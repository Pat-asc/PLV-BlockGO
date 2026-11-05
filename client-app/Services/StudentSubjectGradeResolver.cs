using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using BlockGo.Models;

namespace Client_app.Services;

public sealed record StudentSubjectAttempt(
    long EnrollmentId,
    string StudentEmail,
    string StudentNo,
    string SubjectCode,
    string SchoolYear,
    string Semester,
    string Section,
    string AssignmentCycleId,
    string? PreferredGradeRecordId = null);

public sealed record StudentSubjectGradeResolution(
    AcademicRecord? Record,
    decimal? FinalizedGrade,
    string Availability,
    string MatchBasis)
{
    public bool IsFinalized => Record is not null;
}

public static class StudentSubjectGradeResolver
{
    public const string Finalized = "Finalized";
    public const string NotFinalized = "NotFinalized";
    public const string Ambiguous = "Ambiguous";
    public const string LedgerUnavailable = "LedgerUnavailable";

    public static StudentSubjectGradeResolution Resolve(
        StudentSubjectAttempt attempt,
        IEnumerable<AcademicRecord> records,
        bool ledgerAvailable = true)
    {
        if (!ledgerAvailable)
            return new(null, null, LedgerUnavailable, "ledger-unavailable");

        var candidates = records
            .Where(record => string.Equals(record.Status?.Trim(), "Finalized", StringComparison.OrdinalIgnoreCase))
            .Where(record => MatchesStudent(record, attempt.StudentEmail, attempt.StudentNo))
            .Where(record => Same(record.SubjectCode, attempt.SubjectCode))
            .Where(record => SamePeriod(record.SchoolYear, record.Semester, attempt.SchoolYear, attempt.Semester))
            .GroupBy(record => record.Id?.Trim() ?? "", StringComparer.OrdinalIgnoreCase)
            .Select(group => group.OrderByDescending(RecordTimestamp).ThenByDescending(record => record.Id, StringComparer.OrdinalIgnoreCase).First())
            .ToList();

        if (candidates.Count == 0)
            return new(null, null, NotFinalized, "no-finalized-record");

        if (!string.IsNullOrWhiteSpace(attempt.PreferredGradeRecordId))
        {
            var exactRecord = candidates.Where(record => Same(record.Id, attempt.PreferredGradeRecordId)).ToList();
            if (exactRecord.Count == 1) return Matched(exactRecord[0], "record-id");
            if (exactRecord.Count > 1) return new(null, null, Ambiguous, "record-id-ambiguous");
        }

        if (!IsLegacyCycle(attempt.AssignmentCycleId))
        {
            var exactCycle = candidates.Where(record =>
                !IsLegacyCycle(record.AssignmentCycleId) && Same(record.AssignmentCycleId, attempt.AssignmentCycleId)).ToList();
            if (exactCycle.Count == 1) return Matched(exactCycle[0], "assignment-cycle");
            if (exactCycle.Count > 1) return new(null, null, Ambiguous, "assignment-cycle-ambiguous");
        }

        var sameSection = candidates.Where(record => SectionsMatch(record.Section, attempt.Section)).ToList();
        if (sameSection.Count == 1) return Matched(sameSection[0], "section");
        if (sameSection.Count > 1) return new(null, null, Ambiguous, "section-ambiguous");

        var legacy = candidates.Where(record => IsLegacyCycle(record.AssignmentCycleId)).ToList();
        if (candidates.Count == 1 && legacy.Count == 1)
            return Matched(candidates[0], "legacy-unambiguous");

        return new(null, null, Ambiguous, "finalized-records-ambiguous");
    }

    public static bool MatchesStudent(AcademicRecord record, string? studentEmail, string? studentNo)
    {
        var email = studentEmail?.Trim() ?? "";
        var emailAccount = email.Split('@')[0];
        var number = studentNo?.Trim() ?? "";
        var recordIdentities = new[] { record.StudentHash, record.StudentId, record.StudentNo }
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim());
        var expected = new[] { email, emailAccount, number }
            .Where(value => !string.IsNullOrWhiteSpace(value));
        return recordIdentities.Any(identity => expected.Any(value => Same(identity, value)));
    }

    public static decimal? ParseFinalGrade(string? rawGrade)
    {
        if (string.IsNullOrWhiteSpace(rawGrade)) return null;
        if (decimal.TryParse(rawGrade, NumberStyles.Number, CultureInfo.InvariantCulture, out var direct)) return direct;
        try
        {
            using var document = JsonDocument.Parse(rawGrade);
            foreach (var property in new[] { "finalAverage", "finals", "midterm" })
            {
                if (document.RootElement.TryGetProperty(property, out var value) &&
                    decimal.TryParse(value.ToString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed))
                    return parsed;
            }
        }
        catch (JsonException) { }
        return null;
    }

    public static bool SectionsMatch(string? left, string? right)
    {
        static string Token(string? value)
        {
            var normalized = Regex.Replace(value ?? "", @"\s+", " ").Trim();
            var match = Regex.Match(normalized, @"\b([1-4])\s*-\s*(\d+)\b", RegexOptions.IgnoreCase);
            return match.Success ? $"{match.Groups[1].Value}-{int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture)}" : normalized;
        }

        var first = Token(left);
        var second = Token(right);
        return first.Length > 0 && second.Length > 0 && Same(first, second);
    }

    private static StudentSubjectGradeResolution Matched(AcademicRecord record, string basis) =>
        new(record, ParseFinalGrade(record.Grade), Finalized, basis);

    private static bool SamePeriod(string? recordYear, string? recordSemester, string? attemptYear, string? attemptSemester) =>
        string.Equals(GradeAcademicPeriod.SchoolYear(recordYear), GradeAcademicPeriod.SchoolYear(attemptYear), StringComparison.Ordinal) &&
        string.Equals(GradeAcademicPeriod.Semester(recordSemester), GradeAcademicPeriod.Semester(attemptSemester), StringComparison.Ordinal);

    private static bool IsLegacyCycle(string? value) =>
        string.IsNullOrWhiteSpace(value) || Same(value, "legacy");

    private static DateTimeOffset RecordTimestamp(AcademicRecord record) =>
        DateTimeOffset.TryParse(record.Timestamp, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var timestamp)
            ? timestamp
            : DateTimeOffset.MinValue;

    private static bool Same(string? left, string? right) =>
        string.Equals(left?.Trim(), right?.Trim(), StringComparison.OrdinalIgnoreCase);
}
