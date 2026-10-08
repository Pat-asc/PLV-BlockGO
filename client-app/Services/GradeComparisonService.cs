using System.Globalization;
using System.Text.Json;
using BlockGo.Models;

namespace Client_app.Services;

public sealed record GradeComparisonResult(
    string? CurrentGrade,
    string? ReferenceGrade,
    string IntegrityStatus,
    string? ReferenceRecordId = null,
    int? ReferenceGradeVersion = null,
    string? ReferenceTransactionId = null,
    string? ReferenceSource = null);

public sealed record GradeComparisonHistoryEntry(
    long Sequence,
    string RecordId,
    string? OldGrade,
    string? NewGrade,
    string? Reason,
    DateTimeOffset Timestamp);

public static class GradeComparisonService
{
    public const string Match = "MATCH";
    public const string Mismatch = "MISMATCH";
    public const string ReferenceNotFound = "REFERENCE_NOT_FOUND";
    public const string ReferenceGradeUnavailable = "REFERENCE_GRADE_UNAVAILABLE";

    public static GradeComparisonResult Compare(
        AcademicRecord current,
        IEnumerable<AcademicRecord> authoritativeRecords,
        IEnumerable<GradeComparisonHistoryEntry>? submissionHistory = null)
    {
        ArgumentNullException.ThrowIfNull(current);
        ArgumentNullException.ThrowIfNull(authoritativeRecords);

        var currentGrade = ComparableGrade(current.Grade, current.Term);
        var reference = authoritativeRecords
            .Where(record => !ReferenceEquals(record, current))
            .Where(record => string.Equals(record.Status?.Trim(), "Finalized", StringComparison.OrdinalIgnoreCase))
            .Where(record => IsSameLogicalRecord(current, record))
            .OrderByDescending(FinalizedVersion)
            .ThenByDescending(record => record.Version)
            .ThenByDescending(record => ParseTimestamp(record.FinalizedAt ?? record.Timestamp))
            .FirstOrDefault();

        if (reference is null)
        {
            var historicalGrade = ResolveSubmissionHistoryReference(current, currentGrade, submissionHistory);
            if (historicalGrade is null)
                return new(currentGrade, null, ReferenceNotFound);

            return new(
                currentGrade,
                historicalGrade,
                currentGrade is not null && GradesEqual(currentGrade, historicalGrade) ? Match : Mismatch,
                current.Id,
                null,
                null,
                "POSTGRES_SUBMISSION_HISTORY");
        }

        var referenceGrade = ComparableGrade(reference.Grade, current.Term);
        if (currentGrade is null || referenceGrade is null)
            return new(currentGrade, referenceGrade, ReferenceGradeUnavailable,
                reference.Id, FinalizedVersion(reference), reference.TransactionId, "FABRIC_FINALIZED");

        return new(
            currentGrade,
            referenceGrade,
            GradesEqual(currentGrade, referenceGrade) ? Match : Mismatch,
            reference.Id,
            FinalizedVersion(reference),
            reference.TransactionId,
            "FABRIC_FINALIZED");
    }

