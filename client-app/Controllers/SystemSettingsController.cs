using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Npgsql;
using System;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.SignalR;
using System.Text.RegularExpressions;
using Client_app.Services;

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

        [HttpGet("academic-period-options")]
        [Authorize(Roles = "registrar,system_admin")]
        public async Task<IActionResult> GetAcademicPeriodOptions()
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                var schoolYears = new List<string>();
                string? activeSchoolYear = null;
                string? activeSemester = null;

                await using (var cmd = new NpgsqlCommand(@"
                    SELECT school_year, semester, status
                    FROM academic_periods
                    ORDER BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END, opened_at DESC;", conn))
                await using (var reader = await cmd.ExecuteReaderAsync())
                {
                    while (await reader.ReadAsync())
                    {
                        var schoolYear = reader.GetString(0);
                        if (!schoolYears.Contains(schoolYear, StringComparer.OrdinalIgnoreCase))
                            schoolYears.Add(schoolYear);
                        if (activeSchoolYear is null && reader.GetString(2).Equals("ACTIVE", StringComparison.OrdinalIgnoreCase))
                        {
                            activeSchoolYear = schoolYear;
                            activeSemester = reader.GetString(1);
                        }
                    }
                }

                var now = DateTime.UtcNow;
                var startYear = now.Month >= 6 ? now.Year : now.Year - 1;
                var currentSchoolYear = $"{startYear}-{startYear + 1}";
                if (!schoolYears.Contains(currentSchoolYear, StringComparer.OrdinalIgnoreCase))
                    schoolYears.Insert(0, currentSchoolYear);

                return Ok(new
                {
                    status = "Success",
                    schoolYears,
                    currentSchoolYear,
                    activeAcademicPeriod = activeSchoolYear is null
                        ? null
                        : new { schoolYear = activeSchoolYear, semester = activeSemester }
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Academic-period options could not be loaded.");
                return StatusCode(500, new { status = "Error", message = "Academic-period options could not be loaded." });
            }
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

                var storedValue = req.Value ?? string.Empty;
                if (string.Equals(req.Key?.Trim(), "encoding_period", StringComparison.OrdinalIgnoreCase))
                {
                    try
                    {
                        storedValue = await EncodingPeriodSettingService.SaveAsync(
                            conn, storedValue, HttpContext.RequestAborted);
                    }
                    catch (ArgumentException ex)
                    {
                        return BadRequest(new { status = "Error", message = ex.Message });
                    }
                    catch (EncodingPeriodSettingService.NoActiveAcademicPeriodException ex)
                    {
                        return Conflict(new { status = "Error", message = ex.Message });
                    }
                }

                else
                {
                    using var cmd = new NpgsqlCommand(@"
                        INSERT INTO SystemSettings (key, value) VALUES (@k, @v)
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", conn);
                    cmd.Parameters.AddWithValue("k", req.Key ?? string.Empty);
                    cmd.Parameters.AddWithValue("v", storedValue);
                    await cmd.ExecuteNonQueryAsync();
                }
                await _chatHubContext.Clients.All.SendAsync("SystemSettingChanged", new
                {
                    Key = req.Key,
                    Value = storedValue,
                    UpdatedAt = DateTime.UtcNow
                });
                return Ok(new { status = "Success", value = storedValue });
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
                var actor = User.Identity?.Name ?? "unknown";
                var resetResult = await EncodingPeriodSettingService.ResetAsync(
                    conn, schoolYear, semester, term, startDate, endDate, actor,
                    HttpContext.RequestAborted);

                _logger.LogInformation("Encoding season reset by {User}", User.Identity?.Name);
                await _chatHubContext.Clients.All.SendAsync("SystemSettingChanged", new
                {
                    Key = "encoding_period",
                    Value = resetResult.EncodingPeriod,
                    UpdatedAt = DateTime.UtcNow
                });
                await _chatHubContext.Clients.All.SendAsync("AcademicDataChanged", new
                {
                    Reason = "encoding_season_reset",
                    Department = string.Empty,
                    Actor = actor,
                    OccurredAt = DateTimeOffset.UtcNow
                });

                return Ok(new
                {
                    status = "Success",
                    message = "Encoding season reset successfully.",
                    resetResult.DeactivatedAssignmentCount,
                    clearedDraftGradeCount = 0,
                    resetResult.AcademicContext,
                    resetResult.EncodingPeriod
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { status = "Error", message = ex.Message });
            }
            catch (PostgresException ex) when (
                ex.SqlState == PostgresErrorCodes.UniqueViolation &&
                ex.ConstraintName is "academic_periods_school_year_semester_term_key" or "ux_academic_period_active")
            {
                _logger.LogWarning(ex, "Academic-period reset conflicted with another period change.");
                return Conflict(new { status = "Error", message = "The academic period changed while the reset was in progress. Refresh and try again." });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Encoding season reset failed for {User}", User.Identity?.Name ?? "unknown");
                return StatusCode(500, new { status = "Error", message = "Encoding season could not be reset. Current faculty assignments were not changed." });
            }
        }
    }
}
