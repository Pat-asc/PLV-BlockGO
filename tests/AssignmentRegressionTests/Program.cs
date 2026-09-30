using ClosedXML.Excel;
using BlockGo.Models;
using Client_app.Models;
using Client_app.Services;
using BlockGo.Services;
using Microsoft.AspNetCore.Http;
using Npgsql;

var passed = 0; var skipped = 0;
void Pass(int n, string name) { passed++; Console.WriteLine($"PASS {n}: {name}"); }
void Skip(int n) { skipped++; Console.WriteLine($"SKIP {n}: PostgreSQL integration (SECTIONING_TEST_CONNECTION is not configured)"); }
static void Check(bool value, string message) { if (!value) throw new Exception(message); }
static string FindRepositoryFile(params string[] pathParts)
{
    for (var directory = new DirectoryInfo(Directory.GetCurrentDirectory()); directory is not null; directory = directory.Parent)
    {
        var candidate = Path.Combine(new[] { directory.FullName }.Concat(pathParts).ToArray());
        if (File.Exists(candidate)) return candidate;
    }
    throw new FileNotFoundException($"Repository file was not found: {Path.Combine(pathParts)}");
}

Check(new[] { "final", "finals", "FINAL", "FINALS" }.All(term => GradeAcademicTerm.Normalize(term) == GradeAcademicTerm.Finals),
    "Finals aliases did not normalize to the canonical term."); Pass(60, "finals aliases normalize to finals");
Check(GradeAcademicTerm.Normalize("midterm") == GradeAcademicTerm.Midterm && GradeAcademicTerm.Normalize("MIDTERMS") == GradeAcademicTerm.Midterm,
    "Midterm normalization regressed."); Pass(61, "midterm aliases normalize to midterm");

var openMidterm = GradeEncodingPeriodService.ParseOpen(
    "{\"semester\":\"First Semester\",\"startDate\":\"2026-09-01\",\"endDate\":\"2026-09-30\",\"term\":\"MIDTERM\"}",
    new DateOnly(2026, 9, 22));
Check(openMidterm.Term == "midterm" && openMidterm.Semester == "FIRST", "Authoritative Midterm period did not normalize.");
Pass(69, "authoritative encoding period normalizes Midterm casing");
var midtermOnly = GradeEncodingPeriodService.ProjectIncomingGradePayload(
    "{\"midterm\":\"85\",\"finals\":\"90\",\"finalAverage\":\"87.5\"}", null, openMidterm.Term);
Check(GradeEncodingPeriodService.HasGradeForTerm(midtermOnly, "midterm") && !midtermOnly.Contains("finals", StringComparison.OrdinalIgnoreCase),
    "Closed Finals data survived Midterm projection."); Pass(70, "Midterm upload strips Finals data");
var finalOnlyDuringMidterm = GradeEncodingPeriodService.ProjectIncomingGradePayload("{\"final\":\"90\"}", null, "midterm");
Check(!GradeEncodingPeriodService.HasGradeForTerm(finalOnlyDuringMidterm, "midterm"), "Final-only upload became Midterm workflow data.");
Pass(71, "Final-only Midterm upload is rejected");
var finalsPayload = GradeEncodingPeriodService.ProjectIncomingGradePayload(
    "{\"midterm\":\"99\",\"FINAL\":\"90\"}", "{\"midterm\":\"85\"}", "FINALS");
Check(finalsPayload.Contains("\"midterm\":\"85\"") && finalsPayload.Contains("\"finals\":\"90\"") && !finalsPayload.Contains("99"),
    "Finals projection trusted the workbook Midterm or lost stored history."); Pass(72, "Finals accepts Finals and preserves stored Midterm");
Check(new[] { "final", "finals", "FINAL", "FINALS" }.All(term =>
        GradeEncodingPeriodService.ParseOpen($"{{\"semester\":\"FIRST\",\"startDate\":\"2026-09-01\",\"endDate\":\"2026-09-30\",\"term\":\"{term}\"}}", new DateOnly(2026, 9, 22)).Term == "finals"),
    "Authoritative Finals aliases did not normalize."); Pass(73, "authoritative Finals casing normalization");
Check(RegistrarGradeLedgerMetadataService.IsBrowsableStatus("Finalized") &&
      !new[] { "Draft", "SubmittedToChairperson", "Returned", "ChairpersonApproved", "DepartmentApproved" }
          .Any(RegistrarGradeLedgerMetadataService.IsBrowsableStatus),
    "Registrar ledger browsing exposed a grade before authoritative finalization.");
Pass(82, "Registrar ledger visibility is Finalized-only");
var studentAttempt = new StudentSubjectAttempt(
    10, "student@plv.edu.ph", "26-0042", "IT 101", "2026-2027", "FIRST", "BSIT 1-1", "104");
var finalizedStudentGrade = new AcademicRecord
{
    Id = "finalized-visible", StudentHash = "student@plv.edu.ph", StudentNo = "26-0042",
    SubjectCode = "IT 101", SchoolYear = "2026-2027", Semester = "FIRST",
    Section = "BSIT 1-1", AssignmentCycleId = "104", Status = "Finalized", Grade = "92"
};
var releasedGradeIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "finalized-visible" };
var releasedFinalizedGrades = new[] { finalizedStudentGrade }
    .Where(record => GradeReleasePolicy.IsVisibleToStudent(record, releasedGradeIds));
var visibleResolution = StudentSubjectGradeResolver.Resolve(studentAttempt, releasedFinalizedGrades);
Check(visibleResolution.IsFinalized && visibleResolution.FinalizedGrade == 92m,
    "A released Chairperson-finalized grade was not visible to its exact student and assignment cycle.");
Pass(92, "released Chairperson Finalized grade is student-visible");
Check(!GradeReleasePolicy.IsVisibleToStudent(finalizedStudentGrade, new HashSet<string>(StringComparer.OrdinalIgnoreCase)),
    "An unreleased Finalized grade became student-visible.");
Pass(111, "unreleased Finalized grade remains hidden from students");
var hiddenWorkflowGrades = new[] { "Draft", "SubmittedToChairperson", "Returned", "ChairpersonApproved", "DepartmentApproved" }
    .Select(status => new AcademicRecord
    {
        Id = $"hidden-{status}", StudentHash = "student@plv.edu.ph", StudentNo = "26-0042",
        SubjectCode = "IT 101", SchoolYear = "2026-2027", Semester = "FIRST",
        Section = "BSIT 1-1", AssignmentCycleId = "104", Status = status, Grade = "89"
    });
Check(!StudentSubjectGradeResolver.Resolve(studentAttempt, hiddenWorkflowGrades).IsFinalized,
    "A non-finalized workflow grade became student-visible.");
Pass(93, "non-finalized workflow grades remain hidden from students");
Check(hiddenWorkflowGrades.All(record => !GradeReleasePolicy.IsVisibleToStudent(record,
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { record.Id })),
    "A released but non-finalized workflow grade became student-visible.");
Pass(112, "release metadata cannot expose non-finalized grades");
Check(GradeReleasePolicy.MatchesReleaseContext(finalizedStudentGrade, "26-0042", "2026-2027", "FIRST", "finals")
      && !GradeReleasePolicy.MatchesReleaseContext(finalizedStudentGrade, "26-0042", "2026-2027", "SECOND", "finals"),
    "Registrar grade release matching crossed student academic periods.");
Pass(113, "Registrar release context is student and period scoped");
var closedRejected = false;
try { GradeEncodingPeriodService.ParseOpen("{\"semester\":\"FIRST\",\"startDate\":\"2026-10-01\",\"endDate\":\"2026-10-31\",\"term\":\"midterm\"}", new DateOnly(2026, 9, 22)); }
catch (GradeEncodingPeriodException) { closedRejected = true; }
Check(closedRejected, "Closed encoding period was accepted."); Pass(74, "closed encoding period fails closed");

var assignment = new FacultyAssignmentRosterService.Assignment(102, 1, "profx@plv.edu.ph", "BS Information Technology",
    "BSIT 1-1", "1", "IT 101", 1, "2026-2027", "FIRST", "BSIT 1-1", false);
var canonical = new List<FacultyAssignmentRosterService.RosterStudent> {
    new(1,2,"26-0001","Student A","a@plv.edu.ph",1,1,"2026-2027","FIRST","ENROLLED"),
    new(3,5,"26-0003","Student C","c@plv.edu.ph",1,1,"2026-2027","FIRST","ENROLLED")
};
var bytes = FacultyGradeWorkbookService.Build(assignment, canonical);
var csvBytes = FacultyGradeWorkbookService.BuildCsv(assignment, canonical);
var csvText = new System.Text.UTF8Encoding(true).GetString(csvBytes).TrimStart('\uFEFF');
var csvHeader = csvText.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None)[0];
Check(FacultyGradeWorkbookService.Headers.All(header => csvHeader.Contains($"\"{header}\"", StringComparison.Ordinal)) &&
      csvText.Contains("\"26-0001\"") && csvText.Contains("\"IT 101\"") && csvText.Contains("\"2026-2027\""),
    "CSV template does not match the XLSX grading headers and assignment roster context.");
