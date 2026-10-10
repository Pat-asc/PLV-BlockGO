using System.Text;
using System.Text.Json;
using BlockGo.Models;
using Client_app.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

var passed = 0;
void Check(bool condition, string name)
{
    if (!condition) throw new InvalidOperationException(name);
    passed++;
    Console.WriteLine($"PASS {passed}: {name}");
}

AcademicRecord Record(
    string id,
    string grade = "{\"midterm\":\"88.25\",\"finals\":\"91.50\",\"finalAverage\":\"89.88\",\"standing\":\"Passed\"}",
    string status = "Finalized",
    string subject = "IT 101",
    string semester = "FIRST",
    string term = "finals",
    int version = 1) => new()
{
    Id = id,
    StudentNo = id == "grade-1" ? "26-0001" : "26-0002",
    StudentName = id == "grade-1" ? "Student One" : "Student Two",
    StudentHash = $"{id}@plv.edu.ph",
    Program = "BSIT",
    Course = "Bachelor of Science in Information Technology",
    Section = "BSIT 1-1",
    SubjectCode = subject,
    SubjectTitle = "Introduction to Computing",
    SchoolYear = "2026-2027",
    Semester = semester,
    Term = term,
    Grade = grade,
    Status = status,
    GradeVersion = version,
    TransactionId = $"tx-{id}-v{version}",
    FinalizedBy = "registrar@plv.edu.ph",
    FinalizedAt = "2026-10-10T08:00:00.0000000+00:00",
    AssignmentCycleId = "501"
};

var source = new[] { Record("grade-2"), Record("grade-1") };
var artifact = FinalizedGradeArchiveService.BuildArtifact(source);
Check(artifact.RecordIds.SequenceEqual(new[] { "grade-1", "grade-2" }), "artifact rows use stable student ordering");
Check(artifact.AssignmentCycleId == "501" && artifact.SubjectCode == "IT 101" && artifact.Term == "finals", "artifact carries stable workload identity");
Check(artifact.TransactionIds.SequenceEqual(new[] { "tx-grade-1-v1", "tx-grade-2-v1" }), "artifact carries ledger transaction references");
Check(artifact.FileName == "BSIT-1-1_IT-101_2026-2027_FIRST_finals_Finalized-Grades.json", "artifact filename is deterministic and descriptive");

using (var document = JsonDocument.Parse(artifact.Content))
{
    var records = document.RootElement.GetProperty("records");
    Check(document.RootElement.GetProperty("schema").GetString() == "plv.finalized-grading-sheet.v1", "artifact uses a versioned schema");
    Check(records.GetArrayLength() == 2, "artifact contains the complete finalized workload");
    var first = records[0];
    Check(first.GetProperty("finals").GetString() == "91.50", "numeric grade precision is preserved exactly");
    Check(first.GetProperty("raw_grade_payload").GetString() == source[1].Grade, "authoritative raw grade payload is preserved exactly");
    Check(first.GetProperty("grade_version").GetInt32() == 1, "grade version is included for integrity association");
}

foreach (var special in new[] { "D", "UD", "W", "INC" })
{
    var specialArtifact = FinalizedGradeArchiveService.BuildArtifact(new[]
    {
        Record("grade-1", $"{{\"finals\":\"{special}\",\"standing\":\"{special}\"}}")
    });
    using var document = JsonDocument.Parse(specialArtifact.Content);
    var row = document.RootElement.GetProperty("records")[0];
    Check(row.GetProperty("finals").GetString() == special && row.GetProperty("standing").GetString() == special,
        $"special grade {special} is preserved without coercion");
}

var reordered = FinalizedGradeArchiveService.BuildArtifact(source.Reverse().ToArray());
Check(reordered.DatasetHash == artifact.DatasetHash && reordered.Content.SequenceEqual(artifact.Content), "same finalized dataset is byte-stable across input order");
var corrected = FinalizedGradeArchiveService.BuildArtifact(new[] { Record("grade-1", version: 2), Record("grade-2") });
Check(corrected.DatasetHash != artifact.DatasetHash, "grade version changes produce a new immutable dataset identity");

void ExpectRejected(IEnumerable<AcademicRecord> records, string name)
{
    try
    {
        FinalizedGradeArchiveService.BuildArtifact(records.ToArray());
        throw new InvalidOperationException($"Expected rejection: {name}");
    }
    catch (FinalizedGradeArchiveException) { Check(true, name); }
}

