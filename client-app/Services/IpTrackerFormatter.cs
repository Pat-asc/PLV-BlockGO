namespace Client_app.Services;

public static class IpTrackerFormatter
{
    public static string Format(long ordinal)
    {
        if (ordinal is < 1 or > 0xFFFFFF)
            throw new ArgumentOutOfRangeException(nameof(ordinal), "IP tracker ordinal is outside the supported anonymized range.");
        return $"100.{(ordinal >> 16) & 255}.{(ordinal >> 8) & 255}.{ordinal & 255}";
    }
}