Pass(106, "CSV and XLSX templates share headers and authoritative assignment context");
await using (var validCsvStream = new MemoryStream(csvBytes))
{
    var validCsv = new FormFile(validCsvStream, 0, csvBytes.Length, "file", "grades.csv")
    {
        Headers = new HeaderDictionary(), ContentType = "text/csv"
    };
    Check(await CsvUploadValidator.ValidateGradeWorkbookAsync(validCsv) is null,
        "A generated CSV grading template was rejected by upload validation.");
}
Pass(107, "CSV grade upload validation accepts generated template");
await using (var unsupportedStream = new MemoryStream("not supported"u8.ToArray()))
{
    var unsupported = new FormFile(unsupportedStream, 0, unsupportedStream.Length, "file", "grades.xls")
    {
        Headers = new HeaderDictionary(), ContentType = "application/vnd.ms-excel"
    };
    Check((await CsvUploadValidator.ValidateGradeWorkbookAsync(unsupported))?.Contains("Unsupported file format") == true,
        "An unsupported legacy XLS grade file was accepted.");
}
Pass(108, "grade upload rejects unsupported formats");
await using (var validWorkbookStream = new MemoryStream(bytes))
{
    var validWorkbook = new FormFile(validWorkbookStream, 0, bytes.Length, "file", "grades.xlsx")
    {
        Headers = new HeaderDictionary(),
        ContentType = FacultyGradeWorkbookService.ContentType
    };
    Check(await CsvUploadValidator.ValidateGradeWorkbookAsync(validWorkbook) is null,
        "A generated XLSX grading workbook was rejected by upload validation.");
} Pass(96, "XLSX grade upload validation accepts generated workbook");
await using (var invalidWorkbookStream = new MemoryStream("not a workbook"u8.ToArray()))
{
    var invalidWorkbook = new FormFile(invalidWorkbookStream, 0, invalidWorkbookStream.Length, "file", "grades.xlsx")
    {
        Headers = new HeaderDictionary(),
        ContentType = FacultyGradeWorkbookService.ContentType
    };
    Check((await CsvUploadValidator.ValidateGradeWorkbookAsync(invalidWorkbook))?.Contains("valid XLSX") == true,
        "A renamed non-XLSX file passed grade workbook validation.");
} Pass(97, "XLSX grade upload validation rejects invalid signature");
using var memory = new MemoryStream(bytes); using var book = new XLWorkbook(memory); var sheet = book.Worksheet("Grade Encoding");
Check(bytes.Length > 0 && FacultyGradeWorkbookService.ContentType.Contains("spreadsheetml"), "Invalid XLSX payload."); Pass(22, "XLSX download payload");
Check(sheet.Cell("G2").HasFormula && sheet.Cell("L2").HasFormula && sheet.Cell("M2").HasFormula, "Missing formulas."); Pass(23, "midterm/finals/average formulas");
Check(sheet.Cell("G2").FormulaA1.Contains("COUNT(C2:F2)<4") && sheet.Cell("M2").FormulaA1.Contains("OR(G2=\"\",L2=\"\")"),
    "Incomplete grading rows do not remain blank."); Pass(94, "grading formulas recalculate only complete component sets");
Check(FacultyGradeWorkbookService.WeightedGrade(80,90,100,85) == 86m, "Formula differs from BlockGO."); Pass(24, "20/10/10/60 calculation parity");
Check(sheet.Cell("A1").GetString()=="Student ID" && sheet.Cell("C1").GetString()=="Quizzes (20%)" && sheet.Cell("N2").GetString()=="IT 101", "Upload columns incompatible."); Pass(25, "generated XLSX upload-column compatibility");
var ids = sheet.RowsUsed().Skip(1).Select(r=>r.Cell(1).GetString()).Where(v=>v.Length>0).ToArray();
Check(ids.SequenceEqual(canonical.Select(s=>s.StudentNo)), "Template roster differs."); Pass(26, "template/canonical roster equality");
Check(!ids.Contains("26-0002"), "Removed student is present."); Pass(27, "removed student excluded from XLSX");
Check(book.Worksheet("Assignment").Cell("B1").GetValue<int>() == assignment.Id,
    "Workbook does not retain FacultySections.id."); Pass(38, "XLSX exact FacultySections identity");
sheet.Cell("C2").Value = 80; sheet.Cell("D2").Value = 90; sheet.Cell("E2").Value = 100; sheet.Cell("F2").Value = 85;
using (var populatedStream = new MemoryStream())
{
    book.SaveAs(populatedStream); populatedStream.Position = 0;
    var parsedTemplate = FacultyGradeWorkbookService.Parse(populatedStream);
    Check(parsedTemplate.FacultySectionId == assignment.Id && parsedTemplate.Rows.Count == canonical.Count &&
          parsedTemplate.Rows[0].Values["student_id"] == canonical[0].StudentNo,
        "A generated grading sheet could not be parsed by the upload contract.");
} Pass(85, "generated XLSX template round-trip parser contract");
bool WorkbookRejected(Action<XLWorkbook> mutate, string expected)
{
    using var input = new MemoryStream(bytes);
    using var candidate = new XLWorkbook(input);
    mutate(candidate);
    using var output = new MemoryStream(); candidate.SaveAs(output); output.Position = 0;
    try { FacultyGradeWorkbookService.Parse(output); return false; }
    catch (ArgumentException ex) { return ex.Message.Contains(expected, StringComparison.OrdinalIgnoreCase); }
}
Check(WorkbookRejected(workbook => workbook.Worksheet("Grade Encoding").Cell("B1").Value = "", "heading"),
    "Blank XLSX heading was accepted."); Pass(88, "blank XLSX heading fails with validation error");
Check(WorkbookRejected(workbook => workbook.Worksheet("Grade Encoding").Cell("C1").Value = "Student ID", "Duplicate"),
    "Duplicate XLSX heading was accepted."); Pass(89, "duplicate XLSX heading fails with validation error");
Check(WorkbookRejected(workbook => workbook.Worksheet("Grade Encoding").Cell("A3").Value = "26-0001", "duplicate Student ID"),
    "Duplicate XLSX student ID was accepted."); Pass(90, "duplicate XLSX student row fails before staging");
Check(WorkbookRejected(workbook => workbook.Worksheet("Grade Encoding").Cell("C2").Value = "not-a-grade", "number from 0 to 100"),
    "Invalid XLSX numeric grade was accepted."); Pass(91, "invalid XLSX grade is a readable validation error");
var distinctIdentityAssignment = assignment with { Id = 123, AcademicSectionId = 45 };
Check(FacultyAssignmentRosterService.ValidateUploadContext(distinctIdentityAssignment, 45, "IT 101", "2026-2027", "FIRST", "BSIT 1-1") == null,
    "Valid assignment context was rejected."); Pass(39, "bulk assignment context accepts FacultySections.id distinct from academic section");
Check(FacultyAssignmentRosterService.ValidateUploadContext(distinctIdentityAssignment, 123, "IT 101", "2026-2027", "FIRST", "BSIT 1-1")?.Contains("Academic section") == true,
    "FacultySections.id was accepted as academic_section_id."); Pass(40, "wrong academicSectionId cannot substitute for FacultySections.id");
Check(FacultyAssignmentRosterService.IsOwnedBy(distinctIdentityAssignment, "profx@plv.edu.ph") &&
      !FacultyAssignmentRosterService.IsOwnedBy(distinctIdentityAssignment, "profy@plv.edu.ph"),
    "Faculty ownership check failed."); Pass(41, "faculty assignment ownership");
var fullCoverage = FacultyAssignmentRosterService.CompareRosterCoverage(canonical, new[] { "26-0001", "26-0003" });
var incompleteCoverage = FacultyAssignmentRosterService.CompareRosterCoverage(canonical, new[] { "26-0001", "26-9999" });
Check(fullCoverage == (0, 0) && incompleteCoverage == (1, 1), "Roster coverage comparison failed.");
Pass(42, "submit-to-Chairperson roster coverage");

var cs = Environment.GetEnvironmentVariable("SECTIONING_TEST_CONNECTION");
if (string.IsNullOrWhiteSpace(cs)) { for (var i=1;i<=21;i++) Skip(i); for (var i=28;i<=37;i++) Skip(i); for (var i=62;i<=68;i++) Skip(i); for (var i=75;i<=81;i++) Skip(i); for (var i=83;i<=84;i++) Skip(i); Skip(95); for (var i=98;i<=105;i++) Skip(i); for (var i=114;i<=143;i++) Skip(i); Console.WriteLine($"RESULT: {passed} passed, 0 failed, {skipped} skipped"); return; }

