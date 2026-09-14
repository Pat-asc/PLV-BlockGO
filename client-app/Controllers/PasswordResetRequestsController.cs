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
            ?? throw new InvalidOperationException("A PostgreSQL write connection is required.");
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand(@"
            SELECT pr.request_id, pr.user_id, pr.email, pr.request_status,
                   pr.request_reason, pr.reviewed_at, pr.review_note,
                   pr.completed_at, pr.created_at,
                   COALESCE(sp.full_name, fp.full_name, ap.full_name, pr.email) AS full_name,
                   u.role
            FROM password_reset_requests pr
            JOIN users u ON u.id = pr.user_id
            LEFT JOIN studentprofiles sp ON sp.user_id = u.id
            LEFT JOIN facultyprofiles fp ON fp.user_id = u.id
            LEFT JOIN adminprofiles ap ON ap.user_id = u.id
            WHERE pr.request_status IN ('PENDING', 'APPROVED')
               OR pr.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
            ORDER BY CASE pr.request_status
                         WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2
                     END,
                     pr.created_at DESC;", connection);
        var requests = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            requests.Add(new
            {
                requestId = reader.GetInt64(0),
                userId = reader.GetInt32(1),
                email = reader.GetString(2),
                status = reader.GetString(3),
                reason = reader.IsDBNull(4) ? null : reader.GetString(4),
                reviewedAt = reader.IsDBNull(5) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(5),
                reviewNote = reader.IsDBNull(6) ? null : reader.GetString(6),
                completedAt = reader.IsDBNull(7) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(7),
                createdAt = reader.GetFieldValue<DateTimeOffset>(8),
                fullName = reader.GetString(9),
                role = reader.GetString(10)
            });
        }
        return Ok(new { status = "Success", data = requests });
    }
}
