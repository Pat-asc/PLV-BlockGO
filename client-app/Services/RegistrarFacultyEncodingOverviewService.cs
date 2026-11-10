using Npgsql;
using NpgsqlTypes;

namespace Client_app.Services;

public sealed record RegistrarFacultyEncodingDetail(
    int FacultyUserId,
    string Name,
    string Email,
    string Department,
    long EncodedWorkloads,
    bool HasEncoded);

public sealed record RegistrarFacultyEncodingOverview(
    long EncodedFaculty,
    long TotalFaculty,
    IReadOnlyList<RegistrarFacultyEncodingDetail> Faculty);

public static class RegistrarFacultyEncodingOverviewService
{
    public static async Task<RegistrarFacultyEncodingOverview> GetAsync(
        NpgsqlConnection connection,
        string schoolYear,
        string semester,
        string term,
        string? department,
        string? program,
        CancellationToken cancellationToken = default)
    {
        await using var command = new NpgsqlCommand(@"
            WITH encoded_rows AS (
                SELECT COALESCE(fs.user_id, faculty_user.id) AS faculty_user_id,
                       COALESCE(NULLIF(BTRIM(pgr.assignment_cycle_id), ''), 'record:' || pgr.id) AS workload_id
                FROM pending_grade_records pgr
                LEFT JOIN facultysections fs ON fs.id::text = pgr.assignment_cycle_id
                LEFT JOIN users faculty_user
                  ON (LOWER(BTRIM(faculty_user.email)) = LOWER(BTRIM(pgr.faculty_id))
                      OR faculty_user.id::text = BTRIM(pgr.faculty_id))
                 AND LOWER(faculty_user.role) = 'faculty'
                WHERE LOWER(BTRIM(pgr.school_year)) = LOWER(BTRIM(@schoolYear))
                  AND LOWER(BTRIM(pgr.semester)) = LOWER(BTRIM(@semester))
                  AND LOWER(BTRIM(COALESCE(pgr.term, ''))) = LOWER(BTRIM(@term))
                UNION ALL
                SELECT COALESCE(fs.user_id, faculty_user.id) AS faculty_user_id,
                       COALESCE(NULLIF(BTRIM(snapshot.assignment_cycle_id), ''), 'record:' || snapshot.record_id) AS workload_id
                FROM grade_submission_snapshots snapshot
                LEFT JOIN facultysections fs ON fs.id::text = snapshot.assignment_cycle_id
                LEFT JOIN users faculty_user
                  ON (LOWER(BTRIM(faculty_user.email)) = LOWER(BTRIM(snapshot.faculty_id))
                      OR faculty_user.id::text = BTRIM(snapshot.faculty_id))
                 AND LOWER(faculty_user.role) = 'faculty'
                WHERE LOWER(BTRIM(snapshot.school_year)) = LOWER(BTRIM(@schoolYear))
                  AND LOWER(BTRIM(snapshot.semester)) = LOWER(BTRIM(@semester))
                  AND LOWER(BTRIM(COALESCE(snapshot.term, ''))) = LOWER(BTRIM(@term))
            ), encoded AS (
                SELECT faculty_user_id, COUNT(DISTINCT workload_id) AS workload_count
                FROM encoded_rows
                WHERE faculty_user_id IS NOT NULL
                GROUP BY faculty_user_id
            )
            SELECT faculty.id,
                   COALESCE(NULLIF(BTRIM(profile.full_name), ''), faculty.email) AS faculty_name,
                   faculty.email,
                   COALESCE(NULLIF(BTRIM(profile.department), ''), faculty.organization, '') AS department,
                   COALESCE(encoded.workload_count, 0) AS encoded_workloads
            FROM users faculty
            LEFT JOIN facultyprofiles profile ON profile.user_id = faculty.id
            LEFT JOIN encoded ON encoded.faculty_user_id = faculty.id
            WHERE LOWER(faculty.role) = 'faculty'
              AND LOWER(faculty.status) = 'approved'
              AND faculty.is_active = TRUE
              AND (@department IS NULL OR LOWER(COALESCE(profile.department, faculty.organization, '')) = LOWER(@department))
              AND (@program IS NULL OR LOWER(COALESCE(profile.department, faculty.organization, '')) = LOWER(@program))
            ORDER BY faculty_name, faculty.id;", connection);
        command.Parameters.AddWithValue("schoolYear", schoolYear);
        command.Parameters.AddWithValue("semester", semester);
        command.Parameters.AddWithValue("term", term);
        command.Parameters.Add("department", NpgsqlDbType.Text).Value =
            string.IsNullOrWhiteSpace(department) ? DBNull.Value : department.Trim();
        command.Parameters.Add("program", NpgsqlDbType.Text).Value =
            string.IsNullOrWhiteSpace(program) ? DBNull.Value : program.Trim();

        var faculty = new List<RegistrarFacultyEncodingDetail>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var workloads = reader.GetInt64(4);
            faculty.Add(new RegistrarFacultyEncodingDetail(
                reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                workloads, workloads > 0));
        }

        return new RegistrarFacultyEncodingOverview(
            faculty.LongCount(item => item.HasEncoded), faculty.Count, faculty);
    }
}