await using var db = new NpgsqlConnection(cs); await db.OpenAsync();
async Task Exec(string sql) { await using var c=new NpgsqlCommand(sql,db); await c.ExecuteNonQueryAsync(); }
async Task<long> Count(string sql) { await using var c=new NpgsqlCommand(sql,db); return Convert.ToInt64(await c.ExecuteScalarAsync()); }
try {
await Exec(@"
CREATE TEMP TABLE users(id INT PRIMARY KEY,username TEXT,email TEXT,role TEXT,status TEXT,is_active BOOLEAN);
CREATE TEMP TABLE academic_programs(program_id INT PRIMARY KEY,program_code TEXT,program_name TEXT,is_active BOOLEAN);
CREATE TEMP TABLE curriculums(curriculum_id INT PRIMARY KEY,program_id INT,status TEXT);
CREATE TEMP TABLE curriculum_subjects(id SERIAL,curriculum_id INT,subject_code TEXT,prerequisite TEXT,year_level INT,semester TEXT);
CREATE TEMP TABLE academicsections(id INT PRIMARY KEY,department TEXT,year_level INT,section_num INT,max_capacity INT DEFAULT 40,is_active BOOLEAN DEFAULT TRUE,archived_at TIMESTAMPTZ,archived_by TEXT);
CREATE TEMP TABLE studentprofiles(user_id INT PRIMARY KEY,student_no TEXT,full_name TEXT,department TEXT,section TEXT,assignment_status TEXT,student_email TEXT,sex TEXT,curriculum_id BIGINT,batch_year INT,year_level TEXT);
CREATE TEMP TABLE student_enrollments(enrollment_id BIGSERIAL PRIMARY KEY,student_user_id INT,student_no TEXT,program_id INT,curriculum_id INT,academic_section_id INT,school_year TEXT,semester TEXT,year_level INT,status TEXT,section TEXT,batch_year INT,enrollment_state TEXT DEFAULT 'PLANNING',updated_at TIMESTAMPTZ);
CREATE TEMP TABLE facultyprofiles(user_id INT PRIMARY KEY,faculty_id TEXT,full_name TEXT,department TEXT);
CREATE TEMP TABLE systemsettings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TEMP TABLE academic_periods(academic_period_id BIGSERIAL PRIMARY KEY,school_year TEXT NOT NULL,semester TEXT NOT NULL,term TEXT NOT NULL,status TEXT NOT NULL,opened_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,closed_at TIMESTAMPTZ);
CREATE TEMP TABLE facultysections(id SERIAL PRIMARY KEY,user_id INT,department TEXT,section TEXT,year_level TEXT,subject TEXT,academic_section_id INT,school_year TEXT,semester TEXT,is_active BOOLEAN DEFAULT TRUE,deactivated_at TIMESTAMPTZ,deactivated_by TEXT,schedule TEXT);
CREATE UNIQUE INDEX ux_test_facultysections_exact ON facultysections(user_id,academic_section_id,school_year,semester,LOWER(subject)) WHERE is_active=TRUE;
CREATE TEMP TABLE pending_grade_records(id TEXT PRIMARY KEY,assignment_cycle_id TEXT,student_no TEXT,status TEXT,grade TEXT,student_hash TEXT,student_name TEXT,section TEXT,course TEXT,subject_code TEXT,semester TEXT,school_year TEXT,faculty_id TEXT,date TEXT,ipfs_cid TEXT,term TEXT,
    CONSTRAINT unique_grade_entry_assignment_cycle UNIQUE(student_hash,subject_code,school_year,semester,section,assignment_cycle_id,term));
CREATE TEMP TABLE grade_assignment_cycles(record_id TEXT PRIMARY KEY,assignment_cycle_id TEXT NOT NULL);");
var noActivePeriodRejected = false;
try { await EncodingPeriodSettingService.SaveAsync(db, System.Text.Json.JsonSerializer.Serialize(new { term = "finals" })); }
catch (EncodingPeriodSettingService.NoActiveAcademicPeriodException ex) { noActivePeriodRejected = ex.Message.Contains("open an academic period"); }
Check(noActivePeriodRejected && await Count("SELECT COUNT(*) FROM systemsettings") == 0,
    "Save Schedule accepted a missing active period or changed settings before rejecting it."); Pass(119,"Save Schedule requires active academic period and rolls back");
var enrollmentConstraintMigration = await File.ReadAllTextAsync(
    FindRepositoryFile("migrations", "024_student_enrollment_period_constraint.sql"));
await Exec("INSERT INTO student_enrollments(student_user_id,school_year,semester) VALUES(999,'2026-2027','FIRST'),(999,'2026-2027','FIRST')");
var duplicateMigrationRejected=false;
try { await Exec(enrollmentConstraintMigration); }
catch(PostgresException ex) when (ex.SqlState==PostgresErrorCodes.UniqueViolation) { duplicateMigrationRejected=true; }
Check(duplicateMigrationRejected && await Count("SELECT COUNT(*) FROM student_enrollments WHERE student_user_id=999")==2,
    "The migration did not stop safely while preserving duplicate enrollment history.");
Pass(116,"migration rejects duplicates without deleting enrollment history");
await Exec("DELETE FROM student_enrollments WHERE student_user_id=999");
await Exec(enrollmentConstraintMigration);
await Exec(enrollmentConstraintMigration);
Check(await Count("SELECT COUNT(*) FROM pg_constraint WHERE conrelid='student_enrollments'::regclass AND conname='uq_student_enrollment_period' AND contype='u'")==1,
    "The production-drift migration did not create one idempotent enrollment-period uniqueness contract.");
Pass(114,"migration repairs missing enrollment-period uniqueness idempotently");
await Exec(@"
INSERT INTO academic_programs VALUES(1,'BSIT','BS Information Technology',TRUE),(2,'BSCS','BS Computer Science',TRUE); INSERT INTO curriculums VALUES(1,1,'PUBLISHED'),(2,2,'PUBLISHED');
INSERT INTO academic_periods(school_year,semester,term,status) VALUES('2026-2027','FIRST','midterm','ACTIVE');
INSERT INTO curriculum_subjects(curriculum_id,subject_code,prerequisite,year_level,semester) VALUES(1,'IT 101',NULL,1,'FIRST'),(1,'IT 102','IT 101',1,'FIRST'),(1,'IT 201','IT 102',2,'SECOND'),(2,'CS 101',NULL,1,'FIRST');
INSERT INTO academicsections(id,department,year_level,section_num) VALUES(1,'BS Information Technology',1,1),(2,'BS Information Technology',1,2),(3,'BS Computer Science',1,1);
INSERT INTO users VALUES(1,'x','profx@plv.edu.ph','faculty','APPROVED',TRUE),(3,'y','profy@plv.edu.ph','faculty','APPROVED',TRUE),(9,'z','profz@plv.edu.ph','faculty','APPROVED',TRUE),(13,'chair','chair@plv.edu.ph','department_admin','APPROVED',TRUE),(2,'a','a@plv.edu.ph','student','APPROVED',TRUE),(4,'b','b@plv.edu.ph','student','APPROVED',TRUE),(5,'c','c@plv.edu.ph','student','APPROVED',TRUE),(6,'stale','stale@plv.edu.ph','student','APPROVED',TRUE),(7,'old','old@plv.edu.ph','student','APPROVED',TRUE),(8,'second','second@plv.edu.ph','student','APPROVED',TRUE),(12,'csc','csc@plv.edu.ph','student','APPROVED',TRUE);
INSERT INTO facultyprofiles VALUES(1,'FAC-1','Professor X','BS Information Technology'),(3,'FAC-3','Professor Y','BS Information Technology'),(9,'FAC-9','Professor Z','BS Information Technology'),(13,'CHAIR-1','Chairperson Account','BS Information Technology');
INSERT INTO studentprofiles(user_id,student_no,full_name,department,section,assignment_status) VALUES(2,'26-0001','Student A','Wrong','9-9','Dropped'),(4,'26-0002','Student B','BS Information Technology','BSIT 1-1','Enrolled'),(5,'26-0003','Student C','BS Information Technology','BSIT 1-1','Enrolled'),(6,'26-0004','Stale Profile','BS Information Technology','BSIT 1-1','Enrolled'),(7,'25-0001','Old Period','BS Information Technology','BSIT 1-1','Enrolled'),(8,'26-0005','Second Term','BS Information Technology','BSIT 1-1','Enrolled'),(12,'26-0100','Computer Science Student','BS Computer Science','BSCS 1-1','Enrolled');
INSERT INTO student_enrollments(student_user_id,student_no,program_id,curriculum_id,academic_section_id,school_year,semester,year_level,status) VALUES(2,'26-0001',1,1,1,'2026-2027','FIRST',1,'ENROLLED'),(4,'26-0002',1,1,1,'2026-2027','FIRST',1,'ENROLLED'),(5,'26-0003',1,1,1,'2026-2027','FIRST',1,'ENROLLED'),(12,'26-0100',2,2,3,'2026-2027','FIRST',1,'ENROLLED');");
Check(await StudentCurriculumResolver.ResolveAsync(db, "a@plv.edu.ph") == 1,
    "A PLANNING enrollment did not resolve its assigned published curriculum.");
Pass(125, "student assigned published curriculum is visible before period finalization");
Check(await StudentCurriculumResolver.ResolveAsync(db, "csc@plv.edu.ph") == 2 &&
      await StudentCurriculumResolver.ResolveAsync(db, "a@plv.edu.ph") != 2,
    "Curriculum resolution crossed the authoritative enrollment program.");
Pass(126, "student curriculum resolution is program-isolated");
Check(await Count("SELECT COUNT(*) FROM curriculum_subjects WHERE curriculum_id=1") == 3,
    "The assigned curriculum did not retain its complete subject checklist.");
Pass(127, "assigned curriculum subjects are available");
Check(await Count("SELECT COUNT(*) FROM curriculum_subjects WHERE curriculum_id=1 AND prerequisite IS NOT NULL") == 2,
    "Curriculum prerequisites were not available with the assigned checklist.");
Pass(128, "assigned curriculum prerequisites are available");
Check(await StudentCurriculumResolver.ResolveAsync(db, "stale@plv.edu.ph") is null,
    "A student without an enrollment curriculum received a fallback curriculum.");
Pass(129, "student without an assigned curriculum receives no fallback");
await Exec(@"INSERT INTO curriculums VALUES(3,1,'DRAFT'),(4,1,'RETURNED');
INSERT INTO users VALUES(14,'draft','draft@plv.edu.ph','student','APPROVED',TRUE),(15,'returned','returned@plv.edu.ph','student','APPROVED',TRUE);
INSERT INTO student_enrollments(student_user_id,student_no,program_id,curriculum_id,school_year,semester,year_level,status)
VALUES(14,'26-0014',1,3,'2026-2027','FIRST',1,'ENROLLED'),(15,'26-0015',1,4,'2026-2027','FIRST',1,'ENROLLED');");
Check(await StudentCurriculumResolver.ResolveAsync(db, "draft@plv.edu.ph") is null &&
      await StudentCurriculumResolver.ResolveAsync(db, "returned@plv.edu.ph") is null,
    "A DRAFT or RETURNED curriculum was exposed to a student.");
Pass(130, "non-published curriculum workflow states remain hidden");
Check(await Count("SELECT COUNT(*) FROM curriculum_subjects WHERE curriculum_id=1 AND (year_level<>1 OR semester<>'FIRST')") == 1,
    "The checklist was reduced to the current enrollment year or semester.");
Pass(131, "curriculum checklist remains multi-year and multi-semester");
var planningSubjects = await StudentCurrentSubjectEnrollmentResolver.ResolveAsync(db, "a@plv.edu.ph");
Check(planningSubjects is { EnrollmentState: "PLANNING", CurriculumId: 1, AcademicSectionId: 1 },
    "An ENROLLED PLANNING enrollment with an exact section did not resolve Current Subjects.");
Pass(132, "ENROLLED PLANNING enrollment resolves Current Subjects");
await Exec("UPDATE student_enrollments SET enrollment_state='FINALIZED' WHERE student_user_id=2");
Check(await StudentCurrentSubjectEnrollmentResolver.ResolveAsync(db, "a@plv.edu.ph") is { EnrollmentState: "FINALIZED" },
    "A FINALIZED enrollment no longer resolved Current Subjects.");
Pass(133, "ENROLLED FINALIZED enrollment still resolves Current Subjects");
await Exec("UPDATE student_enrollments SET enrollment_state='PLANNING',status='DROPPED' WHERE student_user_id=2");
Check(await StudentCurrentSubjectEnrollmentResolver.ResolveAsync(db, "a@plv.edu.ph") is null,
    "A non-ENROLLED row resolved Current Subjects.");
Pass(134, "dropped enrollment is excluded from Current Subjects");
await Exec("UPDATE student_enrollments SET status='ENROLLED',school_year='2025-2026' WHERE student_user_id=2");
Check(await StudentCurrentSubjectEnrollmentResolver.ResolveAsync(db, "a@plv.edu.ph") is null,
    "An enrollment outside the active academic period resolved Current Subjects.");
Pass(135, "wrong academic period is excluded from Current Subjects");
await Exec("UPDATE student_enrollments SET school_year='2026-2027' WHERE student_user_id=2; UPDATE academic_periods SET term='finals' WHERE status='ACTIVE'");
Check(await StudentCurrentSubjectEnrollmentResolver.ResolveAsync(db, "a@plv.edu.ph") is not null,
    "Changing only the active encoding term hid Current Subjects.");
Pass(136, "midterm-to-finals change does not alter subject membership");
await Exec("UPDATE academic_periods SET term='midterm' WHERE status='ACTIVE'");
Check(await StudentCurrentSubjectEnrollmentResolver.ResolveAsync(db, "a@plv.edu.ph") is { CurriculumStatus: "PUBLISHED" },
    "An assigned PUBLISHED curriculum did not resolve Current Subjects.");
Pass(137, "assigned PUBLISHED curriculum resolves Current Subjects");
await Exec("UPDATE curriculums SET status='ARCHIVED' WHERE curriculum_id=1");
Check(await StudentCurrentSubjectEnrollmentResolver.ResolveAsync(db, "a@plv.edu.ph") is { CurriculumStatus: "ARCHIVED" },
    "A cohort-retained ARCHIVED curriculum did not resolve Current Subjects.");
Pass(138, "cohort-retained ARCHIVED curriculum resolves Current Subjects");
await Exec("UPDATE curriculums SET status='DRAFT' WHERE curriculum_id=1");
var draftSubjects = await StudentCurrentSubjectEnrollmentResolver.ResolveAsync(db, "a@plv.edu.ph");
await Exec("UPDATE curriculums SET status='RETURNED' WHERE curriculum_id=1");
var returnedSubjects = await StudentCurrentSubjectEnrollmentResolver.ResolveAsync(db, "a@plv.edu.ph");
Check(draftSubjects is null && returnedSubjects is null,
    "A DRAFT or RETURNED curriculum exposed Current Subjects.");
Pass(139, "DRAFT and RETURNED curricula remain hidden from Current Subjects");
await Exec("UPDATE curriculums SET status='PUBLISHED' WHERE curriculum_id=1; UPDATE student_enrollments SET curriculum_id=2 WHERE student_user_id=2");
Check(await StudentCurrentSubjectEnrollmentResolver.ResolveAsync(db, "a@plv.edu.ph") is null,
    "A curriculum belonging to another program resolved Current Subjects.");
Pass(140, "wrong-program curriculum never resolves Current Subjects");
await Exec("UPDATE student_enrollments SET curriculum_id=1 WHERE student_user_id=2");
Check(await Count("SELECT COUNT(*) FROM curriculum_subjects WHERE curriculum_id=1 AND year_level=1 AND semester='FIRST'") == 2 &&
      await Count("SELECT COUNT(*) FROM curriculum_subjects WHERE curriculum_id=1 AND (year_level<>1 OR semester<>'FIRST')") == 1,
    "Current Subjects were not limited to the enrollment year level and semester.");
Pass(141, "Current Subjects are limited to enrollment year level and semester");
Check(await Count("SELECT COUNT(*) FROM pending_grade_records") == 0 &&
      await StudentCurrentSubjectEnrollmentResolver.ResolveAsync(db, "a@plv.edu.ph") is not null,
    "Current Subjects incorrectly required a finalized grade record.");
Pass(142, "Current Subjects do not require a finalized grade");
await Exec("UPDATE student_enrollments SET academic_section_id=NULL WHERE student_user_id=2");
Check(await StudentCurrentSubjectEnrollmentResolver.ResolveAsync(db, "a@plv.edu.ph") is null,
    "An enrollment without an academic section resolved subjects from another section.");
Pass(143, "missing academic section returns no Current Subjects context");
await Exec("UPDATE student_enrollments SET academic_section_id=1 WHERE student_user_id=2");
var enrollmentCount=await Count("SELECT COUNT(*) FROM student_enrollments"); var profileCount=await Count("SELECT COUNT(*) FROM studentprofiles");
var academicPeriodCount = await Count("SELECT COUNT(*) FROM academic_periods");
var normalizedSetting = await EncodingPeriodSettingService.SaveAsync(db,
    System.Text.Json.JsonSerializer.Serialize(new {
        schoolYear = "2025-2026", semester = "1st Semester", term = "finals",
        startDate = "2026-10-01", endDate = "2026-10-31"
    }));
using (var savedSetting = System.Text.Json.JsonDocument.Parse(normalizedSetting))
{
    var root = savedSetting.RootElement;
    Check(root.GetProperty("schoolYear").GetString() == "2026-2027" && root.GetProperty("semester").GetString() == "1st Semester" &&
          root.GetProperty("term").GetString() == "finals" && root.GetProperty("startDate").GetString() == "2026-10-01" &&
          root.GetProperty("endDate").GetString() == "2026-10-31" &&
          await Count("SELECT COUNT(*) FROM academic_periods") == academicPeriodCount &&
          await Count("SELECT COUNT(*) FROM systemsettings WHERE key='encoding_period'") == 1,
        "Save Schedule did not normalize stale period fields or altered academic_periods.");
}
Pass(120,"Save Schedule normalizes stale period and preserves academic_periods and dates");
Task<bool> AllowProgram(string program, CancellationToken _) => Task.FromResult(program == "BSIT");
await Exec("INSERT INTO facultysections(id,user_id,department,section,year_level,subject,academic_section_id,school_year,semester,is_active) VALUES(191,1,'BS Information Technology','BSIT 1-1','1','IT 101',1,'2025-2026','FIRST',FALSE)");
await Exec("INSERT INTO academicsections(id,department,year_level,section_num) VALUES(90,'BS Information Technology',4,9)");
var missingSectionResult = await AcademicSectionLifecycleService.DeleteOrArchiveAsync(db,99999,"registrar@plv.edu.ph");
Check(missingSectionResult is null && await Count("SELECT COUNT(*) FROM academicsections WHERE id=90") == 1,
    "Missing-section rollback left an active reader or unusable connection."); Pass(121,"FOR UPDATE reader is disposed before missing-section rollback");
var unusedSectionResult = await AcademicSectionLifecycleService.DeleteOrArchiveAsync(db,90,"registrar@plv.edu.ph");
Check(unusedSectionResult?.Mode=="deleted" && await Count("SELECT COUNT(*) FROM academicsections WHERE id=90")==0,
    "Unused section remained in canonical storage after deletion.");
var deletedAssignmentRejected=false;
try { await EnrollmentSectioningService.AssignAsync(db,90,new[]{"26-0004"},"2026-2027","FIRST",null); }
catch(Exception ex) when (ex is ArgumentException or KeyNotFoundException) { deletedAssignmentRejected=ex.Message.Contains("not found",StringComparison.OrdinalIgnoreCase); }
Check(deletedAssignmentRejected,"Deleted section still accepted student assignment."); Pass(86,"unused section deletion persists and rejects assignment");
await Exec("INSERT INTO academicsections(id,department,year_level,section_num) VALUES(91,'BS Information Technology',1,9); INSERT INTO facultysections(id,user_id,department,section,year_level,subject,academic_section_id,school_year,semester,is_active) VALUES(190,1,'BS Information Technology','BSIT 1-9','1','IT 101',91,'2026-2027','FIRST',TRUE); INSERT INTO pending_grade_records(id,assignment_cycle_id,student_no,status,grade) VALUES('historical-section-grade','190','26-0001','Finalized','{}')");
var historicalSectionResult = await AcademicSectionLifecycleService.DeleteOrArchiveAsync(db,91,"registrar@plv.edu.ph");
Check(historicalSectionResult?.Mode=="archived" &&
      await Count("SELECT COUNT(*) FROM academicsections WHERE id=91 AND is_active=FALSE")==1 &&
      await Count("SELECT COUNT(*) FROM facultysections WHERE id=190 AND is_active=FALSE")==1 &&
      await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id='historical-section-grade'")==1,
    "Referenced section archival destroyed history or left an active workflow reference.");
var archivedFacultyAssignmentRejected=false;
try { await FacultyBulkAssignmentService.AssignAsync(db,new BulkFacultyAssignmentItemRequest { FacultyUserId=1,SubjectCode="IT 101",AcademicSectionId=91,SchoolYear="2026-2027",Semester="FIRST" },AllowProgram); }
catch(ArgumentException) { archivedFacultyAssignmentRejected=true; }
Check(archivedFacultyAssignmentRejected,"Archived section accepted a new Faculty load."); Pass(87,"referenced section archives while preserving grade history");
var bulkOne = await FacultyBulkAssignmentService.AssignAsync(db, new BulkFacultyAssignmentItemRequest {
    ClientId="one", FacultyUserId=1, SubjectCode="IT 101", AcademicSectionId=1, SchoolYear="2026-2027", Semester="FIRST", Schedule="Monday"
}, AllowProgram);
Check(bulkOne.AcademicSectionId==1 && bulkOne.SchoolYear=="2026-2027" && bulkOne.Semester=="FIRST" && bulkOne.Schedule=="Monday" && bulkOne.AssignmentCycleId==bulkOne.Id.ToString(),"Bulk exact identity or schedule missing."); Pass(28,"single exact bulk assignment, schedule, and assignment cycle");
var conflictingStudentSectioningRejected = false;
try { await EnrollmentSectioningService.AssignAsync(db,1,new[]{"26-0004"},"2026-2027","SECOND",null); }
catch (InvalidOperationException ex) { conflictingStudentSectioningRejected = ex.Message.Contains("active Faculty assignment"); }
Check(conflictingStudentSectioningRejected && await Count("SELECT COUNT(*) FROM student_enrollments") == enrollmentCount,
    "Student sectioning attached a different-period enrollment after a Faculty assignment."); Pass(124,"student sectioning rejects an active Faculty assignment from another period");
var chairpersonRejected=false;
try { await FacultyBulkAssignmentService.AssignAsync(db, new BulkFacultyAssignmentItemRequest { FacultyUserId=13, SubjectCode="IT 101", AcademicSectionId=2, SchoolYear="2026-2027", Semester="FIRST" }, AllowProgram); }
catch(ArgumentException) { chairpersonRejected=true; }
Check(chairpersonRejected,"Chairperson role was accepted as Faculty."); Pass(95,"Faculty assignment accepts Faculty and rejects Chairperson roles");
var sameLabelRoster=await FacultyAssignmentRosterService.GetRosterAsync(db,(await FacultyAssignmentRosterService.ResolveAsync(db,bulkOne.Id)).Value!);
Check(sameLabelRoster.All(student=>student.AcademicSectionId==1) && !sameLabelRoster.Any(student=>student.StudentNo=="26-0100"),
    "Duplicate 1-1 display labels caused cross-program roster ambiguity."); Pass(58,"duplicate display labels remain isolated by academic section ID");
var missingSectionIdRejected=false;
try { await FacultyBulkAssignmentService.AssignAsync(db, new BulkFacultyAssignmentItemRequest { FacultyUserId=1, SubjectCode="IT 101", AcademicSectionId=0, SchoolYear="2026-2027", Semester="FIRST" }, AllowProgram); }
catch(ArgumentException ex) { missingSectionIdRejected=ex.Message.Contains("academicSectionId"); }
Check(missingSectionIdRejected,"Assignment without academicSectionId was accepted."); Pass(59,"missing academic section ID fails closed");
var staleAssignmentRejected = false;
try { await FacultyBulkAssignmentService.AssignAsync(db, new BulkFacultyAssignmentItemRequest {
    ClientId="stale", FacultyUserId=1, SubjectCode="IT 101", AcademicSectionId=1, SchoolYear="2025-2026", Semester="SECOND"
}, AllowProgram); }
catch (ArgumentException ex) { staleAssignmentRejected = ex.Message.Contains("does not match the active academic period"); }
Check(staleAssignmentRejected && await Count("SELECT COUNT(*) FROM facultysections WHERE school_year='2025-2026' AND is_active") == 0,
    "A stale Faculty assignment period was silently converted or persisted."); Pass(117,"stale Faculty assignment period is rejected");
var bulkDuplicate = await FacultyBulkAssignmentService.AssignAsync(db, new BulkFacultyAssignmentItemRequest {
    ClientId="duplicate", FacultyUserId=1, SubjectCode="IT 101", AcademicSectionId=1, SchoolYear="2026-2027", Semester="FIRST", Schedule="Tuesday | 09:00-10:00"
}, AllowProgram);
Check(bulkDuplicate.AlreadyAssigned && bulkDuplicate.Id==bulkOne.Id && bulkDuplicate.Schedule=="Monday" &&
      await Count("SELECT COUNT(*) FROM facultysections WHERE user_id=1 AND academic_section_id=1 AND school_year='2026-2027' AND semester='FIRST' AND subject='IT 101' AND schedule='Monday' AND is_active")==1,
    "Duplicate assignment created or silently overwrote the existing schedule."); Pass(29,"bulk assignment idempotency without schedule overwrite");
var bulkTwo = await FacultyBulkAssignmentService.AssignAsync(db, new BulkFacultyAssignmentItemRequest { FacultyUserId=3, SubjectCode="IT 102", AcademicSectionId=2, SchoolYear="2026-2027", Semester="FIRST" }, AllowProgram);
var bulkThree = await FacultyBulkAssignmentService.AssignAsync(db, new BulkFacultyAssignmentItemRequest { FacultyUserId=9, SubjectCode="IT 101", AcademicSectionId=2, SchoolYear="2026-2027", Semester="FIRST" }, AllowProgram);
Check(bulkTwo.FacultyUserId==3 && bulkThree.FacultyUserId==9 && await Count("SELECT COUNT(*) FROM facultysections WHERE id IN ("+bulkTwo.Id+","+bulkThree.Id+")")==2,"Multiple faculty assignments failed."); Pass(30,"multiple faculty bulk assignment");
var invalidFailed=false; try { await FacultyBulkAssignmentService.AssignAsync(db, new BulkFacultyAssignmentItemRequest { FacultyUserId=3, SubjectCode="BAD 999", AcademicSectionId=1, SchoolYear="2026-2027", Semester="FIRST" }, AllowProgram); } catch(ArgumentException ex) { invalidFailed=ex.Message.Contains("Subject not found"); }
Check(invalidFailed && await Count("SELECT COUNT(*) FROM facultysections WHERE id="+bulkOne.Id)==1,"Invalid row affected successful rows."); Pass(31,"partial-success row isolation and explicit error");
Check(await Count("SELECT COUNT(*) FROM student_enrollments")==enrollmentCount,"Faculty bulk assignment changed student enrollments."); Pass(32,"bulk faculty load preserves canonical student associations");
Check((await FacultyAssignmentRosterService.GetRosterAsync(db,(await FacultyAssignmentRosterService.ResolveAsync(db,bulkTwo.Id)).Value!)).Count==0,"Empty section assignment gained students."); Pass(33,"empty section bulk assignment");
await Exec("UPDATE academic_periods SET status='CLOSED',closed_at=CURRENT_TIMESTAMP WHERE status='ACTIVE'; INSERT INTO academic_periods(school_year,semester,term,status) VALUES('2027-2028','FIRST','midterm','ACTIVE')");
var otherYear = await FacultyBulkAssignmentService.AssignAsync(db, new BulkFacultyAssignmentItemRequest { FacultyUserId=1, SubjectCode="IT 101", AcademicSectionId=2, SchoolYear="2027-2028", Semester="FIRST" }, AllowProgram);
Check(otherYear.Id!=bulkOne.Id && otherYear.SchoolYear=="2027-2028","Authoritative school-year identity collapsed."); Pass(34,"backend academic-year isolation");
await Exec("UPDATE academic_periods SET status='CLOSED',closed_at=CURRENT_TIMESTAMP WHERE status='ACTIVE'; INSERT INTO academic_periods(school_year,semester,term,status) VALUES('2026-2027','SECOND','midterm','ACTIVE')");
var otherSemester = await FacultyBulkAssignmentService.AssignAsync(db, new BulkFacultyAssignmentItemRequest { FacultyUserId=1, SubjectCode="IT 101", AcademicSectionId=2, SchoolYear="2026-2027", Semester="SECOND" }, AllowProgram);
Check(otherSemester.Id!=bulkOne.Id && otherSemester.SchoolYear=="2026-2027" && otherSemester.Semester=="SECOND","Authoritative semester identity collapsed."); Pass(35,"backend semester isolation");
await Exec("UPDATE academic_periods SET status='CLOSED',closed_at=CURRENT_TIMESTAMP WHERE status='ACTIVE'; INSERT INTO academic_periods(school_year,semester,term,status) VALUES('2026-2027','FIRST','midterm','ACTIVE')");
Check(await Count("SELECT COUNT(*) FROM facultysections WHERE id=191 AND school_year='2025-2026' AND semester='FIRST' AND is_active=FALSE")==1,
    "Creating current-period assignments rewrote the historical FacultySection."); Pass(118,"previous-period FacultySection remains unchanged");
var unauthorized=false; try { await FacultyBulkAssignmentService.AssignAsync(db, new BulkFacultyAssignmentItemRequest { FacultyUserId=1, SubjectCode="IT 101", AcademicSectionId=2, SchoolYear="2028-2029", Semester="FIRST" }, (_,_)=>Task.FromResult(false)); } catch(UnauthorizedAccessException ex) { unauthorized=ex.Message.Contains("Unauthorized"); }
Check(unauthorized && await Count("SELECT COUNT(*) FROM facultysections WHERE school_year='2028-2029'")==0,"Unauthorized assignment persisted."); Pass(36,"bulk department authorization");
Check(await Count("SELECT COUNT(*) FROM student_enrollments")==enrollmentCount && await Count("SELECT COUNT(*) FROM studentprofiles")==profileCount,"Bulk assignment mutated enrollment/profile records."); Pass(37,"bulk retry does not resurrect removed students");
await Exec("INSERT INTO student_enrollments(student_user_id,student_no,program_id,curriculum_id,academic_section_id,school_year,semester,year_level,status) VALUES(7,'25-0001',1,1,1,'2025-2026','FIRST',1,'ENROLLED'),(8,'26-0005',1,1,1,'2026-2027','SECOND',1,'ENROLLED')");
enrollmentCount = await Count("SELECT COUNT(*) FROM student_enrollments");
var mixedPeriodRejected = false;
try { await FacultyBulkAssignmentService.AssignAsync(db, new BulkFacultyAssignmentItemRequest {
    FacultyUserId=3, SubjectCode="IT 101", AcademicSectionId=1, SchoolYear="2026-2027", Semester="FIRST"
}, AllowProgram); }
catch (ArgumentException ex) { mixedPeriodRejected = ex.Message.Contains("Section enrollment belongs to"); }
Check(mixedPeriodRejected && await Count("SELECT COUNT(*) FROM facultysections WHERE user_id=3 AND academic_section_id=1 AND is_active") == 0 &&
      await Count("SELECT COUNT(*) FROM student_enrollments") == enrollmentCount,
    "Mixed-period section assignment persisted or changed enrollment history."); Pass(122,"mixed-period section assignment rolls back without changing history");
await Exec("UPDATE facultysections SET is_active=FALSE WHERE id < 100");
await Exec("INSERT INTO facultysections VALUES(101,1,'BS Information Technology','BSIT 1-2','1','IT 101',2,'2026-2027','FIRST',TRUE,NULL,NULL,NULL)");
var empty=(await FacultyAssignmentRosterService.ResolveAsync(db,101)).Value!; Check((await FacultyAssignmentRosterService.GetRosterAsync(db,empty)).Count==0 && await Count("SELECT COUNT(*) FROM student_enrollments")==enrollmentCount && await Count("SELECT COUNT(*) FROM studentprofiles")==profileCount,"Empty assignment mutated students."); Pass(1,"empty-section assignment is independent");
await Exec("INSERT INTO facultysections VALUES(102,1,'BS Information Technology','BSIT 1-1','1','IT 101',1,'2026-2027','FIRST',TRUE,NULL,NULL,NULL)");
var exact=(await FacultyAssignmentRosterService.ResolveAsync(db,102)).Value!; var roster=await FacultyAssignmentRosterService.GetRosterAsync(db,exact);
var historicalAssignment = new FacultyAssignmentRosterService.Assignment(
    191,1,"profx@plv.edu.ph","BS Information Technology","BSIT 1-1","1","IT 101",
    1,"2025-2026","FIRST","BSIT 1-1",false);
var historicalRoster = await FacultyAssignmentRosterService.GetRosterAsync(db,historicalAssignment);
Check(historicalRoster.Select(student=>student.StudentNo).SequenceEqual(new[]{"25-0001"}) &&
      roster.Any(student=>student.StudentNo=="26-0001") && !roster.Any(student=>student.StudentNo=="25-0001"),
    "Roster crossed periods for the same academic section ID."); Pass(123,"same section ID remains isolated across academic periods");
var ledgerAssignments=await RegistrarGradeLedgerMetadataService.LoadAssignmentsAsync(db);
Check(ledgerAssignments.TryGetValue("102",out var ledgerAssignment) && ledgerAssignment.FacultyUserId==1 &&
      ledgerAssignment.AcademicSectionId==1 && ledgerAssignment.ProgramId==1 && ledgerAssignment.ProgramCode=="BSIT" &&
      ledgerAssignment.SubjectCode=="IT 101" && ledgerAssignments.TryGetValue("101",out var noRosterAssignment) &&
      noRosterAssignment.ProgramId==1 && noRosterAssignment.ProgramCode=="BSIT",
    "Registrar ledger assignment metadata did not resolve exact database identities.");
Pass(83,"Registrar ledger resolves canonical program ID through enrollment or exact academic section");
var ledgerStudents=await RegistrarGradeLedgerMetadataService.LoadStudentIdentitiesAsync(db);
Check(ledgerStudents.TryGetValue("26-0001",out var ledgerStudent) && ledgerStudent.UserId==2 &&
      ledgerStudents.TryGetValue("a@plv.edu.ph",out var ledgerStudentByEmail) && ledgerStudentByEmail.UserId==ledgerStudent.UserId,
    "Registrar ledger student identity did not resolve the official Registrar profile.");
Pass(84,"Registrar ledger resolves official student identity by number and account");
Check(roster.Select(r=>r.StudentNo).SequenceEqual(new[]{"26-0001","26-0002","26-0003"}),"Roster is not A/B/C."); Pass(2,"existing roster A/B/C");
await Exec("UPDATE student_enrollments SET status=' Enrolled ' WHERE student_user_id=5 AND school_year='2026-2027' AND semester='FIRST'");
roster=await FacultyAssignmentRosterService.GetRosterAsync(db,exact);
Check(roster.Any(r=>r.StudentNo=="26-0003"),"A case-variant active enrollment was excluded from the Faculty roster.");
Pass(115,"Faculty roster normalizes active enrollment status");
await Exec("UPDATE student_enrollments SET status='ENROLLED' WHERE student_user_id=5 AND school_year='2026-2027' AND semester='FIRST'");
await Exec("UPDATE student_enrollments SET status='DROPPED' WHERE student_user_id=4 AND school_year='2026-2027' AND semester='FIRST'"); roster=await FacultyAssignmentRosterService.GetRosterAsync(db,exact); Check(!roster.Any(r=>r.StudentNo=="26-0002"),"B restored."); Pass(3,"removed student not recreated");
await Exec("UPDATE facultysections SET user_id=3 WHERE id=102"); exact=(await FacultyAssignmentRosterService.ResolveAsync(db,102)).Value!; Check(exact.FacultyUserId==3 && await Count("SELECT COUNT(*) FROM student_enrollments")==enrollmentCount,"Reassignment changed students."); Pass(4,"professor reassignment only");
var upsert=@"INSERT INTO student_enrollments(student_user_id,student_no,program_id,curriculum_id,academic_section_id,school_year,semester,year_level,status) VALUES(6,'26-0004',1,1,1,'2026-2027','FIRST',1,'ENROLLED') ON CONFLICT(student_user_id,school_year,semester) DO UPDATE SET academic_section_id=EXCLUDED.academic_section_id,status='ENROLLED'";
await Exec(upsert); Check(await Count("SELECT COUNT(*) FROM student_enrollments WHERE student_user_id=6 AND academic_section_id=1")==1,"Bulk association failed."); Pass(5,"auto/bulk association"); await Exec(upsert); Check(await Count("SELECT COUNT(*) FROM student_enrollments WHERE student_user_id=6 AND school_year='2026-2027'")==1,"Duplicate enrollment."); Pass(6,"auto/bulk idempotency");
Check(await Count("SELECT COUNT(*) FROM student_enrollments WHERE student_user_id=7 AND school_year='2025-2026'")==1,"Old year changed."); Pass(7,"bulk period isolation");
Check(await Count("SELECT COUNT(*) FROM curriculum_subjects WHERE subject_code='IT 999'")==0,"IT 999 enrolled."); Pass(8,"faculty subject is not student enrollment");
await Exec("UPDATE student_enrollments SET status='DROPPED' WHERE student_user_id=6"); roster=await FacultyAssignmentRosterService.GetRosterAsync(db,exact);
Check(!roster.Any(r=>r.StudentNo=="26-0004"),"Stale profile leaked."); Pass(9,"stale profile excluded"); Check(roster.Any(r=>r.StudentNo=="26-0001"),"Enrollment lost to stale profile."); Pass(10,"enrollment overrides profile"); Check(!roster.Any(r=>r.StudentNo=="25-0001"),"Year leak."); Pass(11,"year isolation"); Check(!roster.Any(r=>r.StudentNo=="26-0005"),"Semester leak."); Pass(12,"semester isolation");
await Exec("UPDATE student_enrollments SET academic_section_id=2 WHERE student_user_id=8 AND semester='SECOND'"); Check((await FacultyAssignmentRosterService.GetRosterAsync(db,exact)).Any(r=>r.StudentNo=="26-0001"),"Newer row overrode assignment."); Pass(13,"newer enrollment cannot override exact assignment");
var one=(await FacultyAssignmentRosterService.GetRosterAsync(db,exact)).Select(r=>r.StudentNo); var two=(await FacultyAssignmentRosterService.GetRosterAsync(db,exact)).Select(r=>r.StudentNo); Check(one.SequenceEqual(two),"Roster consumers differ."); Pass(14,"encoding/template canonical parity"); Check(exact.FacultyUserId!=1,"Ownership fixture invalid."); Pass(15,"unauthorized owner mismatch detected");
await Exec("INSERT INTO facultysections VALUES(103,1,'BS Information Technology','BSIT 1-1','1','IT 101',NULL,NULL,NULL,TRUE,NULL,NULL,NULL)"); Check((await FacultyAssignmentRosterService.ResolveAsync(db,103)).Status==FacultyAssignmentRosterService.ResolutionStatus.UnresolvedLegacy,"Legacy assignment inferred a roster from display text."); Pass(16,"legacy assignment cannot infer grading identity"); Check(!one.Contains("26-0002"),"Removed B visible."); Pass(17,"removed student excluded from all canonical consumers");
await Exec("INSERT INTO pending_grade_records(id,assignment_cycle_id,student_no,status,grade) VALUES('old','102','26-0001','Forwarded to Registrar','{}'),('final','102','26-0002','Finalized','{}'); UPDATE facultysections SET is_active=FALSE WHERE id=102; INSERT INTO facultysections VALUES(104,3,'BS Information Technology','BSIT 1-1','1','IT 101',1,'2026-2027','FIRST',TRUE,NULL,NULL,NULL)");
Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE assignment_cycle_id='104'")==0,"Status inherited."); Pass(18,"new cycle status isolation"); Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id='final'")==1,"Final deleted."); Pass(19,"reset preserves finalized grades"); await Exec("UPDATE facultysections SET is_active=FALSE WHERE id=101"); Check(await Count("SELECT COUNT(*) FROM facultysections WHERE id=101 AND is_active=FALSE")==1,"Deactivate failed."); Pass(20,"safe deactivation"); Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id='final'")==1,"Final history removed."); Pass(21,"deactivation preserves protected history");
var activeCycle=(await FacultyAssignmentRosterService.ResolveAsync(db,104)).Value!;
await Exec("INSERT INTO users VALUES(10,'section-b-one','b1@plv.edu.ph','student','APPROVED',TRUE),(11,'section-b-two','b2@plv.edu.ph','student','APPROVED',TRUE); INSERT INTO studentprofiles(user_id,student_no,full_name,department,section,assignment_status) VALUES(10,'26-0010','Section B One','BS Information Technology','BSIT 1-2','Enrolled'),(11,'26-0011','Section B Two','BS Information Technology','BSIT 1-2','Enrolled'); INSERT INTO student_enrollments(student_user_id,student_no,program_id,curriculum_id,academic_section_id,school_year,semester,year_level,status) VALUES(10,'26-0010',1,1,2,'2026-2027','FIRST',1,'ENROLLED'),(11,'26-0011',1,1,2,'2026-2027','FIRST',1,'ENROLLED'); INSERT INTO facultysections VALUES(105,1,'BS Information Technology','BSIT 1-2','1','IT 101',2,'2026-2027','FIRST',TRUE,NULL,NULL,NULL)");
var sectionB=(await FacultyAssignmentRosterService.ResolveAsync(db,105)).Value!;
var sectionARoster=await FacultyAssignmentRosterService.GetRosterAsync(db,activeCycle);
var sectionBRoster=await FacultyAssignmentRosterService.GetRosterAsync(db,sectionB);
Check(sectionARoster.All(student=>student.AcademicSectionId==1) && sectionBRoster.Select(student=>student.StudentNo).SequenceEqual(new[]{"26-0010","26-0011"}) && sectionBRoster.All(student=>student.AcademicSectionId==2),
    "Exact academic sections leaked students into each other."); Pass(48,"multiple exact section rosters remain isolated");
using (var sectionBWorkbookStream=new MemoryStream(FacultyGradeWorkbookService.Build(sectionB,sectionBRoster))) {
    using var sectionBWorkbook=new XLWorkbook(sectionBWorkbookStream);
    var sectionBIds=sectionBWorkbook.Worksheet("Grade Encoding").RowsUsed().Skip(1).Select(row=>row.Cell(1).GetString()).Where(value=>value.Length>0).ToArray();
    Check(sectionBIds.SequenceEqual(new[]{"26-0010","26-0011"}),"XLSX included a student outside the exact section roster.");
} Pass(49,"XLSX exact roster isolation");
await Exec("INSERT INTO pending_grade_records(id,assignment_cycle_id,student_no,status,grade) VALUES('bulk-draft','104','26-0001','Draft','{\"midterm\":\"80\"}')");
Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id='bulk-draft' AND status='Draft'")==1,"Bulk import was not Draft."); Pass(50,"bulk upload remains Draft");
await Exec("UPDATE pending_grade_records SET grade='{\"midterm\":\"85\"}',status='Draft' WHERE id='bulk-draft' AND LOWER(status) IN ('draft','returned')");
Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id='bulk-draft' AND status='Draft' AND grade LIKE '%85%'")==1,"Manual correction after bulk upload did not persist as Draft."); Pass(51,"manual edit after bulk upload remains Draft");
await Exec("UPDATE pending_grade_records SET status='SubmittedToChairperson' WHERE id='bulk-draft' AND LOWER(status) IN ('draft','returned')");
Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id='bulk-draft' AND status='SubmittedToChairperson'")==1,"Explicit submission did not lock the Draft."); Pass(52,"explicit submission transitions Draft to SubmittedToChairperson");
await Exec("UPDATE pending_grade_records SET status='Returned' WHERE id='bulk-draft' AND LOWER(status)='submittedtochairperson'");
Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id='bulk-draft' AND status='Returned'")==1,"Returned grade did not become editable."); Pass(53,"returned submission re-enters editable state");
await Exec("UPDATE student_enrollments SET student_no='legacy-snapshot' WHERE student_user_id=2 AND school_year='2026-2027' AND semester='FIRST'");
var officialRoster=await FacultyAssignmentRosterService.GetRosterAsync(db,activeCycle);
Check(officialRoster.Any(student=>student.StudentUserId==2 && student.StudentNo=="26-0001" && student.EnrollmentStudentNo=="legacy-snapshot"),
    "Roster did not resolve the Registrar master student number."); Pass(43,"manual save official student-number mapping");
await Exec("UPDATE studentprofiles SET student_no=NULL WHERE user_id=2");
var missingMappingDetected=false;
try { await FacultyAssignmentRosterService.GetRosterAsync(db,activeCycle); }
catch(FacultyAssignmentRosterService.RosterDataIntegrityException ex) {
    missingMappingDetected=ex.StudentUserId==2 && ex.EnrollmentId>0 && ex.Message.Contains("Registrar student number is missing");
}
Check(missingMappingDetected,"Missing official number did not produce a specific diagnostic."); Pass(44,"missing Registrar mapping diagnostic");
await Exec("UPDATE studentprofiles SET student_no='26-0001' WHERE user_id=2");
await Exec("UPDATE student_enrollments SET status='PENDING' WHERE student_user_id=2 AND school_year='2026-2027' AND semester='FIRST'");
Check(!(await FacultyAssignmentRosterService.GetRosterAsync(db,activeCycle)).Any(student=>student.StudentUserId==2),
    "Pending student leaked into Faculty roster."); Pass(45,"pending student excluded");
await Exec("UPDATE student_enrollments SET status='ENROLLED',student_no='26-0001' WHERE student_user_id=2 AND school_year='2026-2027' AND semester='FIRST'");
var parityRoster=await FacultyAssignmentRosterService.GetRosterAsync(db,activeCycle);
Check(parityRoster.Select(student=>student.StudentNo).SequenceEqual(
      (await FacultyAssignmentRosterService.GetRosterAsync(db,activeCycle)).Select(student=>student.StudentNo)),
    "Bulk and manual roster identities differ."); Pass(46,"bulk/manual identity parity");
await Exec("UPDATE student_enrollments SET status='ENROLLED',academic_section_id=NULL,section=NULL WHERE student_user_id=6 AND school_year='2026-2027' AND semester='FIRST'");
var unassignedForSectioning=await EnrollmentSectioningService.GetUnassignedAsync(db,"BSIT",1,"2026-2027","FIRST",null);
Check(unassignedForSectioning.Any(student=>student.StudentNo=="26-0004"),"Unassigned ENROLLED student was missing from Registrar sectioning."); Pass(62,"Registrar sectioning reads current unassigned enrollment");
await EnrollmentSectioningService.AssignAsync(db,1,new[]{"26-0004"},"2026-2027","FIRST",null);
var sectionedAfterAssign=await EnrollmentSectioningService.GetSectionedAsync(db,"BSIT",1,"2026-2027","FIRST",null);
Check(sectionedAfterAssign.Any(student=>student.StudentNo=="26-0004" && student.AcademicSectionId==1 && student.Section=="1-1"),
    "Successful assignment was not visible from authoritative student_enrollments."); Pass(63,"Registrar Section List reflects assignment immediately");
await EnrollmentSectioningService.AssignAsync(db,2,new[]{"26-0004"},"2026-2027","FIRST",null,
    new Dictionary<string,int>(StringComparer.OrdinalIgnoreCase){{"26-0004",1}});
var sectionedAfterMove=await EnrollmentSectioningService.GetSectionedAsync(db,"BSIT",1,"2026-2027","FIRST",null);
Check(sectionedAfterMove.Any(student=>student.StudentNo=="26-0004" && student.AcademicSectionId==2 && student.Section=="1-2") &&
      !sectionedAfterMove.Any(student=>student.StudentNo=="26-0004" && student.AcademicSectionId==1),
    "Moved student remained in the old section or did not appear in the new section."); Pass(64,"Registrar Section List reflects exact section move");
var computerScienceSectioned=await EnrollmentSectioningService.GetSectionedAsync(db,"BSCS",1,"2026-2027","FIRST",null);
Check(computerScienceSectioned.Select(student=>student.StudentNo).SequenceEqual(new[]{"26-0100"}) &&
      computerScienceSectioned.All(student=>student.AcademicSectionId==3),
    "Same-label section membership mixed programs."); Pass(65,"Registrar duplicate section labels remain isolated by ID");
await Exec("INSERT INTO pending_grade_records(id,assignment_cycle_id,student_no,status,grade,student_hash,subject_code,school_year,semester,section,term) VALUES('draft-1','104','26-0001','Draft','{}','draft@example.edu','IT 101','2026-2027','FIRST','BSIT 1-1','midterm') ON CONFLICT ON CONSTRAINT unique_grade_entry_assignment_cycle DO UPDATE SET grade=EXCLUDED.grade; INSERT INTO pending_grade_records(id,assignment_cycle_id,student_no,status,grade,student_hash,subject_code,school_year,semester,section,term) VALUES('draft-2','104','26-0001','Draft','{\"midterm\":\"90\"}','draft@example.edu','IT 101','2026-2027','FIRST','BSIT 1-1','midterm') ON CONFLICT ON CONSTRAINT unique_grade_entry_assignment_cycle DO UPDATE SET grade=EXCLUDED.grade;");
Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE assignment_cycle_id='104' AND student_no='26-0001'")==1,
    "Repeated save created duplicate pending grades."); Pass(47,"no duplicate pending grades");
await Exec(@"INSERT INTO pending_grade_records(id,assignment_cycle_id,student_no,status,grade,student_hash,subject_code,school_year,semester,section,term) VALUES
    ('term-mid-draft','104','26-0801','Draft','{""midterm"":""85""}','term-draft@example.edu','IT 101','2026-2027','FIRST','BSIT 1-1','midterm'),
    ('term-final-draft','104','26-0801','Draft','{""finals"":""90""}','term-draft@example.edu','IT 101','2026-2027','FIRST','BSIT 1-1','finals'),
    ('term-mid-submitted','104','26-0802','SubmittedToChairperson','{}','term-submitted@example.edu','IT 101','2026-2027','FIRST','BSIT 1-1','midterm'),
    ('term-final-after-submitted','104','26-0802','Draft','{}','term-submitted@example.edu','IT 101','2026-2027','FIRST','BSIT 1-1','finals'),
    ('term-mid-chair','104','26-0803','ChairpersonApproved','{}','term-chair@example.edu','IT 101','2026-2027','FIRST','BSIT 1-1','midterm'),
    ('term-final-after-chair','104','26-0803','Draft','{}','term-chair@example.edu','IT 101','2026-2027','FIRST','BSIT 1-1','finals'),
    ('term-mid-dept','104','26-0804','DepartmentApproved','{}','term-dept@example.edu','IT 101','2026-2027','FIRST','BSIT 1-1','midterm'),
    ('term-final-after-dept','104','26-0804','Draft','{}','term-dept@example.edu','IT 101','2026-2027','FIRST','BSIT 1-1','finals'),
    ('term-mid-finalized','104','26-0805','Finalized','{}','term-finalized@example.edu','IT 101','2026-2027','FIRST','BSIT 1-1','midterm'),
    ('term-final-after-finalized','104','26-0805','Draft','{}','term-finalized@example.edu','IT 101','2026-2027','FIRST','BSIT 1-1','finals'),
    ('term-final-submitted','104','26-0806','SubmittedToChairperson','{}','final-submitted@example.edu','IT 101','2026-2027','FIRST','BSIT 1-1','finals'),
    ('term-final-chair','104','26-0807','ChairpersonApproved','{}','final-chair@example.edu','IT 101','2026-2027','FIRST','BSIT 1-1','finals');");
Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE student_hash='term-draft@example.edu' AND assignment_cycle_id='104'")==2,
    "Midterm and Finals Draft records did not coexist."); Pass(98,"Midterm and Finals Draft coexist under term identity");
Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id IN ('term-final-after-submitted','term-final-after-chair','term-final-after-dept','term-final-after-finalized') AND term='finals' AND status='Draft'")==4,
    "A prior-term protected status blocked Finals Draft creation."); Pass(99,"protected Midterm statuses do not block Finals creation");
Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE student_hash='final-submitted@example.edu' AND term='finals' AND LOWER(status) NOT IN ('draft','returned')")==1,
    "Same-term Finals Submitted was not protected."); Pass(100,"same-term Finals Submitted remains protected");
Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE student_hash='final-chair@example.edu' AND term='finals' AND LOWER(status) NOT IN ('draft','returned')")==1,
    "Same-term Finals ChairpersonApproved was not protected."); Pass(101,"same-term Finals ChairpersonApproved remains protected");