ExpectRejected(Array.Empty<AcademicRecord>(), "empty finalized workload is rejected");
ExpectRejected(new[] { Record("grade-1", status: "DepartmentApproved") }, "pre-finalized records are rejected");
ExpectRejected(new[] { Record("grade-1"), Record("grade-2", subject: "IT 102") }, "mixed subjects cannot share an archive");
ExpectRejected(new[] { Record("grade-1"), Record("grade-2", semester: "SECOND") }, "mixed semesters cannot share an archive");
ExpectRejected(new[] { Record("grade-1"), Record("grade-2", term: "midterm") }, "mixed grading terms cannot share an archive");

var encryptedA = IpfsVaultService.Encrypt(artifact.Content, "01234567890123456789012345678901");
var encryptedB = IpfsVaultService.Encrypt(artifact.Content, "01234567890123456789012345678901");
Check(!encryptedA.SequenceEqual(artifact.Content) && !encryptedA.SequenceEqual(encryptedB), "archive encryption uses a fresh IV and does not expose plaintext");
try
{
    IpfsVaultService.Encrypt(artifact.Content, null);
    throw new InvalidOperationException("missing encryption key should fail closed");
}
catch (InvalidOperationException) { Check(true, "automatic archival fails closed without the encryption secret"); }

var repo = FindRepositoryRoot();
var controller = File.ReadAllText(Path.Combine(repo, "client-app", "Controllers", "GradeController.cs"));
var cleanupCommit = controller.IndexOf("await cleanupTransaction.CommitAsync", StringComparison.Ordinal);
var archiveCall = controller.IndexOf("var archive = await TryArchiveFinalizedRecordsAsync", cleanupCommit, StringComparison.Ordinal);
Check(cleanupCommit >= 0 && archiveCall > cleanupCommit, "automatic archive starts after finalized staging cleanup commits");
var retryStart = controller.IndexOf("public async Task<IActionResult> EnsureFinalizedArchive", StringComparison.Ordinal);
var retryEnd = controller.IndexOf("[HttpPost(\"finalize/{recordId}\")]", retryStart, StringComparison.Ordinal);
var retryBody = controller[retryStart..retryEnd];
Check(!retryBody.Contains("FinalizeApprovedGradesAsync", StringComparison.Ordinal) && !retryBody.Contains("FinalizeGradeAsync", StringComparison.Ordinal), "IPFS retry cannot repeat Fabric finalization");
Check(controller.Contains("[Authorize(Roles = \"registrar,department_admin\")]", StringComparison.Ordinal), "historical archive endpoint is role protected");
Check(controller.Contains("[HttpPost(\"upload-ipfs\")]", StringComparison.Ordinal), "manual attachment upload remains available");

