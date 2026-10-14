using System.Text.RegularExpressions;
using Client_app.Models;
using Npgsql;

namespace Client_app.Services;

public static class FacultyBulkAssignmentService
{
    public sealed record ResolvedAcademicSection(
        int Id, string ProgramCode, string ProgramName, int YearLevel, int SectionNumber);

    public sealed record SavedAssignment(
        int Id,
        int FacultyUserId,
        string FacultyEmail,
        string FacultyName,
        string Program,
        string ProgramCode,
        string Section,
        int YearLevel,
        string SubjectCode,
        int AcademicSectionId,
        string SchoolYear,
        string Semester,
        string Schedule,
        bool AlreadyAssigned)
    {
        public string AssignmentCycleId => Id.ToString();
    }

    public static async Task<ResolvedAcademicSection> ResolveAcademicSectionAsync(
        NpgsqlConnection connection,
        string? program,
        string? section,
        string? schoolYear,
        string? semester,
        int? selectedAcademicSectionId,
        Func<string, CancellationToken, Task<bool>> canManageProgram,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(program))
            throw new ArgumentException("Academic program is required to resolve the section.");
        if (string.IsNullOrWhiteSpace(section))
            throw new ArgumentException("Section is required. Use its displayed name, for example BSIT 1-1.");

        var requestedSchoolYear = NormalizeSchoolYear(schoolYear);
        var requestedSemester = NormalizeSemester(semester);
        await using (var period = new NpgsqlCommand(@"
            SELECT school_year, semester
            FROM academic_periods
            WHERE status = 'ACTIVE'
            ORDER BY opened_at DESC
            LIMIT 1;", connection))
        await using (var reader = await period.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
                throw new ArgumentException("No authoritative active academic period is configured. Ask the Registrar to open the academic period before assigning faculty loads.");
            var activeSchoolYear = NormalizeSchoolYear(reader.GetString(0));
            var activeSemester = NormalizeSemester(reader.GetString(1));
            if (!string.Equals(requestedSchoolYear, activeSchoolYear, StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(requestedSemester, activeSemester, StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException($"Faculty assignment period {requestedSchoolYear} {requestedSemester} does not match the active academic period {activeSchoolYear} {activeSemester}.");
        }

        var candidates = new List<ResolvedAcademicSection>();
        await using (var command = new NpgsqlCommand(@"
            SELECT section.id, p.program_code, p.program_name,
                   section.year_level, section.section_num
            FROM academicsections section
            JOIN academic_programs p
              ON LOWER(section.department) IN (LOWER(p.program_code), LOWER(p.program_name))
            WHERE section.is_active = TRUE
              AND p.is_active = TRUE
              AND LOWER(BTRIM(@program)) IN (LOWER(p.program_code), LOWER(p.program_name))
              AND (@selectedAcademicSectionId = 0 OR section.id = @selectedAcademicSectionId)
            ORDER BY section.id;", connection))
        {
            command.Parameters.AddWithValue("program", program.Trim());
            command.Parameters.AddWithValue("selectedAcademicSectionId", selectedAcademicSectionId.GetValueOrDefault());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var candidate = new ResolvedAcademicSection(
                    reader.GetInt32(0), reader.GetString(1), reader.GetString(2),
                    reader.GetInt32(3), reader.GetInt32(4));
                var requestedLabel = NormalizeSectionLabel(section);
                var canonicalLabel = NormalizeSectionLabel($"{candidate.ProgramCode} {candidate.YearLevel}-{candidate.SectionNumber}");
                var shortLabel = NormalizeSectionLabel($"{candidate.YearLevel}-{candidate.SectionNumber}");
                if (requestedLabel == canonicalLabel || requestedLabel == shortLabel)
                    candidates.Add(candidate);
            }
        }

        if (candidates.Count == 0)
            throw new ArgumentException(selectedAcademicSectionId.GetValueOrDefault() > 0
                ? "The uploaded Section does not match the selected active section."
                : "The Section does not identify an active section in the selected academic program.");
        if (candidates.Count > 1)
            throw new ArgumentException("The Section is ambiguous in the selected academic program. Use its full displayed name, for example BSIT 1-1.");

        var resolved = candidates[0];
        if (!await canManageProgram(resolved.ProgramCode, cancellationToken))
            throw new UnauthorizedAccessException("Unauthorized department assignment.");
        return resolved;
    }

    public static async Task<SavedAssignment> AssignAsync(
        NpgsqlConnection connection,
        BulkFacultyAssignmentItemRequest request,
        Func<string, CancellationToken, Task<bool>> canManageProgram,
        CancellationToken cancellationToken = default)
    {
        if (request.FacultyUserId <= 0) throw new ArgumentException("Faculty not found: a valid facultyUserId is required.");
        if (request.AcademicSectionId <= 0) throw new ArgumentException("Academic section not found: a valid academicSectionId is required.");
        if (string.IsNullOrWhiteSpace(request.SubjectCode)) throw new ArgumentException("Subject not found: subjectCode is required.");
        var requestedSchoolYear = NormalizeSchoolYear(request.SchoolYear);
        var requestedSemester = NormalizeSemester(request.Semester);
        var schedule = NormalizeSchedule(request.Schedule);

        string programCode;
        await using (var scope = new NpgsqlCommand(@"
            SELECT p.program_code
            FROM academicsections section
            JOIN academic_programs p
              ON LOWER(section.department) IN (LOWER(p.program_code), LOWER(p.program_name))
            WHERE section.id = @academicSectionId AND section.is_active = TRUE AND p.is_active = TRUE
            LIMIT 1;", connection))
        {
            scope.Parameters.AddWithValue("academicSectionId", request.AcademicSectionId);
            programCode = (await scope.ExecuteScalarAsync(cancellationToken) as string)
                ?? throw new ArgumentException("Academic section not found.");
        }

        if (!await canManageProgram(programCode, cancellationToken))
            throw new UnauthorizedAccessException("Unauthorized department assignment.");

        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            string schoolYear;
            string semester;
            await using (var period = new NpgsqlCommand(@"
                SELECT school_year, semester
                FROM academic_periods
                WHERE status = 'ACTIVE'
                ORDER BY opened_at DESC
                LIMIT 1
                FOR SHARE;", connection, transaction))
            await using (var reader = await period.ExecuteReaderAsync(cancellationToken))
            {
                if (!await reader.ReadAsync(cancellationToken))
                    throw new ArgumentException("No authoritative active academic period is configured. Ask the Registrar to open the academic period before assigning faculty loads.");
                schoolYear = NormalizeSchoolYear(reader.GetString(0));
                semester = NormalizeSemester(reader.GetString(1));
            }

            if (!string.Equals(requestedSchoolYear, schoolYear, StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(requestedSemester, semester, StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException(
                    $"Faculty assignment period {requestedSchoolYear} {requestedSemester} does not match " +
                    $"the active academic period {schoolYear} {semester}. " +
                    "Refresh Academic Assignment and use a section enrolled in the active academic period.");
            }

            int yearLevel;
            int sectionNumber;
            string programName;
            await using (var section = new NpgsqlCommand(@"
                SELECT section.year_level, section.section_num, p.program_name, p.program_code
                FROM academicsections section
                JOIN academic_programs p
                  ON LOWER(section.department) IN (LOWER(p.program_code), LOWER(p.program_name))
                WHERE section.id = @academicSectionId AND section.is_active = TRUE AND p.is_active = TRUE
                FOR UPDATE OF section;", connection, transaction))
            {
                section.Parameters.AddWithValue("academicSectionId", request.AcademicSectionId);
                await using var reader = await section.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken)) throw new ArgumentException("Academic section not found.");
                yearLevel = reader.GetInt32(0);
                sectionNumber = reader.GetInt32(1);
                programName = reader.GetString(2);
                programCode = reader.GetString(3);
            }

            await using (var enrollment = new NpgsqlCommand(@"
                SELECT school_year, semester
                FROM student_enrollments
                WHERE academic_section_id = @academicSectionId
                  AND UPPER(BTRIM(status)) = 'ENROLLED'
                  AND (school_year <> @schoolYear OR semester <> @semester)
                LIMIT 1
                FOR SHARE;", connection, transaction))
            {
                enrollment.Parameters.AddWithValue("academicSectionId", request.AcademicSectionId);
                enrollment.Parameters.AddWithValue("schoolYear", schoolYear);
                enrollment.Parameters.AddWithValue("semester", semester);
                await using var reader = await enrollment.ExecuteReaderAsync(cancellationToken);
                if (await reader.ReadAsync(cancellationToken))
                    throw new ArgumentException(
                        $"Section enrollment belongs to {reader.GetString(0)} {reader.GetString(1)}, " +
                        $"but the active academic period is {schoolYear} {semester}. " +
                        "Use a section enrolled in the active academic period.");
            }

            var subjectCode = request.SubjectCode.Trim();
            await using (var subject = new NpgsqlCommand(@"
                SELECT 1
                FROM curriculum_subjects cs
                JOIN curriculums c ON c.curriculum_id = cs.curriculum_id AND c.status = 'PUBLISHED'
                JOIN academic_programs p ON p.program_id = c.program_id
                WHERE LOWER(p.program_code) = LOWER(@programCode)
                  AND cs.year_level = @yearLevel
                  AND cs.semester = @semester
                  AND LOWER(cs.subject_code) = LOWER(@subjectCode)
                LIMIT 1;", connection, transaction))
            {
                subject.Parameters.AddWithValue("programCode", programCode);
                subject.Parameters.AddWithValue("yearLevel", yearLevel);
                subject.Parameters.AddWithValue("semester", semester);
                subject.Parameters.AddWithValue("subjectCode", subjectCode);
                if (await subject.ExecuteScalarAsync(cancellationToken) is null)
                    throw new ArgumentException("Subject not found in the published curriculum for the selected section and semester.");
            }

            string facultyEmail;
            string facultyName;
            await using (var faculty = new NpgsqlCommand(@"
                SELECT u.email, fp.full_name
                FROM users u
                JOIN facultyprofiles fp ON fp.user_id = u.id
                WHERE u.id = @facultyUserId
                  AND LOWER(u.role) = 'faculty'
                  AND LOWER(u.status) = 'approved'
                  AND u.is_active = TRUE
                  AND LOWER(fp.department) IN (LOWER(@programCode), LOWER(@programName))
                FOR UPDATE OF u;", connection, transaction))
            {
                faculty.Parameters.AddWithValue("facultyUserId", request.FacultyUserId);
                faculty.Parameters.AddWithValue("programCode", programCode);
                faculty.Parameters.AddWithValue("programName", programName);
                await using var reader = await faculty.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                    throw new ArgumentException("Faculty not found in the selected academic program, or the account is inactive.");
                facultyEmail = reader.GetString(0);
                facultyName = reader.GetString(1);
            }

            var sectionLabel = $"{programCode} {yearLevel}-{sectionNumber}";
            await using (var existing = new NpgsqlCommand(@"
                SELECT id, COALESCE(schedule, '')
                FROM facultysections
                WHERE user_id = @facultyUserId
                  AND academic_section_id = @academicSectionId
                  AND school_year = @schoolYear
                  AND semester = @semester
                  AND LOWER(subject) = LOWER(@subjectCode)
                  AND is_active = TRUE
                LIMIT 1;", connection, transaction))
            {
                existing.Parameters.AddWithValue("facultyUserId", request.FacultyUserId);
                existing.Parameters.AddWithValue("academicSectionId", request.AcademicSectionId);
                existing.Parameters.AddWithValue("schoolYear", schoolYear);
                existing.Parameters.AddWithValue("semester", semester);
                existing.Parameters.AddWithValue("subjectCode", subjectCode);
                await using var existingReader = await existing.ExecuteReaderAsync(cancellationToken);
                if (await existingReader.ReadAsync(cancellationToken))
                {
                    var existingId = existingReader.GetInt32(0);
                    var existingSchedule = existingReader.GetString(1);
                    await existingReader.CloseAsync();
                    await transaction.CommitAsync(cancellationToken);
                    return new SavedAssignment(existingId, request.FacultyUserId, facultyEmail, facultyName,
                        programName, programCode, sectionLabel, yearLevel, subjectCode,
                        request.AcademicSectionId, schoolYear, semester, existingSchedule, true);
                }
            }

            var requestedBlocks = FacultyScheduleConflictPolicy.Parse(schedule, false);
            if (requestedBlocks.Count > 0)
            {
                await using var conflicts = new NpgsqlCommand(@"
                    SELECT section, subject, COALESCE(schedule, '')
                    FROM facultysections
                    WHERE user_id = @facultyUserId
                      AND school_year = @schoolYear
                      AND semester = @semester
                      AND is_active = TRUE
                      AND NULLIF(BTRIM(schedule), '') IS NOT NULL
                    ORDER BY id;", connection, transaction);
                conflicts.Parameters.AddWithValue("facultyUserId", request.FacultyUserId);
                conflicts.Parameters.AddWithValue("schoolYear", schoolYear);
                conflicts.Parameters.AddWithValue("semester", semester);
                await using var conflictReader = await conflicts.ExecuteReaderAsync(cancellationToken);
                while (await conflictReader.ReadAsync(cancellationToken))
                {
                    var existingSection = conflictReader.GetString(0);
                    var existingSubject = conflictReader.GetString(1);
                    var existingSchedule = conflictReader.GetString(2);
                    if (FacultyScheduleConflictPolicy.Overlaps(schedule, existingSchedule))
                        throw new ArgumentException(
                            $"Schedule conflict: this Faculty member is already assigned to " +
                            FacultyScheduleConflictPolicy.Describe(existingSection, existingSubject, existingSchedule) + ".");
                }
            }

            object? insertedId;
            await using (var insert = new NpgsqlCommand(@"
                INSERT INTO facultysections
                    (user_id, department, section, year_level, subject,
                     academic_section_id, school_year, semester, schedule, is_active)
                VALUES (@facultyUserId, @programName, @section, @yearLevel, @subjectCode,
                        @academicSectionId, @schoolYear, @semester, @schedule, TRUE)
                ON CONFLICT DO NOTHING
                RETURNING id;", connection, transaction))
            {
                insert.Parameters.AddWithValue("facultyUserId", request.FacultyUserId);
                insert.Parameters.AddWithValue("programName", programName);
                insert.Parameters.AddWithValue("section", sectionLabel);
                insert.Parameters.AddWithValue("yearLevel", yearLevel.ToString());
                insert.Parameters.AddWithValue("subjectCode", subjectCode);
                insert.Parameters.AddWithValue("academicSectionId", request.AcademicSectionId);
                insert.Parameters.AddWithValue("schoolYear", schoolYear);
                insert.Parameters.AddWithValue("semester", semester);
                insert.Parameters.AddWithValue("schedule", schedule);
                insertedId = await insert.ExecuteScalarAsync(cancellationToken);
            }

            var alreadyAssigned = insertedId is null;
            if (alreadyAssigned)
            {
                await using var existing = new NpgsqlCommand(@"
                    SELECT id, COALESCE(schedule, '')
                    FROM facultysections
                    WHERE user_id = @facultyUserId
                      AND academic_section_id = @academicSectionId
                      AND school_year = @schoolYear
                      AND semester = @semester
                      AND LOWER(subject) = LOWER(@subjectCode)
                      AND is_active = TRUE
                    LIMIT 1;", connection, transaction);
                existing.Parameters.AddWithValue("facultyUserId", request.FacultyUserId);
                existing.Parameters.AddWithValue("academicSectionId", request.AcademicSectionId);
                existing.Parameters.AddWithValue("schoolYear", schoolYear);
                existing.Parameters.AddWithValue("semester", semester);
                existing.Parameters.AddWithValue("subjectCode", subjectCode);
                await using var existingReader = await existing.ExecuteReaderAsync(cancellationToken);
                if (!await existingReader.ReadAsync(cancellationToken))
                    throw new InvalidOperationException("Assignment conflicts with an existing faculty load.");
                insertedId = existingReader.GetInt32(0);
                schedule = existingReader.GetString(1);
            }

            await transaction.CommitAsync(cancellationToken);
            return new SavedAssignment(
                Convert.ToInt32(insertedId), request.FacultyUserId, facultyEmail, facultyName,
                programName, programCode, sectionLabel, yearLevel, subjectCode,
                request.AcademicSectionId, schoolYear, semester, schedule, alreadyAssigned);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private static string NormalizeSchoolYear(string? value)
    {
        var normalized = (value ?? string.Empty).Trim();
        var match = Regex.Match(normalized, @"^(\d{4})\s*[-/]\s*(\d{4})$");
        if (!match.Success || int.Parse(match.Groups[2].Value) != int.Parse(match.Groups[1].Value) + 1)
            throw new ArgumentException("Missing or invalid school year. Use YYYY-YYYY with consecutive years.");
        return $"{match.Groups[1].Value}-{match.Groups[2].Value}";
    }

    private static string NormalizeSemester(string? value)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant().Replace("_", " ").Replace("-", " ");
        return normalized switch
        {
            "first" or "1" or "1st" or "first semester" or "1st semester" => "FIRST",
            "second" or "2" or "2nd" or "second semester" or "2nd semester" => "SECOND",
            "midyear" or "mid year" or "summer" => "MIDYEAR",
            "" => throw new ArgumentException("Missing semester."),
            _ => throw new ArgumentException("Semester must be First, Second, or Midyear.")
        };
    }

    private static string NormalizeSchedule(string? value)
    {
        var normalized = Regex.Replace((value ?? string.Empty).Trim(), @"\s+", " ");
        if (normalized.Length > 160)
            throw new ArgumentException("Schedule must not exceed 160 characters.");
        if (normalized.Contains('|') || Regex.IsMatch(normalized, @"\d{1,2}:\d{2}"))
            _ = FacultyScheduleConflictPolicy.Parse(normalized);
        return normalized;
    }

    private static string NormalizeSectionLabel(string? value) =>
        Regex.Replace((value ?? string.Empty).Trim().ToLowerInvariant(), @"\s+", string.Empty);
}