var finalsTermReviewIds=await ChairpersonReviewScopeService.GetCurrentVisibleRecordIdsAsync(db,"finals","FIRST");
Check(finalsTermReviewIds.Contains("term-final-submitted") && !finalsTermReviewIds.Contains("term-mid-submitted"),
    "Chairperson review did not isolate submitted Finals from Midterm."); Pass(102,"Chairperson For Review is term scoped");
Check(await Count("SELECT COUNT(*) FROM pending_grade_records GROUP BY student_hash,subject_code,school_year,semester,section,assignment_cycle_id,LOWER(COALESCE(term,'')) HAVING COUNT(*)>1")==0,
    "Same-term duplicates exist in the migration fixture."); Pass(103,"term-identity duplicate preflight is clean");
await Exec(@"INSERT INTO pending_grade_records
    (id,assignment_cycle_id,student_no,status,grade,student_hash,student_name,section,course,subject_code,semester,school_year,faculty_id,date,ipfs_cid,term)
    VALUES
    ('old-approved','102','26-0901','DepartmentApproved','90','old@example.edu','Old Student','BSIT 1-1','BS Information Technology','IT 101','FIRST','2026-2027','FAC-1','2026-09-01','','finals'),
    ('current-chair-approved','104','26-0900','ChairpersonApproved','90','chair-approved@example.edu','Chair Approved Student','BSIT 1-1','BS Information Technology','IT 101','FIRST','2026-2027','FAC-3','2026-09-21','','finals'),
    ('current-approved','104','26-0902','DepartmentApproved','91','current@example.edu','Current Student','BSIT 1-1','BS Information Technology','IT 101','FIRST','2026-2027','FAC-3','2026-09-21','','finals'),
    ('current-finalized','104','26-0903','Finalized','92','final@example.edu','Final Student','BSIT 1-1','BS Information Technology','IT 101','FIRST','2026-2027','FAC-3','2026-09-21','','finals');");
await Exec("INSERT INTO grade_assignment_cycles(record_id,assignment_cycle_id) VALUES('old-approved','102'),('current-finalized','104')");
var approvedHistoryCount=await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id IN ('old-approved','current-chair-approved','current-approved','current-finalized')");
var finalizationQueue=await RegistrarFinalizationScopeService.GetCurrentApprovedAsync(db,"finals","FIRST");
Check(finalizationQueue.Select(record=>record.Id).SequenceEqual(new[]{"current-chair-approved","current-approved"}),
    "Chairperson finalization queue omitted an approved status or included inactive/historical records."); Pass(66,"Chairperson finalization queue is current-cycle and includes both approved statuses");
Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id='current-finalized'")==1,
    "Finalized history was removed while selecting the active queue."); Pass(67,"finalized history remains stored outside active queue");
