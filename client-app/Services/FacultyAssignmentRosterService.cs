using Npgsql;

namespace Client_app.Services;

public static class FacultyAssignmentRosterService
{
    public sealed class RosterDataIntegrityException : Exception
    {
        public long EnrollmentId { get; }
        public int StudentUserId { get; }

        public RosterDataIntegrityException(long enrollmentId, int studentUserId)
            : base($"Enrollment record {enrollmentId} is linked to student record {studentUserId}, but the Registrar student number is missing.")
        {
            EnrollmentId = enrollmentId;
            StudentUserId = studentUserId;
        }
    }

    public enum ResolutionStatus { Resolved, NotFound, Inactive, UnresolvedLegacy, AmbiguousLegacy }

    public sealed record Assignment(
        int Id, int FacultyUserId, string FacultyEmail, string Department, string Section,
        string YearLevel, string Subject, int AcademicSectionId, string SchoolYear,
        string Semester, string CanonicalSection, bool IsLegacyResolution);

    public sealed record RosterStudent(
        long EnrollmentId, int StudentUserId, string StudentNo, string FullName, string Email,
        int AcademicSectionId, int ProgramId, string SchoolYear, string Semester,
        string EnrollmentStatus, string? EnrollmentStudentNo = null);

    public sealed record Resolution(ResolutionStatus Status, Assignment? Value, string? Message);

    public static bool IsOwnedBy(Assignment assignment, string? facultyEmail) =>
        !string.IsNullOrWhiteSpace(facultyEmail) &&
        string.Equals(assignment.FacultyEmail, facultyEmail.Trim(), StringComparison.OrdinalIgnoreCase);

