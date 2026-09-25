using System.Globalization;
using System.Text.RegularExpressions;

namespace Client_app.Services
{
    public static class GradeAcademicPeriod
    {
        public static string? SchoolYear(string? value)
        {
            var trimmed = (value ?? "").Trim()
                .Replace('\u2010', '-')
                .Replace('\u2011', '-')
                .Replace('\u2012', '-')
                .Replace('\u2013', '-')
                .Replace('\u2014', '-')
                .Replace('\u2015', '-')
                .Replace('\u2212', '-');
            if (Regex.IsMatch(trimmed, @"^\d{4}$") &&
                int.TryParse(trimmed, NumberStyles.None, CultureInfo.InvariantCulture, out var start) && start < 9999)
                return $"{start:0000}-{start + 1:0000}";

            var range = Regex.Match(trimmed, @"^(\d{4})\s*[-/]\s*(\d{4})$");
            if (range.Success && int.Parse(range.Groups[2].Value, CultureInfo.InvariantCulture) ==
                int.Parse(range.Groups[1].Value, CultureInfo.InvariantCulture) + 1)
                return $"{range.Groups[1].Value}-{range.Groups[2].Value}";
            return null;
        }

        public static string? Semester(string? value)
        {
            var normalized = (value ?? "").Trim().ToLowerInvariant().Replace("_", " ").Replace("-", " ");
            return normalized switch
            {
                "first" or "1" or "1st" or "first semester" or "1st semester" => "FIRST",
                "second" or "2" or "2nd" or "second semester" or "2nd semester" => "SECOND",
                "midyear" or "mid year" or "summer" => "MIDYEAR",
                _ => null
            };
        }

        public static string[] SemesterAliases(string semester) => semester switch
        {
            "FIRST" => new[] { "first", "1", "1st", "first semester", "1st semester" },
            "SECOND" => new[] { "second", "2", "2nd", "second semester", "2nd semester" },
            "MIDYEAR" => new[] { "midyear", "mid year", "summer" },
            _ => Array.Empty<string>()
        };
    }
}