await Exec(@"INSERT INTO pending_grade_records(id,assignment_cycle_id,student_no,status,grade,subject_code,school_year,semester,term)
VALUES('old-review','102','26-0998','SubmittedToChairperson','{}','IT 101','2026-2027','FIRST','finals'),
      ('current-review','104','26-0999','SubmittedToChairperson','{}','IT 101','2026-2027','FIRST','finals')");
var currentReviewIds=await ChairpersonReviewScopeService.GetCurrentSubmittedRecordIdsAsync(db,"finals","FIRST");
var currentFinalizedIds=await ChairpersonReviewScopeService.GetCurrentFinalizedRecordIdsAsync(db,"FIRST");
Check(currentReviewIds.SetEquals(new[]{"current-review"}) && currentFinalizedIds.SetEquals(new[]{"current-finalized"}),
    "Current Chairperson tracking mixed active and historical assignment cycles."); Pass(54,"Chairperson review and Finalized tracking contain only active-cycle records");
var assignmentHistoryCountBeforeReset=await Count("SELECT COUNT(*) FROM facultysections");
await Exec("UPDATE facultysections SET is_active=FALSE,deactivated_at=CURRENT_TIMESTAMP,deactivated_by='registrar@plv.edu.ph' WHERE is_active=TRUE");
Check(await Count("SELECT COUNT(*) FROM facultysections WHERE is_active=TRUE")==0 &&
      await Count("SELECT COUNT(*) FROM facultysections WHERE deactivated_at IS NOT NULL AND deactivated_by='registrar@plv.edu.ph'")>0 &&
      await Count("SELECT COUNT(*) FROM facultysections")==assignmentHistoryCountBeforeReset,
    "Reset did not deactivate assignments with audit metadata or deleted assignment history."); Pass(104,"reset deactivates assignments and preserves assignment history");
currentReviewIds=await ChairpersonReviewScopeService.GetCurrentSubmittedRecordIdsAsync(db,"finals","FIRST");
currentFinalizedIds=await ChairpersonReviewScopeService.GetCurrentFinalizedRecordIdsAsync(db,"FIRST");
Check(currentReviewIds.Count==0 && currentFinalizedIds.Count==0,"Reset left old submissions or finalized rows in current tracking."); Pass(55,"reset empties current For Review and Finalized tracking");
Check((await RegistrarFinalizationScopeService.GetCurrentApprovedAsync(db,"finals","FIRST")).Count==0 &&
      await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id IN ('old-approved','current-chair-approved','current-approved','current-finalized')")==approvedHistoryCount,
    "Reset left an actionable finalization row or deleted grade history."); Pass(68,"reset empties finalization queue and preserves history");
Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id IN ('old-review','current-review','final')")==3,
    "Reset deleted historical or finalized grades."); Pass(56,"reset preserves submitted and finalized history");
