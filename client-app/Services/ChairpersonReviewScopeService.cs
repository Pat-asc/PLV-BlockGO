using Npgsql;

namespace Client_app.Services;

public static class ChairpersonReviewScopeService
{
    public static bool IsSubmittedToChairperson(string? status) =>
        string.Equals(status?.Trim(), "SubmittedToChairperson", StringComparison.OrdinalIgnoreCase);

    public static async Task<HashSet<string>> GetCurrentSubmittedRecordIdsAsync(
        NpgsqlConnection connection, string activeTerm, string activeSemester,
        CancellationToken cancellationToken = default)
    {
        return await GetCurrentRecordIdsAsync(connection, activeTerm, activeSemester,
            new[] { "submittedtochairperson" }, cancellationToken);
    }

    public static async Task<HashSet<string>> GetCurrentVisibleRecordIdsAsync(
        NpgsqlConnection connection, string activeTerm, string activeSemester,
        CancellationToken cancellationToken = default)
    {
        return await GetCurrentRecordIdsAsync(connection, activeTerm, activeSemester,
            new[] { "submittedtochairperson", "chairpersonapproved", "departmentapproved" }, cancellationToken);
    }

    private static async Task<HashSet<string>> GetCurrentRecordIdsAsync(
        NpgsqlConnection connection, string activeTerm, string activeSemester, string[] statuses,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(@"
            SELECT pgr.id
            FROM pending_grade_records pgr
            JOIN facultysections fs
              ON fs.id::text = pgr.assignment_cycle_id
            WHERE fs.is_active = TRUE
              AND LOWER(TRIM(fs.school_year)) = LOWER(TRIM(pgr.school_year))
              AND LOWER(TRIM(fs.semester)) = LOWER(TRIM(pgr.semester))
              AND LOWER(TRIM(fs.subject)) = LOWER(TRIM(pgr.subject_code))
              AND LOWER(TRIM(pgr.semester)) = LOWER(TRIM(@semester))
              AND LOWER(TRIM(pgr.term)) = LOWER(TRIM(@term))
              AND LOWER(TRIM(pgr.status)) = ANY(@statuses);", connection);
        command.Parameters.AddWithValue("term", activeTerm);
        command.Parameters.AddWithValue("semester", activeSemester);
        command.Parameters.AddWithValue("statuses", statuses);
        var recordIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            recordIds.Add(reader.GetString(0));
        return recordIds;
    }
}
