using BlockGo.Models;
using Client_app.Services;

namespace BlockGo.Checks;

public static class StudentSubjectGradeChecks
{
public static void Run()
{
static void Check(bool condition, string message)
{
    if (!condition) throw new Exception(message);
}

static StudentSubjectAttempt Attempt(
    string year = "2026-2027", string semester = "FIRST", string cycle = "20",
    string section = "BSIT 1-1", string? preferredRecord = null) =>
    new(1001, "student@plv.edu.ph", "26-0035", "IT 101", year, semester, section, cycle, preferredRecord);

static AcademicRecord Grade(
    string id, string status = "Finalized", string year = "2026-2027", string semester = "FIRST",
    string cycle = "20", string section = "BSIT 1-1", string grade = "{\"midterm\":\"88\",\"finals\":\"90\",\"finalAverage\":\"89\"}",
    string term = "finals") =>
    new()
    {
        Id = id, StudentHash = "student@plv.edu.ph", StudentNo = "26-0035", StudentId = "26-0035",
        SubjectCode = "IT 101", SchoolYear = year, Semester = semester, Section = section,
        AssignmentCycleId = cycle, Status = status, Grade = grade, Term = term,
        TransactionId = $"tx-{id}", TransactionHash = $"hash-{id}", Timestamp = "2026-09-19T01:00:00Z"
    };

// 1. One finalized subject resolves to the current card.
var oneFinalized = StudentSubjectGradeResolver.Resolve(Attempt(), new[] { Grade("final-1") });
Check(oneFinalized.IsFinalized && oneFinalized.FinalizedGrade == 89m, "1: finalized subject was not resolved.");

// 2. Recreated FacultySections cycle does not hide a completed enrollment attempt.
var recreatedAssignment = StudentSubjectGradeResolver.Resolve(Attempt(cycle: "21"), new[] { Grade("final-old-cycle", cycle: "20") });
Check(recreatedAssignment.IsFinalized && recreatedAssignment.MatchBasis == "section", "2: recreated assignment hid the finalized grade.");

// 3. A historical attempt does not become the grade of a new retake.
var retake = StudentSubjectGradeResolver.Resolve(Attempt(year: "2027-2028", cycle: "30"), new[] { Grade("failed-old", year: "2026-2027", grade: "70") });
Check(!retake.IsFinalized && retake.Availability == StudentSubjectGradeResolver.NotFinalized, "3: old failed attempt attached to a retake.");

// 4. Staged data alone is not finalized.
var staged = StudentSubjectGradeResolver.Resolve(Attempt(), new[] { Grade("draft", status: "Draft") });
Check(!staged.IsFinalized, "4: staged grade was shown as finalized.");

// 5. Department approval is still not registrar finalization.
var departmentApproved = StudentSubjectGradeResolver.Resolve(Attempt(), new[] { Grade("department", status: "DepartmentApproved") });
Check(!departmentApproved.IsFinalized, "5: department-approved grade was shown as finalized.");

// 6. A committed Finalized ledger record carries its grade and transaction.
var committed = StudentSubjectGradeResolver.Resolve(Attempt(), new[] { Grade("commit-valid") });
Check(committed.Record?.TransactionId == "tx-commit-valid" && committed.Availability == StudentSubjectGradeResolver.Finalized,
    "6: committed FinalizeRecord result was not resolved.");

// 7. Duplicate staged entries cannot override the finalized record for the same attempt.
var finalizedWins = StudentSubjectGradeResolver.Resolve(Attempt(), new[]
{
    Grade("draft-a", status: "Draft"), Grade("draft-b", status: "FacultySubmitted"), Grade("final-wins")
});
Check(finalizedWins.Record?.Id == "final-wins", "7: staged duplicate overrode the finalized record.");

// 8. When two finalized cycles exist, the exact current cycle wins without merging states.
var separateCycles = StudentSubjectGradeResolver.Resolve(Attempt(cycle: "22"), new[]
{
    Grade("cycle-21", cycle: "21", grade: "75"), Grade("cycle-22", cycle: "22", grade: "95")
});
Check(separateCycles.Record?.Id == "cycle-22" && separateCycles.FinalizedGrade == 95m,
    "8: different assignment cycles were merged.");

// 9. Same subject code in different school years remains period-specific, including Unicode dashes.
var schoolYear = StudentSubjectGradeResolver.Resolve(Attempt(year: "2026–2027"), new[]
{
    Grade("wrong-year", year: "2025-2026"), Grade("right-year", year: "2026-2027")
});
Check(schoolYear.Record?.Id == "right-year", "9: school-year attempts were conflated.");

// 10. Same subject code in different semesters remains period-specific across aliases.
var semester = StudentSubjectGradeResolver.Resolve(Attempt(semester: "First Semester"), new[]
{
    Grade("wrong-semester", semester: "SECOND"), Grade("right-semester", semester: "1st Semester")
});
Check(semester.Record?.Id == "right-semester", "10: semester attempts were conflated.");

// 11. Legacy records match only when the fallback is unambiguous.
var oneLegacy = StudentSubjectGradeResolver.Resolve(Attempt(cycle: "44", section: "BSIT 9"), new[]
{
    Grade("legacy-one", cycle: "legacy", section: "")
});
Check(oneLegacy.Record?.Id == "legacy-one" && oneLegacy.MatchBasis == "legacy-unambiguous",
    "11a: one safe legacy grade did not resolve.");
var ambiguousLegacy = StudentSubjectGradeResolver.Resolve(Attempt(cycle: "44", section: "BSIT 9"), new[]
{
    Grade("legacy-a", cycle: "legacy", section: ""), Grade("legacy-b", cycle: "legacy", section: "")
});
Check(!ambiguousLegacy.IsFinalized && ambiguousLegacy.Availability == StudentSubjectGradeResolver.Ambiguous,
    "11b: ambiguous legacy grades were attached.");

// 12. A Fabric outage is explicit and never degrades into NotFinalized/Not Yet Available.
var outage = StudentSubjectGradeResolver.Resolve(Attempt(), new[] { Grade("known-finalized") }, ledgerAvailable: false);
Check(!outage.IsFinalized && outage.Availability == StudentSubjectGradeResolver.LedgerUnavailable,
    "12: Fabric outage was reported as no finalized grade.");

// 13. Midterm and Finals are two valid finalized records for one assignment, not a conflict.
var exactCycleTerms = StudentSubjectGradeResolver.Resolve(Attempt(), new[]
{
    Grade("midterm-cycle", grade: "88", term: "midterm"),
    Grade("finals-cycle", grade: "91", term: "finals")
});
Check(exactCycleTerms.Record?.Id == "finals-cycle" && exactCycleTerms.Availability == StudentSubjectGradeResolver.Finalized,
    "13: finalized Midterm and Finals in one assignment were incorrectly marked ambiguous.");

// 14. The same Finals preference applies when a recreated/missing assignment falls back to section identity.
var sectionTerms = StudentSubjectGradeResolver.Resolve(Attempt(cycle: "44"), new[]
{
    Grade("midterm-section", cycle: "43", grade: "87", term: "midterm"),
    Grade("finals-section", cycle: "43", grade: "92", term: "finals")
});
Check(sectionTerms.Record?.Id == "finals-section" && sectionTerms.MatchBasis == "section",
    "14: section fallback treated separate Midterm and Finals as conflicting grades.");

// 15. Two competing Finals records remain ambiguous and require manual reconciliation.
var duplicateFinals = StudentSubjectGradeResolver.Resolve(Attempt(), new[]
{
    Grade("finals-a", grade: "90", term: "finals"),
    Grade("finals-b", grade: "91", term: "finals")
});
Check(!duplicateFinals.IsFinalized && duplicateFinals.Availability == StudentSubjectGradeResolver.Ambiguous,
    "15: competing Finals records were silently selected instead of remaining ambiguous.");

Console.WriteLine("PASS: 15 Student Subject List finalized-grade association scenarios.");
}
}
