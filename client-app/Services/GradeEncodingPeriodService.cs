using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Npgsql;

namespace Client_app.Services;

public sealed record ActiveGradeEncodingPeriod(
    string Term,
    string Semester,
    DateOnly StartDate,
    DateOnly EndDate);

public sealed class GradeEncodingPeriodException : Exception
{
    public GradeEncodingPeriodException(string message) : base(message) { }
}

public static class GradeEncodingPeriodService
{
    public static async Task<ActiveGradeEncodingPeriod> GetOpenAsync(
        NpgsqlConnection connection,
        DateOnly? today = null,
        CancellationToken cancellationToken = default)
    {
        await using var command = new NpgsqlCommand(
            "SELECT value FROM SystemSettings WHERE key = 'encoding_period' LIMIT 1;", connection);
        var rawValue = (await command.ExecuteScalarAsync(cancellationToken))?.ToString();
        return ParseOpen(rawValue, today ?? InstitutionToday());
    }

    public static ActiveGradeEncodingPeriod ParseOpen(string? rawValue, DateOnly today)
    {
        if (string.IsNullOrWhiteSpace(rawValue))
            throw new GradeEncodingPeriodException("No active encoding period is configured.");

        try
        {
            using var document = JsonDocument.Parse(rawValue);
            var root = document.RootElement;
            var rawTerm = ReadProperty(root, "term");
            var term = NormalizeStrictTerm(rawTerm);
            var semester = GradeAcademicPeriod.Semester(ReadProperty(root, "semester"));
            if (semester == null)
                throw new GradeEncodingPeriodException("The active encoding period has an invalid semester.");

            if (!DateOnly.TryParseExact(ReadProperty(root, "startDate"), "yyyy-MM-dd",
                    CultureInfo.InvariantCulture, DateTimeStyles.None, out var startDate) ||
                !DateOnly.TryParseExact(ReadProperty(root, "endDate"), "yyyy-MM-dd",
                    CultureInfo.InvariantCulture, DateTimeStyles.None, out var endDate))
                throw new GradeEncodingPeriodException("The encoding period is closed because its date range is not configured.");

            if (endDate < startDate)
                throw new GradeEncodingPeriodException("The encoding period has an invalid date range.");
            if (today < startDate || today > endDate)
                throw new GradeEncodingPeriodException("The encoding period is currently closed.");

            return new(term, semester, startDate, endDate);
        }
        catch (GradeEncodingPeriodException)
        {
            throw;
        }
        catch (JsonException)
        {
            throw new GradeEncodingPeriodException("The active encoding period setting is invalid.");
        }
    }

    public static string ProjectIncomingGradePayload(
        string? incomingPayload,
        string? existingPayload,
        string activeTerm)
    {
        activeTerm = NormalizeStrictTerm(activeTerm);
        var incoming = ParsePayload(incomingPayload, activeTerm);
        var existing = ParsePayload(existingPayload, activeTerm);
        var result = new JsonObject();

        if (activeTerm == BlockGo.Services.GradeAcademicTerm.Midterm)
        {
            result["midterm"] = ReadValue(incoming, "midterm", "midterms", "midtermGrade", "midterm_grade");
        }
        else
        {
            var preservedMidterm = ReadValue(existing, "midterm", "midterms", "midtermGrade", "midterm_grade");
            var finals = ReadValue(incoming, "finals", "final", "finalGrade", "final_grade", "finalsGrade", "finals_grade");
            result["midterm"] = preservedMidterm;
            result["finals"] = finals;

            if (TryNumber(preservedMidterm, out var midtermNumber) && TryNumber(finals, out var finalsNumber))
                result["finalAverage"] = ((midtermNumber + finalsNumber) / 2m).ToString("0.##", CultureInfo.InvariantCulture);
            else if (TryNumber(finals, out finalsNumber))
                result["finalAverage"] = finalsNumber.ToString("0.##", CultureInfo.InvariantCulture);
        }

        CopyMetadata(incoming, result, "standing");
        CopyMetadata(incoming, result, "flagged");
        return result.ToJsonString();
    }

    public static bool HasGradeForTerm(string? payload, string activeTerm)
    {
        var parsed = ParsePayload(payload, activeTerm);
        var value = NormalizeStrictTerm(activeTerm) == BlockGo.Services.GradeAcademicTerm.Finals
            ? ReadValue(parsed, "finals", "final", "finalGrade", "final_grade", "finalsGrade", "finals_grade")
            : ReadValue(parsed, "midterm", "midterms", "midtermGrade", "midterm_grade");
        return !string.IsNullOrWhiteSpace(value);
    }

    private static string NormalizeStrictTerm(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        "midterm" or "midterms" => BlockGo.Services.GradeAcademicTerm.Midterm,
        "final" or "finals" => BlockGo.Services.GradeAcademicTerm.Finals,
        _ => throw new GradeEncodingPeriodException("The active encoding period has an invalid term.")
    };

    private static JsonObject ParsePayload(string? payload, string scalarTerm)
    {
        if (string.IsNullOrWhiteSpace(payload)) return new JsonObject();
        if (!payload.TrimStart().StartsWith('{'))
            return new JsonObject { [NormalizeStrictTerm(scalarTerm)] = payload.Trim() };
        try { return JsonNode.Parse(payload)?.AsObject() ?? new JsonObject(); }
        catch { return new JsonObject(); }
    }

    private static string ReadProperty(JsonElement root, string propertyName) =>
        root.TryGetProperty(propertyName, out var value) ? value.ToString() : string.Empty;

    private static string ReadValue(JsonObject source, params string[] aliases)
    {
        foreach (var property in source)
        {
            if (aliases.Any(alias => string.Equals(alias, property.Key, StringComparison.OrdinalIgnoreCase)))
                return property.Value?.ToString()?.Trim('"') ?? string.Empty;
        }
        return string.Empty;
    }

    private static void CopyMetadata(JsonObject source, JsonObject target, string propertyName)
    {
        var match = source.FirstOrDefault(property =>
            string.Equals(property.Key, propertyName, StringComparison.OrdinalIgnoreCase));
        if (match.Value != null) target[propertyName] = match.Value.DeepClone();
    }

    private static bool TryNumber(string? value, out decimal number) =>
        decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out number);

    private static DateOnly InstitutionToday()
    {
        TimeZoneInfo timeZone;
        try { timeZone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Singapore"); }
        catch (TimeZoneNotFoundException) { timeZone = TimeZoneInfo.FindSystemTimeZoneById("Singapore Standard Time"); }
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, timeZone));
    }
}
