using System.Text.RegularExpressions;
using Client_app.Models;
using Npgsql;

namespace Client_app.Services;

public static class FacultyBulkAssignmentService
{
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
        bool AlreadyAssigned)
    {
        public string AssignmentCycleId => Id.ToString();
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
        var schoolYear = NormalizeSchoolYear(request.SchoolYear);
        var semester = NormalizeSemester(request.Semester);

        string programCode;
        await using (var scope = new NpgsqlCommand(@"
            SELECT p.program_code
            FROM academicsections section
            JOIN academic_programs p
              ON LOWER(section.department) IN (LOWER(p.program_code), LOWER(p.program_name))
            WHERE section.id = @academicSectionId AND p.is_active = TRUE
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
            int yearLevel;
            int sectionNumber;
            string programName;
            await using (var section = new NpgsqlCommand(@"
                SELECT section.year_level, section.section_num, p.program_name, p.program_code
                FROM academicsections section
                JOIN academic_programs p
                  ON LOWER(section.department) IN (LOWER(p.program_code), LOWER(p.program_name))
                WHERE section.id = @academicSectionId AND p.is_active = TRUE
                FOR SHARE OF section;", connection, transaction))
            {
                section.Parameters.AddWithValue("academicSectionId", request.AcademicSectionId);
                await using var reader = await section.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken)) throw new ArgumentException("Academic section not found.");
                yearLevel = reader.GetInt32(0);
                sectionNumber = reader.GetInt32(1);
                programName = reader.GetString(2);
                programCode = reader.GetString(3);
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
                  AND LOWER(fp.department) IN (LOWER(@programCode), LOWER(@programName));", connection, transaction))
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
            object? insertedId;
            await using (var insert = new NpgsqlCommand(@"
                INSERT INTO facultysections
                    (user_id, department, section, year_level, subject,
                     academic_section_id, school_year, semester, is_active)
                VALUES (@facultyUserId, @programName, @section, @yearLevel, @subjectCode,
                        @academicSectionId, @schoolYear, @semester, TRUE)
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
                insertedId = await insert.ExecuteScalarAsync(cancellationToken);
            }

            var alreadyAssigned = insertedId is null;
            if (alreadyAssigned)
            {
                await using var existing = new NpgsqlCommand(@"
                    SELECT id
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
                insertedId = await existing.ExecuteScalarAsync(cancellationToken);
                if (insertedId is null)
                    throw new InvalidOperationException("Assignment conflicts with an existing faculty load.");
            }

            await transaction.CommitAsync(cancellationToken);
            return new SavedAssignment(
                Convert.ToInt32(insertedId), request.FacultyUserId, facultyEmail, facultyName,
                programName, programCode, sectionLabel, yearLevel, subjectCode,
                request.AcademicSectionId, schoolYear, semester, alreadyAssigned);
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
}
