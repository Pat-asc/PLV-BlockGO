using Npgsql;

namespace Client_app.Services;

public static class ChairpersonReviewScopeService
{
    public static bool IsSubmittedToChairperson(string? status) =>
        string.Equals(status?.Trim(), "SubmittedToChairperson", StringComparison.OrdinalIgnoreCase);

    public static async Task<HashSet<string>> GetCurrentSubmittedRecordIdsAsync(
        NpgsqlConnection connection, CancellationToken cancellationToken = default)
    {
        await using var command = new NpgsqlCommand(@"
            SELECT pgr.id
            FROM pending_grade_records pgr
            JOIN facultysections fs
              ON fs.id::text = pgr.assignment_cycle_id
            WHERE fs.is_active = TRUE
              AND LOWER(pgr.status) = 'submittedtochairperson';", connection);
        var recordIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            recordIds.Add(reader.GetString(0));
        return recordIds;
    }
}
