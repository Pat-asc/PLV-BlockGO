namespace BlockGo.Services;

public static class GradeAcademicTerm
{
    public const string Midterm = "midterm";
    public const string Finals = "finals";

    public static string Normalize(string? value, string fallback = Midterm)
    {
        var normalized = value?.Trim().ToLowerInvariant();
        if (normalized is "final" or "finals") return Finals;
        if (normalized is "midterm" or "midterms") return Midterm;
        return fallback == Finals ? Finals : Midterm;
    }
}
