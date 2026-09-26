using System.Text.Json;
using BlockGo.Models;
using BlockGo.Services;
using Client_app.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace Client_app.Controllers;

[Authorize(Roles = "registrar")]
[ApiController]
[Route("api/[controller]")]
public sealed class TranscriptController : ControllerBase
{
    private readonly IBlockchainService _blockchain;
    private readonly string _connectionString;
    private readonly ILogger<TranscriptController> _logger;

    public TranscriptController(IBlockchainService blockchain, IConfiguration configuration,
        ILogger<TranscriptController> logger)
    {
        _blockchain = blockchain;
        _logger = logger;
        _connectionString = configuration.GetConnectionString("MasterConnection")
            ?? configuration.GetConnectionString("PostgresConnection")
            ?? throw new InvalidOperationException("A PostgreSQL connection is required.");
    }

    [HttpGet("students/{studentUserId:int}")]
    public async Task<IActionResult> GetStudentTranscript(int studentUserId, CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);

            await using var profileCommand = new NpgsqlCommand(@"
                SELECT u.email, sp.student_no, sp.full_name,
                       COALESCE(p.program_code, ''), COALESCE(p.program_name, sp.department, ''),
                       enrollment.curriculum_id, COALESCE(c.curriculum_name, ''),
                       COALESCE(c.curriculum_version, ''), enrollment.batch_year
                FROM users u
                JOIN studentprofiles sp ON sp.user_id = u.id
                LEFT JOIN LATERAL (
                    SELECT se.program_id, se.curriculum_id, se.batch_year
                    FROM student_enrollments se
                    WHERE se.student_user_id = u.id AND se.status = 'ENROLLED'
                    ORDER BY se.updated_at DESC, se.enrollment_id DESC LIMIT 1
                ) enrollment ON TRUE
                LEFT JOIN academic_programs p ON p.program_id = enrollment.program_id
                LEFT JOIN curriculums c ON c.curriculum_id = enrollment.curriculum_id
                WHERE u.id = @studentUserId AND LOWER(u.role) = 'student'
                  AND LOWER(u.status) = 'approved' AND u.is_active = TRUE;", connection);
            profileCommand.Parameters.AddWithValue("studentUserId", studentUserId);

            string email;
            string studentNo;
            string studentName;
            string programCode;
            string programName;
            long? curriculumId;
            string curriculumName;
            string curriculumVersion;
            int? batchYear;
            await using (var reader = await profileCommand.ExecuteReaderAsync(cancellationToken))
            {
                if (!await reader.ReadAsync(cancellationToken))
                    return NotFound(new { status = "Error", message = "Active student not found." });
                email = reader.GetString(0);
                studentNo = reader.IsDBNull(1) ? "" : reader.GetString(1);
                studentName = reader.IsDBNull(2) ? email : reader.GetString(2);
                programCode = reader.GetString(3);
                programName = reader.GetString(4);
                curriculumId = reader.IsDBNull(5) ? null : reader.GetInt64(5);
                curriculumName = reader.GetString(6);
                curriculumVersion = reader.GetString(7);
                batchYear = reader.IsDBNull(8) ? null : reader.GetInt32(8);
            }

            if (curriculumId is null)
                return Conflict(new { status = "Error", message = "The student has no cohort curriculum assignment." });

            var subjects = new List<TranscriptSubject>();
            await using (var subjectCommand = new NpgsqlCommand(@"
                SELECT subject_code, subject_title, units, year_level, semester
                FROM curriculum_subjects
                WHERE curriculum_id = @curriculumId
                ORDER BY year_level,
                         CASE semester WHEN 'FIRST' THEN 1 WHEN 'SECOND' THEN 2 ELSE 3 END,
                         subject_code;", connection))
            {
                subjectCommand.Parameters.AddWithValue("curriculumId", curriculumId.Value);
                await using var reader = await subjectCommand.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                    subjects.Add(new(reader.GetString(0), reader.GetString(1), reader.GetDecimal(2),
                        reader.GetInt16(3), reader.GetString(4)));
            }

            var releasedIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            await using (var releaseCommand = new NpgsqlCommand("SELECT record_id FROM grade_releases;", connection))
            await using (var reader = await releaseCommand.ExecuteReaderAsync(cancellationToken))
                while (await reader.ReadAsync(cancellationToken)) releasedIds.Add(reader.GetString(0));

            var actor = User.Identity?.Name ?? throw new InvalidOperationException("Registrar identity is unavailable.");
            var ledgerJson = await _blockchain.GetAllGradesAsync(actor);
            using var ledgerDocument = JsonDocument.Parse(ledgerJson);
            var ledgerElement = ledgerDocument.RootElement.TryGetProperty("data", out var data)
                ? data : ledgerDocument.RootElement;
            var ledgerRecords = JsonSerializer.Deserialize<List<AcademicRecord>>(ledgerElement.GetRawText(),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
            var releasedRecords = ledgerRecords
                .Where(record => releasedIds.Contains(record.Id)
                    && string.Equals(record.Status?.Trim(), "Finalized", StringComparison.OrdinalIgnoreCase)
                    && StudentSubjectGradeResolver.MatchesStudent(record, email, studentNo))
                .GroupBy(record => record.SubjectCode?.Trim() ?? "", StringComparer.OrdinalIgnoreCase)
                .ToDictionary(group => group.Key, group => group
                    .OrderByDescending(record => ParseTimestamp(record.Timestamp)).First(), StringComparer.OrdinalIgnoreCase);

            var transcriptRows = subjects.Select(subject =>
            {
                releasedRecords.TryGetValue(subject.Code, out var record);
                var grade = StudentSubjectGradeResolver.ParseFinalGrade(record?.Grade);
                var standing = ParseStanding(record?.Grade);
                var completed = record is not null && IsPassing(grade, standing);
                return new
                {
                    subjectCode = subject.Code,
                    subjectTitle = subject.Title,
                    subject.Units,
                    yearLevel = subject.YearLevel,
                    semester = subject.Semester,
                    grade,
                    standing,
                    schoolYear = record?.SchoolYear,
                    transactionId = record?.TransactionId,
                    recordId = record?.Id,
                    completed
                };
            }).ToList();
            var incomplete = transcriptRows.Where(row => !row.completed)
                .Select(row => new { row.subjectCode, row.subjectTitle, reason = row.grade is null ? "No released final grade" : row.standing })
                .ToList();

            return Ok(new
            {
                status = "Success",
                data = new
                {
                    student = new { studentUserId, studentNo, studentName, email, programCode, programName, batchYear },
                    curriculum = new { curriculumId, curriculumName, curriculumVersion },
                    records = transcriptRows,
                    completeness = new
                    {
                        isComplete = subjects.Count > 0 && incomplete.Count == 0,
                        requiredSubjects = subjects.Count,
                        completedSubjects = transcriptRows.Count(row => row.completed),
                        missingOrIncomplete = incomplete
                    }
                }
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to build transcript for student user {StudentUserId}", studentUserId);
            return StatusCode(500, new { status = "Error", message = "Unable to build the transcript from released ledger records." });
        }
    }

    private sealed record TranscriptSubject(string Code, string Title, decimal Units, short YearLevel, string Semester);

    private static DateTimeOffset ParseTimestamp(string? value) =>
        DateTimeOffset.TryParse(value, out var timestamp) ? timestamp : DateTimeOffset.MinValue;

    private static string ParseStanding(string? grade)
    {
        if (string.IsNullOrWhiteSpace(grade)) return "Not released";
        try
        {
            using var document = JsonDocument.Parse(grade);
            return document.RootElement.TryGetProperty("standing", out var standing)
                ? standing.ToString() : "Active";
        }
        catch (JsonException) { return "Active"; }
    }

    private static bool IsPassing(decimal? grade, string standing)
    {
        if (grade is null || !string.Equals(standing, "Active", StringComparison.OrdinalIgnoreCase)) return false;
        return grade <= 5m ? grade <= 3m : grade >= 75m;
    }
}
