using System.Globalization;
using System.Text.RegularExpressions;

namespace Client_app.Services;

public static class StudentNamePolicy
{
    public static string NormalizeDisplay(string? value)
    {
        var collapsed = Regex.Replace((value ?? string.Empty).Trim(), @"\s+", " ");
        if (collapsed.Length == 0) return string.Empty;
        return CultureInfo.InvariantCulture.TextInfo.ToTitleCase(collapsed.ToLowerInvariant());
    }

    public static bool SameStudentId(string? left, string? right) =>
        !string.IsNullOrWhiteSpace(left) && !string.IsNullOrWhiteSpace(right) &&
        string.Equals(left.Trim(), right.Trim(), StringComparison.OrdinalIgnoreCase);
}
