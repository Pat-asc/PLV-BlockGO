using Npgsql;

namespace Client_app.Services;

public static class FacultyAssignmentRosterService
{
    public enum ResolutionStatus { Resolved, NotFound, Inactive, UnresolvedLegacy, AmbiguousLegacy }

    public sealed record Assignment(
        int Id, int FacultyUserId, string FacultyEmail, string Department, string Section,
        string YearLevel, string Subject, int AcademicSectionId, string SchoolYear,
        string Semester, string CanonicalSection, bool IsLegacyResolution);

    public sealed record RosterStudent(
        long EnrollmentId, int StudentUserId, string StudentNo, string FullName, string Email,
        int AcademicSectionId, int ProgramId, string SchoolYear, string Semester,
        string EnrollmentStatus);

    public sealed record Resolution(ResolutionStatus Status, Assignment? Value, string? Message);

    public static async Task<Resolution> ResolveAsync(
        NpgsqlConnection connection, int facultySectionId, bool includeInactive = false,
        CancellationToken cancellationToken = default)
    {
        await using var command = new NpgsqlCommand(@"
            SELECT fs.id, fs.user_id, u.email, fs.department, fs.section,
                   COALESCE(fs.year_level, ''), COALESCE(fs.subject, ''),
                   fs.academic_section_id, fs.school_year, fs.semester,
                   fs.is_active,
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

        await using var legacy = new NpgsqlCommand(@"
            SELECT DISTINCT s.id, e.school_year, e.semester,
                   CONCAT(p.program_code, ' ', s.year_level, '-', s.section_num)
            FROM facultysections fs
            JOIN academicsections s
              ON s.year_level::text = TRIM(fs.year_level)
             AND (TRIM(fs.section) = s.section_num::text
                  OR SUBSTRING(fs.section FROM '([1-4]-[0-9]+)') = CONCAT(s.year_level, '-', s.section_num))
            JOIN academic_programs p
              ON LOWER(s.department) IN (LOWER(p.program_code), LOWER(p.program_name))
             AND LOWER(fs.department) IN (LOWER(p.program_code), LOWER(p.program_name))
            JOIN student_enrollments e ON e.academic_section_id = s.id
            WHERE fs.id = @id
            ORDER BY s.id, e.school_year, e.semester;", connection);
        legacy.Parameters.AddWithValue("id", facultySectionId);
        var candidates = new List<(int SectionId, string SchoolYear, string Semester, string Label)>();
        await using var legacyReader = await legacy.ExecuteReaderAsync(cancellationToken);
        while (await legacyReader.ReadAsync(cancellationToken))
            candidates.Add((legacyReader.GetInt32(0), legacyReader.GetString(1), legacyReader.GetString(2), legacyReader.GetString(3)));

        if (candidates.Count == 0)
            return new(ResolutionStatus.UnresolvedLegacy, null,
                "Legacy faculty assignment has no uniquely identifiable academic period.");
        if (candidates.Count > 1)
            return new(ResolutionStatus.AmbiguousLegacy, null,
                "Legacy faculty assignment matches multiple academic periods; an explicit period is required.");
        var candidate = candidates[0];
        return new(ResolutionStatus.Resolved,
            new(id, facultyUserId, facultyEmail, department, section, yearLevel, subject,
                candidate.SectionId, candidate.SchoolYear, candidate.Semester, candidate.Label, true), null);
    }

    public static async Task<List<RosterStudent>> GetRosterAsync(
        NpgsqlConnection connection, Assignment assignment, CancellationToken cancellationToken = default)
    {
        await using var command = new NpgsqlCommand(@"
            SELECT e.enrollment_id, u.id, e.student_no, COALESCE(sp.full_name, ''), u.email,
                   e.academic_section_id, e.program_id, e.school_year, e.semester, e.status
            FROM student_enrollments e
            JOIN users u ON u.id = e.student_user_id
            JOIN studentprofiles sp ON sp.user_id = u.id
            WHERE e.academic_section_id = @academicSectionId
              AND e.school_year = @schoolYear
              AND e.semester = @semester
              AND e.status = 'ENROLLED'
              AND LOWER(u.role) = 'student'
              AND LOWER(u.status) = 'approved'
              AND u.is_active = TRUE
            ORDER BY sp.full_name, e.student_no;", connection);
        command.Parameters.AddWithValue("academicSectionId", assignment.AcademicSectionId);
        command.Parameters.AddWithValue("schoolYear", assignment.SchoolYear);
        command.Parameters.AddWithValue("semester", assignment.Semester);
        var students = new List<RosterStudent>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            students.Add(new(reader.GetInt64(0), reader.GetInt32(1), reader.GetString(2),
                reader.GetString(3), reader.GetString(4), reader.GetInt32(5), reader.GetInt32(6),
                reader.GetString(7), reader.GetString(8), reader.GetString(9)));
        return students;
    }
}
