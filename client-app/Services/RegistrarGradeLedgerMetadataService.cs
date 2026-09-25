using Npgsql;

namespace Client_app.Services;

public static class RegistrarGradeLedgerMetadataService
{
    public sealed record AssignmentMetadata(
        string AssignmentCycleId,
        int FacultyUserId,
        string FacultyEmail,
        string FacultyId,
        string FacultyName,
        int? AcademicSectionId,
        int? ProgramId,
        string ProgramCode,
        string ProgramName,
        int? YearLevel,
        int? SectionNumber,
        string SubjectCode,
        string SchoolYear,
        string Semester);

    public sealed record StudentIdentity(
        int UserId,
        string Email,
        string StudentNumber,
        string FullName,
        string Department,
        string Section);

    public static bool IsBrowsableStatus(string? status)
    {
        var normalized = status?.Trim().ToLowerInvariant().Replace(" ", string.Empty).Replace("_", string.Empty);
        return normalized is "submitted" or "submittedtochairperson" or "chairpersonapproved" or
            "departmentapproved" or "approved" or "forwardedtoregistrar" or "issued" or
            "finalized" or "corrected";
    }

    public static async Task<Dictionary<string, AssignmentMetadata>> LoadAssignmentsAsync(
        NpgsqlConnection connection,
        CancellationToken cancellationToken = default)
    {
        await using var command = new NpgsqlCommand(@"
            WITH assignment_programs AS (
                SELECT fs.id,
                       CASE WHEN COUNT(DISTINCT enrollment.program_id) = 1
                            THEN MIN(enrollment.program_id) END AS program_id
                FROM facultysections fs
                LEFT JOIN student_enrollments enrollment
                  ON enrollment.academic_section_id = fs.academic_section_id
                 AND LOWER(TRIM(enrollment.school_year)) = LOWER(TRIM(fs.school_year))
                 AND LOWER(TRIM(enrollment.semester)) = LOWER(TRIM(fs.semester))
                GROUP BY fs.id
            )
            SELECT fs.id::text,
                   fs.user_id,
                   COALESCE(faculty.email, ''),
                   COALESCE(profile.faculty_id, ''),
                   COALESCE(NULLIF(profile.full_name, ''), faculty.email, ''),
                   fs.academic_section_id,
                   program.program_id,
                   COALESCE(program.program_code, ''),
                   COALESCE(program.program_name, ''),
                   section.year_level,
                   section.section_num,
                   COALESCE(fs.subject, ''),
                   COALESCE(fs.school_year, ''),
                   COALESCE(fs.semester, '')
            FROM facultysections fs
            JOIN users faculty ON faculty.id = fs.user_id
            LEFT JOIN facultyprofiles profile ON profile.user_id = fs.user_id
            LEFT JOIN academicsections section ON section.id = fs.academic_section_id
            LEFT JOIN assignment_programs resolved ON resolved.id = fs.id
            LEFT JOIN academic_programs section_program
              ON LOWER(TRIM(section.department)) = LOWER(TRIM(section_program.program_code))
              OR LOWER(TRIM(section.department)) = LOWER(TRIM(section_program.program_name))
            LEFT JOIN academic_programs program
              ON program.program_id = COALESCE(resolved.program_id, section_program.program_id);", connection);

        var assignments = new Dictionary<string, AssignmentMetadata>(StringComparer.OrdinalIgnoreCase);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var assignment = new AssignmentMetadata(
                reader.GetString(0),
                reader.GetInt32(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetInt32(5),
                reader.IsDBNull(6) ? null : reader.GetInt32(6),
                reader.GetString(7),
                reader.GetString(8),
                reader.IsDBNull(9) ? null : reader.GetInt32(9),
                reader.IsDBNull(10) ? null : reader.GetInt32(10),
                reader.GetString(11),
                reader.GetString(12),
                reader.GetString(13));
            assignments[assignment.AssignmentCycleId] = assignment;
        }

        return assignments;
    }

    public static async Task<Dictionary<string, StudentIdentity>> LoadStudentIdentitiesAsync(
        NpgsqlConnection connection,
        CancellationToken cancellationToken = default)
    {
        await using var command = new NpgsqlCommand(@"
            SELECT student.id, COALESCE(student.email, ''), COALESCE(profile.student_no, ''),
                   COALESCE(profile.full_name, ''), COALESCE(profile.department, ''),
                   COALESCE(profile.section, '')
            FROM users student
            JOIN studentprofiles profile ON profile.user_id = student.id
            WHERE LOWER(student.role) = 'student';", connection);

        var students = new Dictionary<string, StudentIdentity>(StringComparer.OrdinalIgnoreCase);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var student = new StudentIdentity(
                reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                reader.GetString(4), reader.GetString(5));
            if (!string.IsNullOrWhiteSpace(student.Email)) students[student.Email] = student;
            if (!string.IsNullOrWhiteSpace(student.StudentNumber)) students[student.StudentNumber] = student;
        }

        return students;
    }
}