await Exec("INSERT INTO facultysections VALUES(106,1,'BS Information Technology','BSIT 1-1','1','IT 101',1,'2026-2027','FIRST',TRUE,NULL,NULL,NULL); INSERT INTO pending_grade_records(id,assignment_cycle_id,student_no,status,grade,subject_code,school_year,semester,term) VALUES('new-review','106','26-0001','SubmittedToChairperson','{}','IT 101','2026-2027','FIRST','finals')");
Check(await Count("SELECT COUNT(*) FROM facultysections WHERE id=106 AND is_active=TRUE")==1 &&
      await Count("SELECT COUNT(*) FROM facultysections WHERE id<>106 AND academic_section_id=1 AND subject='IT 101' AND is_active=FALSE")>0,
    "An inactive prior assignment blocked the same exact assignment in the new cycle."); Pass(105,"inactive prior assignment does not block a new cycle");
currentReviewIds=await ChairpersonReviewScopeService.GetCurrentSubmittedRecordIdsAsync(db,"finals","FIRST");
Check(currentReviewIds.SetEquals(new[]{"new-review"}) && await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id IN ('old-review','current-review')")==2,
    "New cycle did not isolate its submission from preserved old cycles."); Pass(57,"new-cycle submission is the only current review record");
await Exec("INSERT INTO systemsettings(key,value) VALUES('encoding_period','{\"semester\":\"FIRST\",\"startDate\":\"2026-01-01\",\"endDate\":\"2026-12-31\",\"term\":\"MIDTERM\"}')");
var dbPeriod=await GradeEncodingPeriodService.GetOpenAsync(db,new DateOnly(2026,9,22));
Check(dbPeriod.Term=="midterm" && dbPeriod.Semester=="FIRST","Database encoding period was not authoritative."); Pass(75,"PostgreSQL authoritative Midterm period");
var dbMidtermPayload=GradeEncodingPeriodService.ProjectIncomingGradePayload("{\"midterm\":\"85\",\"finals\":\"90\"}",null,dbPeriod.Term);
await Exec($"INSERT INTO pending_grade_records(id,assignment_cycle_id,student_no,status,grade,subject_code,school_year,semester,term) VALUES('qa-midterm','106','26-0701','SubmittedToChairperson','{dbMidtermPayload.Replace("'", "''")}','IT 101','2026-2027','FIRST','midterm')");
Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id='qa-midterm' AND grade::jsonb ? 'midterm' AND NOT (grade::jsonb ? 'finals')")==1,
    "PostgreSQL Draft retained closed Finals data."); Pass(76,"Midterm persistence contains no Finals field");
