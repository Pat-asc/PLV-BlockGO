using BlockGo.Models;

namespace Client_app.Services;

public static class GradeReleasePolicy
{
    public static string StudentIdentifier(AcademicRecord record) =>
        new[] { record.StudentHash, record.StudentNo, record.StudentId }
            .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;

    public static string Term(AcademicRecord record) =>
        string.IsNullOrWhiteSpace(record.Term) ? "finals" : record.Term.Trim().ToLowerInvariant();

    public static bool IsVisibleToStudent(AcademicRecord record, IReadOnlySet<string> releasedRecordIds) =>
        !string.IsNullOrWhiteSpace(record.Id)
        && string.Equals(record.Status?.Trim(), "Finalized", StringComparison.OrdinalIgnoreCase)
        && releasedRecordIds.Contains(record.Id);

    public static bool MatchesReleaseContext(
        AcademicRecord record,
        string studentIdentifier,
        string schoolYear,
        string semester,
        string term)
    {
        var identifiers = new[] { record.StudentHash, record.StudentNo, record.StudentId };
        return identifiers.Any(value => string.Equals(value?.Trim(), studentIdentifier?.Trim(), StringComparison.OrdinalIgnoreCase))
            && string.Equals(record.SchoolYear?.Trim(), schoolYear?.Trim(), StringComparison.OrdinalIgnoreCase)
            && string.Equals(record.Semester?.Trim(), semester?.Trim(), StringComparison.OrdinalIgnoreCase)
            && string.Equals(Term(record), term?.Trim(), StringComparison.OrdinalIgnoreCase);
    }
}
