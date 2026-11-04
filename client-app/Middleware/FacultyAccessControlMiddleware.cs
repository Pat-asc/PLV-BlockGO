using System.Security.Claims;
using System.Text.Json;
using Npgsql;

namespace Client_app.Middleware;

/// <summary>
/// Keeps an authenticated but blocked Faculty account signed in for Chat while
/// denying every ASP.NET academic/application endpoint. The decision is made on
/// each request so a Chairperson block takes effect without issuing a new JWT.
/// </summary>
public sealed class FacultyAccessControlMiddleware
{
    private readonly RequestDelegate _next;
    private readonly string _connectionString;

    public FacultyAccessControlMiddleware(RequestDelegate next, IConfiguration configuration)
    {
        _next = next;
        _connectionString = configuration.GetConnectionString("PostgresConnection")
            ?? configuration.GetConnectionString("MasterConnection")
            ?? throw new InvalidOperationException("PostgreSQL connection string is not configured.");
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (context.User.Identity?.IsAuthenticated != true || !context.User.IsInRole("faculty") || IsAllowedPath(context.Request.Path))
        {
            await _next(context);
            return;
        }

        var email = context.User.FindFirstValue(ClaimTypes.Email)
            ?? context.User.FindFirstValue(ClaimTypes.Name)
            ?? context.User.Identity?.Name;
        if (string.IsNullOrWhiteSpace(email))
        {
            await _next(context);
            return;
        }

        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync(context.RequestAborted);
        await using var command = new NpgsqlCommand(@"
            SELECT fac.block_reason
            FROM faculty_access_controls fac
            JOIN users u ON u.id = fac.faculty_user_id
            WHERE LOWER(u.email) = LOWER(@email)
              AND fac.is_blocked = TRUE
            LIMIT 1;", connection);
        command.Parameters.AddWithValue("email", email.Trim());
        var reason = await command.ExecuteScalarAsync(context.RequestAborted) as string;
        if (reason is null)
        {
            await _next(context);
            return;
        }

        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsync(JsonSerializer.Serialize(new
        {
            status = "Error",
            code = "FACULTY_BLOCKED",
            message = "Faculty academic access is currently blocked.",
            reason
        }), context.RequestAborted);
    }

    private static bool IsAllowedPath(PathString path) =>
        path.StartsWithSegments("/chatHub") ||
        path.StartsWithSegments("/api/chatHub") ||
        path.StartsWithSegments("/api/Auth/faculty/access-status") ||
        path.StartsWithSegments("/health") ||
        path.StartsWithSegments("/api/ready");
}
