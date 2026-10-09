using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;
using Npgsql;
using BlockGo.Models;
using BlockGo.Services;
using Client_app.Models; 
using System;
using System.Threading.Tasks;
using For_Testing_Only_Capstone.Models;
using System.Text.Json;
using System.Collections.Generic;
using System.Linq;
using BlockGo.Mappers;
using System.Globalization;
using System.IO;
using ClosedXML.Excel;
using System.Net.Http;
using System.Security.Cryptography;
using System.Security.Claims;
using System.Text;
using System.Text.RegularExpressions;
using Client_app.Services;
using Client_app.Controllers;
using Microsoft.AspNetCore.SignalR;


namespace BlockGo.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class GradesController : ControllerBase
    {
        private readonly IBlockchainService _blockchainService;
        private readonly string _connectionString;
        private readonly ILogger<GradesController> _logger;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly IEmailService _emailService;
        private readonly IHubContext<ChatHub> _chatHubContext;
        private readonly IAuditLogService _auditLog;
        private static readonly System.Threading.SemaphoreSlim PendingGradeSchemaLock = new(1, 1);
        private static bool _pendingGradeSchemaReady;

        public GradesController(
            IBlockchainService blockchainService, 
            IConfiguration configuration,
            ILogger<GradesController> logger,
            IHttpClientFactory httpClientFactory,
            IEmailService emailService,
            IHubContext<ChatHub> chatHubContext,
            IAuditLogService auditLog)
        {
            _blockchainService = blockchainService;
            _connectionString = configuration.GetConnectionString("PostgresConnection") ?? configuration.GetConnectionString("MasterConnection") ?? throw new InvalidOperationException("PostgreSQL connection string not found.");
            _logger = logger;
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _emailService = emailService;
            _chatHubContext = chatHubContext;
            _auditLog = auditLog;
        }

        private Task NotifyAcademicDataChangedAsync(string reason, string? department = null, string? actor = null)
        {
            return _chatHubContext.Clients.All.SendAsync("AcademicDataChanged", new
            {
                Reason = reason,
                Department = department,
                Actor = actor,
                ChangedAt = DateTime.UtcNow
            });
        }

        private async Task<List<AcademicRecord>> LoadFinalizedLedgerRecordsAsync(string actor)
        {
            var ledgerJson = await _blockchainService.GetAllGradesAsync(actor);
            using var document = JsonDocument.Parse(ledgerJson);
            var data = document.RootElement.TryGetProperty("data", out var nested)
                ? nested
                : document.RootElement;

            if (data.ValueKind != JsonValueKind.Array) return new List<AcademicRecord>();

            return (JsonSerializer.Deserialize<List<AcademicRecord>>(
                        data.GetRawText(),
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                    ?? new List<AcademicRecord>())
                .Where(record => !string.IsNullOrWhiteSpace(record.Id)
                    && string.Equals(record.Status?.Trim(), "Finalized", StringComparison.OrdinalIgnoreCase))
                .ToList();
        }

        private static bool MatchesGradeReleaseContext(AcademicRecord record, ReleaseStudentGradesRequest request)
            => GradeReleasePolicy.MatchesReleaseContext(record, request.StudentIdentifier, request.SchoolYear, request.Semester, request.Term);

        private static int FinalizedGradeVersion(AcademicRecord record) => record.GradeVersion > 0 ? record.GradeVersion : 1;
        private static string GradeReleaseKey(string recordId, int gradeVersion) => $"{recordId}|{gradeVersion}";

        [HttpGet("release-candidates")]
        [Authorize(Roles = "registrar")]
        public async Task<IActionResult> GetGradeReleaseCandidates(CancellationToken cancellationToken)
        {
            try
            {
                var records = await LoadFinalizedLedgerRecordsAsync(AuthenticatedEmail());
                var recordIds = records.Select(record => record.Id).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
                var released = new Dictionary<string, DateTimeOffset>(StringComparer.OrdinalIgnoreCase);

                if (recordIds.Length > 0)
                {
                    await using var connection = new NpgsqlConnection(_connectionString);
                    await connection.OpenAsync(cancellationToken);
                    await using var command = new NpgsqlCommand(@"
                        SELECT record_id, grade_version, released_at
                        FROM grade_releases
                        WHERE record_id = ANY(@recordIds);", connection);
                    command.Parameters.AddWithValue("recordIds", recordIds);
                    await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                        released[GradeReleaseKey(reader.GetString(0), reader.GetInt32(1))] = reader.GetFieldValue<DateTimeOffset>(2);
                }

                var candidates = records
                    .Where(record => !string.IsNullOrWhiteSpace(GradeReleasePolicy.StudentIdentifier(record)))
                    .GroupBy(record => new
                    {
                        StudentIdentifier = GradeReleasePolicy.StudentIdentifier(record),
                        SchoolYear = record.SchoolYear?.Trim() ?? string.Empty,
                        Semester = record.Semester?.Trim() ?? string.Empty,
                        Term = GradeReleasePolicy.Term(record)
                    })
                    .Select(group =>
                    {
                        var first = group.First();
                        var subjectRecords = group
                            .OrderBy(record => record.SubjectCode, StringComparer.OrdinalIgnoreCase)
                            .Select(record => new
                            {
                                recordId = record.Id,
                                subjectCode = record.SubjectCode,
                                subjectTitle = record.SubjectTitle,
                                grade = record.Grade,
                                units = record.Units,
                                faculty = string.IsNullOrWhiteSpace(record.ProfessorName) ? record.FacultyId : record.ProfessorName,
                                status = record.Status,
                                gradeVersion = FinalizedGradeVersion(record)
                            }).ToArray();
                        var releaseDates = group
                            .Where(record => released.ContainsKey(GradeReleaseKey(record.Id, FinalizedGradeVersion(record))))
                            .Select(record => released[GradeReleaseKey(record.Id, FinalizedGradeVersion(record))])
                            .ToArray();
                        var isReleased = subjectRecords.Length > 0 && releaseDates.Length == subjectRecords.Length;
                        return new
                        {
                            studentIdentifier = group.Key.StudentIdentifier,
                            studentId = string.IsNullOrWhiteSpace(first.StudentNo) ? first.StudentId : first.StudentNo,
                            studentName = first.StudentName,
                            program = string.IsNullOrWhiteSpace(first.Program) ? first.Course : first.Program,
                            yearLevel = first.YearLevel,
                            section = first.Section,
                            schoolYear = group.Key.SchoolYear,
                            semester = group.Key.Semester,
                            term = group.Key.Term,
                            releaseStatus = isReleased ? "Released" : "Ready for Release",
                            releasedAt = isReleased ? releaseDates.Max() : (DateTimeOffset?)null,
                            subjects = subjectRecords
                        };
                    })
                    .OrderBy(candidate => candidate.studentName, StringComparer.OrdinalIgnoreCase)
                    .ThenByDescending(candidate => candidate.schoolYear, StringComparer.OrdinalIgnoreCase)
                    .ToArray();

                return Ok(new { status = "Success", data = candidates });
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Registrar grade release candidates could not be loaded.");
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    status = "Unavailable",
                    message = "Grade release information is temporarily unavailable."
                });
            }
        }

        [HttpPost("release-student")]
        [Authorize(Roles = "registrar")]
        public async Task<IActionResult> ReleaseStudentGrades(
            [FromBody] ReleaseStudentGradesRequest request,
            CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(request.StudentIdentifier)
                || string.IsNullOrWhiteSpace(request.SchoolYear)
                || string.IsNullOrWhiteSpace(request.Semester)
                || string.IsNullOrWhiteSpace(request.Term))
            {
                return BadRequest(new { status = "Error", message = "Student and academic period are required." });
            }

            var actor = AuthenticatedEmail();
            try
            {
                // Re-read Fabric at command time. The client cannot make a non-finalized record eligible.
                var eligible = (await LoadFinalizedLedgerRecordsAsync(actor))
                    .Where(record => MatchesGradeReleaseContext(record, request))
                    .GroupBy(record => record.Id, StringComparer.OrdinalIgnoreCase)
                    .Select(group => group.Last())
                    .ToArray();
                if (eligible.Length == 0)
                {
                    return BadRequest(new
                    {
                        status = "Error",
                        message = "No finalized grades are ready for release for this student and period."
                    });
                }

                await using var connection = new NpgsqlConnection(_connectionString);
                await connection.OpenAsync(cancellationToken);
                await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
                var inserted = 0;
                foreach (var record in eligible)
                {
                    await using var command = new NpgsqlCommand(@"
                        INSERT INTO grade_releases
                            (record_id, grade_version, student_identifier, school_year, semester, term, released_by)
                        VALUES
                            (@recordId, @gradeVersion, @studentIdentifier, @schoolYear, @semester, @term,
                             (SELECT id FROM users WHERE LOWER(email) = LOWER(@actor) LIMIT 1))
                        ON CONFLICT (record_id, grade_version) DO NOTHING;", connection, transaction);
                    command.Parameters.AddWithValue("recordId", record.Id);
                    command.Parameters.AddWithValue("gradeVersion", FinalizedGradeVersion(record));
                    command.Parameters.AddWithValue("studentIdentifier", request.StudentIdentifier.Trim());
                    command.Parameters.AddWithValue("schoolYear", request.SchoolYear.Trim());
                    command.Parameters.AddWithValue("semester", request.Semester.Trim());
                    command.Parameters.AddWithValue("term", request.Term.Trim().ToLowerInvariant());
                    command.Parameters.AddWithValue("actor", actor);
                    inserted += await command.ExecuteNonQueryAsync(cancellationToken);
                }

                await _auditLog.LogAsync(
                    actor,
                    "registrar",
                    "STUDENT_GRADES_RELEASED",
                    "grade_release",
                    $"{request.StudentIdentifier}:{request.SchoolYear}:{request.Semester}:{request.Term}",
                    newValues: new { request.StudentIdentifier, request.SchoolYear, request.Semester, request.Term, RecordIds = eligible.Select(record => record.Id), Inserted = inserted },
                    description: $"Released {eligible.Length} finalized grade record(s) for student visibility.",
                    ipAddress: ClientIpResolver.Resolve(HttpContext),
                    connection: connection,
                    transaction: transaction,
                    cancellationToken: cancellationToken);
                await transaction.CommitAsync(cancellationToken);

                await NotifyAcademicDataChangedAsync("student_grades_released", null, actor);
                await _chatHubContext.Clients.Group($"private_{request.StudentIdentifier.Trim()}").SendAsync("GradeReleased", new
                {
                    Type = "grade_released",
                    Title = "Grades released",
                    Message = "Your finalized grades are now available in the Student Portal.",
                    request.SchoolYear,
                    request.Semester,
                    request.Term
                }, cancellationToken);
                if (request.StudentIdentifier.Contains('@'))
                {
                    try
                    {
                        var subject = "PLV Academic Update: Grades Released";
                        var htmlBody = "<div style='font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;'><h2 style='color: #003366;'>Pamantasan ng Lungsod ng Valenzuela</h2><p>Hello,</p><p>Your finalized grades have been released by the Registrar and are now available in the Student Portal.</p></div>";
                        await _emailService.SendEmailAsync(request.StudentIdentifier.Trim(), subject, htmlBody, true);
                    }
                    catch (Exception emailException)
                    {
                        _logger.LogWarning(emailException, "Grade release was committed, but the student email notification could not be delivered.");
                    }
                }

                return Ok(new
                {
                    status = "Success",
                    message = inserted == 0 ? "These finalized grades were already released." : "Finalized grades released successfully.",
                    releasedRecords = eligible.Length
                });
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Finalized grades could not be released for the requested student period.");
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    status = "Unavailable",
                    message = "Finalized grades could not be released right now. Please try again."
                });
            }
        }

        [HttpPost("release-program")]
        [Authorize(Roles = "registrar")]
        public async Task<IActionResult> ReleaseProgramGrades(
            [FromBody] ReleaseProgramGradesRequest request,
            CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(request.Program)
                || string.IsNullOrWhiteSpace(request.SchoolYear)
                || string.IsNullOrWhiteSpace(request.Semester)
                || string.IsNullOrWhiteSpace(request.Term))
                return BadRequest(new { status = "Error", message = "Program and academic period are required." });

            var actor = AuthenticatedEmail();
            try
            {
                // Re-read the finalized ledger at command time; client-supplied record IDs are never trusted.
                var eligible = (await LoadFinalizedLedgerRecordsAsync(actor))
                    .Where(record => GradeReleasePolicy.MatchesProgramReleaseContext(
                        record, request.Program, request.SchoolYear, request.Semester, request.Term))
                    .Where(record => !string.IsNullOrWhiteSpace(GradeReleasePolicy.StudentIdentifier(record)))
                    .GroupBy(record => record.Id, StringComparer.OrdinalIgnoreCase)
                    .Select(group => group.Last())
                    .ToArray();
                if (eligible.Length == 0)
                    return BadRequest(new { status = "Error", message = "No finalized grades are ready for release for this program and period." });

                await using var connection = new NpgsqlConnection(_connectionString);
                await connection.OpenAsync(cancellationToken);
                await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
                var inserted = 0;
                foreach (var record in eligible)
                {
                    var studentIdentifier = GradeReleasePolicy.StudentIdentifier(record);
                    await using var command = new NpgsqlCommand(@"
                        INSERT INTO grade_releases
                            (record_id, grade_version, student_identifier, school_year, semester, term, released_by)
                        VALUES
                            (@recordId, @gradeVersion, @studentIdentifier, @schoolYear, @semester, @term,
                             (SELECT id FROM users WHERE LOWER(email) = LOWER(@actor) LIMIT 1))
                        ON CONFLICT (record_id, grade_version) DO NOTHING;", connection, transaction);
                    command.Parameters.AddWithValue("recordId", record.Id);
                    command.Parameters.AddWithValue("gradeVersion", FinalizedGradeVersion(record));
                    command.Parameters.AddWithValue("studentIdentifier", studentIdentifier);
                    command.Parameters.AddWithValue("schoolYear", request.SchoolYear.Trim());
                    command.Parameters.AddWithValue("semester", request.Semester.Trim());
                    command.Parameters.AddWithValue("term", request.Term.Trim().ToLowerInvariant());
                    command.Parameters.AddWithValue("actor", actor);
                    inserted += await command.ExecuteNonQueryAsync(cancellationToken);
                }

                var studentIdentifiers = eligible.Select(GradeReleasePolicy.StudentIdentifier)
                    .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
                await _auditLog.LogAsync(
                    actor, "registrar", "PROGRAM_GRADES_RELEASED", "grade_release",
                    $"{request.Program}:{request.SchoolYear}:{request.Semester}:{request.Term}",
                    newValues: new { request.Program, request.SchoolYear, request.Semester, request.Term,
                        RecordIds = eligible.Select(record => record.Id), Students = studentIdentifiers, Inserted = inserted },
                    description: $"Released {eligible.Length} finalized grade record(s) for the selected program and period.",
                    ipAddress: ClientIpResolver.Resolve(HttpContext), connection: connection,
                    transaction: transaction, cancellationToken: cancellationToken);
                await transaction.CommitAsync(cancellationToken);

                await NotifyAcademicDataChangedAsync("program_grades_released", request.Program.Trim(), actor);
                foreach (var identifier in studentIdentifiers)
                    await _chatHubContext.Clients.Group($"private_{identifier}").SendAsync("GradeReleased", new
                    {
                        Type = "grade_released",
                        Title = "Grades released",
                        Message = "Your finalized grades are now available in the Student Portal.",
                        request.SchoolYear,
                        request.Semester,
                        request.Term
                    }, cancellationToken);

                return Ok(new
                {
                    status = "Success",
                    message = inserted == 0 ? "These finalized program grades were already released." : "Finalized program grades released successfully.",
                    releasedRecords = eligible.Length,
                    students = studentIdentifiers.Length
                });
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Finalized grades could not be released for program {Program} and the requested period.", request.Program);
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    status = "Unavailable",
                    message = "Finalized program grades could not be released right now. Please try again."
                });
            }
        }

        public class FlagRequest
        {
            public bool IsFlagged { get; set; }
        }

        public sealed class ReleaseStudentGradesRequest
        {
            public string StudentIdentifier { get; set; } = string.Empty;
            public string SchoolYear { get; set; } = string.Empty;
            public string Semester { get; set; } = string.Empty;
            public string Term { get; set; } = string.Empty;
        }

        public sealed class ReleaseProgramGradesRequest
        {
            public string Program { get; set; } = string.Empty;
            public string SchoolYear { get; set; } = string.Empty;
            public string Semester { get; set; } = string.Empty;
            public string Term { get; set; } = string.Empty;
        }

        public class AcademicStatusRequest
        {
            public string Status { get; set; } = string.Empty;
        }

        private string AuthenticatedEmail() => User.Identity?.Name
            ?? User.Claims.FirstOrDefault(c => c.Type == ClaimTypes.Email)?.Value
            ?? User.Claims.FirstOrDefault(c => c.Type == "email")?.Value
            ?? throw new UnauthorizedAccessException("Authenticated identity is missing.");

        private string AuthenticatedRole() => (User.Claims.FirstOrDefault(c => c.Type == "dbRole")?.Value
            ?? User.Claims.FirstOrDefault(c => c.Type == ClaimTypes.Role)?.Value
            ?? string.Empty).Trim().ToLowerInvariant().Replace('-', '_');

        private static bool MatchesProgramScope(AcademicRecord record, IEnumerable<string> programAliases)
        {
            var aliases = programAliases.Where(value => !string.IsNullOrWhiteSpace(value)).ToArray();
            return aliases.Any(alias =>
                string.Equals(record.Program, alias, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(record.Course, alias, StringComparison.OrdinalIgnoreCase) ||
                (!string.IsNullOrWhiteSpace(record.Section) && record.Section.Contains(alias, StringComparison.OrdinalIgnoreCase)));
        }

        private async Task<AcademicRecord?> LoadRecordForAccessCheckAsync(NpgsqlConnection connection, string recordId, string actorEmail)
        {
            using (var command = new NpgsqlCommand(@"
                SELECT faculty_id, course, program, section, student_hash, status
                FROM pending_grade_records WHERE id = @id LIMIT 1;", connection))
            {
                command.Parameters.AddWithValue("id", recordId);
                using var reader = await command.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    return new AcademicRecord
                    {
                        Id = recordId,
                        FacultyId = reader.IsDBNull(0) ? "" : reader.GetString(0),
                        Course = reader.IsDBNull(1) ? "" : reader.GetString(1),
                        Program = reader.IsDBNull(2) ? "" : reader.GetString(2),
                        Section = reader.IsDBNull(3) ? "" : reader.GetString(3),
                        StudentHash = reader.IsDBNull(4) ? "" : reader.GetString(4),
                        Status = reader.IsDBNull(5) ? "" : reader.GetString(5)
                    };
                }
            }

            var ledgerJson = await _blockchainService.GetGradeAsync(recordId, actorEmail);
            return JsonSerializer.Deserialize<AcademicRecord>(ledgerJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }

        private async Task<bool> CanAccessGradeRecordAsync(NpgsqlConnection connection, string recordId, string actorEmail, string actorRole)
        {
            var record = await LoadRecordForAccessCheckAsync(connection, recordId, actorEmail);
            if (record == null) return false;
            if (actorRole is "registrar" or "system_admin") return true;
            if (actorRole == "student")
                return string.Equals(record.StudentHash, actorEmail, StringComparison.OrdinalIgnoreCase) &&
                       string.Equals(record.Status, "Finalized", StringComparison.OrdinalIgnoreCase);
            if (actorRole == "faculty")
                return string.Equals(record.FacultyId, actorEmail, StringComparison.OrdinalIgnoreCase);
            if (actorRole != "department_admin") return false;

            using var command = new NpgsqlCommand(@"
                SELECT ap.department, p.program_code, p.program_name
                FROM users u
                JOIN adminprofiles ap ON ap.user_id = u.id
                LEFT JOIN academic_programs p
                  ON LOWER(p.program_name) = LOWER(ap.department)
                  OR LOWER(p.program_code) = LOWER(ap.department)
                WHERE LOWER(u.email) = LOWER(@email) AND u.status = 'APPROVED'
                LIMIT 1;", connection);
            command.Parameters.AddWithValue("email", actorEmail);
            using var reader = await command.ExecuteReaderAsync();
            if (!await reader.ReadAsync()) return false;
            var aliases = new[]
            {
                reader.IsDBNull(0) ? "" : reader.GetString(0),
                reader.IsDBNull(1) ? "" : reader.GetString(1),
                reader.IsDBNull(2) ? "" : reader.GetString(2)
            };
            return MatchesProgramScope(record, aliases);
        }

        private static string InferGradeTerm(string? term, string? gradePayload)
        {
            var normalizedTerm = GradeAcademicTerm.Normalize(term, string.Empty);
            if (normalizedTerm == GradeAcademicTerm.Finals ||
                string.Equals(term?.Trim(), "midterm", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(term?.Trim(), "midterms", StringComparison.OrdinalIgnoreCase))
                return normalizedTerm;
            if (!string.IsNullOrWhiteSpace(gradePayload) && gradePayload.TrimStart().StartsWith("{"))
            {
                try
                {
                    using var document = JsonDocument.Parse(gradePayload);
                    if (document.RootElement.TryGetProperty("finals", out var finals) && !string.IsNullOrWhiteSpace(finals.ToString())) return "finals";
                }
                catch { }
            }
            return GradeAcademicTerm.Midterm;
        }

        private async Task<string?> TryGetFinalizedMidtermPayloadAsync(
            NpgsqlConnection connection,
            string assignmentCycleId,
            string studentHash,
            string subjectCode,
            string facultyIdentity,
            CancellationToken cancellationToken)
        {
            var recordIds = new List<string>();
            await using (var command = new NpgsqlCommand(@"
                SELECT record_id
                FROM grade_assignment_cycles
                WHERE assignment_cycle_id = @assignmentCycleId;", connection))
            {
                command.Parameters.AddWithValue("assignmentCycleId", assignmentCycleId);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken)) recordIds.Add(reader.GetString(0));
            }

            foreach (var recordId in recordIds)
            {
                try
                {
                    var rawRecord = await _blockchainService.GetGradeAsync(recordId, facultyIdentity);
                    var record = JsonSerializer.Deserialize<AcademicRecord>(rawRecord,
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    if (record != null &&
                        string.Equals(record.Status, "Finalized", StringComparison.OrdinalIgnoreCase) &&
                        GradeAcademicTerm.Normalize(record.Term, string.Empty) == GradeAcademicTerm.Midterm &&
                        string.Equals(record.StudentHash, studentHash, StringComparison.OrdinalIgnoreCase) &&
                        string.Equals(record.SubjectCode, subjectCode, StringComparison.OrdinalIgnoreCase))
                        return record.Grade;
                }
                catch (LedgerGradeNotFoundException)
                {
                    _logger.LogWarning("Mapped Midterm ledger record {RecordId} was not found.", recordId);
                }
            }

            return null;
        }

        private static async Task<string> ResolveFacultyDisplayNameAsync(NpgsqlConnection connection, string email)
        {
            using var command = new NpgsqlCommand(@"
                SELECT COALESCE(fp.full_name, ap.full_name, u.email)
                FROM users u
                LEFT JOIN facultyprofiles fp ON fp.user_id = u.id
                LEFT JOIN adminprofiles ap ON ap.user_id = u.id
                WHERE LOWER(u.email) = LOWER(@email) LIMIT 1;", connection);
            command.Parameters.AddWithValue("email", email);
            return (await command.ExecuteScalarAsync())?.ToString() ?? email;
        }

        private async Task<(string? Department, string? Identity)> ResolveApprovedAcademicIdentityAsync(
            NpgsqlConnection conn,
            string? preferredIdentity,
            string? fallbackIdentity = null)
        {
            async Task<(string? Department, string? Identity)> TryResolveAsync(string? identity)
            {
                if (string.IsNullOrWhiteSpace(identity)) return (null, null);

                using var cmd = new NpgsqlCommand(@"
                    SELECT department FROM (
                        SELECT fp.department FROM Users u JOIN FacultyProfiles fp ON u.id = fp.user_id WHERE LOWER(u.email) = LOWER(@email) AND u.status = 'APPROVED'
                        UNION
                        SELECT ap.department FROM Users u JOIN AdminProfiles ap ON u.id = ap.user_id WHERE LOWER(u.email) = LOWER(@email) AND u.status = 'APPROVED'
                    ) AS combined LIMIT 1", conn);
                cmd.Parameters.AddWithValue("email", identity);
                var department = await cmd.ExecuteScalarAsync() as string;
                return department == null ? (null, null) : (department, identity);
            }

            var resolved = await TryResolveAsync(preferredIdentity);
            if (resolved.Department != null) return resolved;

            if (!string.Equals(preferredIdentity, fallbackIdentity, StringComparison.OrdinalIgnoreCase))
            {
                resolved = await TryResolveAsync(fallbackIdentity);
                if (resolved.Department != null) return resolved;
            }

            return (null, null);
        }

        [HttpPost("record")]
        [Authorize(Roles = "faculty,department_admin")]
        public async Task<IActionResult> RecordGrade([FromBody] GradeRequest request)
        {
            if (request == null)
                return BadRequest(new { status = "Error", message = "Invalid grade data." });
            _logger.LogInformation("Recording grade for student: {StudentId}", request.StudentId);

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var activeEncodingPeriod = await GradeEncodingPeriodService.GetOpenAsync(
                    conn, cancellationToken: HttpContext.RequestAborted);
                var incomingGradePayload = request.Grade;
                request.Term = activeEncodingPeriod.Term;
                request.Grade = GradeEncodingPeriodService.ProjectIncomingGradePayload(
                    incomingGradePayload, null, activeEncodingPeriod.Term);

                var jwtUser = AuthenticatedEmail();

                var resolvedFaculty = await ResolveApprovedAcademicIdentityAsync(
                    conn,
                    jwtUser,
                    null
                );
                var facDept = resolvedFaculty.Department;
                var effectiveFacultyId = resolvedFaculty.Identity;
                if (facDept == null)
                    return BadRequest(new { status = "Error", message = "Faculty not approved or does not exist." });

                var studentId = request.StudentId?.Trim() ?? "";
                if (string.IsNullOrWhiteSpace(studentId))
                    return BadRequest(new { status = "Error", message = "Registrar student number is required." });
                if (string.IsNullOrWhiteSpace(request.SubjectCode) || string.IsNullOrWhiteSpace(request.Section) ||
                    string.IsNullOrWhiteSpace(request.SchoolYear) || string.IsNullOrWhiteSpace(request.Semester) ||
                    string.IsNullOrWhiteSpace(request.Grade))
                    return BadRequest(new { status = "Error", message = "Subject, section, academic period and grade are required." });
                var canonicalSchoolYear = GradeAcademicPeriod.SchoolYear(request.SchoolYear);
                var enrollmentSemester = GradeAcademicPeriod.Semester(request.Semester);
                if (canonicalSchoolYear == null || enrollmentSemester == null)
                    return BadRequest(new { status = "Error", message = "School year must be YYYY-YYYY and semester must be First, Second, or Midyear." });
                try
                {
                    using var gradeDocument = JsonDocument.Parse(request.Grade);
                    var grade = gradeDocument.RootElement;
                    if (grade.ValueKind != JsonValueKind.Object)
                        return BadRequest(new { status = "Error", message = "Grade must contain the encoded academic terms." });
                    var term = activeEncodingPeriod.Term;
                    var standing = grade.TryGetProperty("standing", out var standingValue) ? standingValue.ToString() : "active";
                    if (string.Equals(standing, "active", StringComparison.OrdinalIgnoreCase) &&
                        (!grade.TryGetProperty(term, out var termGrade) ||
                         !decimal.TryParse(termGrade.ToString(), System.Globalization.NumberStyles.Number,
                             System.Globalization.CultureInfo.InvariantCulture, out var gradeValue) ||
                         gradeValue is < 60 or > 100))
                        return BadRequest(new { status = "Error", message = "The encoded grade must be between 60 and 100." });
                }
                catch (JsonException)
                {
                    return BadRequest(new { status = "Error", message = "Invalid grade format." });
                }

                using var cmdStu = new NpgsqlCommand(@"
                    SELECT sp.department, u.email, sp.student_no, sp.full_name, sp.section
                    FROM Users u
                    JOIN StudentProfiles sp ON u.id = sp.user_id
                    WHERE LOWER(u.role) = 'student' AND LOWER(u.status) = 'approved' AND u.is_active
                      AND LOWER(TRIM(sp.student_no)) = LOWER(TRIM(@studentId))
                    LIMIT 1", conn);
                cmdStu.Parameters.AddWithValue("studentId", studentId);
                string? stuDept = null;
                string? stuEmail = null;
                string stuNumber = studentId;
                string stuName = request.StudentName ?? "";
                string? stuSection = null;
                using (var stuReader = await cmdStu.ExecuteReaderAsync())
                {
                    if (await stuReader.ReadAsync())
                    {
                        stuDept = stuReader.IsDBNull(0) ? null : stuReader.GetString(0);
                        stuEmail = stuReader.IsDBNull(1) ? null : stuReader.GetString(1);
                        if (!stuReader.IsDBNull(2)) stuNumber = stuReader.GetString(2);
                        if (!stuReader.IsDBNull(3)) stuName = ResolvePreferredStudentName(stuName, stuReader.GetString(3), studentId);
                        stuSection = stuReader.IsDBNull(4) ? null : stuReader.GetString(4);
                    }
                }
                if (string.IsNullOrWhiteSpace(stuEmail))
                    return BadRequest(new { status = "Error", message = "Student account was not found. The Registrar must create the student before grades can be encoded." });
                if (request.FacultySectionId <= 0)
                    return BadRequest(new { status = "Error", message = "faculty_section_id is required." });
                var assignmentResolution = await FacultyAssignmentRosterService.ResolveAsync(
                    conn, request.FacultySectionId, false, HttpContext.RequestAborted);
                if (assignmentResolution.Value is null)
                    return assignmentResolution.Status == FacultyAssignmentRosterService.ResolutionStatus.AmbiguousLegacy
                        ? Conflict(new { status = "Ambiguous", message = assignmentResolution.Message })
                        : BadRequest(new { status = "Error", message = assignmentResolution.Message });
                var facultyAssignment = assignmentResolution.Value;
                if (AuthenticatedRole() == "faculty" &&
                    !FacultyAssignmentRosterService.IsOwnedBy(facultyAssignment, effectiveFacultyId))
                    return Forbid();
                var assignmentContextError = FacultyAssignmentRosterService.ValidateUploadContext(
                    facultyAssignment, facultyAssignment.AcademicSectionId, request.SubjectCode,
                    canonicalSchoolYear, enrollmentSemester, request.Section);
                if (assignmentContextError != null)
                    return BadRequest(new { status = "Error", message = assignmentContextError });

                var subjectMetadata = await FacultyAssignmentRosterService.ResolveSubjectMetadataAsync(
                    conn, facultyAssignment, HttpContext.RequestAborted);
                if (subjectMetadata is null)
                    return Conflict(new { status = "Error", message = "The assigned subject has no unambiguous published curriculum title and units." });
                request.SubjectName = subjectMetadata.Title;
                request.Units = subjectMetadata.Units;

                var roster = await FacultyAssignmentRosterService.GetRosterAsync(conn, facultyAssignment, HttpContext.RequestAborted);
                if (!roster.Any(student => string.Equals(student.StudentNo, stuNumber, StringComparison.OrdinalIgnoreCase)))
                    return Forbid();
                stuSection = facultyAssignment.CanonicalSection;
                canonicalSchoolYear = facultyAssignment.SchoolYear;
                enrollmentSemester = facultyAssignment.Semester;
                request.Section = facultyAssignment.CanonicalSection;
                var assignmentCycleId = facultyAssignment.Id.ToString();
                if (!string.Equals(facultyAssignment.Semester, activeEncodingPeriod.Semester, StringComparison.OrdinalIgnoreCase))
                    return BadRequest(new { status = "Error", message = "The selected faculty assignment is outside the active encoding semester." });

                string? existingGradePayload = null;
                using (var existingCommand = new NpgsqlCommand(@"
                    SELECT grade
                    FROM pending_grade_records
                    WHERE assignment_cycle_id = @assignmentCycleId
                      AND LOWER(TRIM(student_hash)) = LOWER(TRIM(@studentHash))
                      AND LOWER(TRIM(subject_code)) = LOWER(TRIM(@subjectCode))
                      AND LOWER(COALESCE(term, '')) = LOWER(@term)
                    LIMIT 1;", conn))
                {
                    existingCommand.Parameters.AddWithValue("assignmentCycleId", assignmentCycleId);
                    existingCommand.Parameters.AddWithValue("studentHash", stuEmail);
                    existingCommand.Parameters.AddWithValue("subjectCode", facultyAssignment.Subject);
                    existingCommand.Parameters.AddWithValue("term", activeEncodingPeriod.Term);
                    existingGradePayload = (await existingCommand.ExecuteScalarAsync())?.ToString();
                }
                var previousSameTermGradePayload = existingGradePayload;
                if (activeEncodingPeriod.Term == GradeAcademicTerm.Finals && string.IsNullOrWhiteSpace(existingGradePayload))
                {
                    existingGradePayload = await TryGetFinalizedMidtermPayloadAsync(
                        conn, assignmentCycleId, stuEmail, facultyAssignment.Subject,
                        effectiveFacultyId ?? jwtUser, HttpContext.RequestAborted);
                }
                request.Grade = GradeEncodingPeriodService.ProjectIncomingGradePayload(
                    incomingGradePayload, existingGradePayload, activeEncodingPeriod.Term);

                request.StudentId = stuNumber;
                request.SchoolYear = canonicalSchoolYear;
                request.Semester = enrollmentSemester;
                request.Course = facDept;
                request.Program = facDept;

                request.FacultyId = effectiveFacultyId ?? jwtUser;
                request.ProfessorName = await ResolveFacultyDisplayNameAsync(conn, request.FacultyId);
                request.Term = activeEncodingPeriod.Term;
                var blockchainRecord = request.ToBlockchainRecord("PLV");
                blockchainRecord.FacultyId = effectiveFacultyId ?? request.FacultyId ?? "";
                blockchainRecord.StudentHash = stuEmail;
                blockchainRecord.StudentNo = stuNumber;
                blockchainRecord.StudentName = stuName;

                await EnsurePendingGradeSchemaAsync(conn);
                using var transaction = await conn.BeginTransactionAsync();
                try
                {
                    using var cmdStage = new NpgsqlCommand(@"
                        WITH updated AS (
                            UPDATE pending_grade_records
                            SET section = @sec,
                                student_no = @studentNo,
                                student_name = @studentName,
                                course = @course,
                                grade = @gr,
                                faculty_id = @fac,
                                date = @dt,
                                ipfs_cid = COALESCE(NULLIF(@ipfs, ''), ipfs_cid),
                                term = @term,
                                status = 'Draft'
                            WHERE LOWER(TRIM(student_hash)) = LOWER(TRIM(@sh))
                              AND LOWER(TRIM(faculty_id)) = LOWER(TRIM(@fac))
                              AND assignment_cycle_id = @assignmentCycleId
                              AND LOWER(status) IN ('draft', 'returned')
                              AND LOWER(TRIM(subject_code)) = LOWER(TRIM(@subj))
                              AND LOWER(TRIM(school_year)) = LOWER(TRIM(@sy))
                              AND LOWER(TRIM(semester)) = LOWER(TRIM(@sem))
                              AND LOWER(COALESCE(term, '')) = LOWER(@term)
                              AND (
                                LOWER(TRIM(COALESCE(section, ''))) = LOWER(TRIM(@sec))
                                OR LOWER(TRIM(COALESCE(section, ''))) = LOWER(TRIM(@subj))
                              )
                            RETURNING id
                        ), inserted AS (
                        INSERT INTO pending_grade_records (id, student_hash, student_no, student_name, section, course, subject_code, grade, semester, school_year, faculty_id, date, ipfs_cid, status, assignment_cycle_id, term)
                        SELECT @id, @sh, @studentNo, @studentName, @sec, @course, @subj, @gr, @sem, @sy, @fac, @dt, @ipfs, 'Draft', @assignmentCycleId, @term
                        WHERE NOT EXISTS (SELECT 1 FROM updated)
                        ON CONFLICT ON CONSTRAINT unique_grade_entry_assignment_cycle DO UPDATE SET
                            student_no = EXCLUDED.student_no,
                            student_name = EXCLUDED.student_name,
                            section = EXCLUDED.section,
                            course = EXCLUDED.course,
                            grade = EXCLUDED.grade,
                            faculty_id = EXCLUDED.faculty_id,
                            date = EXCLUDED.date,
                            ipfs_cid = COALESCE(NULLIF(EXCLUDED.ipfs_cid, ''), pending_grade_records.ipfs_cid),
                            term = EXCLUDED.term,
                            status = 'Draft'
                        WHERE LOWER(pending_grade_records.status) IN ('draft', 'returned')
                          AND LOWER(TRIM(pending_grade_records.faculty_id)) = LOWER(TRIM(EXCLUDED.faculty_id))
                        RETURNING id
                        )
                        SELECT id FROM updated UNION ALL SELECT id FROM inserted;", conn, transaction);
                    cmdStage.Parameters.AddWithValue("id", blockchainRecord.Id ?? (object)Guid.NewGuid().ToString());
                    cmdStage.Parameters.AddWithValue("sh", blockchainRecord.StudentHash ?? "");
                    cmdStage.Parameters.AddWithValue("studentNo", blockchainRecord.StudentNo ?? "");
                    cmdStage.Parameters.AddWithValue("studentName", blockchainRecord.StudentName ?? "");
                    cmdStage.Parameters.AddWithValue("sec", blockchainRecord.Section ?? "");
                    cmdStage.Parameters.AddWithValue("course", blockchainRecord.Course ?? "");
                    cmdStage.Parameters.AddWithValue("subj", blockchainRecord.SubjectCode ?? "");
                    cmdStage.Parameters.AddWithValue("gr", blockchainRecord.Grade ?? "");
                    cmdStage.Parameters.AddWithValue("sem", blockchainRecord.Semester ?? "");
                    cmdStage.Parameters.AddWithValue("sy", blockchainRecord.SchoolYear ?? "");
                    cmdStage.Parameters.AddWithValue("fac", blockchainRecord.FacultyId ?? "");
                    cmdStage.Parameters.AddWithValue("assignmentCycleId", assignmentCycleId);
                    cmdStage.Parameters.AddWithValue("dt", blockchainRecord.Date ?? "");
                    cmdStage.Parameters.AddWithValue("ipfs", blockchainRecord.IpfsCid ?? "");
                    cmdStage.Parameters.AddWithValue("term", activeEncodingPeriod.Term);
                    var stagedId = await cmdStage.ExecuteScalarAsync();
                    if (stagedId == null)
                        return Conflict(new { status = "Error", message = "This grade is already submitted or approved and cannot be edited by Faculty." });

                    using (var cycleMap = new NpgsqlCommand(@"
                        INSERT INTO grade_assignment_cycles (record_id, assignment_cycle_id)
                        VALUES (@recordId, @assignmentCycleId)
                        ON CONFLICT (record_id) DO UPDATE SET assignment_cycle_id = EXCLUDED.assignment_cycle_id;", conn, transaction))
                    {
                        cycleMap.Parameters.AddWithValue("recordId", stagedId.ToString()!);
                        cycleMap.Parameters.AddWithValue("assignmentCycleId", assignmentCycleId);
                        await cycleMap.ExecuteNonQueryAsync();
                    }

                    using var cmdMetadata = new NpgsqlCommand(@"
                        UPDATE pending_grade_records
                        SET subject_title = @subjectTitle, professor_name = @professorName,
                            program = @program, term = @term, units = @units,
                            submitted_by = @submittedBy, recorded_at = CURRENT_TIMESTAMP
                        WHERE id = @id;", conn, transaction);
                    cmdMetadata.Parameters.AddWithValue("subjectTitle", blockchainRecord.SubjectTitle ?? "");
                    cmdMetadata.Parameters.AddWithValue("professorName", blockchainRecord.ProfessorName ?? "");
                    cmdMetadata.Parameters.AddWithValue("program", blockchainRecord.Program ?? blockchainRecord.Course ?? "");
                    cmdMetadata.Parameters.AddWithValue("term", blockchainRecord.Term ?? "midterm");
                    cmdMetadata.Parameters.AddWithValue("units", blockchainRecord.Units);
                    cmdMetadata.Parameters.AddWithValue("submittedBy", blockchainRecord.SubmittedBy ?? blockchainRecord.FacultyId ?? "");
                    cmdMetadata.Parameters.AddWithValue("id", stagedId.ToString() ?? "");
                    await cmdMetadata.ExecuteNonQueryAsync();

                    using var cmdLog = new NpgsqlCommand(@"
                        INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp) 
                        VALUES (@rid, @old, @new, @reason, @appr, CURRENT_TIMESTAMP)", conn, transaction);
                    cmdLog.Parameters.AddWithValue("rid", stagedId.ToString() ?? "");
                    cmdLog.Parameters.AddWithValue("old", previousSameTermGradePayload != null ? (object)previousSameTermGradePayload : DBNull.Value);
                    cmdLog.Parameters.AddWithValue("new", blockchainRecord.Grade ?? "");
                    cmdLog.Parameters.AddWithValue("reason", "Initial Grade Entry (Staged)");
                    cmdLog.Parameters.AddWithValue("appr", effectiveFacultyId ?? (object)DBNull.Value);
                    await cmdLog.ExecuteNonQueryAsync();

                    await transaction.CommitAsync();

                    await NotifyAcademicDataChangedAsync("grade_recorded", blockchainRecord.Course, effectiveFacultyId);
                    return Ok(new { status = "Success", message = "Grade securely staged for Chairperson approval!" });
                }
                catch (Exception ex)
                {
                    await transaction.RollbackAsync();
                    return StatusCode(500, new { status = "Error", message = ex.Message });
                }
            }
            catch (GradeEncodingPeriodException ex)
            {
                return BadRequest(new { status = "EncodingPeriodClosed", message = ex.Message });
            }
            catch (FacultyAssignmentRosterService.RosterDataIntegrityException ex)
            {
                return Conflict(new {
                    status = "DataIntegrityError",
                    message = ex.Message,
                    enrollmentId = ex.EnrollmentId,
                    internalStudentId = ex.StudentUserId
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error recording grade");
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPost("submit-section")]
        [Authorize(Roles = "faculty,department_admin")]
        public async Task<IActionResult> SubmitSection([FromQuery] string department, [FromQuery] string section,
            [FromQuery] string? schoolYear, [FromQuery] string? semester, [FromQuery] int facultySectionId)
        {
            var facultyId = User.Identity?.Name 
                ?? User.Claims.FirstOrDefault(c => c.Type == ClaimTypes.Email)?.Value
                ?? User.Claims.FirstOrDefault(c => c.Type == "email")?.Value;

            if (string.IsNullOrWhiteSpace(facultyId))
                return BadRequest(new { status = "Error", message = "Faculty identity is required." });

            if (facultySectionId <= 0 || string.IsNullOrWhiteSpace(section) || string.IsNullOrWhiteSpace(schoolYear) ||
                string.IsNullOrWhiteSpace(semester))
                return BadRequest(new { status = "Error", message = "Faculty assignment, section, school year and semester are required." });
            var canonicalSchoolYear = GradeAcademicPeriod.SchoolYear(schoolYear);
            var canonicalSemester = GradeAcademicPeriod.Semester(semester);
            if (canonicalSchoolYear == null || canonicalSemester == null)
                return BadRequest(new { status = "Error", message = "School year must be YYYY-YYYY and semester must be First, Second, or Midyear." });

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var activeEncodingPeriod = await GradeEncodingPeriodService.GetOpenAsync(
                    conn, cancellationToken: HttpContext.RequestAborted);

                var assignmentResolution = await FacultyAssignmentRosterService.ResolveAsync(
                    conn, facultySectionId, false, HttpContext.RequestAborted);
                if (assignmentResolution.Value is null)
                    return assignmentResolution.Status == FacultyAssignmentRosterService.ResolutionStatus.AmbiguousLegacy
                        ? Conflict(new { status = "Ambiguous", message = assignmentResolution.Message })
                        : BadRequest(new { status = "Error", message = assignmentResolution.Message });
                var facultyAssignment = assignmentResolution.Value;
                if (!FacultyAssignmentRosterService.IsOwnedBy(facultyAssignment, facultyId))
                    return Forbid();
                if (!string.Equals(facultyAssignment.SchoolYear, canonicalSchoolYear, StringComparison.OrdinalIgnoreCase) ||
                    !string.Equals(facultyAssignment.Semester, canonicalSemester, StringComparison.OrdinalIgnoreCase))
                    return BadRequest(new { status = "Error", message = "Submitted period does not match the selected faculty assignment." });
                if (!string.Equals(facultyAssignment.Semester, activeEncodingPeriod.Semester, StringComparison.OrdinalIgnoreCase))
                    return BadRequest(new { status = "Error", message = "The selected faculty assignment is outside the active encoding semester." });
                var roster = await FacultyAssignmentRosterService.GetRosterAsync(
                    conn, facultyAssignment, HttpContext.RequestAborted);
                if (roster.Count == 0)
                    return BadRequest(new { status = "Error", message = "The selected faculty assignment has no ENROLLED students." });

                var resolvedFaculty = await ResolveApprovedAcademicIdentityAsync(
                    conn,
                    facultyId,
                    facultyId
                );
                var effectiveFacultyId = resolvedFaculty.Identity ?? facultyId;
                var compactSection = facultyAssignment.CanonicalSection;
                var subjectCodeFromLabel = facultyAssignment.Subject;
                if (resolvedFaculty.Department == null || string.IsNullOrWhiteSpace(subjectCodeFromLabel))
                    return BadRequest(new { status = "Error", message = "An assigned subject and section are required for submission." });
                string? departmentCode;
                using (var program = new NpgsqlCommand(@"
                    SELECT p.program_code FROM academic_programs p
                    WHERE LOWER(TRIM(p.program_name)) = LOWER(TRIM(@department))
                       OR LOWER(TRIM(p.program_code)) = LOWER(TRIM(@department))
                    LIMIT 1", conn))
                {
                    program.Parameters.AddWithValue("department", resolvedFaculty.Department);
                    departmentCode = (await program.ExecuteScalarAsync())?.ToString();
                }
                if (departmentCode == null ||
                    !(string.Equals(department?.Trim(), resolvedFaculty.Department, StringComparison.OrdinalIgnoreCase) ||
                      string.Equals(department?.Trim(), departmentCode, StringComparison.OrdinalIgnoreCase)))
                    return Forbid();

                await EnsurePendingGradeSchemaAsync(conn);

                var stagedStudentNumbers = new List<string>();
                var hasInvalidActiveTermGrade = false;
                using (var coverageCommand = new NpgsqlCommand(@"
                    SELECT COALESCE(student_no, ''), grade
                    FROM pending_grade_records
                    WHERE LOWER(TRIM(faculty_id)) = LOWER(TRIM(@faculty))
                      AND assignment_cycle_id = @assignmentCycleId
                      AND LOWER(status) IN ('draft', 'returned')
                      AND LOWER(TRIM(subject_code)) = LOWER(TRIM(@subjectCode))
                      AND LOWER(TRIM(school_year)) = LOWER(TRIM(@schoolYear))
                      AND LOWER(TRIM(semester)) = LOWER(TRIM(@semester))
                      AND LOWER(TRIM(term)) = LOWER(TRIM(@term));", conn))
                {
                    coverageCommand.Parameters.AddWithValue("faculty", effectiveFacultyId);
                    coverageCommand.Parameters.AddWithValue("assignmentCycleId", facultyAssignment.Id.ToString());
                    coverageCommand.Parameters.AddWithValue("subjectCode", facultyAssignment.Subject);
                    coverageCommand.Parameters.AddWithValue("schoolYear", facultyAssignment.SchoolYear);
                    coverageCommand.Parameters.AddWithValue("semester", facultyAssignment.Semester);
                    coverageCommand.Parameters.AddWithValue("term", activeEncodingPeriod.Term);
                    using var coverageReader = await coverageCommand.ExecuteReaderAsync();
                    while (await coverageReader.ReadAsync())
                    {
                        stagedStudentNumbers.Add(coverageReader.GetString(0));
                        if (!GradeEncodingPeriodService.HasGradeForTerm(
                                coverageReader.IsDBNull(1) ? null : coverageReader.GetString(1), activeEncodingPeriod.Term))
                            hasInvalidActiveTermGrade = true;
                    }
                }
                if (hasInvalidActiveTermGrade)
                    return BadRequest(new { status = "Error", message = $"A staged row is missing its {activeEncodingPeriod.Term} grade." });
                var coverage = FacultyAssignmentRosterService.CompareRosterCoverage(roster, stagedStudentNumbers);
                if (coverage.Missing > 0 || coverage.Unexpected > 0)
                    return BadRequest(new {
                        status = "Error",
                        message = $"Staged grades do not match the current ENROLLED roster ({coverage.Missing} missing, {coverage.Unexpected} not enrolled).",
                        missing = coverage.Missing,
                        unexpected = coverage.Unexpected
                    });

                using var cmd = new NpgsqlCommand(@"
                    UPDATE pending_grade_records
                    SET status = 'SubmittedToChairperson',
                        date = @date,
                        school_year = @schoolYear,
                        semester = @semester,
                        course = @department,
                        program = @department,
                        section = CASE
                            WHEN COALESCE(NULLIF(TRIM(section), ''), '') = ''
                                OR LOWER(TRIM(section)) = LOWER(TRIM(subject_code))
                            THEN @compactSection
                            ELSE section
                        END,
                        student_no = COALESCE(
                            NULLIF(student_no, ''),
                            (
                                SELECT sp.student_no
                                FROM Users u
                                JOIN StudentProfiles sp ON u.id = sp.user_id
                                WHERE LOWER(u.email) = LOWER(pending_grade_records.student_hash)
                                LIMIT 1
                            )
                        ),
                        student_name = COALESCE(
                            NULLIF(student_name, ''),
                            (
                                SELECT sp.full_name
                                FROM Users u
                                JOIN StudentProfiles sp ON u.id = sp.user_id
                                WHERE LOWER(u.email) = LOWER(pending_grade_records.student_hash)
                                LIMIT 1
                            )
                        )
                    WHERE LOWER(TRIM(faculty_id)) = LOWER(TRIM(@faculty))
                      AND assignment_cycle_id = @assignmentCycleId
                      AND LOWER(status) IN ('draft', 'returned')
                      AND LOWER(TRIM(school_year)) IN (LOWER(TRIM(@schoolYear)), LOWER(TRIM(@legacySchoolYear)))
                      AND LOWER(TRIM(semester)) = ANY(@semesterAliases)
                      AND LOWER(TRIM(course)) IN (LOWER(TRIM(@department)), LOWER(TRIM(@departmentCode)))
                      AND LOWER(TRIM(COALESCE(subject_code, ''))) = LOWER(TRIM(@subjectCode))
                      AND LOWER(TRIM(term)) = LOWER(TRIM(@term))
                      AND (LOWER(TRIM(COALESCE(section, ''))) = LOWER(TRIM(@section))
                           OR LOWER(TRIM(COALESCE(section, ''))) = LOWER(TRIM(@compactSection)))", conn);
                cmd.Parameters.AddWithValue("faculty", effectiveFacultyId);
                cmd.Parameters.AddWithValue("assignmentCycleId", facultyAssignment.Id.ToString());
                cmd.Parameters.AddWithValue("department", resolvedFaculty.Department);
                cmd.Parameters.AddWithValue("departmentCode", departmentCode);
                cmd.Parameters.AddWithValue("section", section);
                cmd.Parameters.AddWithValue("compactSection", compactSection);
                cmd.Parameters.AddWithValue("subjectCode", subjectCodeFromLabel);
                cmd.Parameters.AddWithValue("schoolYear", canonicalSchoolYear);
                cmd.Parameters.AddWithValue("legacySchoolYear", canonicalSchoolYear[..4]);
                cmd.Parameters.AddWithValue("semester", canonicalSemester);
                cmd.Parameters.AddWithValue("semesterAliases", GradeAcademicPeriod.SemesterAliases(canonicalSemester));
                cmd.Parameters.AddWithValue("date", DateTime.UtcNow.ToString("o"));
                cmd.Parameters.AddWithValue("term", activeEncodingPeriod.Term);

                var updated = await cmd.ExecuteNonQueryAsync();
                if (updated == 0)
                {
                    _logger.LogWarning(
                        "SubmitSection matched no staged rows for faculty {FacultyId} and section {Section}",
                        effectiveFacultyId,
                        section
                    );
                    return BadRequest(new
                    {
                        status = "Error",
                        message = "No staged grades matched the submitted section. Please save the section grades first.",
                        updated
                    });
                }

                await NotifyAcademicDataChangedAsync("section_submitted", department, facultyId);
                return Ok(new { status = "Success", message = "Section submitted to Chairperson.", updated });
            }
            catch (GradeEncodingPeriodException ex)
            {
                return BadRequest(new { status = "EncodingPeriodClosed", message = ex.Message });
            }
            catch (FacultyAssignmentRosterService.RosterDataIntegrityException ex)
            {
                return Conflict(new {
                    status = "DataIntegrityError",
                    message = ex.Message,
                    enrollmentId = ex.EnrollmentId,
                    internalStudentId = ex.StudentUserId
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error submitting section {Section} for {FacultyId}", section, facultyId);
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        private byte[] EncryptStream(Stream inputStream)
        {
            using var aes = Aes.Create();
            var key = _configuration["IpfsEncryptionKey"] ?? "default-encryption-key-32chars!!!";
            aes.Key = System.Text.Encoding.UTF8.GetBytes(key.PadRight(32).Substring(0, 32));
            aes.GenerateIV();
            var iv = aes.IV;

            using var outputStream = new MemoryStream();
            outputStream.Write(iv, 0, iv.Length);

            using (var encryptor = aes.CreateEncryptor())
            using (var cryptoStream = new CryptoStream(outputStream, encryptor, CryptoStreamMode.Write))
            {
                inputStream.CopyTo(cryptoStream);
            }
            return outputStream.ToArray();
        }

        private static string BuildUploadedGradePayload(string? rawGrade, string? rawMidterm, string? rawFinals, string? term) =>
            GradeUploadValuePolicy.BuildPayload(rawGrade, rawMidterm, rawFinals, term);

        private delegate string? GetValDelegate(params string[] cols);

        private static string? GetUploadedTermGrade(GetValDelegate getVal, string? term)
        {
            var activeTerm = GradeAcademicTerm.Normalize(term);
            return activeTerm == "finals"
                ? getVal("final_rating", "final_grade", "finals_grade", "grade", "rating")
                : getVal("midterm_grade", "midterm_rating", "midterm");
        }

        private static string? GetUploadedMidtermGrade(GetValDelegate getVal, string? term)
        {
            if (GradeAcademicTerm.Normalize(term) == GradeAcademicTerm.Finals)
            {
                return null;
            }
            return getVal("midterm_grade", "midterm", "midterm_rating");
        }

        private static string? GetUploadedFinalGrade(GetValDelegate getVal, string? term)
        {
            if (GradeAcademicTerm.Normalize(term) != GradeAcademicTerm.Finals)
            {
                return null;
            }
            return getVal("final_rating", "final_grade", "finals_grade", "final", "finals");
        }

        private static string GetGradeLogValue(string? rawPayload, string? term)
        {
            if (string.IsNullOrWhiteSpace(rawPayload)) return "";

            if (!rawPayload.TrimStart().StartsWith("{"))
            {
                return rawPayload.Length > 10 ? rawPayload.Substring(0, 10) : rawPayload;
            }

            try
            {
                using var doc = JsonDocument.Parse(rawPayload);
                var activeTerm = GradeAcademicTerm.Normalize(term);
                var propertyName = activeTerm == "finals" ? "finals" : "midterm";

                if (doc.RootElement.TryGetProperty(propertyName, out var gradeElement))
                {
                    var gradeValue = gradeElement.ToString() ?? "";
                    return gradeValue.Length > 10 ? gradeValue.Substring(0, 10) : gradeValue;
                }
            }
            catch
            {
            }

            return "";
        }

        private static string EnsurePendingGradeSectionScopedConstraintSql() => @"
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'unique_grade_entry'
                ) THEN
                    ALTER TABLE pending_grade_records DROP CONSTRAINT unique_grade_entry;
                END IF;
            END $$;

            DROP INDEX IF EXISTS unique_grade_entry;

            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_grade_entry_section') THEN
                    ALTER TABLE pending_grade_records DROP CONSTRAINT unique_grade_entry_section;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_grade_entry_assignment_cycle') THEN
                    ALTER TABLE pending_grade_records ADD CONSTRAINT unique_grade_entry_assignment_cycle
                    UNIQUE (student_hash, subject_code, school_year, semester, section, assignment_cycle_id, term);
                END IF;
            END $$;";

        private static string EnsurePendingGradeRecordIdentityColumnsSql() => @"
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'pending_grade_records' AND column_name = 'student_no'
                ) THEN
                    ALTER TABLE pending_grade_records ADD COLUMN student_no VARCHAR(255);
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'pending_grade_records' AND column_name = 'student_name'
                ) THEN
                    ALTER TABLE pending_grade_records ADD COLUMN student_name VARCHAR(255);
                END IF;

                ALTER TABLE pending_grade_records ADD COLUMN IF NOT EXISTS subject_title VARCHAR(255);
                ALTER TABLE pending_grade_records ADD COLUMN IF NOT EXISTS professor_name VARCHAR(255);
                ALTER TABLE pending_grade_records ADD COLUMN IF NOT EXISTS program VARCHAR(255);
                ALTER TABLE pending_grade_records ADD COLUMN IF NOT EXISTS term VARCHAR(20);
                ALTER TABLE pending_grade_records ADD COLUMN IF NOT EXISTS units NUMERIC(5,2);
                ALTER TABLE pending_grade_records ADD COLUMN IF NOT EXISTS submitted_by VARCHAR(255);
                ALTER TABLE pending_grade_records ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMP WITH TIME ZONE;
                ALTER TABLE pending_grade_records ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(255);
                ALTER TABLE pending_grade_records ADD COLUMN IF NOT EXISTS transaction_hash VARCHAR(255);
                ALTER TABLE pending_grade_records ADD COLUMN IF NOT EXISTS assignment_cycle_id VARCHAR(100) NOT NULL DEFAULT 'legacy';
            END $$;";

        private async Task EnsurePendingGradeSchemaAsync(NpgsqlConnection connection)
        {
            if (System.Threading.Volatile.Read(ref _pendingGradeSchemaReady)) return;
            await PendingGradeSchemaLock.WaitAsync();
            try
            {
                if (System.Threading.Volatile.Read(ref _pendingGradeSchemaReady)) return;
                using var command = new NpgsqlCommand(@"
                    CREATE TABLE IF NOT EXISTS pending_grade_records (
                        id VARCHAR(255) PRIMARY KEY,
                        student_hash VARCHAR(255), student_no VARCHAR(255), student_name VARCHAR(255),
                        section VARCHAR(100), course VARCHAR(255), subject_code VARCHAR(100),
                        grade TEXT, semester VARCHAR(50), school_year VARCHAR(50), faculty_id VARCHAR(255),
                        date VARCHAR(50), ipfs_cid VARCHAR(255), status VARCHAR(50), note TEXT
                    );
                    ALTER TABLE pending_grade_records ALTER COLUMN grade TYPE TEXT;
                    CREATE TABLE IF NOT EXISTS grade_assignment_cycles (
                        record_id VARCHAR(255) PRIMARY KEY,
                        assignment_cycle_id VARCHAR(100) NOT NULL,
                        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                " + EnsurePendingGradeRecordIdentityColumnsSql() + EnsurePendingGradeSectionScopedConstraintSql() + @"
                    DO $$
                    BEGIN
                        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gradecorrectionlogs') THEN
                            ALTER TABLE gradecorrectionlogs
                                ALTER COLUMN oldgrade TYPE TEXT,
                                ALTER COLUMN newgrade TYPE TEXT;
                        END IF;
                    END $$;", connection);
                await command.ExecuteNonQueryAsync();
                System.Threading.Volatile.Write(ref _pendingGradeSchemaReady, true);
            }
            finally
            {
                PendingGradeSchemaLock.Release();
            }
        }

        private static string ResolveDisplaySection(string? recordSection, string? profileSection)
        {
            var normalizedRecordSection = string.IsNullOrWhiteSpace(recordSection) ? "" : recordSection.Trim();
            if (!string.IsNullOrWhiteSpace(normalizedRecordSection))
            {
                return normalizedRecordSection;
            }

            var normalizedProfileSection = string.IsNullOrWhiteSpace(profileSection) ? "" : profileSection.Trim();
            return string.IsNullOrWhiteSpace(normalizedProfileSection) ? "Unknown" : normalizedProfileSection;
        }

        private static string ExtractCompactSectionToken(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "";

            var normalized = value.Trim();
            var programMatch = Regex.Match(normalized, @"\b([A-Za-z]{2,}\s*\d+-\d+)\b", RegexOptions.IgnoreCase);
            if (programMatch.Success)
            {
                return programMatch.Groups[1].Value.Trim();
            }

            var numericMatch = Regex.Match(normalized, @"\b(\d+-\d+)\b");
            return numericMatch.Success ? numericMatch.Groups[1].Value.Trim() : "";
        }

        private static string ExtractSubjectCodeFromSectionLabel(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "";

            var match = Regex.Match(value.Trim(), @"\(([^)]+)\)\s*$");
            return match.Success ? match.Groups[1].Value.Trim() : "";
        }

        private static string ResolveYearLevelFromSection(string? displaySection, string? profileSection)
        {
            var sectionSource = string.IsNullOrWhiteSpace(displaySection) ? profileSection : displaySection;
            if (string.IsNullOrWhiteSpace(sectionSource))
            {
                return "Unknown";
            }

            var match = Regex.Match(sectionSource, @"\b([1-4])(?:st|nd|rd|th)?(?:\s*year)?\s*-\s*\d+\b", RegexOptions.IgnoreCase);
            if (match.Success)
            {
                return match.Groups[1].Value;
            }

            var leadingDigitMatch = Regex.Match(sectionSource.Trim(), @"^([1-4])\b");
            if (leadingDigitMatch.Success)
            {
                return leadingDigitMatch.Groups[1].Value;
            }

            return "Unknown";
        }

        private static int GetAcademicRecordCompletenessScore(AcademicRecord record)
        {
            var score = 0;

            if (!string.IsNullOrWhiteSpace(record.StudentNo)) score += 4;
            if (!string.IsNullOrWhiteSpace(record.StudentName)) score += 4;
            if (!string.IsNullOrWhiteSpace(record.Section)) score += 2;
            if (!string.IsNullOrWhiteSpace(record.Status)) score += 1;
            if (!string.IsNullOrWhiteSpace(record.IpfsCid)) score += 1;

            return score;
        }

        private static bool IsPlaceholderStudentName(string? value, string? studentId = null)
        {
            var normalized = (value ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(normalized)) return true;

            if (string.Equals(normalized, "student", StringComparison.OrdinalIgnoreCase)) return true;

            if (!string.IsNullOrWhiteSpace(studentId) &&
                string.Equals(normalized, $"Student {studentId}".Trim(), StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            return false;
        }

        private static string ResolvePreferredStudentName(string? currentName, string? candidateName, string? studentId = null)
        {
            if (!IsPlaceholderStudentName(candidateName, studentId))
            {
                return (candidateName ?? string.Empty).Trim();
            }

            return string.IsNullOrWhiteSpace(currentName)
                ? (candidateName ?? string.Empty).Trim()
                : currentName.Trim();
        }

        [HttpPost("bulk-upload")]
        [Authorize(Roles = "faculty,department_admin")]
        [Consumes("multipart/form-data")]
        [RequestSizeLimit(CsvUploadValidator.MaximumMultipartBodyBytes)]
        public async Task<IActionResult> BulkUploadGrades([FromForm] IFormFile file, [FromForm] int facultySectionId,
            [FromForm] int academicSectionId, [FromForm] string? subjectCode, [FromForm] string? semester,
            [FromForm] string? schoolYear, [FromForm] string? facultyId, [FromForm] string? course,
            [FromForm] string? term, [FromForm] string? section, [FromForm] bool confirmOverwrite = false)
        {
            _logger.LogInformation("Bulk upload initiated by user: {User}", User.Identity?.Name);

            var validationError = await CsvUploadValidator.ValidateGradeWorkbookAsync(file, HttpContext.RequestAborted);
            if (validationError is not null)
                return BadRequest(new { status = "Error", message = validationError });
            if (facultySectionId <= 0)
                return BadRequest(new { status = "Error", message = "facultySectionId is required." });

            var jwtUser = User.Identity?.Name;
            var jwtRole = User.Claims.FirstOrDefault(c => c.Type == "dbRole")?.Value ?? User.Claims.FirstOrDefault(c => c.Type == ClaimTypes.Role)?.Value;
            var targetFacultyId = jwtUser;
            if (string.IsNullOrEmpty(targetFacultyId))
                return BadRequest(new { status = "Error", message = "Faculty identity required." });

            _logger.LogInformation("Grade workbook upload for faculty: {FacultyId} (Initiated by: {JwtUser})", targetFacultyId, jwtUser);
            
            // Sync variable name for the rest of the method
            facultyId = targetFacultyId;

            try
            {
                ActiveGradeEncodingPeriod activeEncodingPeriod;
                await using (var preflightConnection = new NpgsqlConnection(_connectionString))
                {
                    await preflightConnection.OpenAsync(HttpContext.RequestAborted);
                    activeEncodingPeriod = await GradeEncodingPeriodService.GetOpenAsync(
                        preflightConnection, cancellationToken: HttpContext.RequestAborted);
                    var preflightResolution = await FacultyAssignmentRosterService.ResolveAsync(
                        preflightConnection, facultySectionId, false, HttpContext.RequestAborted);
                    if (preflightResolution.Value is null)
                        return preflightResolution.Status == FacultyAssignmentRosterService.ResolutionStatus.AmbiguousLegacy
                            ? Conflict(new { status = "Ambiguous", message = preflightResolution.Message })
                            : BadRequest(new { status = "Error", message = "Faculty assignment was not found or is no longer active." });
                    if (!FacultyAssignmentRosterService.IsOwnedBy(preflightResolution.Value, jwtUser))
                        return Forbid();
                    var preflightContextError = FacultyAssignmentRosterService.ValidateUploadContext(
                        preflightResolution.Value, academicSectionId, subjectCode, schoolYear, semester, section);
                    if (preflightContextError != null)
                        return BadRequest(new { status = "Error", message = preflightContextError });
                    if (!string.Equals(preflightResolution.Value.Semester, activeEncodingPeriod.Semester, StringComparison.OrdinalIgnoreCase))
                        return BadRequest(new { status = "Error", message = "The selected faculty assignment is outside the active encoding semester." });
                }
                term = activeEncodingPeriod.Term;

                var successCount = 0;
                var failureCount = 0;
                var errors = new List<BulkUploadError>();
                var parsedRecords = new List<GradeRequest>();
                int? workbookFacultySectionId = null;

                var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
                string NormalizeHeader(string s) => FacultyGradeWorkbookService.NormalizeHeader(s);

                var tempFile = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ext);
                try
                {
                    using (var fileStream = new FileStream(tempFile, FileMode.Create))
                        await file.CopyToAsync(fileStream);

                    // A bulk import is only a Draft. It must not wait on IPFS or any
                    // ledger dependency before the workbook has been validated and staged.

                    if (ext == ".xlsx")
                    {
                        await using (var validationStream = System.IO.File.OpenRead(tempFile))
                        {
                            var parsedWorkbook = FacultyGradeWorkbookService.Parse(validationStream, validateRows: false);
                            workbookFacultySectionId = parsedWorkbook.FacultySectionId;
                        }
                        using var workbook = new XLWorkbook(tempFile);
                        var ws = workbook.Worksheet(FacultyGradeWorkbookService.GradeSheetName);
                        if (ws == null) return BadRequest(new { status = "Error", message = "The Excel file is empty." });
                        if (!workbook.TryGetWorksheet(FacultyGradeWorkbookService.AssignmentSheetName, out var assignmentSheet) ||
                            !int.TryParse(assignmentSheet.Cell("B1").GetString(), out var embeddedFacultySectionId))
                            return BadRequest(new { status = "Error", message = "The workbook is not tied to an exact Faculty assignment. Download a fresh grading sheet." });
                        workbookFacultySectionId = embeddedFacultySectionId;
                        if (workbookFacultySectionId != facultySectionId)
                            return BadRequest(new { status = "Error", message = "The workbook belongs to a different Faculty assignment." });
                        
                        var headerRow = ws.FirstRowUsed();
                        if (headerRow == null) return BadRequest(new { status = "Error", message = "No data found in Excel sheet." });
                        
                        var headerMap = new Dictionary<string, int>();

                        var normalizedHeaders = new List<string>();
                        for (var column = headerRow.FirstCellUsed()!.Address.ColumnNumber;
                             column <= headerRow.LastCellUsed()!.Address.ColumnNumber; column++)
                        {
                            var colName = NormalizeHeader(headerRow.Cell(column).GetString());
                            if (string.IsNullOrEmpty(colName))
                                return BadRequest(new { status = "Error", message = $"The Excel heading in column {column} is blank." });
                            if (normalizedHeaders.Contains(colName, StringComparer.OrdinalIgnoreCase))
                                return BadRequest(new { status = "Error", message = $"Duplicate Excel heading '{colName}' is not allowed." });
                            normalizedHeaders.Add(colName);
                            headerMap[colName] = column;
                        }
                        if (!normalizedHeaders.Any(value => value is "student_id" or "student_no" or "id_number" or "student_number"))
                            return BadRequest(new { status = "Error", message = "A Student ID or Student Number heading is required." });

                        var rows = ws.RowsUsed().Skip(1);
                        foreach (var row in rows)
                        {
                            string? GetVal(params string[] cols) 
                            {
                                foreach (var col in cols) 
                                {
                                    if (headerMap.ContainsKey(col)) 
                                    {
                                        var cell = row.Cell(headerMap[col]);
                                        var val = "";
                                        try { val = cell.HasFormula ? cell.CachedValue.ToString() : cell.GetFormattedString(CultureInfo.InvariantCulture); }
                                        catch { val = cell.Value.ToString(); }
                                        if (!string.IsNullOrWhiteSpace(val)) return val.Trim();
                                    }
                                }
                                return null;
                            }

                            string? WeightedGrade(string[] quiz, string[] assignment, string[] attendance, string[] exam)
                            {
                                static bool Number(string? value, out decimal result) =>
                                    decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out result);
                                if (!Number(GetVal(quiz), out var q) || !Number(GetVal(assignment), out var a) ||
                                    !Number(GetVal(attendance), out var at) || !Number(GetVal(exam), out var ex)) return null;
                                return decimal.Round((q * .20m) + (a * .10m) + (at * .10m) + (ex * .60m), 2)
                                    .ToString("0.00", CultureInfo.InvariantCulture);
                            }

                            var computedMidterm = WeightedGrade(
                                new[] { "quizzes_20" }, new[] { "assignments_10" },
                                new[] { "attendance_10" }, new[] { "midterm_exam_60" }) ?? GetVal("midterm_grade");
                            var computedFinals = WeightedGrade(
                                new[] { "final_quizzes_20" }, new[] { "final_assignments_10" },
                                new[] { "final_attendance_10" }, new[] { "final_exam_60" }) ?? GetVal("final_grade", "finals_grade");

                            var sId = GradeUploadValuePolicy.NormalizeStudentIdentifier(
                                GetVal("student_id", "student_no", "id_number", "student_number"));
                            if (string.IsNullOrEmpty(sId))
                            {
                                parsedRecords.Add(new GradeRequest { UploadRowNumber = row.RowNumber() });
                                continue;
                            }

                            parsedRecords.Add(new GradeRequest
                            {
                                UploadRowNumber = row.RowNumber(),
                                StudentId = sId ?? "",
                                StudentName = GetVal("student_name", "student", "full_name", "name") ?? "",
                                Section = !string.IsNullOrWhiteSpace(section) ? section : (GetVal("section", "class_section", "sec") ?? ""),
                                Grade = GradeEncodingPeriodService.ProjectIncomingGradePayload(
                                    BuildUploadedGradePayload(
                                        GetUploadedTermGrade(GetVal, term),
                                        computedMidterm ?? GetUploadedMidtermGrade(GetVal, term),
                                        computedFinals ?? GetUploadedFinalGrade(GetVal, term),
                                        term), null, term),
                                SubjectCode = GetVal("subject_code", "course_code", "code", "subject") ?? course ?? "Unknown",
                                SubjectName = GetVal("subject_name", "descriptive_title", "course") ?? course ?? "Unknown",
                                Course = GetVal("course", "department", "program") ?? course ?? "Unknown",
                                Semester = !string.IsNullOrEmpty(semester) ? semester : (GetVal("semester", "term") ?? "Unknown"),
                                SchoolYear = !string.IsNullOrEmpty(schoolYear) ? schoolYear : (GetVal("school_year", "schoolyear", "year") ?? "Unknown"),
                                Program = GetVal("program", "department", "course") ?? course ?? "Unknown",
                                Term = InferGradeTerm(term, null),
                                Units = decimal.TryParse(GetVal("units", "credit_units"), out var units) ? units : 0,
                                Date = DateTime.Now.ToString("yyyy-MM-dd")
                            });
                        }
                    }
                    else if (ext == ".csv")
                    {
                        var csvStudentIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                        using (var reader = new StreamReader(tempFile, System.Text.Encoding.UTF8))
                        {
                            string? line;
                            int lineNum = 0;
                            Dictionary<string, int>? headerMap = null;

                            while ((line = await reader.ReadLineAsync()) != null)
                            {
                                lineNum++;
                                line = line.Trim();
                                if (string.IsNullOrEmpty(line)) continue;

                                var fields = ParseCsvLine(line);
                                if (lineNum == 1)
                                {
                                    headerMap = new Dictionary<string, int>();
                                    for (int i = 0; i < fields.Length; i++)
                                    {
                                        var colName = NormalizeHeader(fields[i]);
                                        if (string.IsNullOrEmpty(colName))
                                            return BadRequest(new { status = "Error", message = $"The CSV heading in column {i + 1} is blank." });
                                        if (headerMap.ContainsKey(colName))
                                            return BadRequest(new { status = "Error", message = $"Duplicate CSV heading '{colName}' is not allowed." });
                                        headerMap[colName] = i;
                                    }
                                    if (!headerMap.Keys.Any(value => value is "student_id" or "student_no" or "id_number" or "student_number"))
                                        return BadRequest(new { status = "Error", message = "A Student ID or Student Number heading is required." });
                                    continue;
                                }

                                string? GetVal(params string[] cols) 
                                {
                                    if (headerMap != null)
                                    {
                                        foreach (var col in cols)
                                        {
                                            if (headerMap.ContainsKey(col))
                                            {
                                                int idx = headerMap[col];
                                                if (idx < fields.Length && !string.IsNullOrWhiteSpace(fields[idx]))
                                                    return fields[idx].Trim().Trim('"');
                                            }
                                        }
                                    }
                                    return null;
                                }

                                foreach (var key in new[] {
                                    "quizzes_20", "assignments_10", "attendance_10", "midterm_exam_60", "midterm_grade",
                                    "final_quizzes_20", "final_assignments_10", "final_attendance_10", "final_exam_60",
                                    "final_grade", "final_rating"
                                })
                                {
                                    var value = GetVal(key);
                                    if (string.IsNullOrWhiteSpace(value)) continue;
                                    if (!decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var number) ||
                                        number is < 0 or > 100)
                                        return BadRequest(new {
                                            status = "ValidationError",
                                            message = $"Row {lineNum} — '{key.Replace('_', ' ')}' must be a number from 0 to 100."
                                        });
                                }

                                string? WeightedGrade(string quiz, string assignment, string attendance, string exam)
                                {
                                    static bool Number(string? value, out decimal result) =>
                                        decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out result);
                                    return Number(GetVal(quiz), out var q) && Number(GetVal(assignment), out var a) &&
                                           Number(GetVal(attendance), out var at) && Number(GetVal(exam), out var ex)
                                        ? FacultyGradeWorkbookService.WeightedGrade(q, a, at, ex)
                                            .ToString("0.00", CultureInfo.InvariantCulture)
                                        : null;
                                }

                                var computedMidterm = WeightedGrade(
                                    "quizzes_20", "assignments_10", "attendance_10", "midterm_exam_60");
                                var computedFinals = WeightedGrade(
                                    "final_quizzes_20", "final_assignments_10", "final_attendance_10", "final_exam_60");

                                var sId = GradeUploadValuePolicy.NormalizeStudentIdentifier(
                                    GetVal("student_id", "student_no", "id_number", "student_number"));
                                if (string.IsNullOrEmpty(sId))
                                {
                                    if (fields.Any(value => !string.IsNullOrWhiteSpace(value)))
                                        return BadRequest(new { status = "ValidationError", message = $"Row {lineNum} — Student ID is required." });
                                    continue;
                                }
                                if (!csvStudentIds.Add(sId))
                                    return BadRequest(new { status = "ValidationError", message = $"Row {lineNum} — duplicate Student ID {sId}." });

                                parsedRecords.Add(new GradeRequest
                                {
                                    UploadRowNumber = lineNum,
                                    StudentId = sId ?? "",
                                    StudentName = GetVal("student_name", "student", "full_name", "name") ?? "",
                                    Section = !string.IsNullOrWhiteSpace(section) ? section : (GetVal("section", "class_section", "sec") ?? ""),
                                    Grade = GradeEncodingPeriodService.ProjectIncomingGradePayload(
                                        BuildUploadedGradePayload(
                                            GetUploadedTermGrade(GetVal, term),
                                            computedMidterm ?? GetUploadedMidtermGrade(GetVal, term),
                                            computedFinals ?? GetUploadedFinalGrade(GetVal, term),
                                            term), null, term),
                                    SubjectCode = GetVal("subject_code", "course_code", "code", "subject") ?? course ?? "Unknown",
                                    SubjectName = GetVal("subject_name", "descriptive_title", "course") ?? course ?? "Unknown",
                                    Course = GetVal("course", "department", "program") ?? course ?? "Unknown",
                                    Semester = !string.IsNullOrEmpty(semester) ? semester : (GetVal("semester", "term") ?? "Unknown"),
                                    SchoolYear = !string.IsNullOrEmpty(schoolYear) ? schoolYear : (GetVal("school_year", "schoolyear", "year") ?? "Unknown"),
                                    Program = GetVal("program", "department", "course") ?? course ?? "Unknown",
                                    Term = InferGradeTerm(term, null),
                                    Units = decimal.TryParse(GetVal("units", "credit_units"), out var units) ? units : 0,
                                    Date = DateTime.Now.ToString("yyyy-MM-dd")
                                });
                            }
                        }
                    }

                    if (parsedRecords.Count == 0)
                        return BadRequest(new { status = "Error", message = "The upload contains no grade rows with Registrar student numbers." });

                    using var conn = new NpgsqlConnection(_connectionString);
                    await conn.OpenAsync();
                    await EnsurePendingGradeSchemaAsync(conn);
                    var resolvedFaculty = await ResolveApprovedAcademicIdentityAsync(conn, facultyId, jwtUser);
                    var facDept = resolvedFaculty.Department;
                    var effectiveFacultyId = resolvedFaculty.Identity;
                    if (facDept == null || string.IsNullOrWhiteSpace(effectiveFacultyId))
                    {
                        return BadRequest(new { status = "Error", message = "The authenticated Faculty account is not approved." });
                    }
                    var professorName = await ResolveFacultyDisplayNameAsync(conn, effectiveFacultyId);
                    var assignmentResolution = await FacultyAssignmentRosterService.ResolveAsync(
                        conn, facultySectionId, false, HttpContext.RequestAborted);
                    if (assignmentResolution.Value is null)
                        return assignmentResolution.Status == FacultyAssignmentRosterService.ResolutionStatus.AmbiguousLegacy
                            ? Conflict(new { status = "Ambiguous", message = assignmentResolution.Message })
                            : BadRequest(new { status = "Error", message = assignmentResolution.Message });
                    var facultyAssignment = assignmentResolution.Value;
                    if (!FacultyAssignmentRosterService.IsOwnedBy(facultyAssignment, effectiveFacultyId))
                        return Forbid();
                    var assignmentContextError = FacultyAssignmentRosterService.ValidateUploadContext(
                        facultyAssignment, academicSectionId, subjectCode, schoolYear, semester, section);
                    if (assignmentContextError != null)
                        return BadRequest(new { status = "Error", message = assignmentContextError });
                    var subjectMetadata = await FacultyAssignmentRosterService.ResolveSubjectMetadataAsync(
                        conn, facultyAssignment, HttpContext.RequestAborted);
                    if (subjectMetadata is null)
                        return Conflict(new { status = "Error", message = "The assigned subject has no unambiguous published curriculum title and units." });
                    _logger.LogInformation(
                        "Bulk grade assignment resolved for faculty user {FacultyUserId}: FacultySectionId={FacultySectionId}, AcademicSectionId={AcademicSectionId}, SchoolYear={SchoolYear}, Semester={Semester}, Subject={Subject}",
                        facultyAssignment.FacultyUserId, facultyAssignment.Id, facultyAssignment.AcademicSectionId,
                        facultyAssignment.SchoolYear, facultyAssignment.Semester, facultyAssignment.Subject);
                    var canonicalRoster = await FacultyAssignmentRosterService.GetRosterAsync(
                        conn, facultyAssignment, HttpContext.RequestAborted);
                    _logger.LogInformation(
                        "Bulk grade roster resolved for FacultySectionId={FacultySectionId}: RosterCount={RosterCount}, AllOfficialStudentNumbersResolved={Resolved}",
                        facultyAssignment.Id, canonicalRoster.Count,
                        canonicalRoster.All(student => !string.IsNullOrWhiteSpace(student.StudentNo)));
                    var rosterStudentNumbers = canonicalRoster
                        .Select(student => student.StudentNo)
                        .ToHashSet(StringComparer.OrdinalIgnoreCase);
                    // Process all extracted records uniformly
                    var processedCombos = new HashSet<string>();
                    foreach (var record in parsedRecords)
                    {
                        try
                        {
                            if (string.IsNullOrWhiteSpace(record.StudentId))
                            {
                                failureCount++;
                                errors.Add(new BulkUploadError {
                                    RowNumber = record.UploadRowNumber,
                                    StudentId = "UNKNOWN",
                                    Reason = "Student ID is required."
                                });
                                continue;
                            }
                            if (!GradeUploadValuePolicy.HasValueForTerm(record.Grade, term))
                            {
                                failureCount++;
                                errors.Add(new BulkUploadError {
                                    RowNumber = record.UploadRowNumber,
                                    StudentId = record.StudentId ?? "UNKNOWN",
                                    Reason = $"Missing {term} grade. Closed-term values were ignored."
                                });
                                continue;
                            }

                            var uploadedSubjectCode = record.SubjectCode;
                            if (!string.Equals(uploadedSubjectCode, facultyAssignment.Subject, StringComparison.OrdinalIgnoreCase))
                            {
                                failureCount++;
                                errors.Add(new BulkUploadError { RowNumber = record.UploadRowNumber, StudentId = record.StudentId ?? "", Reason = "Uploaded subject does not match the selected faculty assignment." });
                                continue;
                            }
                            if (!GradeUploadValuePolicy.TryValidatePayload(record.Grade, term, out var gradeValidationError))
                            {
                                failureCount++;
                                errors.Add(new BulkUploadError {
                                    RowNumber = record.UploadRowNumber,
                                    StudentId = record.StudentId ?? "UNKNOWN",
                                    Reason = gradeValidationError
                                });
                                continue;
                            }
                            record.SubjectCode = facultyAssignment.Subject;
                            record.SubjectName = subjectMetadata.Title;
                            record.Units = subjectMetadata.Units;
                            record.Section = facultyAssignment.CanonicalSection;
                            record.SchoolYear = facultyAssignment.SchoolYear;
                            record.Semester = facultyAssignment.Semester;
                            record.Course = facDept;
                            record.Program = facDept;
                            var comboKey = $"{record.StudentId.ToLower()}_{facultyAssignment.Subject.ToLower()}";
                            if (processedCombos.Contains(comboKey)) {
                                failureCount++;
                                errors.Add(new BulkUploadError { RowNumber = record.UploadRowNumber, StudentId = record.StudentId, Reason = "Duplicate Student ID and subject in upload." });
                                continue;
                            }
                            processedCombos.Add(comboKey);

                            using var cmdStu = new NpgsqlCommand(@"
                                SELECT sp.department, u.email, sp.student_no, sp.full_name
                                FROM users u
                                JOIN studentprofiles sp ON u.id = sp.user_id
                                WHERE (LOWER(sp.student_no) = LOWER(@sid) OR LOWER(u.email) = LOWER(@sid))
                                  AND LOWER(u.role) = 'student'
                                LIMIT 1", conn);
                            cmdStu.Parameters.AddWithValue("sid", record.StudentId);
                            string? stuDept = null, stuEmail = null;
                            string stuNumber = record.StudentId ?? "";
                            string stuName = record.StudentName ?? "";
                            using (var reader = await cmdStu.ExecuteReaderAsync())
                            {
                                if (await reader.ReadAsync())
                                {
                                    stuDept = reader.IsDBNull(0) ? null : reader.GetString(0);
                                    stuEmail = reader.GetString(1);
                                    if (!reader.IsDBNull(2)) stuNumber = reader.GetString(2);
                                    if (!reader.IsDBNull(3)) stuName = ResolvePreferredStudentName(stuName, reader.GetString(3), record.StudentId);
                                }
                            }

                            if (stuEmail == null)
                            {
                                failureCount++;
                                errors.Add(new BulkUploadError { RowNumber = record.UploadRowNumber, StudentId = record.StudentId ?? "", Reason = "Student account not found. Registrar registration is required before grade upload." });
                                continue;
                            }
                            var blockchainRecord = record.ToBlockchainRecord("PLV");
                            blockchainRecord.Section = facultyAssignment.CanonicalSection;
                            blockchainRecord.StudentHash = stuEmail ?? "";
                            blockchainRecord.StudentNo = stuNumber;
                            blockchainRecord.StudentName = stuName;
                            blockchainRecord.FacultyId = effectiveFacultyId ?? facultyId ?? "";
                            blockchainRecord.ProfessorName = professorName;
                            blockchainRecord.SubmittedBy = blockchainRecord.FacultyId;
                            blockchainRecord.Term = term;
                            blockchainRecord.Course = facDept;
                            blockchainRecord.Program = facDept;
                            blockchainRecord.IpfsCid = string.Empty;

                            var assignmentCycleId = facultyAssignment.Id.ToString();
                            blockchainRecord.SchoolYear = facultyAssignment.SchoolYear;
                            blockchainRecord.Semester = facultyAssignment.Semester;
                            if (!rosterStudentNumbers.Contains(stuNumber.Trim()))
                            {
                                failureCount++;
                                errors.Add(new BulkUploadError { RowNumber = record.UploadRowNumber, StudentId = record.StudentId ?? string.Empty, Reason = "Student is not ENROLLED in this faculty assignment's exact section and period." });
                                continue;
                            }

                            string? existingId = null;
                            string? existingGradeJson = null;
                            string? existingStatus = null;

                            using (var cmdCheck = new NpgsqlCommand("SELECT id, grade, status FROM pending_grade_records WHERE LOWER(student_hash) = LOWER(@sh) AND LOWER(subject_code) = LOWER(@subj) AND school_year = @sy AND semester = @sem AND LOWER(section) = LOWER(@sec) AND assignment_cycle_id = @assignmentCycleId AND LOWER(COALESCE(term, '')) = LOWER(@term) LIMIT 1", conn))
                            {
                                cmdCheck.Parameters.AddWithValue("sh", blockchainRecord.StudentHash ?? "");
                                cmdCheck.Parameters.AddWithValue("subj", blockchainRecord.SubjectCode ?? "");
                                cmdCheck.Parameters.AddWithValue("sy", blockchainRecord.SchoolYear ?? "");
                                cmdCheck.Parameters.AddWithValue("sem", blockchainRecord.Semester ?? "");
                                cmdCheck.Parameters.AddWithValue("sec", blockchainRecord.Section ?? "");
                                cmdCheck.Parameters.AddWithValue("assignmentCycleId", assignmentCycleId);
                                cmdCheck.Parameters.AddWithValue("term", term);
                                using var checkReader = await cmdCheck.ExecuteReaderAsync();
                                if (await checkReader.ReadAsync())
                                {
                                    existingId = checkReader.GetString(0);
                                    existingGradeJson = checkReader.GetString(1);
                                    existingStatus = checkReader.GetString(2);
                                }
                            }

                            if (existingStatus != null &&
                                !string.Equals(existingStatus, "Draft", StringComparison.OrdinalIgnoreCase) &&
                                !string.Equals(existingStatus, "Returned", StringComparison.OrdinalIgnoreCase))
                            {
                                failureCount++;
                                errors.Add(new BulkUploadError {
                                    RowNumber = record.UploadRowNumber,
                                    StudentId = record.StudentId ?? "",
                                    Reason = "This grade is already submitted or approved and cannot be edited by Faculty."
                                });
                                continue;
                            }
                            if (existingStatus != null && !confirmOverwrite)
                            {
                                failureCount++;
                                errors.Add(new BulkUploadError {
                                    RowNumber = record.UploadRowNumber,
                                    StudentId = record.StudentId ?? "",
                                    Reason = $"Conflict preview: an existing {existingStatus} grade would be overwritten. Confirm overwrite and upload again to replace it."
                                });
                                continue;
                            }

                            blockchainRecord.Id = existingId ?? Guid.NewGuid().ToString();
                            var previousSameTermGradePayload = existingGradeJson;

                            if (string.Equals(term, GradeAcademicTerm.Finals, StringComparison.OrdinalIgnoreCase) &&
                                string.IsNullOrWhiteSpace(existingGradeJson))
                            {
                                existingGradeJson = await TryGetFinalizedMidtermPayloadAsync(
                                    conn,
                                    assignmentCycleId,
                                    blockchainRecord.StudentHash ?? string.Empty,
                                    facultyAssignment.Subject,
                                    effectiveFacultyId ?? facultyId ?? string.Empty,
                                    HttpContext.RequestAborted);
                            }

                            blockchainRecord.Grade = GradeEncodingPeriodService.ProjectIncomingGradePayload(
                                record.Grade, existingGradeJson, term);
                                
                            using var transaction = await conn.BeginTransactionAsync();
                            try
                            {
                                using var cmdStage = new NpgsqlCommand(@"
                                    INSERT INTO pending_grade_records (id, student_hash, student_no, student_name, section, course, subject_code, grade, semester, school_year, faculty_id, date, ipfs_cid, status, assignment_cycle_id, term)
                        VALUES (@id, @sh, @studentNo, @studentName, @sec, @course, @subj, @gr, @sem, @sy, @fac, @dt, @ipfs, 'Draft', @assignmentCycleId, @term)
                                    ON CONFLICT (id) DO UPDATE SET
                                        student_no = EXCLUDED.student_no,
                                        student_name = EXCLUDED.student_name,
                                        section = EXCLUDED.section,
                                        course = EXCLUDED.course,
                                        grade = EXCLUDED.grade,
                                        faculty_id = EXCLUDED.faculty_id,
                                        date = EXCLUDED.date,
                                        ipfs_cid = EXCLUDED.ipfs_cid,
                                        term = EXCLUDED.term,
                            status = 'Draft';", conn, transaction);
                                cmdStage.Parameters.AddWithValue("id", blockchainRecord.Id ?? Guid.NewGuid().ToString());
                                cmdStage.Parameters.AddWithValue("sh", blockchainRecord.StudentHash ?? "");
                                cmdStage.Parameters.AddWithValue("studentNo", blockchainRecord.StudentNo ?? "");
                                cmdStage.Parameters.AddWithValue("studentName", blockchainRecord.StudentName ?? "");
                                cmdStage.Parameters.AddWithValue("sec", blockchainRecord.Section ?? "");
                                cmdStage.Parameters.AddWithValue("course", blockchainRecord.Course ?? "");
                                cmdStage.Parameters.AddWithValue("subj", blockchainRecord.SubjectCode ?? "");
                                cmdStage.Parameters.AddWithValue("gr", blockchainRecord.Grade ?? "");
                                cmdStage.Parameters.AddWithValue("sem", blockchainRecord.Semester ?? "");
                                cmdStage.Parameters.AddWithValue("sy", blockchainRecord.SchoolYear ?? "");
                                cmdStage.Parameters.AddWithValue("fac", blockchainRecord.FacultyId ?? "");
                                cmdStage.Parameters.AddWithValue("assignmentCycleId", assignmentCycleId);
                                cmdStage.Parameters.AddWithValue("dt", blockchainRecord.Date ?? "");
                                cmdStage.Parameters.AddWithValue("ipfs", blockchainRecord.IpfsCid ?? "");
                                cmdStage.Parameters.AddWithValue("term", term);
                                await cmdStage.ExecuteNonQueryAsync();

                                using (var cycleMap = new NpgsqlCommand(@"
                                    INSERT INTO grade_assignment_cycles (record_id, assignment_cycle_id)
                                    VALUES (@recordId, @assignmentCycleId)
                                    ON CONFLICT (record_id) DO UPDATE SET assignment_cycle_id = EXCLUDED.assignment_cycle_id;", conn, transaction))
                                {
                                    cycleMap.Parameters.AddWithValue("recordId", blockchainRecord.Id ?? "");
                                    cycleMap.Parameters.AddWithValue("assignmentCycleId", assignmentCycleId);
                                    await cycleMap.ExecuteNonQueryAsync();
                                }

                                using var cmdMetadata = new NpgsqlCommand(@"
                                    UPDATE pending_grade_records
                                    SET subject_title = @subjectTitle, professor_name = @professorName,
                                        program = @program, term = @term, units = @units,
                                        submitted_by = @submittedBy, recorded_at = CURRENT_TIMESTAMP
                                    WHERE id = @id;", conn, transaction);
                                cmdMetadata.Parameters.AddWithValue("subjectTitle", blockchainRecord.SubjectTitle ?? "");
                                cmdMetadata.Parameters.AddWithValue("professorName", blockchainRecord.ProfessorName ?? "");
                                cmdMetadata.Parameters.AddWithValue("program", blockchainRecord.Program ?? blockchainRecord.Course ?? "");
                                cmdMetadata.Parameters.AddWithValue("term", blockchainRecord.Term ?? "midterm");
                                cmdMetadata.Parameters.AddWithValue("units", blockchainRecord.Units);
                                cmdMetadata.Parameters.AddWithValue("submittedBy", blockchainRecord.SubmittedBy ?? blockchainRecord.FacultyId ?? "");
                                cmdMetadata.Parameters.AddWithValue("id", blockchainRecord.Id ?? "");
                                await cmdMetadata.ExecuteNonQueryAsync();

                                using var cmdLog = new NpgsqlCommand(@"
                                    INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp) 
                                    VALUES (@rid, @old, @new, @reason, @appr, CURRENT_TIMESTAMP)", conn, transaction);
                                cmdLog.Parameters.AddWithValue("rid", blockchainRecord.Id ?? "");
                                cmdLog.Parameters.AddWithValue("old", previousSameTermGradePayload != null ? (object)previousSameTermGradePayload : DBNull.Value);
                                cmdLog.Parameters.AddWithValue("new", blockchainRecord.Grade ?? "");
                                cmdLog.Parameters.AddWithValue("reason", "Bulk Excel/CSV Upload (Staged)");
                                cmdLog.Parameters.AddWithValue("appr", effectiveFacultyId ?? facultyId ?? (object)DBNull.Value);
                                await cmdLog.ExecuteNonQueryAsync();
                                
                                await transaction.CommitAsync();
                                successCount++;
                            }
                            catch (Exception txEx)
                            {
                                await transaction.RollbackAsync();
                                _logger.LogError(txEx,
                                    "Bulk grade staging transaction failed for student {StudentId}, FacultySectionId={FacultySectionId}, term={Term}",
                                    record.StudentId, facultyAssignment.Id, term);
                                failureCount++;
                                errors.Add(new BulkUploadError { RowNumber = record.UploadRowNumber, StudentId = record.StudentId ?? "", Reason = "The grade could not be saved. No changes were committed for this row." });
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex,
                                "Bulk grade row failed for student {StudentId}, FacultySectionId={FacultySectionId}, term={Term}",
                                record.StudentId, facultyAssignment.Id, term);
                            failureCount++;
                            errors.Add(new BulkUploadError {
                                RowNumber = record.UploadRowNumber,
                                StudentId = record.StudentId ?? "ERROR",
                                Reason = string.Equals(term, GradeAcademicTerm.Finals, StringComparison.OrdinalIgnoreCase)
                                    ? "The Final Term grade could not be saved because its trusted Midterm history or grade storage was unavailable."
                                    : "The grade could not be saved because grade storage was unavailable."
                            });
                        }
                    }
                }
                finally
                {
                if (System.IO.File.Exists(tempFile))
                    System.IO.File.Delete(tempFile);
                }

                if (successCount == 0 && failureCount > 0)
                    return BadRequest(new {
                        status = "Error",
                        message = $"No grades were saved. {errors[0].Reason}",
                        totalProcessed = failureCount,
                        successful = 0,
                        failed = failureCount,
                        errors
                    });
                await NotifyAcademicDataChangedAsync("grades_bulk_uploaded", course, facultyId);
                return Ok(new
                {
                    status = failureCount == 0 ? "Success" : "Partial Success",
                    totalProcessed = successCount + failureCount,
                    successful = successCount,
                    failed = failureCount,
                    errors = errors.Any() ? errors : null,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (GradeEncodingPeriodException ex)
            {
                return BadRequest(new { status = "EncodingPeriodClosed", message = ex.Message });
            }
            catch (FacultyAssignmentRosterService.RosterDataIntegrityException ex)
            {
                return Conflict(new {
                    status = "DataIntegrityError",
                    message = ex.Message,
                    enrollmentId = ex.EnrollmentId,
                    internalStudentId = ex.StudentUserId
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { status = "ValidationError", message = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Grade workbook upload failed");
                return StatusCode(500, new { status = "Error", message = "The grade upload could not be completed." });
            }
        }

        private static string[] ParseCsvLine(string line)
        {
            var fields = new List<string>();
            var current = new StringBuilder();
            var inQuotes = false;

            for (int i = 0; i < line.Length; i++)
            {
                var c = line[i];
                if (c == '"')
                {
                    if (inQuotes && i + 1 < line.Length && line[i + 1] == '"')
                    {
                        current.Append('"');
                        i++;
                    }
                    else
                    {
                        inQuotes = !inQuotes;
                    }
                }
                else if (c == ',' && !inQuotes)
                {
                    fields.Add(current.ToString());
                    current.Clear();
                }
                else
                {
                    current.Append(c);
                }
            }

            fields.Add(current.ToString());
            return fields.ToArray();
        }

        private string? GetCsvField(string[] fields, Dictionary<string, int>? headerMap, string fieldName)
        {
            if (headerMap != null && headerMap.ContainsKey(fieldName))
            {
                int idx = headerMap[fieldName];
                if (idx < fields.Length)
                    return fields[idx].Trim();
            }
            return null;
        }

        [HttpPost("correct")]
        [Authorize(Roles = "faculty")]
        public async Task<IActionResult> CorrectGrade([FromBody] GradeCorrectionRequest correction)
        {
            if (string.IsNullOrEmpty(correction.RecordID)) 
                return BadRequest(new { status = "Error", message = "RecordID is required." });

            try
            {
                var actorEmail = AuthenticatedEmail();
                correction.ApprovedBy = actorEmail;
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                if (!await CanAccessGradeRecordAsync(conn, correction.RecordID, actorEmail, "faculty"))
                    return Forbid();

                using var cmdCheck = new NpgsqlCommand("SELECT grade, status FROM pending_grade_records WHERE id = @id", conn);
                cmdCheck.Parameters.AddWithValue("id", correction.RecordID);
                string? existingPending = null;
                string? existingStatus = null;
                string? authoritativeOldGrade = null;
                await using (var pendingReader = await cmdCheck.ExecuteReaderAsync())
                {
                    if (await pendingReader.ReadAsync())
                    {
                        existingPending = pendingReader.IsDBNull(0) ? "" : pendingReader.GetString(0);
                        existingStatus = pendingReader.IsDBNull(1) ? "" : pendingReader.GetString(1);
                    }
                }

                if (existingPending != null)
                {
                    authoritativeOldGrade = existingPending;
                    if (!string.Equals(existingStatus, "Returned", StringComparison.OrdinalIgnoreCase))
                        return Conflict(new { status = "Error", message = "Only a Chairperson-returned grade can be corrected." });
                    using var cmdUpdate = new NpgsqlCommand("UPDATE pending_grade_records SET grade = @grade, status = 'Corrected', date = @dt WHERE id = @id", conn);
                    cmdUpdate.Parameters.AddWithValue("grade", correction.NewGrade ?? "");
                    cmdUpdate.Parameters.AddWithValue("dt", DateTime.UtcNow.ToString("yyyy-MM-dd"));
                    cmdUpdate.Parameters.AddWithValue("id", correction.RecordID ?? (object)DBNull.Value);
                    await cmdUpdate.ExecuteNonQueryAsync();
                }
                else
                {
                    string existingGradeJson = await _blockchainService.GetGradeAsync(correction.RecordID, correction.ApprovedBy);
                    var gradeToUpdate = JsonSerializer.Deserialize<AcademicRecord>(existingGradeJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    if (gradeToUpdate == null) 
                        return NotFound(new { status = "Error", message = "Original grade record not found on blockchain." });
                    if (!string.Equals(gradeToUpdate.Status, "Returned", StringComparison.OrdinalIgnoreCase))
                        return Conflict(new { status = "Error", message = "Only a Chairperson-returned grade can be corrected." });

                    authoritativeOldGrade = gradeToUpdate.Grade;
                    gradeToUpdate.Grade = correction.NewGrade ?? "";
                    gradeToUpdate.FacultyId = correction.ApprovedBy ?? "";
                    gradeToUpdate.Date = DateTime.UtcNow.ToString("yyyy-MM-dd");
                    
                    await _blockchainService.UpdateGradeAsync(gradeToUpdate, correction.ApprovedBy ?? "Unknown");
                }

                using var cmdLog = new NpgsqlCommand(@"
                    INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp) 
                    VALUES (@rid, @old, @new, @reason, @appr, CURRENT_TIMESTAMP)", conn);
                cmdLog.Parameters.AddWithValue("rid", correction.RecordID ?? (object)DBNull.Value);
                cmdLog.Parameters.AddWithValue("old", authoritativeOldGrade != null ? (object)authoritativeOldGrade : DBNull.Value);
                cmdLog.Parameters.AddWithValue("new", correction.NewGrade != null ? (object)correction.NewGrade : DBNull.Value);
                cmdLog.Parameters.AddWithValue("reason", correction.ReasonText ?? "");
                cmdLog.Parameters.AddWithValue("appr", correction.ApprovedBy ?? "");
                await cmdLog.ExecuteNonQueryAsync();

                await NotifyAcademicDataChangedAsync("grade_corrected", null, correction.ApprovedBy);
                return Ok(new { status = "Success", message = "Correction synchronized." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPost("correct-finalized")]
        [Authorize(Roles = "department_admin")]
        public async Task<IActionResult> CorrectFinalizedGrade([FromBody] FinalizedGradeCorrectionRequest correction)
        {
            correction.RecordId = correction.RecordId?.Trim() ?? string.Empty;
            correction.Reason = correction.Reason?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(correction.RecordId) || string.IsNullOrWhiteSpace(correction.NewGrade))
                return BadRequest(new { status = "Error", message = "Record ID and corrected grade are required." });
            if (correction.Reason.Length < 3)
                return BadRequest(new { status = "Error", message = "Correction reason must contain at least 3 characters." });
            if (correction.ExpectedGradeVersion < 1)
                return BadRequest(new { status = "Error", message = "The current grade version is required. Refresh and try again." });

            var actor = AuthenticatedEmail();
            try
            {
                await using var connection = new NpgsqlConnection(_connectionString);
                await connection.OpenAsync(HttpContext.RequestAborted);
                if (!await CanAccessGradeRecordAsync(connection, correction.RecordId, actor, "department_admin"))
                    return Forbid();

                var beforeJson = await _blockchainService.GetGradeAsync(correction.RecordId, actor);
                var before = JsonSerializer.Deserialize<AcademicRecord>(beforeJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (before == null) return NotFound(new { status = "Error", message = "Finalized grade was not found." });
                if (!string.Equals(before.Status, "Finalized", StringComparison.OrdinalIgnoreCase))
                    return Conflict(new { status = "Error", message = "Only a finalized grade can create a new immutable grade version." });
                if (FinalizedGradeVersion(before) != correction.ExpectedGradeVersion)
                    return Conflict(new { status = "Error", message = "This grade was corrected by another user. Refresh before trying again." });

                await _blockchainService.CorrectFinalizedGradeAsync(correction, actor);
                var committedJson = await _blockchainService.GetGradeAsync(correction.RecordId, actor);
                var committed = JsonSerializer.Deserialize<AcademicRecord>(committedJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (committed == null || FinalizedGradeVersion(committed) != correction.ExpectedGradeVersion + 1 ||
                    !string.Equals(committed.Status, "Finalized", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("The corrected Fabric grade could not be verified after commit.");

                try
                {
                    await using var logCommand = new NpgsqlCommand(@"
                        INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp)
                        VALUES (@recordId, @oldGrade, @newGrade, @reason, @actor, CURRENT_TIMESTAMP);", connection);
                    logCommand.Parameters.AddWithValue("recordId", correction.RecordId);
                    logCommand.Parameters.AddWithValue("oldGrade", before.Grade ?? string.Empty);
                    logCommand.Parameters.AddWithValue("newGrade", correction.NewGrade);
                    logCommand.Parameters.AddWithValue("reason", correction.Reason);
                    logCommand.Parameters.AddWithValue("actor", actor);
                    await logCommand.ExecuteNonQueryAsync(HttpContext.RequestAborted);
                }
                catch (Exception auditException)
                {
                    // Fabric is authoritative. Never report the committed version as absent merely
                    // because the secondary PostgreSQL audit copy could not be written.
                    _logger.LogWarning(auditException, "Fabric grade {RecordId} was corrected, but its PostgreSQL audit copy was not recorded.", correction.RecordId);
                }

                await NotifyAcademicDataChangedAsync("finalized_grade_corrected", committed.Program, actor);
                return Ok(new
                {
                    status = "Success",
                    message = $"Corrected grade committed as immutable version {FinalizedGradeVersion(committed)}. Registrar release is required before Student visibility.",
                    data = committed
                });
            }
            catch (LedgerMiddlewareException exception) when (exception.StatusCode == System.Net.HttpStatusCode.Conflict)
            {
                return Conflict(new { status = "Error", message = "This grade changed while the correction was being submitted. Refresh and try again." });
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Finalized grade correction failed for {RecordId}; no application state was advanced before Fabric commit.", correction.RecordId);
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { status = "Error", message = "The finalized correction could not be committed. The current ledger version remains authoritative." });
            }
        }

        [HttpGet("grade-summary/pdf")]
        [Authorize(Roles = "registrar")]
        public async Task<IActionResult> ExportGradeSummaryPdf(
            [FromQuery] string section,
            [FromQuery] string? schoolYear,
            [FromQuery] string? semester,
            CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(section))
                return BadRequest(new { status = "Error", message = "Section is required." });

            var registrar = AuthenticatedEmail();
            var records = new List<AcademicRecord>();
            try
            {
                try
                {
                    var ledgerJson = await _blockchainService.GetAllGradesAsync(registrar);
                    using var ledgerDocument = JsonDocument.Parse(ledgerJson);
                    var ledgerData = ledgerDocument.RootElement.TryGetProperty("data", out var data)
                        ? data
                        : ledgerDocument.RootElement;
                    if (ledgerData.ValueKind == JsonValueKind.Array)
                    {
                        records.AddRange(JsonSerializer.Deserialize<List<AcademicRecord>>(
                            ledgerData.GetRawText(),
                            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new List<AcademicRecord>());
                    }
                }
                catch (Exception ledgerException)
                {
                    _logger.LogWarning(ledgerException, "Ledger grades were unavailable while exporting section {Section}; using staged records.", section);
                }

                await using var connection = new NpgsqlConnection(_connectionString);
                await connection.OpenAsync(cancellationToken);
                await EnsurePendingGradeSchemaAsync(connection);
                await using (var command = new NpgsqlCommand(@"
                    SELECT id, student_hash, student_no, student_name, section, course, subject_code, grade,
                           semester, school_year, faculty_id, date, status, subject_title, professor_name,
                           program, term, units, submitted_by, recorded_at, transaction_id, transaction_hash
                    FROM pending_grade_records
                    WHERE LOWER(section) = LOWER(@section)
                      AND LOWER(status) IN ('departmentapproved', 'finalized', 'issued');", connection))
                {
                    command.Parameters.AddWithValue("section", section.Trim());
                    await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                    {
                        records.Add(new AcademicRecord
                        {
                            Id = reader.IsDBNull(0) ? string.Empty : reader.GetString(0),
                            StudentHash = reader.IsDBNull(1) ? string.Empty : reader.GetString(1),
                            StudentNo = reader.IsDBNull(2) ? string.Empty : reader.GetString(2),
                            StudentName = reader.IsDBNull(3) ? string.Empty : reader.GetString(3),
                            Section = reader.IsDBNull(4) ? string.Empty : reader.GetString(4),
                            Course = reader.IsDBNull(5) ? string.Empty : reader.GetString(5),
                            SubjectCode = reader.IsDBNull(6) ? string.Empty : reader.GetString(6),
                            Grade = reader.IsDBNull(7) ? string.Empty : reader.GetString(7),
                            Semester = reader.IsDBNull(8) ? string.Empty : reader.GetString(8),
                            SchoolYear = reader.IsDBNull(9) ? string.Empty : reader.GetString(9),
                            FacultyId = reader.IsDBNull(10) ? string.Empty : reader.GetString(10),
                            Date = reader.IsDBNull(11) ? string.Empty : reader.GetString(11),
                            Status = reader.IsDBNull(12) ? string.Empty : reader.GetString(12),
                            SubjectTitle = reader.IsDBNull(13) ? string.Empty : reader.GetString(13),
                            ProfessorName = reader.IsDBNull(14) ? string.Empty : reader.GetString(14),
                            Program = reader.IsDBNull(15) ? string.Empty : reader.GetString(15),
                            Term = reader.IsDBNull(16) ? string.Empty : reader.GetString(16),
                            Units = reader.IsDBNull(17) ? 0 : reader.GetDecimal(17),
                            SubmittedBy = reader.IsDBNull(18) ? string.Empty : reader.GetString(18),
                            Timestamp = reader.IsDBNull(19) ? string.Empty : reader.GetFieldValue<DateTimeOffset>(19).ToString("O"),
                            TransactionId = reader.IsDBNull(20) ? string.Empty : reader.GetString(20),
                            TransactionHash = reader.IsDBNull(21) ? string.Empty : reader.GetString(21)
                        });
                    }
                }

                var studentNames = new Dictionary<string, (string Number, string Name)>(StringComparer.OrdinalIgnoreCase);
                await using (var profiles = new NpgsqlCommand(@"
                    SELECT u.email, COALESCE(sp.student_no, ''), COALESCE(sp.full_name, '')
                    FROM users u
                    JOIN studentprofiles sp ON sp.user_id = u.id
                    WHERE LOWER(u.role) = 'student';", connection))
                await using (var profileReader = await profiles.ExecuteReaderAsync(cancellationToken))
                {
                    while (await profileReader.ReadAsync(cancellationToken))
                    {
                        var email = profileReader.GetString(0);
                        var number = profileReader.GetString(1);
                        var name = profileReader.GetString(2);
                        studentNames[email] = (number, name);
                        if (!string.IsNullOrWhiteSpace(number)) studentNames[number] = (number, name);
                    }
                }

                records = records
                    .Where(record => string.Equals(record.Section?.Trim(), section.Trim(), StringComparison.OrdinalIgnoreCase))
                    .Where(record => string.IsNullOrWhiteSpace(schoolYear) || string.Equals(record.SchoolYear?.Trim(), schoolYear.Trim(), StringComparison.OrdinalIgnoreCase))
                    .Where(record => string.IsNullOrWhiteSpace(semester) || string.Equals(record.Semester?.Trim(), semester.Trim(), StringComparison.OrdinalIgnoreCase))
                    .Where(record => string.Equals(record.Status, "Finalized", StringComparison.OrdinalIgnoreCase))
                    .GroupBy(record => string.IsNullOrWhiteSpace(record.Id)
                        ? $"{record.StudentHash}|{record.SubjectCode}|{record.SchoolYear}|{record.Semester}"
                        : record.Id,
                        StringComparer.OrdinalIgnoreCase)
                    .Select(group => group.OrderByDescending(GetAcademicRecordCompletenessScore).First())
                    .OrderBy(record => record.StudentName)
                    .ThenBy(record => record.StudentNo)
                    .ThenBy(record => record.SubjectCode)
                    .ToList();

                if (records.Count == 0)
                    return NotFound(new { status = "Error", message = "No finalized grades were found for the selected section and period." });

                var lines = new List<string>
                {
                    "PAMANTASAN NG LUNGSOD NG VALENZUELA - BLOCKGO",
                    "GRADE SUMMARY REPORT",
                    $"Section: {section.Trim()}    School Year: {(string.IsNullOrWhiteSpace(schoolYear) ? "All" : schoolYear.Trim())}    Semester: {(string.IsNullOrWhiteSpace(semester) ? "All" : semester.Trim())}",
                    $"Generated: {DateTimeOffset.UtcNow:yyyy-MM-dd HH:mm:ss 'UTC'}    Records: {records.Count}",
                    string.Empty,
                    $"{"Student ID",-14} {"Student Name",-28} {"Subject",-14} {"Grade",-9} {"Status",-20}",
                    new string('-', 91)
                };
                foreach (var record in records)
                {
                    var profileKey = !string.IsNullOrWhiteSpace(record.StudentNo) ? record.StudentNo : record.StudentHash;
                    studentNames.TryGetValue(profileKey ?? string.Empty, out var profile);
                    var studentNumber = FirstNonBlank(record.StudentNo, record.StudentId, profile.Number, record.StudentHash);
                    var studentName = FirstNonBlank(record.StudentName, profile.Name, "Unknown Student");
                    lines.Add($"{FitPdfColumn(studentNumber, 14),-14} {FitPdfColumn(studentName, 28),-28} {FitPdfColumn(record.SubjectCode, 14),-14} {FitPdfColumn(DisplayGradeForReport(record.Grade), 9),-9} {FitPdfColumn(record.Status, 20),-20}");
                }

                var pdf = BuildTextPdf(lines);
                var safeSection = Regex.Replace(section.Trim(), @"[^A-Za-z0-9_-]+", "_");
                return File(pdf, "application/pdf", $"grade-summary_{safeSection}.pdf");
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Grade summary PDF export failed for section {Section}", section);
                return StatusCode(500, new { status = "Error", message = "The grade summary PDF could not be generated." });
            }
        }

        private static string FirstNonBlank(params string?[] values) =>
            values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;

        private static string DisplayGradeForReport(string? rawGrade)
        {
            if (string.IsNullOrWhiteSpace(rawGrade)) return string.Empty;
            try
            {
                using var document = JsonDocument.Parse(rawGrade);
                if (document.RootElement.ValueKind == JsonValueKind.Object)
                {
                    foreach (var property in new[] { "finalAverage", "finals", "midterm" })
                        if (document.RootElement.TryGetProperty(property, out var value) && value.ValueKind != JsonValueKind.Null)
                            return value.ValueKind == JsonValueKind.String ? value.GetString() ?? string.Empty : value.ToString();
                }
            }
            catch (JsonException)
            {
                // Older ledger entries store the grade as plain text.
            }
            return rawGrade.Trim();
        }

        private static string FitPdfColumn(string? value, int width)
        {
            var normalized = Regex.Replace(value ?? string.Empty, @"\s+", " ").Trim();
            return normalized.Length <= width ? normalized : normalized[..Math.Max(1, width - 1)] + "~";
        }

        private static byte[] BuildTextPdf(IReadOnlyList<string> reportLines)
        {
            const int linesPerPage = 38;
            var pages = reportLines.Chunk(linesPerPage).Select(chunk => chunk.ToArray()).ToArray();
            var objectCount = 3 + pages.Length * 2;
            var offsets = new long[objectCount + 1];
            using var output = new MemoryStream();

            void Write(string value)
            {
                var bytes = Encoding.ASCII.GetBytes(value);
                output.Write(bytes, 0, bytes.Length);
            }
            void WriteObject(int number, string body)
            {
                offsets[number] = output.Position;
                Write($"{number} 0 obj\n{body}\nendobj\n");
            }
            static string Escape(string value)
            {
                var ascii = new string(value.Select(character => character is >= ' ' and <= '~' ? character : '?').ToArray());
                return ascii.Replace("\\", "\\\\").Replace("(", "\\(").Replace(")", "\\)");
            }

            Write("%PDF-1.4\n");
            WriteObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
            var pageReferences = string.Join(" ", Enumerable.Range(0, pages.Length).Select(index => $"{4 + index * 2} 0 R"));
            WriteObject(2, $"<< /Type /Pages /Kids [{pageReferences}] /Count {pages.Length} >>");
            WriteObject(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");

            for (var pageIndex = 0; pageIndex < pages.Length; pageIndex++)
            {
                var pageObject = 4 + pageIndex * 2;
                var contentObject = pageObject + 1;
                var content = new StringBuilder("BT\n/F1 8 Tf\n36 558 Td\n12 TL\n");
                foreach (var line in pages[pageIndex])
                    content.Append('(').Append(Escape(line)).Append(") Tj\nT*\n");
                content.Append("ET\n");
                var contentText = content.ToString();
                WriteObject(pageObject, $"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents {contentObject} 0 R >>");
                WriteObject(contentObject, $"<< /Length {Encoding.ASCII.GetByteCount(contentText)} >>\nstream\n{contentText}endstream");
            }

            var xrefOffset = output.Position;
            Write($"xref\n0 {objectCount + 1}\n");
            Write("0000000000 65535 f \n");
            for (var number = 1; number <= objectCount; number++)
                Write($"{offsets[number]:D10} 00000 n \n");
            Write($"trailer\n<< /Size {objectCount + 1} /Root 1 0 R >>\nstartxref\n{xrefOffset}\n%%EOF\n");
            return output.ToArray();
        }

        [HttpGet("all")]
        public async Task<IActionResult> GetAllGrades([FromQuery] string invokerId)
        {
            invokerId = AuthenticatedEmail();
            var jwtRole = AuthenticatedRole();
            bool isAuthorizedViewer = jwtRole == "registrar" || jwtRole == "department_admin";
            bool isStudent = jwtRole == "student";
            var diagnosticDepartment = "unresolved";
            var diagnosticSchoolYear = "unresolved";
            var diagnosticSemester = "unresolved";
            var diagnosticTerm = "unresolved";

            try
            {
                var allGrades = new List<AcademicRecord>();
                var authoritativeLedgerGrades = new List<AcademicRecord>();

                try {
                    var jsonResult = await _blockchainService.GetAllGradesAsync(invokerId);
                    using var doc = JsonDocument.Parse(jsonResult);
                    if (doc.RootElement.TryGetProperty("data", out var dataElement))
                    {
                        var blockchainGrades = JsonSerializer.Deserialize<List<AcademicRecord>>(
                            dataElement.GetRawText(), 
                            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                        );
                        if (blockchainGrades != null)
                        {
                            authoritativeLedgerGrades.AddRange(blockchainGrades);
                            allGrades.AddRange(blockchainGrades);
                        }
                    }
                } catch (Exception ex) {
                    _logger.LogWarning(ex, "Could not fetch blockchain grades for role {Role}, user {User}", jwtRole, invokerId);
                    if (jwtRole == "department_admin")
                        throw new InvalidOperationException("Authoritative finalized grade tracking is unavailable.", ex);
                }

                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsurePendingGradeSchemaAsync(conn);
                var pendingGradesById = new Dictionary<string, AcademicRecord>(StringComparer.OrdinalIgnoreCase);

                using var cmd = new NpgsqlCommand(@"
                    SELECT id, student_hash, student_no, student_name, section, course, subject_code, grade,
                           semester, school_year, faculty_id, date, ipfs_cid, status, note,
                           subject_title, professor_name, program, term, units, submitted_by,
                           recorded_at, transaction_id, transaction_hash, assignment_cycle_id
                    FROM pending_grade_records", conn);
                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    var pendingGrade = new AcademicRecord {
                        Id = reader.IsDBNull(0) ? "" : reader.GetString(0),
                        StudentHash = reader.IsDBNull(1) ? "" : reader.GetString(1),
                        StudentNo = reader.IsDBNull(2) ? "" : reader.GetString(2),
                        StudentName = reader.IsDBNull(3) ? "" : reader.GetString(3),
                        Section = reader.IsDBNull(4) ? "" : reader.GetString(4),
                        Course = reader.IsDBNull(5) ? "" : reader.GetString(5),
                        SubjectCode = reader.IsDBNull(6) ? "" : reader.GetString(6),
                        Grade = reader.IsDBNull(7) ? "" : reader.GetString(7),
                        Semester = reader.IsDBNull(8) ? "" : reader.GetString(8),
                        SchoolYear = reader.IsDBNull(9) ? "" : reader.GetString(9),
                        FacultyId = reader.IsDBNull(10) ? "" : reader.GetString(10),
                        Date = reader.IsDBNull(11) ? "" : reader.GetString(11),
                        IpfsCid = reader.IsDBNull(12) ? "" : reader.GetString(12),
                        Status = reader.IsDBNull(13) ? "" : reader.GetString(13),
                        Note = reader.IsDBNull(14) ? "" : reader.GetString(14),
                        SubjectTitle = reader.IsDBNull(15) ? "" : reader.GetString(15),
                        ProfessorName = reader.IsDBNull(16) ? "" : reader.GetString(16),
                        Program = reader.IsDBNull(17) ? "" : reader.GetString(17),
                        Term = reader.IsDBNull(18) ? "" : reader.GetString(18),
                        Units = reader.IsDBNull(19) ? 0 : reader.GetDecimal(19),
                        SubmittedBy = reader.IsDBNull(20) ? "" : reader.GetString(20),
                        Timestamp = reader.IsDBNull(21) ? "" : reader.GetFieldValue<DateTimeOffset>(21).ToString("O"),
                        TransactionId = reader.IsDBNull(22) ? "" : reader.GetString(22),
                        TransactionHash = reader.IsDBNull(23) ? "" : reader.GetString(23),
                        AssignmentCycleId = reader.IsDBNull(24) ? "" : reader.GetString(24),
                        University = "PLV",
                        Version = 1
                    };
                    allGrades.Add(pendingGrade);
                    if (!string.IsNullOrWhiteSpace(pendingGrade.Id))
                        pendingGradesById[pendingGrade.Id] = pendingGrade;
                }
                await reader.CloseAsync();

                var comparisonHistoryByRecordId = new Dictionary<string, List<GradeComparisonHistoryEntry>>(StringComparer.OrdinalIgnoreCase);

                var assignmentCycles = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                using (var cycleCommand = new NpgsqlCommand("SELECT record_id, assignment_cycle_id FROM grade_assignment_cycles", conn))
                using (var cycleReader = await cycleCommand.ExecuteReaderAsync())
                    while (await cycleReader.ReadAsync()) assignmentCycles[cycleReader.GetString(0)] = cycleReader.GetString(1);
                foreach (var grade in allGrades)
                    if (assignmentCycles.TryGetValue(grade.Id ?? "", out var cycleId)) grade.AssignmentCycleId = cycleId;

                if (jwtRole == "department_admin")
                {
                    HashSet<string> currentVisibleRecordIds;
                    HashSet<string> currentFinalizedRecordIds;
                    ActiveGradeEncodingPeriod? activeEncodingPeriod = null;
                    try
                    {
                        activeEncodingPeriod = await GradeEncodingPeriodService.GetConfiguredAsync(
                            conn, cancellationToken: HttpContext.RequestAborted);
                        diagnosticSemester = activeEncodingPeriod.Semester;
                        diagnosticTerm = activeEncodingPeriod.Term;
                        currentVisibleRecordIds = await ChairpersonReviewScopeService
                            .GetCurrentVisibleRecordIdsAsync(conn, activeEncodingPeriod.Term,
                                activeEncodingPeriod.Semester, HttpContext.RequestAborted);
                        currentFinalizedRecordIds = await ChairpersonReviewScopeService
                            .GetCurrentFinalizedRecordIdsAsync(conn, activeEncodingPeriod.Semester,
                                HttpContext.RequestAborted);
                    }
                    catch (GradeEncodingPeriodException)
                    {
                        currentVisibleRecordIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                        currentFinalizedRecordIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    }

                    static bool IsCurrentWorkflowStatus(string? status)
                    {
                        var normalized = status?.Trim().ToLowerInvariant();
                        return normalized is "draft" or "returned" or "submitted" or "submittedtochairperson" or
                            "chairpersonapproved" or "departmentapproved" or "finalized";
                    }

                    allGrades = allGrades.Where(grade =>
                    {
                        if (!IsCurrentWorkflowStatus(grade.Status)) return true;
                        if (string.Equals(grade.Status, "Finalized", StringComparison.OrdinalIgnoreCase))
                            return activeEncodingPeriod != null &&
                                   currentFinalizedRecordIds.Contains(grade.Id ?? string.Empty) &&
                                   string.Equals(GradeAcademicTerm.Normalize(grade.Term, string.Empty), activeEncodingPeriod.Term, StringComparison.OrdinalIgnoreCase) &&
                                   string.Equals(GradeAcademicPeriod.Semester(grade.Semester), activeEncodingPeriod.Semester, StringComparison.OrdinalIgnoreCase);
                        return currentVisibleRecordIds.Contains(grade.Id ?? string.Empty);
                    }).ToList();

                    if (activeEncodingPeriod != null)
                    {
                        diagnosticSchoolYear = string.Join(",", allGrades
                            .Where(grade => currentVisibleRecordIds.Contains(grade.Id ?? string.Empty) ||
                                            currentFinalizedRecordIds.Contains(grade.Id ?? string.Empty))
                            .Select(grade => grade.SchoolYear)
                            .Where(value => !string.IsNullOrWhiteSpace(value))
                            .Distinct(StringComparer.OrdinalIgnoreCase)
                            .Take(3));
                        if (string.IsNullOrWhiteSpace(diagnosticSchoolYear)) diagnosticSchoolYear = "no-current-records";
                        foreach (var grade in allGrades.Where(grade =>
                                     currentVisibleRecordIds.Contains(grade.Id ?? string.Empty)))
                        {
                            grade.Grade = GradeEncodingPeriodService.ProjectIncomingGradePayload(
                                grade.Grade, grade.Grade, activeEncodingPeriod.Term);
                            grade.Term = activeEncodingPeriod.Term;
                        }
                    }
                }

                // Deduplicate records that might temporarily exist in both staging and the ledger.
                // Prefer the richer local staged copy when it contains student number/name metadata.
                allGrades = GradeRecordMergePolicy.PreferPending(
                    allGrades, pendingGradesById, GetAcademicRecordCompletenessScore);

                var enrichedGrades = new List<Dictionary<string, object>>();
                
                using var cmdProfiles = new NpgsqlCommand("SELECT u.email, sp.department, sp.section, sp.student_no, sp.full_name FROM Users u JOIN StudentProfiles sp ON u.id = sp.user_id", conn);
                var studentProfiles = new Dictionary<string, (string dept, string sec, string studentNo, string fullName)>(StringComparer.OrdinalIgnoreCase);
                using var profReader = await cmdProfiles.ExecuteReaderAsync();
                while (await profReader.ReadAsync())
                {
                    studentProfiles[profReader.GetString(0)] = (
                        profReader.IsDBNull(1) ? "Unknown" : profReader.GetString(1),
                        profReader.IsDBNull(2) ? "Unknown" : profReader.GetString(2),
                        profReader.IsDBNull(3) ? "" : profReader.GetString(3),
                        profReader.IsDBNull(4) ? "" : profReader.GetString(4)
                    );
                }
                await profReader.CloseAsync();

                var registrarAssignments = jwtRole == "registrar"
                    ? await RegistrarGradeLedgerMetadataService.LoadAssignmentsAsync(conn, HttpContext.RequestAborted)
                    : new Dictionary<string, RegistrarGradeLedgerMetadataService.AssignmentMetadata>(StringComparer.OrdinalIgnoreCase);
                var registrarStudents = jwtRole == "registrar"
                    ? await RegistrarGradeLedgerMetadataService.LoadStudentIdentitiesAsync(conn, HttpContext.RequestAborted)
                    : new Dictionary<string, RegistrarGradeLedgerMetadataService.StudentIdentity>(StringComparer.OrdinalIgnoreCase);

                if (isStudent)
                {
                    allGrades = allGrades.Where(grade =>
                        string.Equals(grade.StudentHash, invokerId, StringComparison.OrdinalIgnoreCase) &&
                        string.Equals(grade.Status, "Finalized", StringComparison.OrdinalIgnoreCase)).ToList();
                }
                else if (jwtRole == "faculty")
                {
                    allGrades = allGrades.Where(grade => string.Equals(grade.FacultyId, invokerId, StringComparison.OrdinalIgnoreCase)).ToList();
                }
                else if (jwtRole == "registrar")
                {
                    allGrades = allGrades
                        .Where(grade => RegistrarGradeLedgerMetadataService.IsBrowsableStatus(grade.Status))
                        .ToList();
                }
                else if (jwtRole == "department_admin")
                {
                    string? programCode = null;
                    string? programName = null;
                    using var scopeCommand = new NpgsqlCommand(@"
                        SELECT p.program_code, p.program_name
                        FROM users u JOIN adminprofiles ap ON ap.user_id = u.id
                        JOIN academic_programs p ON LOWER(p.program_name) = LOWER(ap.department) OR LOWER(p.program_code) = LOWER(ap.department)
                        WHERE LOWER(u.email) = LOWER(@email) LIMIT 1;", conn);
                    scopeCommand.Parameters.AddWithValue("email", invokerId);
                    using var scopeReader = await scopeCommand.ExecuteReaderAsync();
                    if (await scopeReader.ReadAsync())
                    {
                        programCode = scopeReader.GetString(0);
                        programName = scopeReader.GetString(1);
                        diagnosticDepartment = $"{programCode}/{programName}";
                    }
                    await scopeReader.CloseAsync();
                    allGrades = allGrades.Where(grade =>
                        string.Equals(grade.Program, programCode, StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(grade.Program, programName, StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(grade.Course, programCode, StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(grade.Course, programName, StringComparison.OrdinalIgnoreCase) ||
                        (!string.IsNullOrWhiteSpace(programCode) && (grade.Section ?? "").Contains(programCode, StringComparison.OrdinalIgnoreCase))).ToList();
                }

                if (jwtRole == "department_admin")
                {
                    var authorizedPendingRecordIds = allGrades
                        .Select(grade => grade.Id ?? string.Empty)
                        .Where(recordId => pendingGradesById.ContainsKey(recordId))
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToArray();
                    if (authorizedPendingRecordIds.Length > 0)
                    {
                        using var historyCommand = new NpgsqlCommand(@"
                            SELECT logid, recordid, oldgrade, newgrade, reasontext, timestamp
                            FROM gradecorrectionlogs
                            WHERE recordid = ANY(@recordIds)
                            ORDER BY logid DESC;", conn);
                        historyCommand.Parameters.AddWithValue("recordIds", authorizedPendingRecordIds);
                        using var historyReader = await historyCommand.ExecuteReaderAsync();
                        while (await historyReader.ReadAsync())
                        {
                            var recordId = historyReader.IsDBNull(1) ? string.Empty : historyReader.GetString(1);
                            if (string.IsNullOrWhiteSpace(recordId)) continue;
                            if (!comparisonHistoryByRecordId.TryGetValue(recordId, out var entries))
                            {
                                entries = new List<GradeComparisonHistoryEntry>();
                                comparisonHistoryByRecordId[recordId] = entries;
                            }
                            var timestamp = historyReader.IsDBNull(5)
                                ? DateTimeOffset.MinValue
                                : new DateTimeOffset(DateTime.SpecifyKind(historyReader.GetDateTime(5), DateTimeKind.Utc));
                            entries.Add(new GradeComparisonHistoryEntry(
                                historyReader.GetInt32(0),
                                recordId,
                                historyReader.IsDBNull(2) ? null : historyReader.GetString(2),
                                historyReader.IsDBNull(3) ? null : historyReader.GetString(3),
                                historyReader.IsDBNull(4) ? null : historyReader.GetString(4),
                                timestamp));
                        }
                    }
                }

                foreach(var g in allGrades) 
                {
                    comparisonHistoryByRecordId.TryGetValue(g.Id ?? string.Empty, out var comparisonHistory);
                    var comparison = jwtRole == "department_admin" && pendingGradesById.ContainsKey(g.Id ?? string.Empty)
                        ? GradeComparisonService.Compare(g, authoritativeLedgerGrades, comparisonHistory)
                        : jwtRole == "department_admin" && string.Equals(g.Status, "Finalized", StringComparison.OrdinalIgnoreCase)
                            ? GradeComparisonService.FromFinalized(g)
                            : new GradeComparisonResult(null, null, GradeComparisonService.ReferenceNotFound);
                    registrarAssignments.TryGetValue(g.AssignmentCycleId ?? string.Empty, out var assignmentMetadata);
                    RegistrarGradeLedgerMetadataService.StudentIdentity? officialStudent = null;
                    if (!string.IsNullOrWhiteSpace(g.StudentNo)) registrarStudents.TryGetValue(g.StudentNo, out officialStudent);
                    if (officialStudent == null && !string.IsNullOrWhiteSpace(g.StudentHash))
                        registrarStudents.TryGetValue(g.StudentHash, out officialStudent);

                    string dept = "Unknown";
                    string profileSection = "Unknown";
                    string sec = ResolveDisplaySection(g.Section, null);
                    string year = ResolveYearLevelFromSection(sec, null);
                    string studentNo = g.StudentNo ?? "";
                    string studentName = g.StudentName ?? "";
                    
                    if (g.StudentHash != null && studentProfiles.TryGetValue(g.StudentHash, out var prof))
                    {
                        dept = prof.dept;
                        profileSection = prof.sec;
                        sec = ResolveDisplaySection(g.Section, prof.sec);
                        if (string.IsNullOrWhiteSpace(studentNo)) studentNo = prof.studentNo;
                        if (string.IsNullOrWhiteSpace(studentName) || IsPlaceholderStudentName(studentName, studentNo))
                        {
                            studentName = ResolvePreferredStudentName(studentName, prof.fullName, studentNo);
                        }
                        year = ResolveYearLevelFromSection(sec, prof.sec);
                    }

                    if (officialStudent != null)
                    {
                        dept = officialStudent.Department;
                        profileSection = officialStudent.Section;
                        studentNo = officialStudent.StudentNumber;
                        studentName = officialStudent.FullName;
                    }

                    if (assignmentMetadata != null)
                    {
                        if (assignmentMetadata.YearLevel.HasValue && assignmentMetadata.SectionNumber.HasValue)
                        {
                            var sectionPrefix = !string.IsNullOrWhiteSpace(assignmentMetadata.ProgramCode)
                                ? assignmentMetadata.ProgramCode
                                : assignmentMetadata.ProgramName;
                            sec = $"{sectionPrefix} {assignmentMetadata.YearLevel}-{assignmentMetadata.SectionNumber}".Trim();
                            year = assignmentMetadata.YearLevel.Value.ToString(CultureInfo.InvariantCulture);
                        }
                        if (!string.IsNullOrWhiteSpace(assignmentMetadata.ProgramName)) dept = assignmentMetadata.ProgramName;
                    }

                    string safeStudentHash = g.StudentHash ?? "";
                    string safeFacultyId = g.FacultyId ?? "";

                    if (!isAuthorizedViewer && 
                        !string.Equals(g.FacultyId, invokerId, StringComparison.OrdinalIgnoreCase) && 
                        !string.Equals(g.StudentHash, invokerId, StringComparison.OrdinalIgnoreCase))
                    {
                        safeStudentHash = "[REDACTED]";
                        safeFacultyId = "[REDACTED]";
                    }

                    if (isStudent && !string.Equals(g.Status, "Finalized", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    enrichedGrades.Add(new Dictionary<string, object> {
                        { "id", g.Id ?? "" },
                        { "student_hash", safeStudentHash },
                        { "studentId", !string.IsNullOrWhiteSpace(studentNo) ? studentNo : safeStudentHash },
                        { "student_no", studentNo },
                        { "studentNo", studentNo },
                        { "student_name", studentName },
                        { "student_user_id", officialStudent?.UserId ?? 0 },
                        { "section", sec },
                        { "record_section", g.Section ?? "" },
                        { "student_section", profileSection },
                        { "course", FirstNonBlank(assignmentMetadata?.ProgramName, g.Course) },
                        { "subject_code", FirstNonBlank(assignmentMetadata?.SubjectCode, g.SubjectCode) },
                        { "subject_title", g.SubjectTitle ?? "" },
                        { "subject_name", g.SubjectTitle ?? "" },
                        { "program", FirstNonBlank(assignmentMetadata?.ProgramCode, g.Program, g.Course) },
                        { "program_id", assignmentMetadata?.ProgramId ?? 0 },
                        { "program_code", assignmentMetadata?.ProgramCode ?? "" },
                        { "program_name", assignmentMetadata?.ProgramName ?? "" },
                        { "programId", assignmentMetadata?.ProgramId ?? 0 },
                        { "programCode", assignmentMetadata?.ProgramCode ?? "" },
                        { "programName", assignmentMetadata?.ProgramName ?? "" },
                        { "term", g.Term ?? "" },
                        { "units", g.Units },
                        { "grade", g.Grade ?? "" },
                        { "current_grade", comparison.CurrentGrade ?? "" },
                        { "reference_grade", comparison.ReferenceGrade! },
                        { "referenceGrade", comparison.ReferenceGrade! },
                        { "integrity_status", comparison.IntegrityStatus },
                        { "integrityStatus", comparison.IntegrityStatus },
                        { "reference_record_id", comparison.ReferenceRecordId ?? "" },
                        { "reference_grade_version", comparison.ReferenceGradeVersion ?? 0 },
                        { "reference_transaction_id", comparison.ReferenceTransactionId ?? "" },
                        { "reference_source", comparison.ReferenceSource ?? "" },
                        { "semester", FirstNonBlank(assignmentMetadata?.Semester, g.Semester) },
                        { "school_year", FirstNonBlank(assignmentMetadata?.SchoolYear, g.SchoolYear) },
                        { "schoolYear", FirstNonBlank(assignmentMetadata?.SchoolYear, g.SchoolYear) },
                        { "faculty_id", safeFacultyId },
                        { "faculty_user_id", assignmentMetadata?.FacultyUserId ?? 0 },
                        { "faculty_email", FirstNonBlank(assignmentMetadata?.FacultyEmail, safeFacultyId) },
                        { "faculty_number", assignmentMetadata?.FacultyId ?? "" },
                        { "professor_name", FirstNonBlank(assignmentMetadata?.FacultyName, g.ProfessorName) },
                        { "submitted_by", g.SubmittedBy ?? "" },
                        { "timestamp", g.Timestamp ?? "" },
                        { "transaction_id", g.TransactionId ?? "" },
                        { "transaction_hash", g.TransactionHash ?? g.TransactionId ?? "" },
                        { "date", g.Date ?? "" },
                        { "ipfs_cid", g.IpfsCid ?? "" },
                        { "status", g.Status ?? "" },
                        { "note", g.Note ?? "" },
                        { "university", g.University ?? "" },
                        { "version", g.Version },
                        { "finalized_by", g.FinalizedBy ?? "" },
                        { "finalized_at", g.FinalizedAt ?? "" },
                        { "assignment_cycle_id", g.AssignmentCycleId ?? "" },
                        { "faculty_section_id", g.AssignmentCycleId ?? "" },
                        { "academic_section_id", assignmentMetadata?.AcademicSectionId ?? 0 },
                        { "department", dept },
                        { "year_level", year }
                    });
                }
                
                var sortedGrades = enrichedGrades
                    .OrderBy(g => g["department"].ToString())
                    .ThenBy(g => g["year_level"].ToString())
                    .ThenBy(g => g["section"].ToString())
                    .ToList();

                return Ok(new { status = "Success", count = sortedGrades.Count, data = sortedGrades });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Failed to fetch grades for role {Role}, Chairperson {Chairperson}, department {Department}, school year {SchoolYear}, semester {Semester}, term {Term}",
                    jwtRole, invokerId, diagnosticDepartment, diagnosticSchoolYear, diagnosticSemester, diagnosticTerm);
                return StatusCode(500, new { status = "Error", message = "Grade tracking is temporarily unavailable." });
            }
        }

        [HttpGet("{recordId}")]
        public async Task<IActionResult> GetGrade(string recordId, [FromQuery] string invokerId)
        {
            invokerId = AuthenticatedEmail();
            var jwtRole = AuthenticatedRole();
            bool isStudent = jwtRole == "student";

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                using var cmd = new NpgsqlCommand(@"
                    SELECT id, student_hash, student_no, student_name, section, course, subject_code, grade,
                           semester, school_year, faculty_id, date, ipfs_cid, status, note,
                           subject_title, professor_name, program, term, units, submitted_by,
                           recorded_at, transaction_id, transaction_hash
                    FROM pending_grade_records WHERE id = @id", conn);
                cmd.Parameters.AddWithValue("id", recordId);
                
                using (var reader = await cmd.ExecuteReaderAsync())
                {
                    if (await reader.ReadAsync())
                    {
                        var localGrade = new AcademicRecord {
                            Id = reader.IsDBNull(0) ? "" : reader.GetString(0),
                            StudentHash = reader.IsDBNull(1) ? "" : reader.GetString(1),
                            StudentNo = reader.IsDBNull(2) ? "" : reader.GetString(2),
                            StudentId = reader.IsDBNull(2) ? "" : reader.GetString(2),
                            StudentName = reader.IsDBNull(3) ? "" : reader.GetString(3),
                            Section = reader.IsDBNull(4) ? "" : reader.GetString(4),
                            Course = reader.IsDBNull(5) ? "" : reader.GetString(5),
                            SubjectCode = reader.IsDBNull(6) ? "" : reader.GetString(6),
                            Grade = reader.IsDBNull(7) ? "" : reader.GetString(7),
                            Semester = reader.IsDBNull(8) ? "" : reader.GetString(8),
                            SchoolYear = reader.IsDBNull(9) ? "" : reader.GetString(9),
                            FacultyId = reader.IsDBNull(10) ? "" : reader.GetString(10),
                            Date = reader.IsDBNull(11) ? "" : reader.GetString(11),
                            IpfsCid = reader.IsDBNull(12) ? "" : reader.GetString(12),
                            Status = reader.IsDBNull(13) ? "" : reader.GetString(13),
                            Note = reader.IsDBNull(14) ? "" : reader.GetString(14),
                            SubjectTitle = reader.IsDBNull(15) ? "" : reader.GetString(15),
                            ProfessorName = reader.IsDBNull(16) ? "" : reader.GetString(16),
                            Program = reader.IsDBNull(17) ? "" : reader.GetString(17),
                            Term = reader.IsDBNull(18) ? "" : reader.GetString(18),
                            Units = reader.IsDBNull(19) ? 0 : reader.GetDecimal(19),
                            SubmittedBy = reader.IsDBNull(20) ? "" : reader.GetString(20),
                            Timestamp = reader.IsDBNull(21) ? "" : reader.GetFieldValue<DateTimeOffset>(21).ToString("O"),
                            TransactionId = reader.IsDBNull(22) ? "" : reader.GetString(22),
                            TransactionHash = reader.IsDBNull(23) ? "" : reader.GetString(23),
                            University = "PLV",
                            Version = 1
                        };
                        
                        await reader.CloseAsync();
                        if (!await CanAccessGradeRecordAsync(conn, recordId, invokerId, jwtRole)) return Forbid();

                        if (jwtRole == "department_admin" &&
                            !string.Equals(localGrade.Status, "Finalized", StringComparison.OrdinalIgnoreCase))
                        {
                            ActiveGradeEncodingPeriod activeEncodingPeriod;
                            try
                            {
                                activeEncodingPeriod = await GradeEncodingPeriodService.GetOpenAsync(
                                    conn, cancellationToken: HttpContext.RequestAborted);
                            }
                            catch (GradeEncodingPeriodException)
                            {
                                return NotFound(new { status = "Error", message = "No current grade workflow is open." });
                            }

                            var visibleIds = await ChairpersonReviewScopeService.GetCurrentVisibleRecordIdsAsync(
                                conn, activeEncodingPeriod.Term, activeEncodingPeriod.Semester,
                                HttpContext.RequestAborted);
                            if (!visibleIds.Contains(recordId)) return NotFound();
                            localGrade.Grade = GradeEncodingPeriodService.ProjectIncomingGradePayload(
                                localGrade.Grade, localGrade.Grade, activeEncodingPeriod.Term);
                            localGrade.Term = activeEncodingPeriod.Term;
                        }

                        return Ok(new { status = "Success", data = localGrade });
                    }
                }

                var jsonResult = await _blockchainService.GetGradeAsync(recordId, invokerId);
                var ledgerGrade = JsonSerializer.Deserialize<AcademicRecord>(jsonResult, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (!await CanAccessGradeRecordAsync(conn, recordId, invokerId, jwtRole)) return Forbid();
                return Ok(new { status = "Success", data = ledgerGrade });
            }
            catch (Exception)
            {
                return NotFound(new { status = "Error", message = $"Grade not found: {recordId}" });
            }
        }

        [HttpGet("history/{recordId}")]
        [Authorize(Roles = "registrar,department_admin,faculty,student,system_admin")]
        public async Task<IActionResult> GetGradeHistory(string recordId, [FromQuery] string invokerId)
        {
            invokerId = AuthenticatedEmail();

            var jwtRole = User.Claims.FirstOrDefault(c => c.Type == "dbRole")?.Value ?? User.Claims.FirstOrDefault(c => c.Type == ClaimTypes.Role)?.Value;

            try
            {
                await using var connection = new NpgsqlConnection(_connectionString);
                await connection.OpenAsync(HttpContext.RequestAborted);
                if (!await CanAccessGradeRecordAsync(connection, recordId, invokerId, jwtRole ?? string.Empty))
                    return Forbid();

                var response = await _blockchainService.GetGradeHistoryAsync(recordId, invokerId);
                using var document = JsonDocument.Parse(response);
                var data = document.RootElement.TryGetProperty("data", out var history) ? history.Clone() : document.RootElement.Clone();

                if (string.Equals(jwtRole, "student", StringComparison.OrdinalIgnoreCase))
                {
                    var releasedVersions = new HashSet<int>();
                    await using var releaseCommand = new NpgsqlCommand(@"
                        SELECT release.grade_version
                        FROM grade_releases release
                        JOIN users student ON LOWER(student.email) = LOWER(@email)
                        JOIN studentprofiles profile ON profile.user_id = student.id
                        WHERE release.record_id = @recordId
                          AND LOWER(release.student_identifier) IN (LOWER(student.email), LOWER(profile.student_no));", connection);
                    releaseCommand.Parameters.AddWithValue("email", invokerId);
                    releaseCommand.Parameters.AddWithValue("recordId", recordId);
                    await using var reader = await releaseCommand.ExecuteReaderAsync(HttpContext.RequestAborted);
                    while (await reader.ReadAsync(HttpContext.RequestAborted)) releasedVersions.Add(reader.GetInt32(0));

                    var visible = data.TryGetProperty("versions", out var versions)
                        ? versions.EnumerateArray()
                            .Where(item => item.TryGetProperty("version", out var version) && releasedVersions.Contains(version.GetInt32()))
                            .Select(item => JsonSerializer.Deserialize<Dictionary<string, object?>>(item.GetRawText())!)
                            .ToList()
                        : new List<Dictionary<string, object?>>();
                    for (var index = 0; index < visible.Count; index++)
                        visible[index]["status"] = index == visible.Count - 1 ? "Current" : "Superseded";
                    var currentVisibleVersion = visible.Count == 0 || visible[^1]["version"] is not JsonElement versionElement
                        ? 0
                        : versionElement.GetInt32();
                    return Ok(new
                    {
                        status = "Success",
                        data = new { logicalGradeId = recordId, currentVersion = currentVisibleVersion, versions = visible }
                    });
                }
                return Ok(new { status = "Success", data });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        public sealed class ApproveGradesRequest
        {
            public List<string> RecordIds { get; set; } = new();
        }

        public sealed class FinalizeGradesRequest
        {
            public List<string> RecordIds { get; set; } = new();
        }

        public sealed class SendGradesToRegistrarRequest
        {
            public List<string> RecordIds { get; set; } = new();
        }

        [HttpPost("approve")]
        [Authorize(Roles = "department_admin")]
        public async Task<IActionResult> ApproveGrades([FromBody] ApproveGradesRequest request)
        {
            var invokerId = AuthenticatedEmail();
            try
            {
                return await ApproveGradeRecordsAsync(request?.RecordIds ?? new List<string>(), invokerId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Chairperson section approval failed for {Chairperson}", invokerId);
                return StatusCode(500, new { status = "Error", message = "The grades could not be approved. Refresh the review queue before retrying." });
            }
        }

        // Retained for compatibility with older clients. New Chairperson UI uses the
        // atomic section endpoint above so one confirmation produces one request.
        [HttpPost("approve/{recordId}")]
        [Authorize(Roles = "department_admin")]
        public async Task<IActionResult> ApproveGrade(string recordId, [FromQuery] string invokerId)
        {
            invokerId = AuthenticatedEmail();
            try
            {
                return await ApproveGradeRecordsAsync(new[] { recordId }, invokerId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Chairperson grade approval failed for {RecordId}", recordId);
                return StatusCode(500, new { status = "Error", message = "The grade could not be approved. Refresh the review queue before retrying." });
            }
        }

        private async Task<IActionResult> ApproveGradeRecordsAsync(
            IEnumerable<string> requestedRecordIds, string invokerId)
        {
            var recordIds = requestedRecordIds
                .Where(recordId => !string.IsNullOrWhiteSpace(recordId))
                .Select(recordId => recordId.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
            if (recordIds.Length == 0)
                return BadRequest(new { status = "Error", message = "At least one submitted grade record is required." });

            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync(HttpContext.RequestAborted);
            await EnsurePendingGradeSchemaAsync(connection);

            foreach (var recordId in recordIds)
                if (!await CanAccessGradeRecordAsync(connection, recordId, invokerId, "department_admin"))
                    return Forbid();

            var activePeriod = await GradeEncodingPeriodService.GetConfiguredAsync(
                connection, cancellationToken: HttpContext.RequestAborted);
            await using var transaction = await connection.BeginTransactionAsync(HttpContext.RequestAborted);

            var statuses = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            await using (var statusCommand = new NpgsqlCommand(@"
                SELECT id, status
                FROM pending_grade_records
                WHERE id = ANY(@recordIds)
                FOR UPDATE;", connection, transaction))
            {
                statusCommand.Parameters.AddWithValue("recordIds", recordIds);
                await using var reader = await statusCommand.ExecuteReaderAsync(HttpContext.RequestAborted);
                while (await reader.ReadAsync(HttpContext.RequestAborted))
                    statuses[reader.GetString(0)] = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
            }

            if (statuses.Count != recordIds.Length)
            {
                await transaction.RollbackAsync(HttpContext.RequestAborted);
                return NotFound(new { status = "Error", message = "One or more submitted grade records no longer exist. Refresh the review queue." });
            }

            var invalidStatus = statuses.FirstOrDefault(entry =>
                !string.Equals(entry.Value, "SubmittedToChairperson", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(entry.Value, "Submitted", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(entry.Value, "ChairpersonApproved", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(entry.Value, "DepartmentApproved", StringComparison.OrdinalIgnoreCase));
            if (!string.IsNullOrEmpty(invalidStatus.Key))
            {
                await transaction.RollbackAsync(HttpContext.RequestAborted);
                return Conflict(new { status = "Error", message = $"A grade in {invalidStatus.Value} status cannot be approved. It must first be submitted by Faculty." });
            }

            var submittedCount = statuses.Count(entry =>
                string.Equals(entry.Value, "SubmittedToChairperson", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(entry.Value, "Submitted", StringComparison.OrdinalIgnoreCase));
            var approvedCount = 0;
            if (submittedCount > 0)
            {
                await using var approveCommand = new NpgsqlCommand(@"
                    UPDATE pending_grade_records pgr
                    SET status = 'ChairpersonApproved', date = @date
                    FROM facultysections fs
                    WHERE pgr.id = ANY(@recordIds)
                      AND LOWER(pgr.status) IN ('submittedtochairperson', 'submitted')
                      AND fs.id::text = pgr.assignment_cycle_id
                      AND fs.is_active = TRUE
                      AND LOWER(TRIM(fs.school_year)) = LOWER(TRIM(pgr.school_year))
                      AND LOWER(TRIM(fs.semester)) = LOWER(TRIM(pgr.semester))
                      AND LOWER(TRIM(fs.subject)) = LOWER(TRIM(pgr.subject_code))
                      AND LOWER(TRIM(pgr.semester)) = LOWER(TRIM(@semester))
                      AND LOWER(TRIM(pgr.term)) = LOWER(TRIM(@term));", connection, transaction);
                approveCommand.Parameters.AddWithValue("recordIds", recordIds);
                approveCommand.Parameters.AddWithValue("date", DateTime.UtcNow.ToString("o"));
                approveCommand.Parameters.AddWithValue("semester", activePeriod.Semester);
                approveCommand.Parameters.AddWithValue("term", activePeriod.Term);
                approvedCount = await approveCommand.ExecuteNonQueryAsync(HttpContext.RequestAborted);
            }

            if (approvedCount != submittedCount)
            {
                await transaction.RollbackAsync(HttpContext.RequestAborted);
                return Conflict(new { status = "Error", message = "The section is no longer in the current review queue. No grades were approved; refresh and try again." });
            }

            await transaction.CommitAsync(HttpContext.RequestAborted);
            await NotifyAcademicDataChangedAsync("grade_approved", null, invokerId);
            return Ok(new
            {
                status = "Success",
                message = "Grades approved by the Chairperson and ready for finalization.",
                approvedCount,
                idempotent = submittedCount == 0
            });
        }

        [HttpPost("send-to-registrar")]
        [Authorize(Roles = "department_admin")]
        public async Task<IActionResult> SendGradesToRegistrar([FromBody] SendGradesToRegistrarRequest request)
        {
            var invokerId = AuthenticatedEmail();
            var recordIds = (request?.RecordIds ?? new List<string>())
                .Where(recordId => !string.IsNullOrWhiteSpace(recordId))
                .Select(recordId => recordId.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
            if (recordIds.Length == 0)
                return BadRequest(new { status = "Error", message = "At least one approved grade record is required." });

            try
            {
                await using var connection = new NpgsqlConnection(_connectionString);
                await connection.OpenAsync(HttpContext.RequestAborted);
                await EnsurePendingGradeSchemaAsync(connection);

                foreach (var recordId in recordIds)
                    if (!await CanAccessGradeRecordAsync(connection, recordId, invokerId, "department_admin"))
                        return Forbid();

                var activePeriod = await GradeEncodingPeriodService.GetConfiguredAsync(
                    connection, cancellationToken: HttpContext.RequestAborted);
                await using var transaction = await connection.BeginTransactionAsync(HttpContext.RequestAborted);
                var statuses = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                await using (var statusCommand = new NpgsqlCommand(@"
                    SELECT id, status
                    FROM pending_grade_records
                    WHERE id = ANY(@recordIds)
                    FOR UPDATE;", connection, transaction))
                {
                    statusCommand.Parameters.AddWithValue("recordIds", recordIds);
                    await using var reader = await statusCommand.ExecuteReaderAsync(HttpContext.RequestAborted);
                    while (await reader.ReadAsync(HttpContext.RequestAborted))
                        statuses[reader.GetString(0)] = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
                }

                if (statuses.Count != recordIds.Length)
                {
                    await transaction.RollbackAsync(HttpContext.RequestAborted);
                    return Conflict(new { status = "Error", message = "One or more approved grades no longer exist in staging. Refresh before sending." });
                }

                var invalidStatus = statuses.FirstOrDefault(entry =>
                    !string.Equals(entry.Value, "ChairpersonApproved", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(entry.Value, "DepartmentApproved", StringComparison.OrdinalIgnoreCase));
                if (!string.IsNullOrEmpty(invalidStatus.Key))
                {
                    await transaction.RollbackAsync(HttpContext.RequestAborted);
                    return Conflict(new { status = "Error", message = $"A grade in {invalidStatus.Value} status cannot be sent to the Registrar." });
                }

                var unsentCount = statuses.Count(entry =>
                    string.Equals(entry.Value, "ChairpersonApproved", StringComparison.OrdinalIgnoreCase));
                var sentCount = 0;
                if (unsentCount > 0)
                {
                    await using var sendCommand = new NpgsqlCommand(@"
                        UPDATE pending_grade_records pgr
                        SET status = 'DepartmentApproved', date = @date
                        FROM facultysections fs
                        WHERE pgr.id = ANY(@recordIds)
                          AND LOWER(TRIM(pgr.status)) = 'chairpersonapproved'
                          AND fs.id::text = pgr.assignment_cycle_id
                          AND LOWER(TRIM(fs.school_year)) = LOWER(TRIM(pgr.school_year))
                          AND LOWER(TRIM(fs.semester)) = LOWER(TRIM(pgr.semester))
                          AND LOWER(TRIM(fs.subject)) = LOWER(TRIM(pgr.subject_code))
                          AND LOWER(TRIM(pgr.semester)) = LOWER(TRIM(@semester))
                          AND LOWER(TRIM(pgr.term)) = LOWER(TRIM(@term));", connection, transaction);
                    sendCommand.Parameters.AddWithValue("recordIds", recordIds);
                    sendCommand.Parameters.AddWithValue("date", DateTime.UtcNow.ToString("o"));
                    sendCommand.Parameters.AddWithValue("semester", activePeriod.Semester);
                    sendCommand.Parameters.AddWithValue("term", activePeriod.Term);
                    sentCount = await sendCommand.ExecuteNonQueryAsync(HttpContext.RequestAborted);
                }

                if (sentCount != unsentCount)
                {
                    await transaction.RollbackAsync(HttpContext.RequestAborted);
                    return Conflict(new { status = "Error", message = "The approved section changed before handoff. Nothing was sent; refresh and try again." });
                }

                await transaction.CommitAsync(HttpContext.RequestAborted);
                try
                {
                    await NotifyAcademicDataChangedAsync("grades_sent_to_registrar", null, invokerId);
                }
                catch (Exception notificationException)
                {
                    _logger.LogWarning(notificationException, "Grades were sent to the Registrar, but the handoff notification failed");
                }
                return Ok(new
                {
                    status = "Success",
                    message = "Approved grades were sent to the Registrar Finalize queue.",
                    sentCount,
                    idempotent = unsentCount == 0
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Chairperson handoff to Registrar failed for {Chairperson}", invokerId);
                return StatusCode(500, new { status = "Error", message = "The approved grades could not be sent. Their current state was preserved; refresh before retrying." });
            }
        }

        [HttpPost("finalize")]
        [Authorize(Roles = "registrar")]
        public async Task<IActionResult> FinalizeGrades([FromBody] FinalizeGradesRequest request)
        {
            var invokerId = AuthenticatedEmail();
            var recordIds = (request?.RecordIds ?? new List<string>())
                .Where(recordId => !string.IsNullOrWhiteSpace(recordId))
                .Select(recordId => recordId.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
            if (recordIds.Length == 0)
                return BadRequest(new { status = "Error", message = "At least one approved grade record is required." });

            try
            {
                await using var connection = new NpgsqlConnection(_connectionString);
                await connection.OpenAsync(HttpContext.RequestAborted);
                await EnsurePendingGradeSchemaAsync(connection);

                var activePeriod = await GradeEncodingPeriodService.GetConfiguredAsync(
                    connection, cancellationToken: HttpContext.RequestAborted);
                var queue = await RegistrarFinalizationScopeService.GetCurrentApprovedAsync(
                    connection, activePeriod.Term, activePeriod.Semester, HttpContext.RequestAborted);
                var requested = new HashSet<string>(recordIds, StringComparer.OrdinalIgnoreCase);
                var approvedRecords = queue.Where(record => requested.Contains(record.Id)).ToArray();
                if (approvedRecords.Length != recordIds.Length)
                {
                    var finalizedLedgerRecords = await LoadFinalizedLedgerRecordsAsync(invokerId);
                    var finalizedRequested = finalizedLedgerRecords
                        .Where(record => requested.Contains(record.Id))
                        .ToArray();
                    if (finalizedRequested.Length == recordIds.Length)
                    {
                        return Ok(new
                        {
                            status = "Success",
                            message = "The approved section was already finalized on the ledger.",
                            finalizedCount = finalizedRequested.Length,
                            idempotent = true,
                            transactionIds = finalizedRequested
                                .Select(record => record.TransactionId)
                                .Where(transactionId => !string.IsNullOrWhiteSpace(transactionId))
                                .Distinct(StringComparer.OrdinalIgnoreCase)
                                .ToArray()
                        });
                    }
                    return Conflict(new { status = "Error", message = "One or more grades are no longer in the current Finalize queue. Refresh before retrying." });
                }

                foreach (var record in approvedRecords)
                    if (!await CanAccessGradeRecordAsync(connection, record.Id, invokerId, "registrar"))
                        return Forbid();

                var middlewareResponse = await _blockchainService.FinalizeApprovedGradesAsync(approvedRecords, invokerId);
                using var responseDocument = JsonDocument.Parse(middlewareResponse);
                var responseRoot = responseDocument.RootElement;
                var detailsJson = responseRoot.TryGetProperty("details", out var detailsElement)
                    ? detailsElement.GetString()
                    : responseRoot.GetRawText();
                if (string.IsNullOrWhiteSpace(detailsJson))
                    throw new InvalidOperationException("Fabric did not return the finalized grade batch for verification.");

                var finalizedRecords = JsonSerializer.Deserialize<List<AcademicRecord>>(
                    detailsJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                    ?? new List<AcademicRecord>();
                var finalizedById = finalizedRecords
                    .Where(record => !string.IsNullOrWhiteSpace(record.Id))
                    .ToDictionary(record => record.Id, StringComparer.OrdinalIgnoreCase);
                var unverified = approvedRecords.FirstOrDefault(staged =>
                    !finalizedById.TryGetValue(staged.Id, out var finalized) ||
                    !GradeLedgerMatch.IsSameGrade(staged, finalized) ||
                    !string.Equals(finalized.Status, "Finalized", StringComparison.OrdinalIgnoreCase));
                if (unverified != null)
                    throw new InvalidOperationException($"Fabric grade {unverified.Id} did not verify against its approved staging snapshot.");

                await using var cleanupTransaction = await connection.BeginTransactionAsync(HttpContext.RequestAborted);
                await using (var cleanup = new NpgsqlCommand(@"
                    DELETE FROM pending_grade_records
                    WHERE id = ANY(@recordIds)
                      AND LOWER(TRIM(status)) = 'departmentapproved';", connection, cleanupTransaction))
                {
                    cleanup.Parameters.AddWithValue("recordIds", recordIds);
                    var deleted = await cleanup.ExecuteNonQueryAsync(HttpContext.RequestAborted);
                    if (deleted != recordIds.Length)
                    {
                        await using var remainingCommand = new NpgsqlCommand(
                            "SELECT COUNT(*) FROM pending_grade_records WHERE id = ANY(@recordIds);",
                            connection, cleanupTransaction);
                        remainingCommand.Parameters.AddWithValue("recordIds", recordIds);
                        var remaining = Convert.ToInt32(await remainingCommand.ExecuteScalarAsync(HttpContext.RequestAborted));
                        if (remaining > 0)
                        {
                            await cleanupTransaction.RollbackAsync(HttpContext.RequestAborted);
                            throw new InvalidOperationException("Finalized grades were verified, but approved staging changed before cleanup; staging was retained for reconciliation.");
                        }
                    }
                }
                await cleanupTransaction.CommitAsync(HttpContext.RequestAborted);

                try
                {
                    await NotifyAcademicDataChangedAsync("grade_finalized", approvedRecords[0].Course, invokerId);
                }
                catch (Exception notificationException)
                {
                    _logger.LogWarning(notificationException, "Approved grade batch was finalized, but its notification could not be delivered");
                }

                return Ok(new
                {
                    status = "Success",
                    message = "Approved section finalized and verified on the ledger.",
                    finalizedCount = approvedRecords.Length,
                    transactionIds = finalizedRecords
                        .Select(record => record.TransactionId)
                        .Where(transactionId => !string.IsNullOrWhiteSpace(transactionId))
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToArray()
                });
            }
            catch (LedgerMiddlewareException ex)
            {
                _logger.LogError(ex, "Fabric batch finalization failed; approved staging remains retryable");
                return StatusCode((int)ex.StatusCode, new { status = "Error", code = ex.Code, message = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Registrar batch finalization failed; approved staging was retained unless ledger verification completed");
                return StatusCode(500, new { status = "Error", message = "The section could not be finalized. Its approved data was preserved; refresh before retrying." });
            }
        }

        [HttpPost("finalize/{recordId}")]
        [Authorize(Roles = "registrar")]
        public async Task<IActionResult> FinalizeGrade(string recordId, [FromQuery] string invokerId)
        {
            invokerId = AuthenticatedEmail();

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                if (!await CanAccessGradeRecordAsync(conn, recordId, invokerId, "registrar"))
                    return Forbid();

                using var cmd = new NpgsqlCommand(@"
                    SELECT id, student_hash, student_no, student_name, section, course, subject_code, grade,
                           semester, school_year, faculty_id, date, ipfs_cid, note,
                           subject_title, professor_name, program, term, units, submitted_by, recorded_at,
                           status, assignment_cycle_id
                    FROM pending_grade_records WHERE id = @id", conn);
                cmd.Parameters.AddWithValue("id", recordId);
                
                AcademicRecord? pendingRecord = null;
                using (var reader = await cmd.ExecuteReaderAsync())
                {
                    if (await reader.ReadAsync())
                    {
                        pendingRecord = new AcademicRecord {
                            Id = reader.IsDBNull(0) ? "" : reader.GetString(0),
                            StudentHash = reader.IsDBNull(1) ? "" : reader.GetString(1),
                            StudentNo = reader.IsDBNull(2) ? "" : reader.GetString(2),
                            StudentId = reader.IsDBNull(2) ? "" : reader.GetString(2),
                            StudentName = reader.IsDBNull(3) ? "" : reader.GetString(3),
                            Section = reader.IsDBNull(4) ? "" : reader.GetString(4),
                            Course = reader.IsDBNull(5) ? "" : reader.GetString(5),
                            SubjectCode = reader.IsDBNull(6) ? "" : reader.GetString(6),
                            Grade = reader.IsDBNull(7) ? "" : reader.GetString(7),
                            Semester = reader.IsDBNull(8) ? "" : reader.GetString(8),
                            SchoolYear = reader.IsDBNull(9) ? "" : reader.GetString(9),
                            FacultyId = reader.IsDBNull(10) ? "" : reader.GetString(10),
                            Date = reader.IsDBNull(11) ? "" : reader.GetString(11),
                            IpfsCid = reader.IsDBNull(12) ? "" : reader.GetString(12),
                            Note = reader.IsDBNull(13) ? "" : reader.GetString(13),
                            SubjectTitle = reader.IsDBNull(14) ? "" : reader.GetString(14),
                            ProfessorName = reader.IsDBNull(15) ? "" : reader.GetString(15),
                            Program = reader.IsDBNull(16) ? "" : reader.GetString(16),
                            Term = reader.IsDBNull(17) ? "" : reader.GetString(17),
                            Units = reader.IsDBNull(18) ? 0 : reader.GetDecimal(18),
                            SubmittedBy = reader.IsDBNull(19) ? "" : reader.GetString(19),
                            Timestamp = reader.IsDBNull(20) ? "" : reader.GetFieldValue<DateTimeOffset>(20).ToString("O"),
                            Status = reader.IsDBNull(21) ? "" : reader.GetString(21),
                            AssignmentCycleId = reader.IsDBNull(22) ? "" : reader.GetString(22),
                            University = "PLV",
                            Version = 1
                        };
                    }
                }

                if (pendingRecord != null)
                {
                    if (!string.Equals(pendingRecord.Status, "DepartmentApproved", StringComparison.OrdinalIgnoreCase))
                        return Conflict(new { status = "Error", message = $"A grade in {pendingRecord.Status} status cannot be finalized. Chairperson approval is required first." });
                    AcademicRecord? stagedLedgerRecord = null;
                    try {
                        var existing = await _blockchainService.GetGradeAsync(recordId, invokerId);
                        stagedLedgerRecord = JsonSerializer.Deserialize<AcademicRecord>(existing, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    } catch (LedgerGradeNotFoundException) {
                        _logger.LogInformation("Grade {RecordId} has not yet been issued to Fabric; issuing from approved staging", recordId);
                    }

                    if (stagedLedgerRecord != null && !GradeLedgerMatch.IsSameGrade(pendingRecord, stagedLedgerRecord))
                        return Conflict(new { status = "Error", message = "The Fabric record with this UUID does not match the approved staged grade. Finalization was stopped." });

                    if (string.Equals(stagedLedgerRecord?.Status, "Finalized", StringComparison.OrdinalIgnoreCase))
                    {
                        using var cleanupCommand = new NpgsqlCommand("DELETE FROM pending_grade_records WHERE id = @id", conn);
                        cleanupCommand.Parameters.AddWithValue("id", recordId);
                        await cleanupCommand.ExecuteNonQueryAsync();
                        return Ok(new { status = "Success", message = "Grade was already finalized on the Ledger; stale staging was cleaned up.", idempotent = true });
                    }

                    if (stagedLedgerRecord == null)
                    {
                        try
                        {
                            // The authenticated Chairperson is already authorized by Fabric for
                            // this department. Issuing approved staging as that real actor avoids
                            // impersonating the original Faculty or depending on mutable Faculty
                            // certificate section scope after the assignment cycle was captured.
                            await _blockchainService.SubmitGradeAsync(pendingRecord, invokerId);
                        }
                        catch (LedgerMiddlewareException issueError) when (issueError.Code == "LEDGER_RECORD_EXISTS")
                        {
                            _logger.LogWarning("Grade {RecordId} was issued concurrently; reading its committed ledger state before continuing", recordId);
                        }
                        var issuedJson = await _blockchainService.GetGradeAsync(recordId, invokerId);
                        stagedLedgerRecord = JsonSerializer.Deserialize<AcademicRecord>(issuedJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                        if (stagedLedgerRecord == null || !GradeLedgerMatch.IsSameGrade(pendingRecord, stagedLedgerRecord))
                            return Conflict(new { status = "Error", message = "The issued Fabric record could not be verified against the approved staged grade." });
                    }

                    if (string.Equals(stagedLedgerRecord.Status, "Issued", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(stagedLedgerRecord.Status, "Corrected", StringComparison.OrdinalIgnoreCase))
                        await _blockchainService.ApproveGradeAsync(recordId, invokerId);
                    else if (!string.Equals(stagedLedgerRecord.Status, "DepartmentApproved", StringComparison.OrdinalIgnoreCase))
                        return Conflict(new { status = "Error", message = $"A Fabric grade in {stagedLedgerRecord.Status} status cannot be finalized from approved staging." });

                    await _blockchainService.FinalizeGradeAsync(recordId, invokerId);
                    var finalizedJson = await _blockchainService.GetGradeAsync(recordId, invokerId);
                    var finalizedRecord = JsonSerializer.Deserialize<AcademicRecord>(finalizedJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    if (finalizedRecord == null || !GradeLedgerMatch.IsSameGrade(pendingRecord, finalizedRecord) ||
                        !string.Equals(finalizedRecord.Status, "Finalized", StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException($"Fabric grade {recordId} did not verify as a committed Finalized record; approved staging was retained for retry.");
                    
                    using var cmdDel = new NpgsqlCommand("DELETE FROM pending_grade_records WHERE id = @id", conn);
                    cmdDel.Parameters.AddWithValue("id", recordId);
                    await cmdDel.ExecuteNonQueryAsync();

                    try
                    {
                        await NotifyAcademicDataChangedAsync("grade_finalized", pendingRecord.Course, invokerId);
                    }
                    catch (Exception notificationException)
                    {
                        _logger.LogWarning(notificationException, "Fabric grade {RecordId} was Finalized, but a notification could not be delivered", recordId);
                    }
                    return Ok(new { status = "Success", message = "Grade finalized and successfully written to Ledger." });
                }

                try
                {
                    var existingLedgerJson = await _blockchainService.GetGradeAsync(recordId, invokerId);
                    var existingLedgerRecord = JsonSerializer.Deserialize<AcademicRecord>(existingLedgerJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    if (string.Equals(existingLedgerRecord?.Status, "Finalized", StringComparison.OrdinalIgnoreCase))
                        return Ok(new { status = "Success", message = "Grade was already finalized on the Ledger.", idempotent = true });
                    return Conflict(new { status = "Error", message = "The staged grade is missing and the Fabric record is not Finalized. The Chairperson must reconcile this record before retrying." });
                }
                catch (LedgerGradeNotFoundException)
                {
                    return NotFound(new { status = "Error", message = "Neither an approved staged grade nor a Fabric record exists for this UUID." });
                }
            }
            catch (LedgerMiddlewareException ex)
            {
                _logger.LogError(ex, "Fabric finalization failed for {RecordId}; approved staging remains retryable", recordId);
                return StatusCode((int)ex.StatusCode, new { status = "Error", code = ex.Code, message = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Registrar finalization failed for {RecordId}; approved staging was not removed before ledger verification", recordId);
                return StatusCode(500, new { status = "Error", message = "The grade could not be finalized. Its approved state was preserved; refresh before retrying." });
            }
        }

        [HttpGet("finalization-queue")]
        [Authorize(Roles = "registrar")]
        public async Task<IActionResult> GetFinalizationQueue()
        {
            try
            {
                await using var connection = new NpgsqlConnection(_connectionString);
                await connection.OpenAsync(HttpContext.RequestAborted);
                await EnsurePendingGradeSchemaAsync(connection);
                var activePeriod = await GradeEncodingPeriodService.GetConfiguredAsync(
                    connection, cancellationToken: HttpContext.RequestAborted);
                var records = await RegistrarFinalizationScopeService.GetCurrentApprovedAsync(
                    connection, activePeriod.Term, activePeriod.Semester, HttpContext.RequestAborted);
                var authorizedRecords = new List<AcademicRecord>();
                foreach (var record in records)
                    if (await CanAccessGradeRecordAsync(connection, record.Id, AuthenticatedEmail(), "registrar"))
                        authorizedRecords.Add(record);
                return Ok(new { status = "Success", data = authorizedRecords });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to load the current Registrar finalization queue");
                return StatusCode(500, new { status = "Error", message = "The Finalize queue is temporarily unavailable." });
            }
        }

        public class SubmitFinalsRequest
        {
            public string FinalGrade { get; set; } = string.Empty;
            public string InvokerId { get; set; } = string.Empty;
        }

        [HttpPost("submit-finals/{recordId}")]
        [Authorize(Roles = "faculty")]
        public async Task<IActionResult> SubmitFinals(string recordId, [FromBody] SubmitFinalsRequest request)
        {
            if (string.IsNullOrEmpty(recordId) || string.IsNullOrEmpty(request.FinalGrade))
            {
                return BadRequest(new { status = "Error", message = "Record ID and final grade are required." });
            }

            var invokerId = AuthenticatedEmail();

            try
            {
                using (var accessConnection = new NpgsqlConnection(_connectionString))
                {
                    await accessConnection.OpenAsync();
                    if (!await CanAccessGradeRecordAsync(accessConnection, recordId, invokerId, "faculty"))
                        return Forbid();
                }

                // 1. Fetch the existing record from the ledger or staging area
                string existingGradeJson = await _blockchainService.GetGradeAsync(recordId, invokerId);
                var gradeRecord = JsonSerializer.Deserialize<AcademicRecord>(existingGradeJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

                if (gradeRecord == null)
                {
                    return NotFound(new { status = "Error", message = "Original grade record not found on blockchain." });
                }
                var previousGradePayload = gradeRecord.Grade;

                // 2. Parse the existing Grade JSON payload to get the midterm grade
                string midtermGradeStr = "";
                if (!string.IsNullOrEmpty(gradeRecord.Grade) && gradeRecord.Grade.Trim().StartsWith("{"))
                {
                    using var gradePayloadDoc = JsonDocument.Parse(gradeRecord.Grade);
                    if (gradePayloadDoc.RootElement.TryGetProperty("midterm", out var midtermProp))
                    {
                        midtermGradeStr = midtermProp.GetString() ?? "";
                    }
                }
                else
                {
                    // Fallback: If it's not a JSON object, assume the existing grade is the midterm
                    midtermGradeStr = gradeRecord.Grade;
                }

                // 3. Build the new, merged payload using the existing helper
                string newGradePayload = BuildUploadedGradePayload(
                    rawGrade: request.FinalGrade, // The new grade being submitted for the active term
                    rawMidterm: midtermGradeStr,   // The existing midterm grade
                    rawFinals: request.FinalGrade, // The new final grade
                    term: "finals"                 // Specify the context is for finals
                );

                // 4. Update the record and submit it to the blockchain
                gradeRecord.Grade = newGradePayload;
                gradeRecord.Date = DateTime.UtcNow.ToString("yyyy-MM-dd");
                gradeRecord.Status = "Corrected"; // Or a more specific status like "FinalsSubmitted"

                await _blockchainService.UpdateGradeAsync(gradeRecord, invokerId);

                // 5. Log the update for audit purposes
                using (var conn = new NpgsqlConnection(_connectionString))
                {
                    await conn.OpenAsync();
                    using var cmdLog = new NpgsqlCommand(@"
                        INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp) 
                        VALUES (@rid, @old, @new, @reason, @appr, CURRENT_TIMESTAMP)", conn);
                    cmdLog.Parameters.AddWithValue("rid", recordId);
                    cmdLog.Parameters.AddWithValue("old", GetGradeLogValue(previousGradePayload, "finals"));
                    cmdLog.Parameters.AddWithValue("new", GetGradeLogValue(newGradePayload, "finals"));
                    cmdLog.Parameters.AddWithValue("reason", "Finals Grade Entry");
                    cmdLog.Parameters.AddWithValue("appr", invokerId);
                    await cmdLog.ExecuteNonQueryAsync();
                }

                await NotifyAcademicDataChangedAsync("finals_grade_submitted", gradeRecord.Course, invokerId);

                return Ok(new { status = "Success", message = "Finals grade has been successfully recorded and is pending review." });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error submitting final grade for record {RecordId}", recordId);
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        private async Task<bool> UpdatePendingGradeJsonAsync(
            string recordId,
            Action<System.Text.Json.Nodes.JsonObject> updateAction,
            IReadOnlyCollection<string>? allowedStatuses = null)
        {
            try {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                using var cmdSel = new NpgsqlCommand("SELECT grade, status FROM pending_grade_records WHERE id = @id", conn);
                cmdSel.Parameters.AddWithValue("id", recordId);
                string? existingGrade = null;
                string? existingStatus = null;
                using (var reader = await cmdSel.ExecuteReaderAsync())
                {
                    if (await reader.ReadAsync())
                    {
                        existingGrade = reader.IsDBNull(0) ? string.Empty : reader.GetString(0);
                        existingStatus = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
                    }
                }

                if (existingGrade == null || (allowedStatuses != null && !allowedStatuses.Contains(existingStatus ?? string.Empty, StringComparer.OrdinalIgnoreCase))) return false;
                
                System.Text.Json.Nodes.JsonObject gradeObj;
                if (existingGrade.TrimStart().StartsWith("{")) {
                    try { gradeObj = System.Text.Json.Nodes.JsonNode.Parse(existingGrade)?.AsObject() ?? new System.Text.Json.Nodes.JsonObject(); }
                    catch { gradeObj = new System.Text.Json.Nodes.JsonObject(); gradeObj["finalAverage"] = existingGrade; }
                } else {
                    gradeObj = new System.Text.Json.Nodes.JsonObject(); gradeObj["finalAverage"] = existingGrade;
                }
                
                updateAction(gradeObj);
                
                using var cmdUpd = new NpgsqlCommand("UPDATE pending_grade_records SET grade = @gr, date = @dt WHERE id = @id", conn);
                cmdUpd.Parameters.AddWithValue("gr", gradeObj.ToJsonString());
                cmdUpd.Parameters.AddWithValue("dt", DateTime.UtcNow.ToString("yyyy-MM-dd"));
                cmdUpd.Parameters.AddWithValue("id", recordId);
                await cmdUpd.ExecuteNonQueryAsync();
                
                return true;
            } catch { return false; }
        }

        [HttpPost("flag/{recordId}")]
        [Authorize(Roles = "faculty")]
        public async Task<IActionResult> FlagGrade(string recordId, [FromQuery] string invokerId, [FromBody] FlagRequest request)
        {
            invokerId = AuthenticatedEmail();

            try
            {
                using (var accessConnection = new NpgsqlConnection(_connectionString))
                {
                    await accessConnection.OpenAsync();
                    if (!await CanAccessGradeRecordAsync(accessConnection, recordId, invokerId, "faculty"))
                        return Forbid();
                }

                if (await UpdatePendingGradeJsonAsync(recordId, obj => obj["flagged"] = request.IsFlagged))
                {
                    await NotifyAcademicDataChangedAsync(request.IsFlagged ? "grade_flagged" : "grade_unflagged", null, invokerId);
                    return Ok(new { status = "Success", message = request.IsFlagged ? "Record flagged for Chairperson review (Staged)." : "Flag removed (Staged)." });
                }

                var jsonResult = await _blockchainService.GetGradeAsync(recordId, invokerId);
                var gradeToUpdate = JsonSerializer.Deserialize<AcademicRecord>(jsonResult, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (gradeToUpdate == null) 
                    return NotFound(new { status = "Error", message = "Record not found on blockchain." });

                System.Text.Json.Nodes.JsonObject gradeObj;
                if (!string.IsNullOrEmpty(gradeToUpdate.Grade) && gradeToUpdate.Grade.TrimStart().StartsWith("{"))
                {
                    try {
                        gradeObj = System.Text.Json.Nodes.JsonNode.Parse(gradeToUpdate.Grade)?.AsObject() ?? new System.Text.Json.Nodes.JsonObject();
                    } catch {
                        gradeObj = new System.Text.Json.Nodes.JsonObject();
                        gradeObj["finalAverage"] = gradeToUpdate.Grade;
                    }
                }
                else
                {
                    gradeObj = new System.Text.Json.Nodes.JsonObject();
                    gradeObj["finalAverage"] = gradeToUpdate.Grade ?? "";
                }

                gradeObj["flagged"] = request.IsFlagged;
                gradeToUpdate.Grade = gradeObj.ToJsonString();
                gradeToUpdate.Date = DateTime.UtcNow.ToString("yyyy-MM-dd");
                
                await _blockchainService.UpdateGradeAsync(gradeToUpdate, invokerId);

                if (request.IsFlagged) {
                    try {
                        using var conn = new NpgsqlConnection(_connectionString);
                        await conn.OpenAsync();
                        using var cmdChair = new NpgsqlCommand("SELECT u.email FROM Users u JOIN AdminProfiles ap ON u.id = ap.user_id WHERE ap.department = @dept AND u.role IN ('department_admin', 'deptAdmin') AND u.status = 'APPROVED' LIMIT 1", conn);
                        cmdChair.Parameters.AddWithValue("dept", gradeToUpdate.Course ?? "");
                        var chairEmail = (await cmdChair.ExecuteScalarAsync()) as string;

                        if (!string.IsNullOrEmpty(chairEmail)) {
                            var subj = "PLV Grades Ledger: Grade Flagged for Review";
                            var msg = $"<div style='font-family: Arial, sans-serif; padding: 20px;'><h2 style='color: #003366;'>Pamantasan ng Lungsod ng Valenzuela</h2><p>Hello,</p><p>A grade for subject <strong>{gradeToUpdate.SubjectCode}</strong> has been flagged for review. Please check the Chairperson portal for more details.</p></div>";
                            await _emailService.SendEmailAsync(chairEmail, subj, msg, true);
                        }
                    } catch (Exception ex) { _logger.LogWarning(ex, "Failed to notify chairperson about flagged grade."); }
                }

                await NotifyAcademicDataChangedAsync(request.IsFlagged ? "grade_flagged" : "grade_unflagged", gradeToUpdate.Course, invokerId);
                return Ok(new { status = "Success", message = request.IsFlagged ? "Record flagged for Chairperson review." : "Flag removed." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPost("return/{recordId}")]
        [Authorize(Roles = "department_admin")]
        public async Task<IActionResult> ReturnGrade(string recordId, [FromBody] ReturnRequest request)
        {
            var note = request.Note?.Trim();
            if (string.IsNullOrWhiteSpace(note) || note.Length < 3)
                return BadRequest(new { status = "Error", message = "Correction remarks must contain at least 3 characters." });

            try
            {
                var invokerId = AuthenticatedEmail();
                
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                if (!await CanAccessGradeRecordAsync(conn, recordId, invokerId, AuthenticatedRole()))
                    return Forbid();
                var isRegistrar = AuthenticatedRole() == "registrar";
                await using var transaction = await conn.BeginTransactionAsync();
                using var cmd = new NpgsqlCommand(@"
                    WITH candidate AS (
                        SELECT id, status
                        FROM pending_grade_records
                        WHERE id = @id
                        FOR UPDATE
                    )
                    UPDATE pending_grade_records AS grade
                    SET status = 'Returned', note = @note, date = @dt
                    FROM candidate
                    WHERE grade.id = candidate.id
                      AND (
                          (@isRegistrar AND LOWER(candidate.status) IN ('departmentapproved', 'approved'))
                          OR (NOT @isRegistrar AND LOWER(candidate.status) IN ('submittedtochairperson', 'submitted', 'chairpersonapproved'))
                      )
                    RETURNING grade.id, candidate.status, grade.faculty_id, grade.course;", conn, transaction);
                cmd.Parameters.AddWithValue("note", note);
                cmd.Parameters.AddWithValue("dt", DateTime.UtcNow.ToString("o"));
                cmd.Parameters.AddWithValue("id", recordId);
                cmd.Parameters.AddWithValue("isRegistrar", isRegistrar);
                string? returnedId = null;
                string? previousStatus = null;
                string? facultyId = null;
                string? course = null;
                await using (var reader = await cmd.ExecuteReaderAsync())
                {
                    if (await reader.ReadAsync())
                    {
                        returnedId = reader.GetString(0);
                        previousStatus = reader.IsDBNull(1) ? null : reader.GetString(1);
                        facultyId = reader.IsDBNull(2) ? null : reader.GetString(2);
                        course = reader.IsDBNull(3) ? null : reader.GetString(3);
                    }
                }

                if (returnedId != null)
                {
                    using var cmdLog = new NpgsqlCommand(@"
                        INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp) 
                        VALUES (@rid, @old, @new, @reason, @appr, CURRENT_TIMESTAMP)", conn, transaction);
                    cmdLog.Parameters.AddWithValue("rid", recordId);
                    cmdLog.Parameters.AddWithValue("old", previousStatus ?? "SubmittedToChairperson");
                    cmdLog.Parameters.AddWithValue("new", "Returned");
                    cmdLog.Parameters.AddWithValue("reason", note);
                    cmdLog.Parameters.AddWithValue("appr", invokerId);
                    await cmdLog.ExecuteNonQueryAsync();
                    await transaction.CommitAsync();

                    if (!string.IsNullOrWhiteSpace(facultyId))
                        await _chatHubContext.Clients.Group($"private_{facultyId}").SendAsync("GradeReturned", new
                        {
                            Type = "grade_returned", RecordId = recordId, Note = note, Actor = invokerId, OccurredAt = DateTimeOffset.UtcNow
                        });
                    await NotifyAcademicDataChangedAsync("grade_returned", course, invokerId);
                    return Ok(new { status = "Success", message = "Grade returned to faculty with correction remarks.", data = new { recordId, note, facultyId } });
                }

                using var statusCommand = new NpgsqlCommand("SELECT status FROM pending_grade_records WHERE id = @id", conn, transaction);
                statusCommand.Parameters.AddWithValue("id", recordId);
                var currentStatus = (await statusCommand.ExecuteScalarAsync())?.ToString();
                await transaction.RollbackAsync();
                if (currentStatus is null)
                    return NotFound(new { status = "Error", message = "The staged grade record was not found. Finalized ledger records are immutable." });
                return Conflict(new { status = "Error", message = $"A grade in {currentStatus} status cannot be returned. Only submitted or Department-approved staged grades can be returned." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        public class ReturnRequest
        {
            public string? Note { get; set; }
            public string? InvokerId { get; set; }
        }

        [HttpPost("status/{recordId}")]
        [Authorize(Roles = "faculty")]
        public async Task<IActionResult> UpdateAcademicStatus(string recordId, [FromQuery] string invokerId, [FromBody] AcademicStatusRequest request)
        {
            invokerId = AuthenticatedEmail();
            var academicStatus = NormalizeAcademicStatus(request.Status);
            if (academicStatus is null)
                return BadRequest(new { status = "Error", message = "Academic status must be Dropped, Incomplete, or Withdrawn." });

            try
            {
                using (var accessConnection = new NpgsqlConnection(_connectionString))
                {
                    await accessConnection.OpenAsync();
                    if (!await CanAccessGradeRecordAsync(accessConnection, recordId, invokerId, "faculty"))
                        return Forbid();
                }

                var updated = await UpdatePendingGradeJsonAsync(recordId, obj =>
                {
                    obj["academicStatus"] = academicStatus;
                    obj["remarks"] = academicStatus;
                }, new[] { "Draft", "Returned" });
                if (!updated)
                    return Conflict(new { status = "Error", message = "Academic standing can be changed only while a grade is Draft or Returned. Finalized ledger records are immutable." });

                await NotifyAcademicDataChangedAsync("academic_status_updated", null, invokerId);
                return Ok(new { status = "Success", message = $"Academic status updated to {academicStatus}.", data = new { recordId, academicStatus } });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        private static string? NormalizeAcademicStatus(string? value) => (value ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "d" or "dropped" => "Dropped",
            "inc" or "incomplete" => "Incomplete",
            "w" or "withdrawn" => "Withdrawn",
            _ => null
        };

        [HttpGet("audit-all")]
        [Authorize(Roles = "registrar,system_admin")]
        public async Task<IActionResult> GetSystemAuditLogs()
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var logs = new List<object>();
                using var cmd = new NpgsqlCommand(@"
                    SELECT logid, recordid, oldgrade, newgrade, reasontext, approvedby, timestamp 
                    FROM gradecorrectionlogs 
                    ORDER BY timestamp DESC", conn);
                
                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    logs.Add(new {
                        id = reader.GetInt32(0),
                        recordId = reader.GetString(1),
                        oldGrade = reader.IsDBNull(2) ? null : reader.GetString(2),
                        newGrade = reader.IsDBNull(3) ? null : reader.GetString(3),
                        reason = reader.IsDBNull(4) ? null : reader.GetString(4),
                        approvedBy = reader.IsDBNull(5) ? null : reader.GetString(5),
                        timestamp = reader.GetDateTime(6)
                    });
                }
                await reader.CloseAsync();

                using var administrativeCommand = new NpgsqlCommand(@"
                    SELECT a.audit_id, a.entity_id, a.old_values, a.new_values,
                           a.action, COALESCE(u.email, 'system'), a.timestamp,
                           a.description
                    FROM audit_logs a
                    LEFT JOIN users u ON u.id = a.user_id
                    ORDER BY a.timestamp DESC", conn);
                using var administrativeReader = await administrativeCommand.ExecuteReaderAsync();
                while (await administrativeReader.ReadAsync())
                {
                    var action = administrativeReader.GetString(4);
                    var description = administrativeReader.IsDBNull(7) ? null : administrativeReader.GetString(7);
                    logs.Add(new
                    {
                        id = $"audit-{administrativeReader.GetInt32(0)}",
                        recordId = administrativeReader.IsDBNull(1) ? "" : administrativeReader.GetString(1),
                        oldGrade = administrativeReader.IsDBNull(2) ? null : administrativeReader.GetString(2),
                        newGrade = administrativeReader.IsDBNull(3) ? null : administrativeReader.GetString(3),
                        reason = string.IsNullOrWhiteSpace(description) ? action : $"{action}: {description}",
                        approvedBy = administrativeReader.GetString(5),
                        timestamp = administrativeReader.GetDateTime(6)
                    });
                }

                logs = logs.OrderByDescending(log =>
                {
                    var timestampProperty = log.GetType().GetProperty("timestamp");
                    return timestampProperty?.GetValue(log) is DateTime value ? value : DateTime.MinValue;
                }).ToList();

                return Ok(new { status = "Success", data = logs });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpGet("audit-logs/{recordId}")]
        [Authorize(Roles = "faculty,department_admin,registrar")]
        public async Task<IActionResult> GetAuditLogs(string recordId)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                if (!await CanAccessGradeRecordAsync(conn, recordId, AuthenticatedEmail(), AuthenticatedRole()))
                    return Forbid();

                var logs = new List<object>();
                using var cmd = new NpgsqlCommand(@"
                    SELECT logid, recordid, oldgrade, newgrade, reasontext, approvedby, timestamp 
                    FROM gradecorrectionlogs 
                    WHERE recordid = @rid 
                    ORDER BY timestamp DESC", conn);
                
                cmd.Parameters.AddWithValue("rid", recordId);

                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    logs.Add(new {
                        id = reader.GetInt32(0),
                        recordId = reader.GetString(1),
                        oldGrade = reader.IsDBNull(2) ? null : reader.GetString(2),
                        newGrade = reader.IsDBNull(3) ? null : reader.GetString(3),
                        reason = reader.IsDBNull(4) ? null : reader.GetString(4),
                        approvedBy = reader.IsDBNull(5) ? null : reader.GetString(5),
                        timestamp = reader.GetDateTime(6)
                    });
                }

                return Ok(new { status = "Success", data = logs });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPost("upload-ipfs")]
        [Authorize(Roles = "faculty,department_admin")]
        [Consumes("multipart/form-data")]
        public async Task<IActionResult> UploadToIpfs([FromForm] IFormFile file)
        {
            if (file == null || file.Length == 0) return BadRequest(new { status = "Error", message = "File is required." });

            try
            {
                using var client = _httpClientFactory.CreateClient();
                using var content = new MultipartFormDataContent();
                
                // Encrypt before upload
                byte[] encryptedData;
                using (var stream = file.OpenReadStream())
                {
                    encryptedData = EncryptStream(stream);
                }
                
                content.Add(new ByteArrayContent(encryptedData), "file", file.FileName + ".enc");
                
                var ipfsHost = Environment.GetEnvironmentVariable("IPFS_HOST") ?? "ipfs0";
                var ipfsUrl = _configuration["IpfsApiUrl"] ?? $"http://{ipfsHost}:5001/api/v0/add?cid-version=1&wrap-with-directory=false";
                var ipfsRes = await client.PostAsync(ipfsUrl, content);
                
                if (ipfsRes.IsSuccessStatusCode)
                {
                    var ipfsJson = await ipfsRes.Content.ReadAsStringAsync();
                    var cid = "";
                    
                    // Robust multi-line JSON parsing
                    var lines = ipfsJson.Split('\n', StringSplitOptions.RemoveEmptyEntries);
                    foreach (var line in lines)
                    {
                        try {
                            using var doc = JsonDocument.Parse(line);
                            if (doc.RootElement.TryGetProperty("Hash", out var hashProp)) {
                                cid = hashProp.GetString() ?? cid;
                            }
                        } catch { }
                    }

                    // A successful response guarantees durable pins at all three campuses.
                    await DistributePinAsync(cid);

                    return Ok(new { status = "Success", cid = cid, url = $"/ipfs/{cid}", message = "File encrypted and securely distributed to IPFS." });
                }
                return StatusCode((int)ipfsRes.StatusCode, new { status = "Error", message = "IPFS daemon rejected the file." });
            }
            catch (Exception ex) { return StatusCode(500, new { status = "Error", message = $"IPFS service unreachable: {ex.Message}" }); }
        }

        [HttpGet("view-ipfs/{cid}")]
        [HttpPost("view-ipfs/{cid}")]
        [Authorize(Roles = "faculty,department_admin,registrar")]
        public async Task<IActionResult> ViewIpfsFile(string cid)
        {
            // Resilient parameter detection
            var vaultPassword = Request.Query["vaultPassword"].ToString();
            if (string.IsNullOrEmpty(vaultPassword)) vaultPassword = Request.Query["password"].ToString();
            if (string.IsNullOrEmpty(vaultPassword)) vaultPassword = Request.Query["vault_password"].ToString();
            if (string.IsNullOrEmpty(vaultPassword)) vaultPassword = Request.Query["vaultpass"].ToString();

            // The application viewer submits the password as JSON so it is not
            // exposed in the URL or routine reverse-proxy access logs.
            if (string.IsNullOrEmpty(vaultPassword) && HttpMethods.IsPost(Request.Method))
            {
                try
                {
                    using var requestBody = await JsonDocument.ParseAsync(Request.Body);
                    if (requestBody.RootElement.TryGetProperty("vaultPassword", out var passwordProperty))
                    {
                        vaultPassword = passwordProperty.GetString() ?? string.Empty;
                    }
                }
                catch (JsonException)
                {
                    return BadRequest(new { status = "Error", message = "A valid vault password request is required." });
                }
            }

            if (string.IsNullOrEmpty(vaultPassword))
            {
                _logger.LogWarning("ViewIpfsFile: vaultPassword missing. CID: {CID}. Providing HTML Challenge.", cid);
                
                // Return a simple HTML prompt if accessed via browser/direct link without password
                var html = $@"
                <!DOCTYPE html>
                <html>
                <head>
                    <title>SPII Vault Access Control</title>
                    <style>
                        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f1f5f9; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
                        .card {{ background: white; padding: 2.5rem; border-radius: 2rem; shadow: 0 20px 25px -5px rgba(0,0,0,0.1); width: 100%; max-width: 450px; border: 1px solid #e2e8f0; text-align: center; }}
                        .badge {{ display: inline-block; padding: 0.25rem 0.75rem; background: #e0f2fe; color: #0369a1; border-radius: 9999px; font-size: 0.75rem; font-weight: bold; margin-bottom: 1rem; }}
                        h2 {{ color: #003366; margin: 0 0 0.5rem 0; font-size: 1.5rem; }}
                        p {{ color: #64748b; font-size: 0.9rem; margin-bottom: 2rem; line-height: 1.5; }}
                        .cid-box {{ background: #f8fafc; padding: 0.75rem; border-radius: 0.75rem; font-family: monospace; font-size: 0.7rem; color: #475569; margin-bottom: 2rem; border: 1px dashed #cbd5e1; word-break: break-all; }}
                        input {{ width: 100%; padding: 1rem; margin-bottom: 1.25rem; border: 2px solid #e2e8f0; border-radius: 1rem; box-sizing: border-box; outline: none; font-size: 1rem; transition: border-color 0.2s; }}
                        input:focus {{ border-color: #003366; }}
                        button {{ width: 100%; padding: 1rem; background: #003366; color: white; border: none; border-radius: 1rem; font-weight: bold; cursor: pointer; transition: transform 0.1s, background 0.2s; font-size: 1rem; }}
                        button:hover {{ background: #00264d; }}
                        button:active {{ transform: scale(0.98); }}
                        .links {{ margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #f1f5f9; }}
                        .links a {{ color: #64748b; font-size: 0.8rem; text-decoration: none; }}
                        .links a:hover {{ text-decoration: underline; color: #003366; }}
                    </style>
                </head>
                <body>
                    <div class='card'>
                        <div class='badge'>DISTRIBUTED VAULT</div>
                        <h2>Private Record Access</h2>
                        <p>This academic record is encrypted and distributed across the PLV IPFS Network. Enter the Vault Password to view the decrypted content.</p>
                        
                        <div class='cid-box'>CID: {cid}</div>

                        <form onsubmit='handleSubmit(event)'>
                            <input type='password' id='pass' placeholder='Enter Vault Password' required autofocus />
                            <button type='submit'>Decrypt & View in Browser</button>
                        </form>

                        <div class='links'>
                            <a href='/ipfs/{cid}' target='_blank'>View Raw Encrypted Block (via IPFS Gateway)</a>
                        </div>
                    </div>
                    <script>
                        function handleSubmit(e) {{
                            e.preventDefault();
                            const pass = document.getElementById('pass').value;
                            const url = new URL(window.location.href);
                            url.searchParams.set('vaultPassword', pass);
                            window.location.href = url.toString();
                        }}
                    </script>
                </body>
                </html>";
                return Content(html, "text/html");
            }

            // Verify vault password against internal secret (simple check for this prototype)
            var expectedPassword = _configuration["VaultPassword"] ?? "PLV-Vault-2026";
            if (vaultPassword != expectedPassword)
            {
                return BadRequest(new { status = "Error", message = "Invalid Vault Password. Access Denied." });
            }

            try
            {
                var ipfsHost = Environment.GetEnvironmentVariable("IPFS_HOST") ?? "ipfs0";
                var ipfsUrl = $"http://{ipfsHost}:8080/ipfs/{cid}";

                using var client = _httpClientFactory.CreateClient();
                var response = await client.GetAsync(ipfsUrl);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogWarning("IPFS Gateway returned {StatusCode} for CID {CID}", response.StatusCode, cid);
                    return NotFound(new { status = "Error", message = "File not found on IPFS Gateway." });
                }

                var encryptedData = await response.Content.ReadAsByteArrayAsync();
                
                // Check if the content is HTML (likely a Directory listing from IPFS)
                var contentStr = System.Text.Encoding.UTF8.GetString(encryptedData.Take(100).ToArray());
                if (contentStr.Contains("<!DOCTYPE html>") || contentStr.Contains("<html"))
                {
                    return BadRequest(new { status = "Error", message = "This record was uploaded in an older format (Directory CID) and cannot be decrypted directly." });
                }

                if (encryptedData.Length < 16)
                {
                    return BadRequest(new { status = "Error", message = "Invalid encrypted data format." });
                }

                // Extract IV from the first 16 bytes
                byte[] iv = new byte[16];
                Array.Copy(encryptedData, 0, iv, 0, 16);
                byte[] ciphertext = new byte[encryptedData.Length - 16];
                Array.Copy(encryptedData, 16, ciphertext, 0, ciphertext.Length);

                var key = _configuration["IpfsEncryptionKey"] ?? "default-encryption-key-32chars!!!";
                var keyBytes = System.Text.Encoding.UTF8.GetBytes(key.PadRight(32).Substring(0, 32));

                using var aes = Aes.Create();
                aes.Key = keyBytes;
                aes.IV = iv;

                using var msInput = new MemoryStream(ciphertext);
                using var msOutput = new MemoryStream();
                try 
                {
                    using (var decryptor = aes.CreateDecryptor())
                    using (var cryptoStream = new CryptoStream(msInput, decryptor, CryptoStreamMode.Read))
                    {
                        await cryptoStream.CopyToAsync(msOutput);
                    }
                }
                catch (CryptographicException)
                {
                    return BadRequest(new { status = "Error", message = "Decryption failed. Invalid key or corrupted data." });
                }

                var decryptedData = msOutput.ToArray();
                
                // Content detection for the Cloud Viewer
                var buffer = new byte[4];
                if (decryptedData.Length >= 4) Array.Copy(decryptedData, 0, buffer, 0, 4);
                bool isPdf = (buffer[0] == 0x25 && buffer[1] == 0x50 && buffer[2] == 0x44 && buffer[3] == 0x46);
                
                var textContent = System.Text.Encoding.UTF8.GetString(decryptedData);

                // Convert JSON records into rows before the generic CSV check. JSON
                // commonly contains commas, so treating it as CSV produces unlabeled,
                // fragmented values in the viewer.
                var jsonHeaders = new List<string>();
                var jsonRows = new List<Dictionary<string, string>>();
                try
                {
                    using var jsonDocument = JsonDocument.Parse(textContent);

                    static string FormatJsonValue(JsonElement value)
                    {
                        return value.ValueKind switch
                        {
                            JsonValueKind.String => value.GetString() ?? string.Empty,
                            JsonValueKind.Null or JsonValueKind.Undefined => string.Empty,
                            JsonValueKind.True => "Yes",
                            JsonValueKind.False => "No",
                            JsonValueKind.Object => string.Join("; ", value.EnumerateObject().Select(property =>
                                $"{FormatJsonHeader(property.Name)}: {FormatJsonValue(property.Value)}")),
                            JsonValueKind.Array => string.Join(", ", value.EnumerateArray().Select(FormatJsonValue)),
                            _ => value.ToString()
                        };
                    }

                    void AddJsonObject(JsonElement jsonObject)
                    {
                        var row = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                        foreach (var property in jsonObject.EnumerateObject())
                        {
                            if (!jsonHeaders.Contains(property.Name, StringComparer.OrdinalIgnoreCase))
                            {
                                jsonHeaders.Add(property.Name);
                            }
                            row[property.Name] = FormatJsonValue(property.Value);
                        }
                        jsonRows.Add(row);
                    }

                    if (jsonDocument.RootElement.ValueKind == JsonValueKind.Object)
                    {
                        AddJsonObject(jsonDocument.RootElement);
                    }
                    else if (jsonDocument.RootElement.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in jsonDocument.RootElement.EnumerateArray())
                        {
                            if (item.ValueKind == JsonValueKind.Object)
                            {
                                AddJsonObject(item);
                            }
                            else
                            {
                                if (!jsonHeaders.Contains("value", StringComparer.OrdinalIgnoreCase))
                                {
                                    jsonHeaders.Add("value");
                                }
                                jsonRows.Add(new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                                {
                                    ["value"] = FormatJsonValue(item)
                                });
                            }
                        }
                    }
                    else
                    {
                        jsonHeaders.Add("value");
                        jsonRows.Add(new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                        {
                            ["value"] = FormatJsonValue(jsonDocument.RootElement)
                        });
                    }
                }
                catch (JsonException)
                {
                    // Non-JSON content continues through the existing PDF/CSV/text viewer.
                }

                static string FormatJsonHeader(string header)
                {
                    var spaced = Regex.Replace(header, "([a-z0-9])([A-Z])", "$1 $2")
                        .Replace('_', ' ')
                        .Replace('-', ' ');
                    var words = spaced.Split(' ', StringSplitOptions.RemoveEmptyEntries)
                        .Select(word => word.ToLowerInvariant() switch
                        {
                            "id" => "ID",
                            "ipfs" => "IPFS",
                            "gpa" => "GPA",
                            "cid" => "CID",
                            _ => CultureInfo.InvariantCulture.TextInfo.ToTitleCase(word.ToLowerInvariant())
                        });
                    return string.Join(" ", words);
                }
                
                // --- CLOUD VIEWER HTML ---
                var viewerHtml = $@"
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Cloud Viewer - {cid}</title>
                    <style>
                        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 2rem; color: #1e293b; }}
                        .container {{ max-width: 1200px; margin: 0 auto; background: white; border-radius: 1.5rem; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; overflow: hidden; display: flex; flex-direction: column; height: 85vh; }}
                        .header {{ background: #003366; color: white; padding: 1.25rem 2rem; display: flex; justify-content: space-between; align-items: center; }}
                        .header h1 {{ margin: 0; font-size: 1.1rem; font-weight: 800; letter-spacing: -0.025em; }}
                        .header .meta {{ font-size: 0.7rem; opacity: 0.8; font-family: monospace; }}
                        .content {{ flex: 1; overflow: auto; padding: 0; background: #fff; position: relative; }}
                        
                        /* Table Styling for CSVs */
                        table {{ width: 100%; border-collapse: collapse; font-size: 0.85rem; border: none; }}
                        th {{ text-align: left; background: #f8fafc; padding: 0.75rem 1rem; font-weight: 700; color: #475569; border-bottom: 2px solid #e2e8f0; position: sticky; top: 0; z-index: 10; }}
                        td {{ padding: 0.75rem 1rem; border-bottom: 1px solid #f1f5f9; color: #334155; }}
                        tr:hover {{ background: #f1f5f9; }}

                        /* PDF Embed */
                        embed {{ width: 100%; height: 100%; border: none; position: absolute; top: 0; left: 0; }}

                        .btn {{ padding: 0.5rem 1rem; border-radius: 0.5rem; font-weight: bold; text-decoration: none; font-size: 0.75rem; transition: all 0.2s; cursor: pointer; border: none; }}
                        .btn-white {{ background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2); }}
                        .btn-white:hover {{ background: rgba(255,255,255,0.2); }}
                    </style>
                </head>
                <body>
                    <div class='container'>
                        <div class='header'>
                            <div>
                                <h1>PLV Vault: Decrypted Record Viewer</h1>
                                <div class='meta'>ID: {cid}</div>
                            </div>
                            <button onclick='window.close()' class='btn btn-white'>Close Cloud Viewer</button>
                        </div>
                        <div class='content'>";

                if (isPdf)
                {
                    var base64Pdf = Convert.ToBase64String(decryptedData);
                    viewerHtml += $@"<embed src='data:application/pdf;base64,{base64Pdf}' type='application/pdf' />";
                }
                else if (jsonRows.Count > 0)
                {
                    viewerHtml += "<table><thead><tr>";
                    foreach (var header in jsonHeaders)
                    {
                        viewerHtml += $"<th>{System.Net.WebUtility.HtmlEncode(FormatJsonHeader(header))}</th>";
                    }
                    viewerHtml += "</tr></thead><tbody>";

                    foreach (var row in jsonRows)
                    {
                        viewerHtml += "<tr>";
                        foreach (var header in jsonHeaders)
                        {
                            row.TryGetValue(header, out var value);
                            viewerHtml += $"<td>{System.Net.WebUtility.HtmlEncode(value ?? string.Empty)}</td>";
                        }
                        viewerHtml += "</tr>";
                    }

                    viewerHtml += "</tbody></table>";
                }
                else if (textContent.Contains(",") || textContent.Contains("\t"))
                {
                    viewerHtml += "<table><thead><tr>";
                    var separator = textContent.Contains("\t") ? '\t' : ',';
                    var lines = textContent.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.RemoveEmptyEntries);
                    if (lines.Length > 0)
                    {
                        var headers = lines[0].Split(separator);
                        foreach (var h in headers) viewerHtml += $"<th>{System.Net.WebUtility.HtmlEncode(h)}</th>";
                        viewerHtml += "</tr></thead><tbody>";
                        
                        for (int i = 1; i < lines.Length; i++)
                        {
                            viewerHtml += "<tr>";
                            var cells = lines[i].Split(separator);
                            foreach (var c in cells) viewerHtml += $"<td>{System.Net.WebUtility.HtmlEncode(c)}</td>";
                            viewerHtml += "</tr>";
                        }
                    }
                    viewerHtml += "</tbody></table>";
                }
                else
                {
                    viewerHtml += $"<pre style='padding: 2rem; margin: 0; white-space: pre-wrap; font-family: monospace;'>{System.Net.WebUtility.HtmlEncode(textContent)}</pre>";
                }

                viewerHtml += @"
                        </div>
                    </div>
                </body>
                </html>";

                return Content(viewerHtml, "text/html");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving or decrypting IPFS file");
                return StatusCode(500, new { status = "Error", message = $"Decryption failed: {ex.Message}" });
            }
        }

        private async Task DistributePinAsync(string cid)
        {
            if (string.IsNullOrEmpty(cid)) return;

            var configuredNodes = Environment.GetEnvironmentVariable("IPFS_PEER_NODES");
            var nodes = (configuredNodes ?? Environment.GetEnvironmentVariable("IPFS_HOST") ?? "ipfs-api.plv-fabric.svc.cluster.local")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
            
            var pinTasks = nodes.Select(async node =>
            {
                using var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(120);

                var pinUrl = $"http://{node}:5001/api/v0/pin/add?arg={Uri.EscapeDataString(cid)}&recursive=true";
                using var response = await client.PostAsync(pinUrl, null);
                if (!response.IsSuccessStatusCode)
                {
                    var body = await response.Content.ReadAsStringAsync();
                    throw new HttpRequestException($"IPFS node {node} rejected pin {cid}: {(int)response.StatusCode} {body}");
                }

                _logger.LogInformation("Successfully distributed/pinned CID {CID} to node {Node}", cid, node);
            });

            await Task.WhenAll(pinTasks);
        }

        [HttpPost("export-pdf")]
        [HttpGet("export-pdf")]
        [HttpGet("summary/pdf")]
        [HttpPost("summary/pdf")]
        [HttpGet("grade-summary-pdf")]
        [HttpPost("grade-summary-pdf")]
        [HttpGet("/api/Student/grades/pdf")]
        [HttpGet("/api/Student/grade-summary-pdf")]
        [Authorize(Roles = "faculty,registrar,department_admin,chairperson,student,admin")]
        public async Task<IActionResult> ExportGradeSummaryPdf(
            [FromQuery] string? recordId = null,
            [FromQuery] string? studentEmail = null,
            [FromQuery] string? studentId = null,
            [FromBody] GradeSummaryExportRequest? request = null)
        {
            try
            {
                var targetRecordId = request?.RecordId ?? recordId;
                var targetStudentEmail = request?.StudentEmail ?? studentEmail ?? studentId;

                var invokerId = User.Identity?.Name ?? "system";
                var userRole = User.FindFirst("dbRole")?.Value ?? User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

                if (string.IsNullOrWhiteSpace(targetRecordId) && string.IsNullOrWhiteSpace(targetStudentEmail))
                {
                    if (userRole.Equals("student", StringComparison.OrdinalIgnoreCase))
                    {
                        targetStudentEmail = invokerId;
                    }
                    else
                    {
                        return BadRequest(new { status = "Error", message = "RecordId or StudentEmail is required." });
                    }
                }

                // Get grade records
                List<AcademicRecord> records = new();
                
                if (!string.IsNullOrWhiteSpace(targetRecordId))
                {
                    try
                    {
                        var recordJson = await _blockchainService.GetGradeAsync(targetRecordId, invokerId);
                        var record = JsonSerializer.Deserialize<AcademicRecord>(recordJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                        if (record != null) records.Add(record);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Blockchain fetch failed for record {RecordId}, checking database fallback.", targetRecordId);
                    }

                    if (!records.Any())
                    {
                        using var conn = new NpgsqlConnection(_connectionString);
                        await conn.OpenAsync();
                        using var dbCmd = new NpgsqlCommand(@"
                            SELECT id, student_hash, student_no, student_name, course, subject_code, subject_title, grade, term, status, date, semester, school_year
                            FROM pending_grade_records
                            WHERE id = @id OR transaction_id = @id
                            LIMIT 1", conn);
                        dbCmd.Parameters.AddWithValue("id", targetRecordId);
                        using var reader = await dbCmd.ExecuteReaderAsync();
                        if (await reader.ReadAsync())
                        {
                            records.Add(new AcademicRecord
                            {
                                SubjectCode = reader["subject_code"]?.ToString(),
                                SubjectTitle = reader["subject_title"]?.ToString(),
                                Grade = reader["grade"]?.ToString(),
                                Term = reader["term"]?.ToString() ?? "Final",
                                Status = reader["status"]?.ToString(),
                                Date = reader["date"]?.ToString(),
                                StudentHash = reader["student_hash"]?.ToString() ?? reader["student_no"]?.ToString(),
                                Course = reader["course"]?.ToString(),
                                SchoolYear = reader["school_year"]?.ToString(),
                                Semester = reader["semester"]?.ToString()
                            });
                        }
                    }
                }
                else if (!string.IsNullOrWhiteSpace(targetStudentEmail))
                {
                    // Registrar/admin can export for any student; faculty can only export their own
                    if (userRole.Equals("faculty", StringComparison.OrdinalIgnoreCase) && !invokerId.Equals(targetStudentEmail, StringComparison.OrdinalIgnoreCase))
                        return Forbid();

                    try
                    {
                        var allGradesJson = await _blockchainService.GetAllGradesAsync(targetStudentEmail);
                        using var doc = JsonDocument.Parse(allGradesJson);
                        var dataElement = doc.RootElement.TryGetProperty("data", out var d) ? d : doc.RootElement;
                        records = JsonSerializer.Deserialize<List<AcademicRecord>>(dataElement.GetRawText(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Blockchain fetch failed for student {StudentEmail}, checking database fallback.", targetStudentEmail);
                    }

                    if (!records.Any())
                    {
                        using var conn = new NpgsqlConnection(_connectionString);
                        await conn.OpenAsync();
                        using var dbCmd = new NpgsqlCommand(@"
                            SELECT id, student_hash, student_no, student_name, course, subject_code, subject_title, grade, term, status, date, semester, school_year
                            FROM pending_grade_records
                            WHERE LOWER(student_hash) = LOWER(@email)
                               OR LOWER(student_no) = LOWER(@email)
                               OR student_hash IN (SELECT student_no FROM studentprofiles WHERE LOWER(student_email) = LOWER(@email))
                               OR student_hash IN (SELECT student_no FROM studentprofiles sp JOIN users u ON u.id = sp.user_id WHERE LOWER(u.email) = LOWER(@email))
                            ORDER BY school_year DESC, semester DESC, subject_code ASC", conn);
                        dbCmd.Parameters.AddWithValue("email", targetStudentEmail.Trim());
                        using var reader = await dbCmd.ExecuteReaderAsync();
                        while (await reader.ReadAsync())
                        {
                            records.Add(new AcademicRecord
                            {
                                SubjectCode = reader["subject_code"]?.ToString(),
                                SubjectTitle = reader["subject_title"]?.ToString(),
                                Grade = reader["grade"]?.ToString(),
                                Term = reader["term"]?.ToString() ?? "Final",
                                Status = reader["status"]?.ToString(),
                                Date = reader["date"]?.ToString(),
                                StudentHash = reader["student_hash"]?.ToString() ?? reader["student_no"]?.ToString(),
                                Course = reader["course"]?.ToString(),
                                SchoolYear = reader["school_year"]?.ToString(),
                                Semester = reader["semester"]?.ToString()
                            });
                        }
                    }
                }

                records = records
                    .Where(record => string.Equals(record.Status, "Finalized", StringComparison.OrdinalIgnoreCase))
                    .ToList();

                if (records.Count == 0)
                    return NotFound(new { status = "Error", message = "No finalized grades are available for this PDF." });

                // Student details
                var first = records.First();
                var studentHash = first.StudentHash ?? targetStudentEmail ?? "N/A";
                var dept = first.Course ?? "Academic Department";
                var sy = first.SchoolYear ?? DateTime.UtcNow.Year.ToString();
                var sem = first.Semester ?? "1st Semester";

                // Generate valid standard PDF 1.4 document
                var pdfBytes = GenerateGradeSummaryPdfBytes(studentHash, dept, sy, sem, records);

                return File(pdfBytes, "application/pdf", $"grade-summary-{DateTime.UtcNow:yyyyMMddHHmmss}.pdf");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error exporting grade summary PDF");
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        private static byte[] GenerateGradeSummaryPdfBytes(
            string studentHash,
            string department,
            string schoolYear,
            string semester,
            List<AcademicRecord> records)
        {
            var contentSb = new StringBuilder();

            // Header Banner
            contentSb.AppendLine("0.0 0.2 0.4 rg"); // PLV Navy
            contentSb.AppendLine("BT /F2 16 Tf 50 740 Td (Pamantasan ng Lungsod ng Valenzuela) Tj ET");
            contentSb.AppendLine("0.1 0.1 0.1 rg");
            contentSb.AppendLine("BT /F2 12 Tf 50 722 Td (OFFICIAL GRADE SUMMARY REPORT) Tj ET");
            contentSb.AppendLine($"BT /F1 8 Tf 50 708 Td (Generated: {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC) Tj ET");

            // Horizontal line
            contentSb.AppendLine("0.0 0.2 0.4 RG 1.5 w 50 698 m 562 698 l S");

            // Student Information Box
            contentSb.AppendLine("0.96 0.97 0.98 rg 50 635 512 55 re f");
            contentSb.AppendLine("0.8 0.85 0.9 RG 0.75 w 50 635 512 55 re S");

            contentSb.AppendLine("0.1 0.1 0.1 rg");
            var cleanHash = EscapePdfString(studentHash.Length > 30 ? studentHash.Substring(0, 30) + "..." : studentHash);
            var cleanDept = EscapePdfString(department);
            var cleanSy = EscapePdfString(schoolYear);
            var cleanSem = EscapePdfString(semester);

            contentSb.AppendLine($"BT /F2 9.5 Tf 60 672 Td (Student / Hash: {cleanHash}) Tj ET");
            contentSb.AppendLine($"BT /F1 9 Tf 60 657 Td (Department: {cleanDept}) Tj ET");
            contentSb.AppendLine($"BT /F1 9 Tf 60 642 Td (School Year: {cleanSy}   |   Semester: {cleanSem}) Tj ET");

            // Table Header
            contentSb.AppendLine("0.0 0.2 0.4 rg 50 605 512 20 re f");
            contentSb.AppendLine("1 1 1 rg");
            contentSb.AppendLine("BT /F2 9 Tf 56 611 Td (Subject Code) Tj ET");
            contentSb.AppendLine("BT /F2 9 Tf 150 611 Td (Subject Title) Tj ET");
            contentSb.AppendLine("BT /F2 9 Tf 340 611 Td (Grade) Tj ET");
            contentSb.AppendLine("BT /F2 9 Tf 390 611 Td (Term) Tj ET");
            contentSb.AppendLine("BT /F2 9 Tf 445 611 Td (Status) Tj ET");
            contentSb.AppendLine("BT /F2 9 Tf 510 611 Td (Date) Tj ET");

            // Table Rows
            float y = 588;
            bool alt = false;
            foreach (var record in records)
            {
                if (y < 65) break;

                if (alt)
                {
                    contentSb.AppendLine($"0.97 0.97 0.97 rg 50 {y - 4} 512 16 re f");
                }
                alt = !alt;

                contentSb.AppendLine("0.1 0.1 0.1 rg");
                var code = EscapePdfString(record.SubjectCode ?? "N/A");
                var title = EscapePdfString(TruncateString(record.SubjectTitle ?? "N/A", 32));
                var grade = EscapePdfString(record.Grade ?? "N/A");
                var term = EscapePdfString(record.Term ?? "Final");
                var status = EscapePdfString(record.Status ?? "N/A");
                var date = EscapePdfString(TruncateString(record.Date ?? DateTime.UtcNow.ToString("yyyy-MM-dd"), 12));

                contentSb.AppendLine($"BT /F1 8.5 Tf 56 {y} Td ({code}) Tj ET");
                contentSb.AppendLine($"BT /F1 8.5 Tf 150 {y} Td ({title}) Tj ET");
                contentSb.AppendLine($"BT /F2 8.5 Tf 340 {y} Td ({grade}) Tj ET");
                contentSb.AppendLine($"BT /F1 8.5 Tf 390 {y} Td ({term}) Tj ET");
                contentSb.AppendLine($"BT /F1 8.5 Tf 445 {y} Td ({status}) Tj ET");
                contentSb.AppendLine($"BT /F1 8.5 Tf 510 {y} Td ({date}) Tj ET");

                contentSb.AppendLine($"0.88 0.88 0.88 RG 0.5 w 50 {y - 4} m 562 {y - 4} l S");
                y -= 17;
            }

            // Footer
            contentSb.AppendLine("0.7 0.7 0.7 RG 0.5 w 50 42 m 562 42 l S");
            contentSb.AppendLine("0.4 0.4 0.4 rg");
            contentSb.AppendLine("BT /F1 7.5 Tf 50 30 Td (Pamantasan ng Lungsod ng Valenzuela - Blockchain Grade Verification System) Tj ET");
            contentSb.AppendLine("BT /F1 7.5 Tf 490 30 Td (Page 1 of 1) Tj ET");

            var streamBytes = Encoding.ASCII.GetBytes(contentSb.ToString());

            using var ms = new MemoryStream();
            using var writer = new StreamWriter(ms, Encoding.ASCII);
            var offsets = new List<long>();

            writer.Write("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
            writer.Flush();

            // Obj 1: Catalog
            offsets.Add(ms.Position);
            writer.Write("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
            writer.Flush();

            // Obj 2: Pages
            offsets.Add(ms.Position);
            writer.Write("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
            writer.Flush();

            // Obj 3: Page
            offsets.Add(ms.Position);
            writer.Write("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n");
            writer.Flush();

            // Obj 4: Font F1
            offsets.Add(ms.Position);
            writer.Write("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
            writer.Flush();

            // Obj 5: Font F2
            offsets.Add(ms.Position);
            writer.Write("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n");
            writer.Flush();

            // Obj 6: Stream
            offsets.Add(ms.Position);
            writer.Write($"6 0 obj\n<< /Length {streamBytes.Length} >>\nstream\n");
            writer.Flush();
            ms.Write(streamBytes, 0, streamBytes.Length);
            writer.Write("\nendstream\nendobj\n");
            writer.Flush();

            // xref
            var xrefOffset = ms.Position;
            writer.Write($"xref\n0 {offsets.Count + 1}\n0000000000 65535 f \n");
            foreach (var off in offsets)
            {
                writer.Write($"{off:D10} 00000 n \n");
            }
            writer.Write($"trailer\n<< /Size {offsets.Count + 1} /Root 1 0 R >>\nstartxref\n{xrefOffset}\n%%EOF\n");
            writer.Flush();

            return ms.ToArray();
        }

        private static string EscapePdfString(string? input)
        {
            if (string.IsNullOrEmpty(input)) return "";
            var sb = new StringBuilder();
            foreach (var ch in input)
            {
                if (ch == '(' || ch == ')' || ch == '\\')
                {
                    sb.Append('\\').Append(ch);
                }
                else if (ch >= 32 && ch <= 126)
                {
                    sb.Append(ch);
                }
                else
                {
                    sb.Append(' ');
                }
            }
            return sb.ToString();
        }

        private static string TruncateString(string? input, int maxLength)
        {
            if (string.IsNullOrEmpty(input)) return "";
            return input.Length <= maxLength ? input : input.Substring(0, maxLength) + "...";
        }

        public class GradeSummaryExportRequest
        {
            public string? RecordId { get; set; }
            public string? StudentEmail { get; set; }
        }
    }
}
