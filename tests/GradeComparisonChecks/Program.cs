using BlockGo.Models;
using Client_app.Services;

static void Check(bool condition, string scenario)
{
    if (!condition) throw new Exception($"FAIL: {scenario}");
    Console.WriteLine($"PASS: {scenario}");
}

static AcademicRecord Record(string grade = "1.75", string status = "SubmittedToChairperson") => new()
{
    Id = "grade-001",
    LogicalGradeId = "grade-001",
    StudentNo = "2026-0001",
    StudentId = "2026-0001",
    StudentHash = "student@plv.edu.ph",
    SubjectCode = "IT 101",
    Section = "BSIT 1-1",
    Program = "BSIT",
    SchoolYear = "2026-2027",
    Semester = "FIRST",
    Term = "midterm",
    AssignmentCycleId = "91",
    Grade = grade,
    Status = status,
    GradeVersion = 1,
    Version = 1,
    TransactionId = "tx-1"
};

static AcademicRecord Finalized(string grade = "1.75", int gradeVersion = 1)
{
    var record = Record(grade, "Finalized");
    record.GradeVersion = gradeVersion;
    record.Version = gradeVersion;
    record.TransactionId = $"tx-{gradeVersion}";
    return record;
}

var current = Record();
var trusted = Finalized();

var matching = GradeComparisonService.Compare(current, new[] { trusted });
Check(matching.CurrentGrade == "1.75" && matching.ReferenceGrade == "1.75", "current and reference grades are returned");
Check(matching.IntegrityStatus == GradeComparisonService.Match, "equal grades produce MATCH");

var mismatch = GradeComparisonService.Compare(current, new[] { Finalized("2.00") });
Check(mismatch.IntegrityStatus == GradeComparisonService.Mismatch, "different grades produce MISMATCH");

var missing = GradeComparisonService.Compare(current, Array.Empty<AcademicRecord>());
Check(missing.ReferenceGrade is null && missing.IntegrityStatus == GradeComparisonService.ReferenceNotFound,
    "missing reference produces explicit safe state");
Check(missing.ReferenceGrade != missing.CurrentGrade, "missing reference is not copied from current grade");

var wrongStudent = Finalized(); wrongStudent.StudentNo = "2026-9999"; wrongStudent.StudentId = "2026-9999"; wrongStudent.StudentHash = "other@plv.edu.ph";
Check(GradeComparisonService.Compare(current, new[] { wrongStudent }).IntegrityStatus == GradeComparisonService.ReferenceNotFound,
    "student identity is required for matching");

var wrongSubject = Finalized(); wrongSubject.SubjectCode = "IT 999";
Check(GradeComparisonService.Compare(current, new[] { wrongSubject }).IntegrityStatus == GradeComparisonService.ReferenceNotFound,
    "subject code is required for matching");

var wrongSection = Finalized(); wrongSection.Section = "BSIT 2-1";
Check(GradeComparisonService.Compare(current, new[] { wrongSection }).IntegrityStatus == GradeComparisonService.ReferenceNotFound,
    "section is required for matching");

var wrongYear = Finalized(); wrongYear.SchoolYear = "2027-2028";
var wrongSemester = Finalized(); wrongSemester.Semester = "SECOND";
Check(GradeComparisonService.Compare(current, new[] { wrongYear }).IntegrityStatus == GradeComparisonService.ReferenceNotFound &&
      GradeComparisonService.Compare(current, new[] { wrongSemester }).IntegrityStatus == GradeComparisonService.ReferenceNotFound,
    "school year and semester are required for matching");

var oldVersion = Finalized("1.50", 1);
var currentVersion = Finalized("1.75", 2);
var versioned = GradeComparisonService.Compare(current, new[] { oldVersion, currentVersion });
Check(versioned.ReferenceGrade == "1.75" && versioned.ReferenceGradeVersion == 2 && versioned.ReferenceTransactionId == "tx-2",
    "highest finalized grade version is selected");

Check(GradeComparisonService.Compare(Record("1.5"), new[] { Finalized("1.50") }).IntegrityStatus == GradeComparisonService.Match,
    "numeric equivalents do not produce false mismatches");

var outsideProgram = Finalized(); outsideProgram.Program = "BSCS";
Check(GradeComparisonService.Compare(current, new[] { outsideProgram }).IntegrityStatus == GradeComparisonService.ReferenceNotFound,
    "outside-program records cannot become references");

var beforeCurrent = current.Grade;
var beforeTrusted = trusted.Grade;
_ = GradeComparisonService.Compare(current, new[] { trusted });
Check(current.Grade == beforeCurrent && trusted.Grade == beforeTrusted, "comparison is read-only and does not mutate records");

var legacy = Finalized("1.75"); legacy.GradeVersion = 0; legacy.SchoolYear = "2026"; legacy.Semester = "1st Semester";
Check(GradeComparisonService.Compare(current, new[] { legacy }).IntegrityStatus == GradeComparisonService.Match,
    "legacy valid records continue matching through academic-period normalization");

var wrongAssignment = Finalized(); wrongAssignment.AssignmentCycleId = "92";
Check(GradeComparisonService.Compare(current, new[] { wrongAssignment }).IntegrityStatus == GradeComparisonService.ReferenceNotFound,
    "faculty assignment cycle is required when present");

var wrongRecord = Finalized(); wrongRecord.Id = "grade-002"; wrongRecord.LogicalGradeId = "grade-002";
Check(GradeComparisonService.Compare(current, new[] { wrongRecord }).IntegrityStatus == GradeComparisonService.ReferenceNotFound,
    "stable grade record identity is required");

var finalsCurrent = Record("{\"midterm\":85,\"finals\":90}"); finalsCurrent.Term = "finals";
var finalsReference = Finalized("{\"midterm\":70,\"finals\":90}"); finalsReference.Term = "finals";
Check(GradeComparisonService.Compare(finalsCurrent, new[] { finalsReference }).IntegrityStatus == GradeComparisonService.Match,
    "active grading term selects the correct value from structured payloads");

var nonFinalized = Record("1.75", "Issued");
Check(GradeComparisonService.Compare(current, new[] { nonFinalized }).IntegrityStatus == GradeComparisonService.ReferenceNotFound,
    "non-finalized ledger data is never trusted as a reference");

Console.WriteLine("All Grade Comparison backend checks passed.");
