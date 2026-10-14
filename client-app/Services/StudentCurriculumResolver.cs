using Npgsql;

namespace Client_app.Services;

public static class StudentCurriculumResolver
{
    public static async Task<long?> ResolveAsync(
        NpgsqlConnection connection,
        string authenticatedEmail,
        CancellationToken cancellationToken = default)
    {
        await using var command = new NpgsqlCommand(@"
            SELECT curriculum.curriculum_id
            FROM users account
            JOIN LATERAL (
                SELECT enrollment.program_id, enrollment.curriculum_id
                FROM student_enrollments enrollment
                WHERE enrollment.student_user_id = account.id
                  AND enrollment.status = 'ENROLLED'
                ORDER BY enrollment.school_year DESC,
                         CASE enrollment.semester WHEN 'MIDYEAR' THEN 3 WHEN 'SECOND' THEN 2 ELSE 1 END DESC,
                         enrollment.enrollment_id DESC
                LIMIT 1
            ) assigned ON TRUE
            JOIN curriculums curriculum
              ON curriculum.curriculum_id = assigned.curriculum_id
             AND curriculum.program_id = assigned.program_id
             AND curriculum.status IN ('PUBLISHED', 'ARCHIVED')
            WHERE LOWER(account.email) = LOWER(@actor)
              AND LOWER(account.role) = 'student'
              AND LOWER(account.status) = 'approved'
              AND account.is_active;", connection);
        command.Parameters.AddWithValue("actor", authenticatedEmail);
        var result = await command.ExecuteScalarAsync(cancellationToken);
        return result is null or DBNull ? null : Convert.ToInt64(result);
    }
}
