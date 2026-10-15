using Npgsql;

namespace Client_app.Services;

public sealed record LoginActivityEntry(
    long AuditId,
    int UserId,
    string User,
    string Role,
    DateTimeOffset OccurredAt);

public sealed record LoginActivitySummary(
    bool Available,
    long SuccessfulToday,
    long UniqueUsersToday,
    IReadOnlyList<LoginActivityEntry> Recent)
{
    public static LoginActivitySummary Unavailable { get; } = new(false, 0, 0, Array.Empty<LoginActivityEntry>());
}

public static class LoginActivityService
{
    public static async Task<LoginActivitySummary> GetAsync(
        NpgsqlConnection connection,
        int recentLimit = 10,
        CancellationToken cancellationToken = default)
    {
        recentLimit = Math.Clamp(recentLimit, 1, 50);
        long successfulToday;
        long uniqueUsersToday;
        await using (var totals = new NpgsqlCommand(@"
            SELECT COUNT(*), COUNT(DISTINCT user_id)
            FROM audit_logs
            WHERE UPPER(TRIM(action)) = 'LOGIN_SUCCESS'
              AND timestamp >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC');", connection))
        await using (var reader = await totals.ExecuteReaderAsync(cancellationToken))
        {
            await reader.ReadAsync(cancellationToken);
            successfulToday = reader.GetInt64(0);
            uniqueUsersToday = reader.GetInt64(1);
        }

        var recent = new List<LoginActivityEntry>();
        await using var command = new NpgsqlCommand(@"
            SELECT a.audit_id, a.user_id,
                   COALESCE(
                       (SELECT ap.full_name FROM adminprofiles ap WHERE ap.user_id = u.id LIMIT 1),
                       (SELECT fp.full_name FROM facultyprofiles fp WHERE fp.user_id = u.id LIMIT 1),
                       (SELECT sp.full_name FROM studentprofiles sp WHERE sp.user_id = u.id LIMIT 1),
                       u.username, u.email, 'Unknown user'
                   ) AS actor,
                   COALESCE(NULLIF(TRIM(a.actor_role), ''), u.role, 'unknown') AS actor_role,
                   a.timestamp
            FROM audit_logs a
            JOIN users u ON u.id = a.user_id
            WHERE UPPER(TRIM(a.action)) = 'LOGIN_SUCCESS'
            ORDER BY a.timestamp DESC, a.audit_id DESC
            LIMIT @limit;", connection);
        command.Parameters.AddWithValue("limit", recentLimit);
        await using var recentReader = await command.ExecuteReaderAsync(cancellationToken);
        while (await recentReader.ReadAsync(cancellationToken))
        {
            var occurredAt = recentReader.GetFieldValue<DateTime>(4);
            recent.Add(new LoginActivityEntry(
                recentReader.GetInt64(0),
                recentReader.GetInt32(1),
                recentReader.GetString(2),
                recentReader.GetString(3),
                new DateTimeOffset(DateTime.SpecifyKind(occurredAt, DateTimeKind.Utc))));
        }

        return new LoginActivitySummary(true, successfulToday, uniqueUsersToday, recent);
    }
}