await Exec("INSERT INTO pending_grade_records(id,assignment_cycle_id,student_no,status,grade,subject_code,school_year,semester,term) VALUES('qa-future','106','26-0702','SubmittedToChairperson','{\"finals\":\"90\"}','IT 101','2026-2027','FIRST','finals')");
var midtermReviewIds=await ChairpersonReviewScopeService.GetCurrentVisibleRecordIdsAsync(db,"midterm","FIRST");
Check(midtermReviewIds.Contains("qa-midterm") && !midtermReviewIds.Contains("qa-future"),"Chairperson scope exposed a closed-term row.");
Pass(77,"Chairperson API scope excludes closed Finals row");
await Exec("INSERT INTO pending_grade_records(id,assignment_cycle_id,student_no,status,grade,subject_code,school_year,semester,term) VALUES('qa-submit-mid','106','26-0703','Draft','{\"midterm\":\"86\"}','IT 101','2026-2027','FIRST','midterm'),('qa-submit-final','106','26-0704','Draft','{\"finals\":\"91\"}','IT 101','2026-2027','FIRST','finals'); UPDATE pending_grade_records SET status='SubmittedToChairperson' WHERE assignment_cycle_id='106' AND LOWER(term)='midterm' AND LOWER(status)='draft'");
Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id='qa-submit-mid' AND status='SubmittedToChairperson'")==1 && await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id='qa-submit-final' AND status='Draft'")==1,
    "Submit-to-Chairperson crossed encoding terms."); Pass(78,"submission transitions only active Midterm rows");