    public static string? ValidateUploadContext(
        Assignment assignment, int academicSectionId, string? subject, string? schoolYear,
        string? semester, string? section)
    {
        if (academicSectionId <= 0)
            return "academicSectionId is required.";
        if (assignment.AcademicSectionId != academicSectionId)
            return "Academic section does not match the selected faculty assignment.";
        if (!string.Equals(assignment.Subject, subject?.Trim(), StringComparison.OrdinalIgnoreCase))
            return "Subject does not match the selected faculty assignment.";

        var canonicalSchoolYear = GradeAcademicPeriod.SchoolYear(schoolYear);
        var canonicalSemester = GradeAcademicPeriod.Semester(semester);
        if (!string.Equals(assignment.SchoolYear, canonicalSchoolYear, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(assignment.Semester, canonicalSemester, StringComparison.OrdinalIgnoreCase))
            return "Academic period does not match the selected faculty assignment.";
        if (!string.Equals(assignment.CanonicalSection, section?.Trim(), StringComparison.OrdinalIgnoreCase))
            return "Section does not match the selected faculty assignment.";

        return null;
    }

    public static (int Missing, int Unexpected) CompareRosterCoverage(
        IEnumerable<RosterStudent> roster, IEnumerable<string> stagedStudentNumbers)
    {
        var rosterNumbers = roster.Select(student => student.StudentNo.Trim())
            .Where(value => value.Length > 0)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var stagedNumbers = stagedStudentNumbers.Select(value => value?.Trim() ?? string.Empty)
            .Where(value => value.Length > 0)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        return (rosterNumbers.Except(stagedNumbers, StringComparer.OrdinalIgnoreCase).Count(),
            stagedNumbers.Except(rosterNumbers, StringComparer.OrdinalIgnoreCase).Count());
    }

    public static async Task<Resolution> ResolveAsync(
        NpgsqlConnection connection, int facultySectionId, bool includeInactive = false,
        CancellationToken cancellationToken = default)
    {
        await using var command = new NpgsqlCommand(@"
            SELECT fs.id, fs.user_id, u.email, fs.department, fs.section,
                   COALESCE(fs.year_level, ''), COALESCE(fs.subject, ''),
                   fs.academic_section_id, fs.school_year, fs.semester,
                   fs.is_active AND (fs.academic_section_id IS NULL OR COALESCE(s.is_active, FALSE)),
                   CASE WHEN s.id IS NULL THEN fs.section
                        ELSE CONCAT(p.program_code, ' ', s.year_level, '-', s.section_num) END
            FROM facultysections fs
            JOIN users u ON u.id = fs.user_id
            LEFT JOIN academicsections s ON s.id = fs.academic_section_id
            LEFT JOIN academic_programs p
              ON LOWER(s.department) IN (LOWER(p.program_code), LOWER(p.program_name))
            WHERE fs.id = @id;", connection);
        command.Parameters.AddWithValue("id", facultySectionId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
            return new(ResolutionStatus.NotFound, null, "Faculty assignment was not found.");

        var id = reader.GetInt32(0);
        var facultyUserId = reader.GetInt32(1);
        var facultyEmail = reader.GetString(2);
        var department = reader.GetString(3);
        var section = reader.GetString(4);
        var yearLevel = reader.GetString(5);
        var subject = reader.GetString(6);
        var academicSectionId = reader.IsDBNull(7) ? (int?)null : reader.GetInt32(7);
        var schoolYear = reader.IsDBNull(8) ? null : reader.GetString(8);
        var semester = reader.IsDBNull(9) ? null : reader.GetString(9);
        var isActive = reader.GetBoolean(10);
        var canonicalSection = reader.GetString(11);
        await reader.CloseAsync();

        if (!isActive && !includeInactive)
            return new(ResolutionStatus.Inactive, null, "Faculty assignment is inactive.");
        if (academicSectionId.HasValue && !string.IsNullOrWhiteSpace(schoolYear) && !string.IsNullOrWhiteSpace(semester))
            return new(ResolutionStatus.Resolved,
                new(id, facultyUserId, facultyEmail, department, section, yearLevel, subject,
                    academicSectionId.Value, schoolYear, semester, canonicalSection, false), null);

        return new(ResolutionStatus.UnresolvedLegacy, null,
            "Faculty assignment is missing its exact academic section or period. Ask the Registrar to recreate the assignment before grading.");
    }

    public static async Task<List<RosterStudent>> GetRosterAsync(
        NpgsqlConnection connection, Assignment assignment, CancellationToken cancellationToken = default)
    {
        await using var command = new NpgsqlCommand(@"
            SELECT e.enrollment_id, u.id, NULLIF(BTRIM(sp.student_no), ''),
                   COALESCE(sp.full_name, ''), u.email,
                   e.academic_section_id, e.program_id, e.school_year, e.semester, e.status,
                   NULLIF(BTRIM(e.student_no), '')
            FROM student_enrollments e
            JOIN users u ON u.id = e.student_user_id
            LEFT JOIN studentprofiles sp ON sp.user_id = u.id
            WHERE e.academic_section_id = @academicSectionId
              AND e.school_year = @schoolYear
              AND e.semester = @semester
              AND e.status = 'ENROLLED'
              AND LOWER(u.role) = 'student'
              AND LOWER(u.status) = 'approved'
              AND u.is_active = TRUE
            ORDER BY sp.full_name, sp.student_no;", connection);
        command.Parameters.AddWithValue("academicSectionId", assignment.AcademicSectionId);
        command.Parameters.AddWithValue("schoolYear", assignment.SchoolYear);
        command.Parameters.AddWithValue("semester", assignment.Semester);
        var students = new List<RosterStudent>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var enrollmentId = reader.GetInt64(0);
            var studentUserId = reader.GetInt32(1);
            if (reader.IsDBNull(2))
                throw new RosterDataIntegrityException(enrollmentId, studentUserId);

            students.Add(new(enrollmentId, studentUserId, reader.GetString(2),
                reader.GetString(3), reader.GetString(4), reader.GetInt32(5), reader.GetInt32(6),
                reader.GetString(7), reader.GetString(8), reader.GetString(9),
                reader.IsDBNull(10) ? null : reader.GetString(10)));
        }
        return students;
    }
}
