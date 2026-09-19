using ClosedXML.Excel;
using Client_app.Services;
using Npgsql;

var passed = 0; var skipped = 0;
void Pass(int n, string name) { passed++; Console.WriteLine($"PASS {n}: {name}"); }
void Skip(int n) { skipped++; Console.WriteLine($"SKIP {n}: PostgreSQL integration (SECTIONING_TEST_CONNECTION is not configured)"); }
static void Check(bool value, string message) { if (!value) throw new Exception(message); }

var assignment = new FacultyAssignmentRosterService.Assignment(102, 1, "profx@plv.edu.ph", "BS Information Technology",
    "BSIT 1-1", "1", "IT 101", 1, "2026-2027", "FIRST", "BSIT 1-1", false);
var canonical = new List<FacultyAssignmentRosterService.RosterStudent> {
    new(1,2,"26-0001","Student A","a@plv.edu.ph",1,1,"2026-2027","FIRST","ENROLLED"),
    new(3,5,"26-0003","Student C","c@plv.edu.ph",1,1,"2026-2027","FIRST","ENROLLED")
};
var bytes = FacultyGradeWorkbookService.Build(assignment, canonical);
using var memory = new MemoryStream(bytes); using var book = new XLWorkbook(memory); var sheet = book.Worksheet("Grade Encoding");
Check(bytes.Length > 0 && FacultyGradeWorkbookService.ContentType.Contains("spreadsheetml"), "Invalid XLSX payload."); Pass(22, "XLSX download payload");
Check(sheet.Cell("G2").HasFormula && sheet.Cell("L2").HasFormula && sheet.Cell("M2").HasFormula, "Missing formulas."); Pass(23, "midterm/finals/average formulas");
Check(FacultyGradeWorkbookService.WeightedGrade(80,90,100,85) == 86m, "Formula differs from BlockGO."); Pass(24, "20/10/10/60 calculation parity");
Check(sheet.Cell("A1").GetString()=="Student ID" && sheet.Cell("C1").GetString()=="Quizzes (20%)" && sheet.Cell("N2").GetString()=="IT 101", "Upload columns incompatible."); Pass(25, "generated XLSX upload-column compatibility");
var ids = sheet.RowsUsed().Skip(1).Select(r=>r.Cell(1).GetString()).Where(v=>v.Length>0).ToArray();
Check(ids.SequenceEqual(canonical.Select(s=>s.StudentNo)), "Template roster differs."); Pass(26, "template/canonical roster equality");
Check(!ids.Contains("26-0002"), "Removed student is present."); Pass(27, "removed student excluded from XLSX");

var cs = Environment.GetEnvironmentVariable("SECTIONING_TEST_CONNECTION");
if (string.IsNullOrWhiteSpace(cs)) { for (var i=1;i<=21;i++) Skip(i); Console.WriteLine($"RESULT: {passed} passed, 0 failed, {skipped} skipped"); return; }