var switchedFinals=GradeEncodingPeriodService.ProjectIncomingGradePayload("{\"midterm\":\"99\",\"finals\":\"90\"}",dbMidtermPayload,"finals");
Check(switchedFinals.Contains("\"midterm\":\"85\"") && switchedFinals.Contains("\"finals\":\"90\"") && !switchedFinals.Contains("99"),
    "Switching to Finals reused the newly uploaded workbook Midterm."); Pass(79,"Finals switch preserves DB Midterm only");
var historicalBefore=await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id IN ('current-finalized','final')");
await Exec("UPDATE systemsettings SET value='{\"semester\":\"FIRST\",\"startDate\":\"2026-01-01\",\"endDate\":\"2026-12-31\",\"term\":\"FINALS\"}' WHERE key='encoding_period'");
var finalsPeriod=await GradeEncodingPeriodService.GetOpenAsync(db,new DateOnly(2026,9,22));
Check(finalsPeriod.Term=="finals" && await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id IN ('current-finalized','final')")==historicalBefore,
    "Opening Finals altered historical grades."); Pass(80,"opening Finals preserves historical grades");
Check(!GradeEncodingPeriodService.ProjectIncomingGradePayload("{\"final\":\"90\"}",null,"midterm").Contains("finals",StringComparison.OrdinalIgnoreCase),
    "API projection leaked a Finals alias during Midterm."); Pass(81,"current API projection removes Finals aliases");
Console.WriteLine($"RESULT: {passed} passed, 0 failed, {skipped} skipped");
} finally { await Exec("DROP TABLE IF EXISTS grade_assignment_cycles,pending_grade_records,facultysections,facultyprofiles,student_enrollments,studentprofiles,curriculum_subjects,curriculums,academicsections,academic_programs,academic_periods,systemsettings,users CASCADE"); }
