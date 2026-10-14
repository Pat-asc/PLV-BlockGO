namespace Client_app.Services;

public static class YearLevelPolicy
{
    public const short Minimum = 1;
    public const short Maximum = 4;

    public static short Parse(string? value)
    {
        var candidate = (value ?? string.Empty).Trim();
        if (!short.TryParse(candidate, out var yearLevel) || candidate.Contains('.') ||
            yearLevel < Minimum || yearLevel > Maximum)
            throw new ArgumentException($"Year Level must be a whole number from {Minimum} to {Maximum}.");
        return yearLevel;
    }

    public static int Validate(int value)
    {
        if (value < Minimum || value > Maximum)
            throw new ArgumentException($"Year Level must be a whole number from {Minimum} to {Maximum}.");
        return value;
    }
}
