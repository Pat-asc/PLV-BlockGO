using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace Client_app.Controllers;

[ApiController]
[Authorize(Roles = "registrar")]
[Route("api/password-reset-requests")]
public sealed class PasswordResetRequestsController : ControllerBase
{
    private readonly string _connectionString;

    public PasswordResetRequestsController(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("MasterConnection")
            ?? configuration.GetConnectionString("PostgresConnection")
            ?? throw new InvalidOperationException(
                "A PostgreSQL write connection is required.");
    }

    [HttpGet]
    public async Task<IActionResult> List(
        CancellationToken cancellationToken)
    {
        await using var connection =
            new NpgsqlConnection(_connectionString);

        await connection.OpenAsync(cancellationToken);

        await using var command = new NpgsqlCommand(@"
            SELECT
                request_id,
                user_id,
                email,
                created_at,
                request_status,
                request_reason,
                reviewed_by,
                reviewed_at,
                review_note,
                completed_at
            FROM password_reset_requests
            WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
            ORDER BY created_at DESC;
        ", connection);

        var requests = new List<object>();

        await using var reader =
            await command.ExecuteReaderAsync(cancellationToken);

        while (await reader.ReadAsync(cancellationToken))
        {
            requests.Add(new
            {
                requestId = reader.GetInt64(0),
                userId = reader.GetInt32(1),
                email = reader.GetString(2),
                createdAt = reader.GetFieldValue<DateTimeOffset>(3),
                status = reader.GetString(4),
                requestReason = reader.IsDBNull(5)
                    ? null
                    : reader.GetString(5),
                reviewedBy = reader.IsDBNull(6)
                    ? (int?)null
                    : reader.GetInt32(6),
                reviewedAt = reader.IsDBNull(7)
                    ? (DateTimeOffset?)null
                    : reader.GetFieldValue<DateTimeOffset>(7),
                reviewNote = reader.IsDBNull(8)
                    ? null
                    : reader.GetString(8),
                completedAt = reader.IsDBNull(9)
                    ? (DateTimeOffset?)null
                    : reader.GetFieldValue<DateTimeOffset>(9)
            });
        }

        return Ok(new
        {
            status = "Success",
            data = requests
        });
    }
}
