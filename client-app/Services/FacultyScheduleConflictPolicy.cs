using System.Globalization;
using System.Text.RegularExpressions;

namespace Client_app.Services;

public static class FacultyScheduleConflictPolicy
{
    public sealed record ScheduleBlock(string Day, int StartMinutes, int EndMinutes);

    private static readonly Dictionary<string, string> DayAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["mon"] = "Monday", ["monday"] = "Monday",
        ["tue"] = "Tuesday", ["tues"] = "Tuesday", ["tuesday"] = "Tuesday",
        ["wed"] = "Wednesday", ["wednesday"] = "Wednesday",
        ["thu"] = "Thursday", ["thur"] = "Thursday", ["thurs"] = "Thursday", ["thursday"] = "Thursday",
        ["fri"] = "Friday", ["friday"] = "Friday",
        ["sat"] = "Saturday", ["saturday"] = "Saturday",
        ["sun"] = "Sunday", ["sunday"] = "Sunday",
    };

    private static readonly Regex BlockPattern = new(
        @"^(?<days>[^|]+)\|\s*(?<start>\d{1,2}:\d{2}(?:\s*[AP]M)?)\s*[-\u2013\u2014]\s*(?<end>\d{1,2}:\d{2}(?:\s*[AP]M)?)$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static IReadOnlyList<ScheduleBlock> Parse(string? value, bool rejectInvalid = true)
    {
        var normalized = Regex.Replace((value ?? string.Empty).Trim(), @"[ \t]+", " ");
        if (normalized.Length == 0) return Array.Empty<ScheduleBlock>();

        var blocks = new List<ScheduleBlock>();
        foreach (var rawBlock in Regex.Split(normalized, @"\s*(?:;|\r?\n)\s*").Where(part => part.Length > 0))
        {
            var match = BlockPattern.Match(rawBlock);
            if (!match.Success || !TryMinutes(match.Groups["start"].Value, out var start) ||
                !TryMinutes(match.Groups["end"].Value, out var end) || start >= end)
            {
                if (rejectInvalid)
                    throw new ArgumentException("Schedule must use Day | HH:mm-HH:mm, with the start time before the end time.");
                continue;
            }

            var days = Regex.Split(match.Groups["days"].Value.Trim(), @"\s*(?:/|,|&|\band\b)\s*",
                RegexOptions.IgnoreCase).Where(day => day.Length > 0).ToArray();
            if (days.Length == 0 || days.Any(day => !DayAliases.ContainsKey(day.Trim())))
            {
                if (rejectInvalid) throw new ArgumentException("Schedule contains an unsupported day.");
                continue;
            }

            blocks.AddRange(days.Select(day => new ScheduleBlock(DayAliases[day.Trim()], start, end)));
        }
        return blocks;
    }

    public static bool Overlaps(string? left, string? right)
    {
        var leftBlocks = Parse(left, false);
        var rightBlocks = Parse(right, false);
        return leftBlocks.Any(first => rightBlocks.Any(second =>
            string.Equals(first.Day, second.Day, StringComparison.OrdinalIgnoreCase) &&
            first.StartMinutes < second.EndMinutes && second.StartMinutes < first.EndMinutes));
    }

    public static string Describe(string section, string subject, string schedule) =>
        $"{section}, {subject}, {Regex.Replace(schedule.Trim(), @"\s*\|\s*", " ")}";

    private static bool TryMinutes(string value, out int minutes)
    {
        minutes = 0;
        var formats = new[] { "H:mm", "HH:mm", "h:mm tt", "hh:mm tt" };
        if (!DateTime.TryParseExact(value.Trim().ToUpperInvariant(), formats, CultureInfo.InvariantCulture,
                DateTimeStyles.AllowWhiteSpaces, out var parsed)) return false;
        minutes = parsed.Hour * 60 + parsed.Minute;
        return true;
    }
}
