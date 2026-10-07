using BlockGo.Models;

namespace Client_app.Services;

public static class GradeRecordMergePolicy
{
    public static List<AcademicRecord> PreferPending(
        IEnumerable<AcademicRecord> records,
        IReadOnlyDictionary<string, AcademicRecord> pendingById,
        Func<AcademicRecord, int> completenessScore) => records
        .GroupBy(record => record.Id, StringComparer.OrdinalIgnoreCase)
        .Select(group => pendingById.TryGetValue(group.Key ?? string.Empty, out var pending)
            ? pending
            : group.OrderByDescending(completenessScore).First())
        .ToList();
}