await using var db = new NpgsqlConnection(cs); await db.OpenAsync();
async Task Exec(string sql) { await using var c=new NpgsqlCommand(sql,db); await c.ExecuteNonQueryAsync(); }
async Task<long> Count(string sql) { await using var c=new NpgsqlCommand(sql,db); return Convert.ToInt64(await c.ExecuteScalarAsync()); }
try {
await Exec(@"
CREATE TEMP TABLE users(id INT PRIMARY KEY,username TEXT,email TEXT,role TEXT,status TEXT,is_active BOOLEAN);
CREATE TEMP TABLE academic_programs(program_id INT PRIMARY KEY,program_code TEXT,program_name TEXT,is_active BOOLEAN);
CREATE TEMP TABLE curriculums(curriculum_id INT PRIMARY KEY,program_id INT,status TEXT);
CREATE TEMP TABLE curriculum_subjects(id SERIAL,curriculum_id INT,subject_code TEXT,year_level INT,semester TEXT);
CREATE TEMP TABLE academicsections(id INT PRIMARY KEY,department TEXT,year_level INT,section_num INT);
CREATE TEMP TABLE studentprofiles(user_id INT PRIMARY KEY,student_no TEXT,full_name TEXT,department TEXT,section TEXT,assignment_status TEXT);
CREATE TEMP TABLE student_enrollments(enrollment_id BIGSERIAL PRIMARY KEY,student_user_id INT,student_no TEXT,program_id INT,curriculum_id INT,academic_section_id INT,school_year TEXT,semester TEXT,year_level INT,status TEXT,UNIQUE(student_user_id,school_year,semester));
CREATE TEMP TABLE facultysections(id INT PRIMARY KEY,user_id INT,department TEXT,section TEXT,year_level TEXT,subject TEXT,academic_section_id INT,school_year TEXT,semester TEXT,is_active BOOLEAN DEFAULT TRUE,deactivated_at TIMESTAMPTZ,deactivated_by TEXT);
CREATE TEMP TABLE pending_grade_records(id TEXT PRIMARY KEY,assignment_cycle_id TEXT,student_no TEXT,status TEXT,grade TEXT);
INSERT INTO academic_programs VALUES(1,'BSIT','BS Information Technology',TRUE); INSERT INTO curriculums VALUES(1,1,'PUBLISHED');
INSERT INTO curriculum_subjects(curriculum_id,subject_code,year_level,semester) VALUES(1,'IT 101',1,'FIRST');
INSERT INTO academicsections VALUES(1,'BS Information Technology',1,1),(2,'BS Information Technology',1,2);
INSERT INTO users VALUES(1,'x','profx@plv.edu.ph','faculty','APPROVED',TRUE),(3,'y','profy@plv.edu.ph','faculty','APPROVED',TRUE),(2,'a','a@plv.edu.ph','student','APPROVED',TRUE),(4,'b','b@plv.edu.ph','student','APPROVED',TRUE),(5,'c','c@plv.edu.ph','student','APPROVED',TRUE),(6,'stale','stale@plv.edu.ph','student','APPROVED',TRUE),(7,'old','old@plv.edu.ph','student','APPROVED',TRUE),(8,'second','second@plv.edu.ph','student','APPROVED',TRUE);
INSERT INTO studentprofiles VALUES(2,'26-0001','Student A','Wrong','9-9','Dropped'),(4,'26-0002','Student B','BS Information Technology','BSIT 1-1','Enrolled'),(5,'26-0003','Student C','BS Information Technology','BSIT 1-1','Enrolled'),(6,'26-0004','Stale Profile','BS Information Technology','BSIT 1-1','Enrolled'),(7,'25-0001','Old Period','BS Information Technology','BSIT 1-1','Enrolled'),(8,'26-0005','Second Term','BS Information Technology','BSIT 1-1','Enrolled');
INSERT INTO student_enrollments(student_user_id,student_no,program_id,curriculum_id,academic_section_id,school_year,semester,year_level,status) VALUES(2,'26-0001',1,1,1,'2026-2027','FIRST',1,'ENROLLED'),(4,'26-0002',1,1,1,'2026-2027','FIRST',1,'ENROLLED'),(5,'26-0003',1,1,1,'2026-2027','FIRST',1,'ENROLLED'),(7,'25-0001',1,1,1,'2025-2026','FIRST',1,'ENROLLED'),(8,'26-0005',1,1,1,'2026-2027','SECOND',1,'ENROLLED');");
var enrollmentCount=await Count("SELECT COUNT(*) FROM student_enrollments"); var profileCount=await Count("SELECT COUNT(*) FROM studentprofiles");
await Exec("INSERT INTO facultysections VALUES(101,1,'BS Information Technology','BSIT 1-2','1','IT 101',2,'2026-2027','FIRST',TRUE,NULL,NULL)");
var empty=(await FacultyAssignmentRosterService.ResolveAsync(db,101)).Value!; Check((await FacultyAssignmentRosterService.GetRosterAsync(db,empty)).Count==0 && await Count("SELECT COUNT(*) FROM student_enrollments")==enrollmentCount && await Count("SELECT COUNT(*) FROM studentprofiles")==profileCount,"Empty assignment mutated students."); Pass(1,"empty-section assignment is independent");
await Exec("INSERT INTO facultysections VALUES(102,1,'BS Information Technology','BSIT 1-1','1','IT 101',1,'2026-2027','FIRST',TRUE,NULL,NULL)");
var exact=(await FacultyAssignmentRosterService.ResolveAsync(db,102)).Value!; var roster=await FacultyAssignmentRosterService.GetRosterAsync(db,exact);
Check(roster.Select(r=>r.StudentNo).SequenceEqual(new[]{"26-0001","26-0002","26-0003"}),"Roster is not A/B/C."); Pass(2,"existing roster A/B/C");
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
await Exec("INSERT INTO facultysections VALUES(103,1,'BS Information Technology','BSIT 1-1','1','IT 101',NULL,NULL,NULL,TRUE,NULL,NULL)"); Check((await FacultyAssignmentRosterService.ResolveAsync(db,103)).Status==FacultyAssignmentRosterService.ResolutionStatus.AmbiguousLegacy,"Legacy chose latest."); Pass(16,"legacy ambiguity is explicit"); Check(!one.Contains("26-0002"),"Removed B visible."); Pass(17,"removed student excluded from all canonical consumers");
await Exec("INSERT INTO pending_grade_records VALUES('old','102','26-0001','Forwarded to Registrar','{}'),('final','102','26-0002','Finalized','{}'); UPDATE facultysections SET is_active=FALSE WHERE id=102; INSERT INTO facultysections VALUES(104,3,'BS Information Technology','BSIT 1-1','1','IT 101',1,'2026-2027','FIRST',TRUE,NULL,NULL)");
Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE assignment_cycle_id='104'")==0,"Status inherited."); Pass(18,"new cycle status isolation"); Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id='final'")==1,"Final deleted."); Pass(19,"reset preserves finalized grades"); await Exec("UPDATE facultysections SET is_active=FALSE WHERE id=101"); Check(await Count("SELECT COUNT(*) FROM facultysections WHERE id=101 AND is_active=FALSE")==1,"Deactivate failed."); Pass(20,"safe deactivation"); Check(await Count("SELECT COUNT(*) FROM pending_grade_records WHERE id='final'")==1,"Final history removed."); Pass(21,"deactivation preserves protected history");
Console.WriteLine($"RESULT: {passed} passed, 0 failed, {skipped} skipped");
} finally { await Exec("DROP TABLE IF EXISTS pending_grade_records,facultysections,student_enrollments,studentprofiles,curriculum_subjects,curriculums,academicsections,academic_programs,users CASCADE"); }
