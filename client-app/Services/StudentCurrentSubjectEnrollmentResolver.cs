using Npgsql;

namespace Client_app.Services;

public sealed record StudentCurrentSubjectEnrollment(
    string StudentNo,
    long EnrollmentId,
    string SchoolYear,
    string Semester,
    short YearLevel,
    int ProgramId,
    string ProgramCode,
    string ProgramName,
    int AcademicSectionId,
    int SectionNumber,
    long CurriculumId,
    string CurriculumStatus,
    string EnrollmentState);

public static class StudentCurrentSubjectEnrollmentResolver
{
    public static async Task<StudentCurrentSubjectEnrollment?> ResolveAsync(
        NpgsqlConnection connection,
        string authenticatedEmail,
        CancellationToken cancellationToken = default)
    {
        await using var command = new NpgsqlCommand(@"
            SELECT profile.student_no, enrollment.enrollment_id, enrollment.school_year,
                   enrollment.semester, enrollment.year_level, program.program_id,
                   program.program_code, program.program_name, section.id, section.section_num,
                   curriculum.curriculum_id, curriculum.status, enrollment.enrollment_state
            FROM users account
            JOIN studentprofiles profile ON profile.user_id = account.id
            JOIN LATERAL (
                SELECT period.school_year, period.semester
                FROM academic_periods period
                WHERE period.status = 'ACTIVE'
                ORDER BY period.opened_at DESC, period.academic_period_id DESC
                LIMIT 1
            ) active_period ON TRUE
            JOIN LATERAL (
                SELECT candidate.*
                FROM student_enrollments candidate
                WHERE candidate.student_user_id = account.id
                  AND candidate.school_year = active_period.school_year
                  AND candidate.semester = active_period.semester
                  AND candidate.status = 'ENROLLED'
                ORDER BY candidate.enrollment_id DESC
                LIMIT 1
            ) enrollment ON TRUE
            JOIN academic_programs program
              ON program.program_id = enrollment.program_id
             AND program.is_active = TRUE
            JOIN academicsections section
              ON section.id = enrollment.academic_section_id
             AND section.is_active = TRUE
             AND section.year_level = enrollment.year_level
             AND LOWER(TRIM(section.department)) IN (
                 LOWER(TRIM(program.program_code)),
                 LOWER(TRIM(program.program_name)))
            JOIN curriculums curriculum
              ON curriculum.curriculum_id = enrollment.curriculum_id
             AND curriculum.program_id = enrollment.program_id
             AND curriculum.status IN ('PUBLISHED', 'ARCHIVED')
            WHERE LOWER(account.email) = LOWER(@actor)
              AND LOWER(account.role) = 'student'
              AND LOWER(account.status) = 'approved'
              AND account.is_active;", connection);
        command.Parameters.AddWithValue("actor", authenticatedEmail);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;

        return new StudentCurrentSubjectEnrollment(
            reader.GetString(0),
            Convert.ToInt64(reader.GetValue(1)),
            reader.GetString(2),
            reader.GetString(3),
            Convert.ToInt16(reader.GetValue(4)),
            Convert.ToInt32(reader.GetValue(5)),
            reader.GetString(6),
            reader.GetString(7),
            Convert.ToInt32(reader.GetValue(8)),
            Convert.ToInt32(reader.GetValue(9)),
            Convert.ToInt64(reader.GetValue(10)),
            reader.GetString(11),
            reader.GetString(12));
    }
}
