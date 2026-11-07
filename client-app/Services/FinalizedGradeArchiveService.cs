using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using BlockGo.Models;
using BlockGo.Services;
using Npgsql;
using NpgsqlTypes;

namespace Client_app.Services;

public sealed record FinalizedGradeArchiveResult(
    string Status,
    string? Cid,
    string FileName,
    string DatasetHash,
    string? FailureCode = null,
    bool Reused = false);

public sealed record FinalizedGradeArchiveAssociation(string Status, string? Cid);

public sealed class FinalizedGradeArchiveException : Exception
{
    public string Code { get; }

    public FinalizedGradeArchiveException(string code, string message, Exception? inner = null)
        : base(message, inner) => Code = code;
}

public sealed class FinalizedGradeArchiveService
{
    private const string Available = "AVAILABLE";
    private const string Failed = "FAILED";
    private readonly IIpfsVaultService _ipfsVault;
    private readonly ILogger<FinalizedGradeArchiveService> _logger;

    public FinalizedGradeArchiveService(
        IIpfsVaultService ipfsVault,
        ILogger<FinalizedGradeArchiveService> logger)
    {
        _ipfsVault = ipfsVault;
        _logger = logger;
    }

    public async Task<FinalizedGradeArchiveResult> EnsureArchivedAsync(
        NpgsqlConnection connection,
        IReadOnlyCollection<AcademicRecord> finalizedRecords,
        string actor,
        CancellationToken cancellationToken = default)
    {
        FinalizedGradeArtifact artifact;
        try
        {
            artifact = BuildArtifact(finalizedRecords);
        }
        catch (Exception exception) when (exception is not FinalizedGradeArchiveException)
        {
            throw new FinalizedGradeArchiveException(
                "IPFS_ARCHIVE_GENERATION_FAILED",
                "The finalized grading sheet could not be generated.", exception);
        }

        var academicSectionId = await ResolveAcademicSectionIdAsync(
            connection, artifact.AssignmentCycleId, cancellationToken);

        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            await using (var insert = new NpgsqlCommand(@"
                INSERT INTO finalized_grade_archives
                    (dataset_hash, assignment_cycle_id, academic_section_id, program, section,
                     subject_code, school_year, semester, term, record_ids, record_versions,
                     finalized_transaction_ids, file_name, content_type, status, archived_by)
                VALUES
                    (@datasetHash, @assignmentCycleId, @academicSectionId, @program, @section,
                     @subjectCode, @schoolYear, @semester, @term, @recordIds, @recordVersions::jsonb,
                     @transactionIds, @fileName, 'application/json', 'PENDING', @actor)
                ON CONFLICT (dataset_hash) DO NOTHING;", connection, transaction))
            {
                AddArtifactParameters(insert, artifact, academicSectionId, actor);
                await insert.ExecuteNonQueryAsync(cancellationToken);
            }

            long archiveId;
            string status;
            string? existingCid;
            await using (var select = new NpgsqlCommand(@"
                SELECT archive_id, status, cid
                FROM finalized_grade_archives
                WHERE dataset_hash = @datasetHash
                FOR UPDATE;", connection, transaction))
            {
                select.Parameters.AddWithValue("datasetHash", artifact.DatasetHash);
                await using var reader = await select.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                    throw new FinalizedGradeArchiveException(
                        "IPFS_METADATA_PERSIST_FAILED",
                        "The grading-sheet archive metadata could not be reserved.");
                archiveId = reader.GetInt64(0);
                status = reader.GetString(1);
                existingCid = reader.IsDBNull(2) ? null : reader.GetString(2);
            }

            if (status == Available && !string.IsNullOrWhiteSpace(existingCid))
            {
                await transaction.CommitAsync(cancellationToken);
                return new FinalizedGradeArchiveResult(
                    Available, existingCid, artifact.FileName, artifact.DatasetHash, Reused: true);
            }

            await using (var pending = new NpgsqlCommand(@"
                UPDATE finalized_grade_archives
                SET status = 'PENDING', failure_code = NULL, failure_message = NULL,
                    attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP,
                    archived_by = @actor
                WHERE archive_id = @archiveId;", connection, transaction))
            {
                pending.Parameters.AddWithValue("archiveId", archiveId);
                pending.Parameters.AddWithValue("actor", actor);
                await pending.ExecuteNonQueryAsync(cancellationToken);
            }

            string cid;
            try
            {
                cid = await _ipfsVault.UploadEncryptedAsync(
                    artifact.Content, artifact.FileName, cancellationToken);
            }
            catch (Exception uploadException)
            {
                await MarkFailedAsync(
                    connection, transaction, archiveId, "IPFS_UPLOAD_FAILED",
                    "The internal IPFS service did not complete the grading-sheet archive.", cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                _logger.LogError(uploadException,
                    "Finalized grading-sheet IPFS upload failed for assignment {AssignmentCycleId}, subject {Subject}, term {Term}, dataset {DatasetHash}",
                    artifact.AssignmentCycleId, artifact.SubjectCode, artifact.Term, artifact.DatasetHash);
                return new FinalizedGradeArchiveResult(
                    Failed, null, artifact.FileName, artifact.DatasetHash, "IPFS_UPLOAD_FAILED");
            }

            await using (var available = new NpgsqlCommand(@"
                UPDATE finalized_grade_archives
                SET cid = @cid, status = 'AVAILABLE', failure_code = NULL, failure_message = NULL,
                    archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE archive_id = @archiveId;", connection, transaction))
            {
                available.Parameters.AddWithValue("archiveId", archiveId);
                available.Parameters.AddWithValue("cid", cid);
                if (await available.ExecuteNonQueryAsync(cancellationToken) != 1)
                    throw new FinalizedGradeArchiveException(
                        "IPFS_METADATA_PERSIST_FAILED",
                        "IPFS returned a CID, but its finalized grading-sheet metadata was not persisted.");
            }

            await transaction.CommitAsync(cancellationToken);
            _logger.LogInformation(
                "Finalized grading sheet archived for assignment {AssignmentCycleId}, academic section {AcademicSectionId}, subject {Subject}, term {Term}, file {FileName}, CID {Cid}, transactions {TransactionIds}",
                artifact.AssignmentCycleId, academicSectionId, artifact.SubjectCode, artifact.Term,
                artifact.FileName, cid, artifact.TransactionIds);
            return new FinalizedGradeArchiveResult(
                Available, cid, artifact.FileName, artifact.DatasetHash);
        }
        catch (FinalizedGradeArchiveException)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
        catch (Exception exception)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new FinalizedGradeArchiveException(
                "IPFS_METADATA_PERSIST_FAILED",
                "The finalized grading-sheet archive metadata could not be persisted.", exception);
        }
    }

    public static FinalizedGradeArtifact BuildArtifact(IReadOnlyCollection<AcademicRecord> finalizedRecords)
    {
        if (finalizedRecords.Count == 0)
            throw new FinalizedGradeArchiveException(
                "IPFS_ARCHIVE_GENERATION_FAILED", "At least one finalized record is required.");

        var ordered = finalizedRecords
            .OrderBy(record => FirstNonBlank(record.StudentNo, record.StudentId, record.StudentHash), StringComparer.OrdinalIgnoreCase)
            .ThenBy(record => record.Id, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var first = ordered[0];
        var assignmentCycleId = Required(first.AssignmentCycleId, "assignment cycle");
        var subjectCode = Required(first.SubjectCode, "subject code");
        var schoolYear = Required(first.SchoolYear, "school year");
        var semester = Required(first.Semester, "semester");
        var term = GradeAcademicTerm.Normalize(first.Term, string.Empty);
        if (string.IsNullOrWhiteSpace(first.Term))
            throw new FinalizedGradeArchiveException(
                "IPFS_ARCHIVE_GENERATION_FAILED", "The finalized grading term is missing.");

        foreach (var record in ordered)
        {
            if (!string.Equals(record.Status?.Trim(), "Finalized", StringComparison.OrdinalIgnoreCase))
                throw new FinalizedGradeArchiveException(
                    "IPFS_ARCHIVE_GENERATION_FAILED", "Only verified Finalized records may be archived.");
            if (!Same(record.AssignmentCycleId, assignmentCycleId) ||
                !Same(record.SubjectCode, subjectCode) ||
                !Same(record.SchoolYear, schoolYear) ||
                !Same(record.Semester, semester) ||
                !Same(GradeAcademicTerm.Normalize(record.Term, string.Empty), term))
                throw new FinalizedGradeArchiveException(
                    "IPFS_ARCHIVE_GENERATION_FAILED",
                    "Finalized records from different academic workloads cannot share one grading sheet.");
        }

        var generatedAt = ordered
            .Select(record => ParseTimestamp(record.FinalizedAt) ?? ParseTimestamp(record.Timestamp))
            .Where(value => value.HasValue)
            .Select(value => value!.Value)
            .DefaultIfEmpty(DateTimeOffset.UnixEpoch)
            .Max();
        var rows = ordered.Select(ToArtifactRecord).ToArray();
        var versions = ordered.ToDictionary(
            record => record.Id,
            record => record.GradeVersion > 0 ? record.GradeVersion : 1,
            StringComparer.OrdinalIgnoreCase);
        var transactionIds = ordered.Select(record => record.TransactionId)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var section = Required(first.Section, "section");
        var program = FirstNonBlank(first.Program, first.Course);
        var envelope = new FinalizedGradeSheetEnvelope(
            "plv.finalized-grading-sheet.v1",
            new FinalizedGradeSheetMetadata(
                assignmentCycleId, program, section, subjectCode, first.SubjectTitle ?? string.Empty,
                schoolYear, semester, term, generatedAt.ToUniversalTime().ToString("O"),
                transactionIds),
            rows);
        var content = JsonSerializer.SerializeToUtf8Bytes(envelope, new JsonSerializerOptions { WriteIndented = true });

        ValidateArtifactRows(ordered, rows);
        var datasetHash = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
        var fileName = string.Join('_', new[]
        {
            SafeFilePart(section), SafeFilePart(subjectCode), SafeFilePart(schoolYear),
            SafeFilePart(semester), SafeFilePart(term), "Finalized-Grades.json"
        });
        return new FinalizedGradeArtifact(
            assignmentCycleId, program, section, subjectCode, schoolYear, semester, term,
            fileName, datasetHash, content, ordered.Select(record => record.Id).ToArray(),
            versions, transactionIds);
    }

    public static async Task<Dictionary<string, FinalizedGradeArchiveAssociation>> LoadAssociationsAsync(
        NpgsqlConnection connection,
        IReadOnlyCollection<AcademicRecord> finalizedRecords,
        CancellationToken cancellationToken = default)
    {
        var byId = finalizedRecords.Where(record => !string.IsNullOrWhiteSpace(record.Id))
            .ToDictionary(record => record.Id, StringComparer.OrdinalIgnoreCase);
        var associations = new Dictionary<string, FinalizedGradeArchiveAssociation>(StringComparer.OrdinalIgnoreCase);
        if (byId.Count == 0) return associations;

        await using var command = new NpgsqlCommand(@"
            SELECT status, cid, record_ids, record_versions::text
            FROM finalized_grade_archives
            WHERE record_ids && @recordIds
            ORDER BY archived_at DESC NULLS LAST, updated_at DESC;", connection);
        command.Parameters.AddWithValue("recordIds", NpgsqlDbType.Array | NpgsqlDbType.Text, byId.Keys.ToArray());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var status = reader.GetString(0);
            var cid = reader.IsDBNull(1) ? null : reader.GetString(1);
            var ids = reader.GetFieldValue<string[]>(2);
            using var versionsDocument = JsonDocument.Parse(reader.GetString(3));
            foreach (var id in ids)
            {
                if (associations.ContainsKey(id) || !byId.TryGetValue(id, out var record)) continue;
                if (!versionsDocument.RootElement.TryGetProperty(id, out var archivedVersion)) continue;
                var currentVersion = record.GradeVersion > 0 ? record.GradeVersion : 1;
                if (archivedVersion.GetInt32() == currentVersion)
                    associations[id] = new FinalizedGradeArchiveAssociation(status, cid);
            }
        }
        return associations;
    }

    private static FinalizedGradeSheetRecord ToArtifactRecord(AcademicRecord record)
    {
        var values = ExtractGradeValues(record.Grade);
        return new FinalizedGradeSheetRecord(
            record.Id, FirstNonBlank(record.StudentNo, record.StudentId), record.StudentName ?? string.Empty,
            record.StudentHash ?? string.Empty, FirstNonBlank(record.Program, record.Course), record.Section,
            record.SubjectCode, record.SubjectTitle ?? string.Empty, record.SchoolYear, record.Semester,
            GradeAcademicTerm.Normalize(record.Term, string.Empty), record.Grade,
            values.Midterm, values.Finals, values.FinalAverage, values.Standing,
            record.Status, record.GradeVersion > 0 ? record.GradeVersion : 1,
            record.TransactionId ?? string.Empty, record.FinalizedBy ?? string.Empty,
            record.FinalizedAt ?? string.Empty, record.AssignmentCycleId);
    }

    private static (string Midterm, string Finals, string FinalAverage, string Standing) ExtractGradeValues(string payload)
    {
        if (string.IsNullOrWhiteSpace(payload) || !payload.TrimStart().StartsWith('{'))
            return (string.Empty, string.Empty, payload ?? string.Empty, string.Empty);
        try
        {
            using var document = JsonDocument.Parse(payload);
            return (
                JsonText(document.RootElement, "midterm"),
                JsonText(document.RootElement, "finals"),
                JsonText(document.RootElement, "finalAverage"),
                JsonText(document.RootElement, "standing"));
        }
        catch (JsonException)
        {
            return (string.Empty, string.Empty, payload, string.Empty);
        }
    }

    private static string JsonText(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return string.Empty;
        return value.ValueKind == JsonValueKind.String ? value.GetString() ?? string.Empty : value.GetRawText();
    }

    private static void ValidateArtifactRows(AcademicRecord[] source, FinalizedGradeSheetRecord[] rows)
    {
        var byId = rows.ToDictionary(row => row.RecordId, StringComparer.OrdinalIgnoreCase);
        foreach (var record in source)
        {
            if (!byId.TryGetValue(record.Id, out var row) ||
                !string.Equals(row.RawGradePayload, record.Grade, StringComparison.Ordinal) ||
                row.GradeVersion != (record.GradeVersion > 0 ? record.GradeVersion : 1))
                throw new FinalizedGradeArchiveException(
                    "IPFS_ARCHIVE_GENERATION_FAILED",
                    "The generated grading sheet does not match the verified finalized records.");
        }
    }

    private static async Task<int?> ResolveAcademicSectionIdAsync(
        NpgsqlConnection connection,
        string assignmentCycleId,
        CancellationToken cancellationToken)
    {
        if (!int.TryParse(assignmentCycleId, NumberStyles.None, CultureInfo.InvariantCulture, out var facultySectionId))
            return null;
        await using var command = new NpgsqlCommand(
            "SELECT academic_section_id FROM facultysections WHERE id = @id LIMIT 1;", connection);
        command.Parameters.AddWithValue("id", facultySectionId);
        var value = await command.ExecuteScalarAsync(cancellationToken);
        return value is null or DBNull ? null : Convert.ToInt32(value, CultureInfo.InvariantCulture);
    }

    private static void AddArtifactParameters(
        NpgsqlCommand command,
        FinalizedGradeArtifact artifact,
        int? academicSectionId,
        string actor)
    {
        command.Parameters.AddWithValue("datasetHash", artifact.DatasetHash);
        command.Parameters.AddWithValue("assignmentCycleId", artifact.AssignmentCycleId);
        command.Parameters.AddWithValue("academicSectionId", (object?)academicSectionId ?? DBNull.Value);
        command.Parameters.AddWithValue("program", artifact.Program);
        command.Parameters.AddWithValue("section", artifact.Section);
        command.Parameters.AddWithValue("subjectCode", artifact.SubjectCode);
        command.Parameters.AddWithValue("schoolYear", artifact.SchoolYear);
        command.Parameters.AddWithValue("semester", artifact.Semester);
        command.Parameters.AddWithValue("term", artifact.Term);
        command.Parameters.AddWithValue("recordIds", NpgsqlDbType.Array | NpgsqlDbType.Text, artifact.RecordIds);
        command.Parameters.AddWithValue("recordVersions", JsonSerializer.Serialize(artifact.RecordVersions));
        command.Parameters.AddWithValue("transactionIds", NpgsqlDbType.Array | NpgsqlDbType.Text, artifact.TransactionIds);
        command.Parameters.AddWithValue("fileName", artifact.FileName);
        command.Parameters.AddWithValue("actor", actor);
    }

    private static async Task MarkFailedAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        long archiveId,
        string code,
        string message,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(@"
            UPDATE finalized_grade_archives
            SET status = 'FAILED', failure_code = @code, failure_message = @message,
                updated_at = CURRENT_TIMESTAMP
            WHERE archive_id = @archiveId;", connection, transaction);
        command.Parameters.AddWithValue("archiveId", archiveId);
        command.Parameters.AddWithValue("code", code);
        command.Parameters.AddWithValue("message", message);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string SafeFilePart(string value)
    {
        var normalized = RegexReplace(value, @"[^A-Za-z0-9.-]+", "-").Trim('-');
        return string.IsNullOrWhiteSpace(normalized) ? "Unknown" : normalized;
    }

    private static string RegexReplace(string? value, string pattern, string replacement) =>
        System.Text.RegularExpressions.Regex.Replace(value?.Trim() ?? string.Empty, pattern, replacement);

    private static DateTimeOffset? ParseTimestamp(string? value) =>
        DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed)
            ? parsed
            : null;

    private static bool Same(string? left, string? right) =>
        string.Equals(left?.Trim(), right?.Trim(), StringComparison.OrdinalIgnoreCase);

    private static string Required(string? value, string field) =>
        !string.IsNullOrWhiteSpace(value)
            ? value.Trim()
            : throw new FinalizedGradeArchiveException(
                "IPFS_ARCHIVE_GENERATION_FAILED", $"The finalized {field} is missing.");

    private static string FirstNonBlank(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;
}

public sealed record FinalizedGradeArtifact(
    string AssignmentCycleId,
    string Program,
    string Section,
    string SubjectCode,
    string SchoolYear,
    string Semester,
    string Term,
    string FileName,
    string DatasetHash,
    byte[] Content,
    string[] RecordIds,
    IReadOnlyDictionary<string, int> RecordVersions,
    string[] TransactionIds);

public sealed record FinalizedGradeSheetEnvelope(
    [property: JsonPropertyName("schema")] string Schema,
    [property: JsonPropertyName("metadata")] FinalizedGradeSheetMetadata Metadata,
    [property: JsonPropertyName("records")] FinalizedGradeSheetRecord[] Records);

public sealed record FinalizedGradeSheetMetadata(
    [property: JsonPropertyName("assignment_cycle_id")] string AssignmentCycleId,
    [property: JsonPropertyName("program")] string Program,
    [property: JsonPropertyName("section")] string Section,
    [property: JsonPropertyName("subject_code")] string SubjectCode,
    [property: JsonPropertyName("subject_title")] string SubjectTitle,
    [property: JsonPropertyName("school_year")] string SchoolYear,
    [property: JsonPropertyName("semester")] string Semester,
    [property: JsonPropertyName("term")] string Term,
    [property: JsonPropertyName("generated_at")] string GeneratedAt,
    [property: JsonPropertyName("finalized_transaction_ids")] string[] FinalizedTransactionIds);

public sealed record FinalizedGradeSheetRecord(
    [property: JsonPropertyName("record_id")] string RecordId,
    [property: JsonPropertyName("student_no")] string StudentNo,
    [property: JsonPropertyName("student_name")] string StudentName,
    [property: JsonPropertyName("student_identity")] string StudentIdentity,
    [property: JsonPropertyName("program")] string Program,
    [property: JsonPropertyName("section")] string Section,
    [property: JsonPropertyName("subject_code")] string SubjectCode,
    [property: JsonPropertyName("subject_title")] string SubjectTitle,
    [property: JsonPropertyName("school_year")] string SchoolYear,
    [property: JsonPropertyName("semester")] string Semester,
    [property: JsonPropertyName("term")] string Term,
    [property: JsonPropertyName("raw_grade_payload")] string RawGradePayload,
    [property: JsonPropertyName("midterm")] string Midterm,
    [property: JsonPropertyName("finals")] string Finals,
    [property: JsonPropertyName("final_average")] string FinalAverage,
    [property: JsonPropertyName("standing")] string Standing,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("grade_version")] int GradeVersion,
    [property: JsonPropertyName("ledger_transaction_id")] string LedgerTransactionId,
    [property: JsonPropertyName("finalized_by")] string FinalizedBy,
    [property: JsonPropertyName("finalized_at")] string FinalizedAt,
    [property: JsonPropertyName("assignment_cycle_id")] string AssignmentCycleId);
