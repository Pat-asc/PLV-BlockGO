using Npgsql;

namespace Client_app.Services;

public sealed record RegistrarWorkflowOverview(
    long SubmittedToChairperson,
    long ChairpersonApproved,
    long DepartmentApproved,
    long Returned);

public static class RegistrarWorkflowOverviewService
{
    public static async Task<RegistrarWorkflowOverview> GetAsync(
        NpgsqlConnection connection,
        string schoolYear,
        string semester,
        string term,
        string? department = null,
        string? program = null,
        CancellationToken cancellationToken = default)
    {
        await using var command = new NpgsqlCommand(@"
            WITH workflow_workloads AS (
                SELECT DISTINCT
                       LOWER(TRIM(pgr.status)) AS normalized_status,
                       COALESCE(NULLIF(TRIM(pgr.assignment_cycle_id), ''), 'record:' || pgr.id) AS assignment_identity,
                       LOWER(TRIM(COALESCE(pgr.subject_code, ''))) AS subject_identity,
                       LOWER(TRIM(COALESCE(pgr.section, ''))) AS section_identity
                FROM pending_grade_records pgr
                LEFT JOIN facultysections fs
                  ON fs.id::text = pgr.assignment_cycle_id
                 AND LOWER(TRIM(fs.school_year)) = LOWER(TRIM(pgr.school_year))
                 AND LOWER(TRIM(fs.semester)) = LOWER(TRIM(pgr.semester))
                 AND LOWER(TRIM(fs.subject)) = LOWER(TRIM(pgr.subject_code))
                WHERE LOWER(TRIM(pgr.school_year)) = LOWER(TRIM(@schoolYear))
                  AND LOWER(TRIM(pgr.semester)) = LOWER(TRIM(@semester))
                  AND LOWER(TRIM(COALESCE(pgr.term, ''))) = LOWER(TRIM(@term))
                  AND (@department IS NULL OR LOWER(TRIM(COALESCE(fs.department, ''))) = LOWER(TRIM(@department)))
                  AND (@program IS NULL OR LOWER(TRIM(COALESCE(NULLIF(pgr.program, ''), pgr.course, ''))) = LOWER(TRIM(@program)))
                  AND LOWER(TRIM(pgr.status)) IN (
                      'submittedtochairperson', 'chairpersonapproved', 'departmentapproved', 'returned'
                  )
            )
            SELECT normalized_status, COUNT(*)
            FROM workflow_workloads
            GROUP BY normalized_status;", connection);
        command.Parameters.AddWithValue("schoolYear", schoolYear);
        command.Parameters.AddWithValue("semester", semester);
        command.Parameters.AddWithValue("term", term);
        command.Parameters.Add("department", NpgsqlTypes.NpgsqlDbType.Text).Value =
            string.IsNullOrWhiteSpace(department) ? DBNull.Value : department.Trim();
        command.Parameters.Add("program", NpgsqlTypes.NpgsqlDbType.Text).Value =
            string.IsNullOrWhiteSpace(program) ? DBNull.Value : program.Trim();

        long submitted = 0;
        long chairpersonApproved = 0;
        long departmentApproved = 0;
        long returned = 0;
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var count = reader.GetInt64(1);
            switch (reader.GetString(0))
            {
                case "submittedtochairperson": submitted = count; break;
                case "chairpersonapproved": chairpersonApproved = count; break;
                case "departmentapproved": departmentApproved = count; break;
                case "returned": returned = count; break;
            }
        }

        return new RegistrarWorkflowOverview(submitted, chairpersonApproved, departmentApproved, returned);
    }
}
