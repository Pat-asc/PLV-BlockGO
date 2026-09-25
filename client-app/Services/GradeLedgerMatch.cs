using BlockGo.Models;

namespace BlockGo.Services;

public static class GradeLedgerMatch
{
    public static bool IsSameGrade(AcademicRecord staged, AcademicRecord ledger)
    {
        static bool Same(string? left, string? right) =>
            string.Equals(left?.Trim(), right?.Trim(), StringComparison.OrdinalIgnoreCase);

        return Same(staged.Id, ledger.Id)
            && Same(staged.StudentHash, ledger.StudentHash)
            && Same(staged.StudentNo, ledger.StudentNo)
            && Same(staged.Section, ledger.Section)
            && Same(staged.SubjectCode, ledger.SubjectCode)
            && Same(staged.SchoolYear, ledger.SchoolYear)
            && Same(staged.Semester, ledger.Semester)
            && string.Equals(staged.Grade?.Trim(), ledger.Grade?.Trim(), StringComparison.Ordinal);
    }
}
