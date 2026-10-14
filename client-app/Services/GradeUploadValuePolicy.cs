using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using BlockGo.Services;

namespace Client_app.Services;

public static class GradeUploadValuePolicy
{
    private static readonly IReadOnlyDictionary<string, string> SpecialStandings =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["D"] = "dropped",
            ["UD"] = "unofficially_dropped",
            ["W"] = "withdrawn",
            ["INC"] = "incomplete"
        };

    public static string BuildPayload(string? rawGrade, string? rawMidterm, string? rawFinals, string? term)
    {
        if (string.IsNullOrWhiteSpace(rawGrade) && string.IsNullOrWhiteSpace(rawMidterm) && string.IsNullOrWhiteSpace(rawFinals))
            return string.Empty;
        if (!string.IsNullOrWhiteSpace(rawGrade) && rawGrade.TrimStart().StartsWith('{'))
            return rawGrade;

        var activeTerm = GradeAcademicTerm.Normalize(term);
        var midterm = Normalize(rawMidterm);
        var finals = Normalize(rawFinals);
        var grade = Normalize(rawGrade);

        if (activeTerm == GradeAcademicTerm.Finals && string.IsNullOrWhiteSpace(finals)) finals = grade;
        if (activeTerm == GradeAcademicTerm.Midterm && string.IsNullOrWhiteSpace(midterm)) midterm = grade;

        var activeValue = activeTerm == GradeAcademicTerm.Finals ? finals : midterm;
        var standing = ResolveStanding(activeValue);
        if (standing is not null)
        {
            if (activeTerm == GradeAcademicTerm.Finals) finals = string.Empty;
            else midterm = string.Empty;
        }

        var payload = new JsonObject
        {
            ["midterm"] = midterm,
            ["finals"] = finals
        };
        if (standing is not null) payload["standing"] = standing;

        if (TryNumber(midterm, out var midtermNumber) && TryNumber(finals, out var finalsNumber))
            payload["finalAverage"] = ((midtermNumber + finalsNumber) / 2m).ToString("0.##", CultureInfo.InvariantCulture);
        else if (activeTerm == GradeAcademicTerm.Finals && TryNumber(finals, out finalsNumber))
            payload["finalAverage"] = finalsNumber.ToString("0.##", CultureInfo.InvariantCulture);

        return payload.ToJsonString();
    }

    public static bool HasValueForTerm(string? payload, string? term) =>
        GradeEncodingPeriodService.HasGradeForTerm(payload, GradeAcademicTerm.Normalize(term)) ||
        ResolvePayloadStanding(payload) is not null;

    public static bool TryValidatePayload(string? payload, string? term, out string reason)
    {
        if (ResolvePayloadStanding(payload) is not null)
        {
            reason = string.Empty;
            return true;
        }

        var value = GetTermValue(payload, term);
        if (!decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var numericGrade) ||
            numericGrade is < 60 or > 100)
        {
            reason = $"The {GradeAcademicTerm.Normalize(term)} grade must be a number from 60 to 100, or D, UD, W, or INC.";
            return false;
        }

        reason = string.Empty;
        return true;
    }

    public static bool IsSpecialValue(string? value) => ResolveStanding(value) is not null;

    public static string NormalizeStudentIdentifier(string? value) =>
        new string((value ?? string.Empty)
            .Where(character => character is not ('\uFEFF' or '\u200B' or '\u2060' or '\u00A0'))
            .ToArray())
            .Trim();

    public static string GetTermValue(string? payload, string? term)
    {
        if (string.IsNullOrWhiteSpace(payload)) return string.Empty;
        if (!payload.TrimStart().StartsWith('{')) return payload.Trim();
        try
        {
            using var document = JsonDocument.Parse(payload);
            var propertyName = GradeAcademicTerm.Normalize(term) == GradeAcademicTerm.Finals ? "finals" : "midterm";
            return document.RootElement.TryGetProperty(propertyName, out var value) ? value.ToString().Trim() : string.Empty;
        }
        catch (JsonException)
        {
            return string.Empty;
        }
    }

    private static string Normalize(string? value) => (value ?? string.Empty).Trim();

    private static string? ResolveStanding(string? value) =>
        SpecialStandings.TryGetValue(Normalize(value), out var standing) ? standing : null;

    private static string? ResolvePayloadStanding(string? payload)
    {
        if (string.IsNullOrWhiteSpace(payload) || !payload.TrimStart().StartsWith('{'))
            return ResolveStanding(payload);
        try
        {
            using var document = JsonDocument.Parse(payload);
            if (!document.RootElement.TryGetProperty("standing", out var standing)) return null;
            var normalized = standing.ToString().Trim().ToLowerInvariant();
            return normalized is "dropped" or "unofficially_dropped" or "withdrawn" or "incomplete"
                ? normalized
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static bool TryNumber(string? value, out decimal number) =>
        decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out number);
}