    private static string? ResolveSubmissionHistoryReference(
        AcademicRecord current,
        string? currentGrade,
        IEnumerable<GradeComparisonHistoryEntry>? submissionHistory)
    {
        if (currentGrade is null || submissionHistory is null) return null;

        var entries = submissionHistory
            .Where(entry => string.Equals(entry.RecordId?.Trim(), current.Id?.Trim(), StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(entry => entry.Sequence)
            .ThenByDescending(entry => entry.Timestamp)
            .ToList();

        for (var index = 0; index < entries.Count; index++)
        {
            var newGrade = HistoryGrade(entries[index].NewGrade, current.Term);
            if (newGrade is null || !GradesEqual(currentGrade, newGrade)) continue;

            var oldGrade = HistoryGrade(entries[index].OldGrade, current.Term);
            if (oldGrade is not null) return oldGrade;

            for (var olderIndex = index + 1; olderIndex < entries.Count; olderIndex++)
            {
                var priorNewGrade = HistoryGrade(entries[olderIndex].NewGrade, current.Term);
                if (priorNewGrade is not null) return priorNewGrade;
            }
            return null;
        }

        return null;
    }

    private static string? HistoryGrade(string? value, string? term)
    {
        var normalized = value?.Trim().ToLowerInvariant();
        if (normalized is null or "" or "draft" or "returned" or "submitted" or
            "submittedtochairperson" or "chairpersonapproved" or "departmentapproved" or
            "approved" or "issued" or "corrected" or "finalized")
            return null;
        return ComparableGrade(value, term);
    }

    public static bool IsSameLogicalRecord(AcademicRecord current, AcademicRecord reference)
    {
        if (!StableRecordIdMatches(current, reference)) return false;
        if (!StudentIdentityMatches(current, reference)) return false;
        if (!SameRequired(current.SubjectCode, reference.SubjectCode)) return false;
        if (!SameRequired(current.Section, reference.Section)) return false;
        if (!SameSchoolYear(current.SchoolYear, reference.SchoolYear)) return false;
        if (!SameSemester(current.Semester, reference.Semester)) return false;
        if (!SameWhenBothPresent(current.Program, reference.Program)) return false;
        if (!SameWhenBothPresent(current.AssignmentCycleId, reference.AssignmentCycleId)) return false;
        if (!SameWhenBothPresent(current.Term, reference.Term)) return false;
        return true;
    }

    private static bool StableRecordIdMatches(AcademicRecord current, AcademicRecord reference)
    {
        var currentIds = new[] { current.Id, current.LogicalGradeId }
            .Where(value => !string.IsNullOrWhiteSpace(value));
        var referenceIds = new[] { reference.Id, reference.LogicalGradeId }
            .Where(value => !string.IsNullOrWhiteSpace(value));
        return currentIds.Any(left => referenceIds.Any(right => Same(left, right)));
    }

    private static bool StudentIdentityMatches(AcademicRecord current, AcademicRecord reference)
    {
        var currentIds = new[] { current.StudentNo, current.StudentId, current.StudentHash }
            .Where(value => !string.IsNullOrWhiteSpace(value));
        var referenceIds = new[] { reference.StudentNo, reference.StudentId, reference.StudentHash }
            .Where(value => !string.IsNullOrWhiteSpace(value));
        return currentIds.Any(left => referenceIds.Any(right => Same(left, right)));
    }

    private static bool SameSchoolYear(string? left, string? right)
    {
        var normalizedLeft = GradeAcademicPeriod.SchoolYear(left);
        var normalizedRight = GradeAcademicPeriod.SchoolYear(right);
        return normalizedLeft is not null && normalizedRight is not null
            ? string.Equals(normalizedLeft, normalizedRight, StringComparison.Ordinal)
            : SameRequired(left, right);
    }

    private static bool SameSemester(string? left, string? right)
    {
        var normalizedLeft = GradeAcademicPeriod.Semester(left);
        var normalizedRight = GradeAcademicPeriod.Semester(right);
        return normalizedLeft is not null && normalizedRight is not null
            ? string.Equals(normalizedLeft, normalizedRight, StringComparison.Ordinal)
            : SameRequired(left, right);
    }

    private static bool SameRequired(string? left, string? right) =>
        !string.IsNullOrWhiteSpace(left) && !string.IsNullOrWhiteSpace(right) && Same(left, right);

    private static bool SameWhenBothPresent(string? left, string? right) =>
        string.IsNullOrWhiteSpace(left) || string.IsNullOrWhiteSpace(right) || Same(left, right);

    private static bool Same(string? left, string? right) =>
        string.Equals(left?.Trim(), right?.Trim(), StringComparison.OrdinalIgnoreCase);

    private static int FinalizedVersion(AcademicRecord record) =>
        record.GradeVersion > 0 ? record.GradeVersion : 1;

    private static DateTimeOffset ParseTimestamp(string? value) =>
        DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed)
            ? parsed
            : DateTimeOffset.MinValue;

    private static bool GradesEqual(string left, string right)
    {
        if (decimal.TryParse(left, NumberStyles.Number, CultureInfo.InvariantCulture, out var leftNumber) &&
            decimal.TryParse(right, NumberStyles.Number, CultureInfo.InvariantCulture, out var rightNumber))
            return leftNumber == rightNumber;
        return string.Equals(left.Trim(), right.Trim(), StringComparison.OrdinalIgnoreCase);
    }

    private static string? ComparableGrade(string? payload, string? term)
    {
        if (string.IsNullOrWhiteSpace(payload)) return null;
        var trimmed = payload.Trim();
        if (!trimmed.StartsWith('{')) return NormalizeScalar(trimmed);

        try
        {
            using var document = JsonDocument.Parse(trimmed);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return NormalizeScalar(trimmed);

            var normalizedTerm = term?.Trim().ToLowerInvariant();
            var preferred = normalizedTerm == "finals"
                ? new[] { "finals", "final", "finalAverage", "grade" }
                : new[] { "midterm", "grade", "finalAverage", "final" };
            foreach (var name in preferred)
                if (TryGetProperty(root, name, out var value))
                    return NormalizeElement(value);
            return null;
        }
        catch (JsonException)
        {
            return NormalizeScalar(trimmed);
        }
    }

    private static bool TryGetProperty(JsonElement root, string name, out JsonElement value)
    {
        foreach (var property in root.EnumerateObject())
            if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase))
            {
                value = property.Value;
                return true;
            }
        value = default;
        return false;
    }

    private static string? NormalizeElement(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Number => NormalizeScalar(value.GetRawText()),
        JsonValueKind.String => NormalizeScalar(value.GetString()),
        _ => null
    };

    private static string? NormalizeScalar(string? value)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrWhiteSpace(trimmed)) return null;
        return trimmed;
    }
}
