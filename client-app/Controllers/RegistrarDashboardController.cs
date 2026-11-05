using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Client_app.Services;
using BlockGo.Services;
using Npgsql;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Client_app.Controllers
{
    [Authorize(Roles = "registrar,admin")]
    [ApiController]
    [Route("api/[controller]")]
    public class RegistrarDashboardController : ControllerBase
    {
        private readonly string _connectionString;

        public RegistrarDashboardController(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("PostgresConnection") ?? configuration.GetConnectionString("MasterConnection") ?? throw new InvalidOperationException("PostgreSQL connection string not found.");
        }

        [HttpGet("overview")]
        public async Task<IActionResult> GetSystemOverview(
            [FromQuery] string? schoolYear,
            [FromQuery] string? semester,
            [FromQuery] string? term,
            [FromQuery] string? department,
            [FromQuery] string? program,
            CancellationToken cancellationToken)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync(cancellationToken);
                var configured = await GradeEncodingPeriodService.GetConfiguredAsync(conn, cancellationToken);
                var activePeriod = await EncodingPeriodSettingService.ResolveActiveEnrollmentPeriodAsync(
                    conn, cancellationToken: cancellationToken);
                if (activePeriod is null)
                    return Conflict(new { status = "Error", message = "No authoritative active academic period is configured." });

                var normalizedYear = string.IsNullOrWhiteSpace(schoolYear)
                    ? activePeriod.Value.SchoolYear
                    : GradeAcademicPeriod.SchoolYear(schoolYear);
                var normalizedSemester = string.IsNullOrWhiteSpace(semester)
                    ? activePeriod.Value.Semester
                    : GradeAcademicPeriod.Semester(semester);
                if (normalizedYear is null || normalizedSemester is null)
                    return BadRequest(new { status = "Error", message = "A valid school year and semester are required." });

                var requestedTerm = term?.Trim().ToLowerInvariant();
                if (!string.IsNullOrWhiteSpace(requestedTerm) && requestedTerm is not ("midterm" or "midterms" or "final" or "finals"))
                    return BadRequest(new { status = "Error", message = "Term must be midterm or finals." });
                var normalizedTerm = string.IsNullOrWhiteSpace(requestedTerm)
                    ? configured.Term
                    : GradeAcademicTerm.Normalize(requestedTerm);
                if (normalizedTerm is not (GradeAcademicTerm.Midterm or GradeAcademicTerm.Finals))
                    return BadRequest(new { status = "Error", message = "Term must be midterm or finals." });

                var counts = await RegistrarWorkflowOverviewService.GetAsync(
                    conn, normalizedYear, normalizedSemester, normalizedTerm,
                    department, program, cancellationToken);
                return Ok(new
                {
                    status = "Success",
                    filters = new { schoolYear = normalizedYear, semester = normalizedSemester, term = normalizedTerm, department, program },
                    counts
                });
            }
            catch (GradeEncodingPeriodException ex)
            {
                return Conflict(new { status = "Error", message = ex.Message });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpGet("logs/query")]
        public async Task<IActionResult> QueryActivityLogs([FromQuery] DateTime? from, [FromQuery] DateTime? to)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var logs = new List<object>();
                var fromDate = from ?? DateTime.UtcNow.AddDays(-30);
                var toDate = to ?? DateTime.UtcNow;

                using var cmd = new NpgsqlCommand(@"
                    SELECT logid, recordid, oldgrade, newgrade, reasontext, approvedby, timestamp 
                    FROM gradecorrectionlogs 
                    WHERE timestamp >= @from AND timestamp <= @to
                    ORDER BY timestamp DESC", conn);
                
                cmd.Parameters.AddWithValue("from", fromDate);
                cmd.Parameters.AddWithValue("to", toDate);

                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    logs.Add(new {
                        id = reader.GetInt32(0),
                        recordId = reader.IsDBNull(1) ? null : reader.GetString(1),
                        oldGrade = reader.IsDBNull(2) ? null : reader.GetString(2),
                        newGrade = reader.IsDBNull(3) ? null : reader.GetString(3),
                        reason = reader.IsDBNull(4) ? null : reader.GetString(4),
                        approvedBy = reader.IsDBNull(5) ? null : reader.GetString(5),
                        timestamp = reader.GetDateTime(6)
                    });
                }

                return Ok(logs);
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }
    }
}
