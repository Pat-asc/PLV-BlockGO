using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Npgsql;
using System;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.SignalR;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Client_app.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class SystemSettingsController : ControllerBase
    {
        private readonly string _connectionString;
        private readonly ILogger<SystemSettingsController> _logger;
        private readonly IHubContext<ChatHub> _chatHubContext;
        private static readonly object SchemaInitializationLock = new();
        private static bool _schemaInitialized;

        public SystemSettingsController(IConfiguration configuration, ILogger<SystemSettingsController> logger, IHubContext<ChatHub> chatHubContext)
        {
            _connectionString = configuration.GetConnectionString("PostgresConnection") ?? configuration.GetConnectionString("MasterConnection") ?? throw new InvalidOperationException("PostgreSQL connection string not found.");
            _logger = logger;
            _chatHubContext = chatHubContext;
            EnsureTableExists();
        }

        private void EnsureTableExists()
        {
            if (System.Threading.Volatile.Read(ref _schemaInitialized)) return;
            lock (SchemaInitializationLock)
            {
                if (System.Threading.Volatile.Read(ref _schemaInitialized)) return;
                try
                {
                    using var conn = new NpgsqlConnection(_connectionString);
                    conn.Open();
                    using var cmd = new NpgsqlCommand(@"
                        CREATE TABLE IF NOT EXISTS SystemSettings (
                            key VARCHAR(255) PRIMARY KEY,
                            value TEXT NOT NULL
                        );", conn);
                    cmd.ExecuteNonQuery();
                    System.Threading.Volatile.Write(ref _schemaInitialized, true);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "System settings schema initialization was deferred.");
                }
            }
        }

        public class SettingRequest
        {
            public string Key { get; set; } = string.Empty;
            public string Value { get; set; } = string.Empty;
        }

        public sealed class ResetEncodingSeasonRequest
        {
            public string SchoolYear { get; set; } = string.Empty;
            public string Semester { get; set; } = string.Empty;
            public string Term { get; set; } = string.Empty;
            public string? StartDate { get; set; }
            public string? EndDate { get; set; }
        }

        [HttpGet("{key}")]
        public async Task<IActionResult> GetSetting(string key)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                using var cmd = new NpgsqlCommand("SELECT value FROM SystemSettings WHERE key = @k", conn);
                cmd.Parameters.AddWithValue("k", key);
                var value = await cmd.ExecuteScalarAsync();
                if (value != null)
                {
                    return Ok(new { status = "Success", value = value.ToString() });
                }
                return NotFound(new { status = "Error", message = "Setting not found." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPost]
        [Authorize(Roles = "registrar,system_admin")]
        public async Task<IActionResult> SaveSetting([FromBody] SettingRequest req)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                using var cmd = new NpgsqlCommand(@"
                    INSERT INTO SystemSettings (key, value) VALUES (@k, @v) 
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", conn);
                cmd.Parameters.AddWithValue("k", req.Key);
                cmd.Parameters.AddWithValue("v", req.Value);
                await cmd.ExecuteNonQueryAsync();
                await _chatHubContext.Clients.All.SendAsync("SystemSettingChanged", new
                {
                    Key = req.Key,
                    Value = req.Value,
                    UpdatedAt = DateTime.UtcNow
                });
                return Ok(new { status = "Success" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPost("reset-season")]
        [Authorize(Roles = "registrar,system_admin")]
        public async Task<IActionResult> ResetEncodingSeason([FromBody] ResetEncodingSeasonRequest request)
        {
            try
            {
                var schoolYear = request.SchoolYear?.Trim() ?? string.Empty;
                if (!Regex.IsMatch(schoolYear, @"^\d{4}-\d{4}$") ||
                    int.Parse(schoolYear[5..]) != int.Parse(schoolYear[..4]) + 1)
                    return BadRequest(new { status = "Error", message = "School year must use the consecutive YYYY-YYYY format." });
                var semester = (request.Semester ?? "").Trim().ToUpperInvariant() switch
                {
                    "1ST SEMESTER" or "FIRST" => "FIRST",
                    "2ND SEMESTER" or "SECOND" => "SECOND",
                    "SUMMER" or "MIDYEAR" => "MIDYEAR",
                    _ => ""
                };
                var term = (request.Term ?? "").Trim().ToLowerInvariant();
                if (semester.Length == 0 || term is not ("midterm" or "finals"))
                    return BadRequest(new { status = "Error", message = "A valid semester and encoding term are required." });
                DateOnly? startDate = string.IsNullOrWhiteSpace(request.StartDate) ? null :
                    DateOnly.TryParse(request.StartDate, out var parsedStart) ? parsedStart :
                    throw new ArgumentException("Start date is invalid.");
                DateOnly? endDate = string.IsNullOrWhiteSpace(request.EndDate) ? null :
                    DateOnly.TryParse(request.EndDate, out var parsedEnd) ? parsedEnd :
                    throw new ArgumentException("End date is invalid.");
                if (startDate.HasValue && endDate.HasValue && endDate < startDate)
                    return BadRequest(new { status = "Error", message = "End date cannot be before start date." });

                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                using var tx = await conn.BeginTransactionAsync();

                await using (var closePeriod = new NpgsqlCommand(@"
                    UPDATE academic_periods
                    SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP
                    WHERE status = 'ACTIVE';", conn, tx))
                    await closePeriod.ExecuteNonQueryAsync();

                await using (var openPeriod = new NpgsqlCommand(@"
                    INSERT INTO academic_periods
                        (school_year, semester, term, start_date, end_date, opened_by)
                    VALUES (@schoolYear, @semester, @term, @startDate, @endDate,
                            (SELECT id FROM users WHERE LOWER(email) = LOWER(@actor) LIMIT 1));", conn, tx))
                {
                    openPeriod.Parameters.AddWithValue("schoolYear", schoolYear);
                    openPeriod.Parameters.AddWithValue("semester", semester);
                    openPeriod.Parameters.AddWithValue("term", term);
                    openPeriod.Parameters.AddWithValue("startDate", (object?)startDate ?? DBNull.Value);
                    openPeriod.Parameters.AddWithValue("endDate", (object?)endDate ?? DBNull.Value);
                    openPeriod.Parameters.AddWithValue("actor", User.Identity?.Name ?? "unknown");
                    await openPeriod.ExecuteNonQueryAsync();
                }

                // End the current teaching cycles without deleting their workflow or
                // academic history. New assignments receive new FacultySections IDs.
                using var cmdDeactivateAssignments = new NpgsqlCommand(@"
                    UPDATE FacultySections
                    SET is_active = FALSE,
                        deactivated_at = CURRENT_TIMESTAMP,
                        deactivated_by = @actor
                    WHERE is_active = TRUE", conn, tx);
                cmdDeactivateAssignments.Parameters.AddWithValue("actor", User.Identity?.Name ?? "unknown");
                var deactivatedAssignmentCount = await cmdDeactivateAssignments.ExecuteNonQueryAsync();

                var displaySemester = semester switch { "FIRST" => "1st Semester", "SECOND" => "2nd Semester", _ => "Summer" };
                var resetEncodingPeriod = JsonSerializer.Serialize(new
                {
                    schoolYear,
                    semester = displaySemester,
                    startDate = startDate?.ToString("yyyy-MM-dd") ?? "",
                    endDate = endDate?.ToString("yyyy-MM-dd") ?? "",
                    term
                });
                using var cmdResetEncodingPeriod = new NpgsqlCommand(@"
                    INSERT INTO SystemSettings (key, value) VALUES ('encoding_period', @value)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", conn, tx);
                cmdResetEncodingPeriod.Parameters.AddWithValue("value", resetEncodingPeriod);
                await cmdResetEncodingPeriod.ExecuteNonQueryAsync();

                await tx.CommitAsync();

                _logger.LogInformation("Encoding season reset by {User}", User.Identity?.Name);
                await _chatHubContext.Clients.All.SendAsync("SystemSettingChanged", new
                {
                    Key = "encoding_period",
                    Value = resetEncodingPeriod,
                    UpdatedAt = DateTime.UtcNow
                });
                await _chatHubContext.Clients.All.SendAsync("AcademicDataChanged", new
                {
                    Reason = "encoding_season_reset",
                    Department = string.Empty,
                    Actor = User.Identity?.Name ?? "unknown",
                    OccurredAt = DateTimeOffset.UtcNow
                });

                return Ok(new
                {
                    status = "Success",
                    message = "Encoding season reset. Current faculty assignments were deactivated; grade workflow history, finalized ledger records, and saved sections were preserved.",
                    deactivatedAssignmentCount,
                    clearedDraftGradeCount = 0,
                    academicContext = new { schoolYear, semester, term }
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { status = "Error", message = ex.Message });
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                return Conflict(new { status = "Error", message = "That academic period already exists. Choose a new school year, semester, or term." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = $"Failed to reset season: {ex.Message}" });
            }
        }
    }
}