var connectionString = Environment.GetEnvironmentVariable("FINALIZED_ARCHIVE_TEST_CONNECTION");
if (!string.IsNullOrWhiteSpace(connectionString))
{
    await using var connection = new NpgsqlConnection(connectionString);
    await connection.OpenAsync();
    await using (var setup = new NpgsqlCommand(@"
        CREATE TEMP TABLE facultysections(id INTEGER PRIMARY KEY, academic_section_id INTEGER);
        INSERT INTO facultysections VALUES (501, 77);
        CREATE TEMP TABLE finalized_grade_archives (
            archive_id BIGSERIAL PRIMARY KEY, dataset_hash CHAR(64) UNIQUE NOT NULL,
            assignment_cycle_id VARCHAR(100) NOT NULL, academic_section_id INTEGER,
            program VARCHAR(255) NOT NULL, section VARCHAR(100) NOT NULL,
            subject_code VARCHAR(100) NOT NULL, school_year VARCHAR(50) NOT NULL,
            semester VARCHAR(50) NOT NULL, term VARCHAR(20) NOT NULL,
            record_ids TEXT[] NOT NULL, record_versions JSONB NOT NULL,
            finalized_transaction_ids TEXT[] NOT NULL, cid VARCHAR(255),
            file_name VARCHAR(255) NOT NULL, content_type VARCHAR(100) NOT NULL,
            status VARCHAR(20) NOT NULL, failure_code VARCHAR(50), failure_message VARCHAR(500),
            attempt_count INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, archived_at TIMESTAMPTZ,
            archived_by VARCHAR(255) NOT NULL);", connection))
        await setup.ExecuteNonQueryAsync();

    var vault = new FakeVault();
    var service = new FinalizedGradeArchiveService(vault, NullLogger<FinalizedGradeArchiveService>.Instance);
    var first = await service.EnsureArchivedAsync(connection, source, "registrar@plv.edu.ph");
    Check(first.Status == "AVAILABLE" && first.Cid == FakeVault.Cid && vault.UploadCount == 1, "successful upload persists the returned CID");
    var second = await service.EnsureArchivedAsync(connection, source.Reverse().ToArray(), "registrar@plv.edu.ph");
    Check(second.Reused && second.Cid == first.Cid && vault.UploadCount == 1, "duplicate finalization/archive request reuses one CID");
    var associations = await FinalizedGradeArchiveService.LoadAssociationsAsync(connection, source);
    Check(associations.Count == 2 && associations.Values.All(value => value.Status == "AVAILABLE" && value.Cid == FakeVault.Cid), "CID association resolves for every matching record version");
    var mismatchedVersion = source.Select(record => record.Id == "grade-1" ? Record("grade-1", version: 2) : record).ToArray();
    var versionAssociations = await FinalizedGradeArchiveService.LoadAssociationsAsync(connection, mismatchedVersion);
    Check(!versionAssociations.ContainsKey("grade-1") && versionAssociations.ContainsKey("grade-2"), "stale CID is hidden after a grade-version change");

    var failureRows = new[] { Record("failure-1", subject: "IT 103") };
    var failingVault = new FakeVault(fail: true);
    var failingService = new FinalizedGradeArchiveService(failingVault, NullLogger<FinalizedGradeArchiveService>.Instance);
    var failed = await failingService.EnsureArchivedAsync(connection, failureRows, "registrar@plv.edu.ph");
    Check(failed.Status == "FAILED" && failed.FailureCode == "IPFS_UPLOAD_FAILED", "IPFS failure is recorded without changing finalized grade data");
    var retryVault = new FakeVault();
    var retryService = new FinalizedGradeArchiveService(retryVault, NullLogger<FinalizedGradeArchiveService>.Instance);
    var recovered = await retryService.EnsureArchivedAsync(connection, failureRows, "registrar@plv.edu.ph");
    Check(recovered.Status == "AVAILABLE" && retryVault.UploadCount == 1, "failed IPFS archive can be retried independently");

    if (string.Equals(Environment.GetEnvironmentVariable("FINALIZED_ARCHIVE_REAL_IPFS"), "1", StringComparison.Ordinal))
    {
        Environment.SetEnvironmentVariable("IPFS_HOST", "127.0.0.1");
        Environment.SetEnvironmentVariable("IPFS_PEER_NODES", "127.0.0.1");
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["IpfsApiUrl"] = "http://127.0.0.1:5001/api/v0/add?cid-version=1&wrap-with-directory=false",
            ["IpfsEncryptionKey"] = "01234567890123456789012345678901"
        }).Build();
        var realVault = new IpfsVaultService(
            new SimpleHttpClientFactory(), configuration, NullLogger<IpfsVaultService>.Instance);
        var realService = new FinalizedGradeArchiveService(realVault, NullLogger<FinalizedGradeArchiveService>.Instance);
        var realResult = await realService.EnsureArchivedAsync(
            connection, new[] { Record("real-ipfs-1", subject: "IT 104") }, "registrar@plv.edu.ph");
        Check(realResult.Status == "AVAILABLE" && realResult.Cid is { Length: > 20 }, "real IPFS upload returns and persists a CID");
        Console.WriteLine($"REAL IPFS CID: {realResult.Cid}");
    }
}
else
{
    Console.WriteLine("SKIP: PostgreSQL archive persistence checks (FINALIZED_ARCHIVE_TEST_CONNECTION is not configured)");
}

Console.WriteLine($"RESULT: {passed} passed, 0 failed");

static string FindRepositoryRoot()
{
    for (var directory = new DirectoryInfo(Directory.GetCurrentDirectory()); directory is not null; directory = directory.Parent)
        if (File.Exists(Path.Combine(directory.FullName, "client-app", "For_Testing_Only_Capstone.csproj"))) return directory.FullName;
    throw new DirectoryNotFoundException("Repository root was not found.");
}

sealed class FakeVault(bool fail = false) : IIpfsVaultService
{
    public const string Cid = "bafybeigdyrzt5examplefinalizedgradesheetcid";
    public int UploadCount { get; private set; }

    public Task<string> UploadEncryptedAsync(byte[] content, string fileName, CancellationToken cancellationToken = default)
    {
        UploadCount++;
        if (fail) throw new HttpRequestException("simulated IPFS outage");
        if (content.Length == 0 || !fileName.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("invalid generated artifact");
        return Task.FromResult(Cid);
    }
}

sealed class SimpleHttpClientFactory : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => new();
}
