using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Client_app.Services;

public sealed class GrafanaSessionTokenService
{
    private const string RequiredRole = "system_admin";
    private readonly byte[] _signingKey;
    private readonly Func<DateTimeOffset> _utcNow;

    public GrafanaSessionTokenService(
        string signingSecret,
        TimeSpan? lifetime = null,
        Func<DateTimeOffset>? utcNow = null)
    {
        if (string.IsNullOrWhiteSpace(signingSecret))
            throw new InvalidOperationException("A Grafana session signing secret is required.");

        _signingKey = SHA256.HashData(Encoding.UTF8.GetBytes(
            $"BlockGo:GrafanaSession:v1\n{signingSecret.Trim()}"));
        Lifetime = lifetime ?? TimeSpan.FromHours(8);
        if (Lifetime <= TimeSpan.Zero || Lifetime > TimeSpan.FromHours(24))
            throw new ArgumentOutOfRangeException(nameof(lifetime), "Grafana session lifetime must be between zero and 24 hours.");
        _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);
    }

    public TimeSpan Lifetime { get; }

    public string Create(string actorEmail)
    {
        var actor = NormalizeActor(actorEmail);
        var now = _utcNow();
        var payload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            version = 1,
            actor,
            role = RequiredRole,
            issuedAt = now.ToUnixTimeSeconds(),
            expiresAt = now.Add(Lifetime).ToUnixTimeSeconds()
        });
        var encodedPayload = Base64UrlEncode(payload);
        var signature = Sign(encodedPayload);
        return $"{encodedPayload}.{Base64UrlEncode(signature)}";
    }

    public bool TryValidate(string? token, out string actorEmail)
    {
        actorEmail = string.Empty;
        if (string.IsNullOrWhiteSpace(token) || token.Length > 4096) return false;

        var parts = token.Split('.', StringSplitOptions.None);
        if (parts.Length != 2 || string.IsNullOrWhiteSpace(parts[0]) || string.IsNullOrWhiteSpace(parts[1])) return false;

        byte[] suppliedSignature;
        try { suppliedSignature = Base64UrlDecode(parts[1]); }
        catch (FormatException) { return false; }
        var expectedSignature = Sign(parts[0]);
        if (suppliedSignature.Length != expectedSignature.Length ||
            !CryptographicOperations.FixedTimeEquals(suppliedSignature, expectedSignature)) return false;

        try
        {
            using var document = JsonDocument.Parse(Base64UrlDecode(parts[0]));
            var root = document.RootElement;
            if (!root.TryGetProperty("version", out var version) || version.GetInt32() != 1 ||
                !root.TryGetProperty("role", out var role) || role.GetString() != RequiredRole ||
                !root.TryGetProperty("actor", out var actorValue) ||
                !root.TryGetProperty("issuedAt", out var issuedAtValue) ||
                !root.TryGetProperty("expiresAt", out var expiresAtValue)) return false;

            var actor = NormalizeActor(actorValue.GetString());
            var now = _utcNow().ToUnixTimeSeconds();
            var issuedAt = issuedAtValue.GetInt64();
            var expiresAt = expiresAtValue.GetInt64();
            if (issuedAt > now + 60 || expiresAt <= now || expiresAt - issuedAt > TimeSpan.FromHours(24).TotalSeconds)
                return false;

            actorEmail = actor;
            return true;
        }
        catch (Exception exception) when (exception is JsonException or FormatException or InvalidOperationException or ArgumentException)
        {
            return false;
        }
    }

    private byte[] Sign(string encodedPayload)
    {
        using var hmac = new HMACSHA256(_signingKey);
        return hmac.ComputeHash(Encoding.UTF8.GetBytes(encodedPayload));
    }

    private static string NormalizeActor(string? actorEmail)
    {
        var actor = (actorEmail ?? string.Empty).Trim().ToLowerInvariant();
        if (actor.Length is 0 or > 255 || !actor.Contains('@') || actor.Any(char.IsControl))
            throw new ArgumentException("A valid System Administrator email is required.", nameof(actorEmail));
        return actor;
    }

    private static string Base64UrlEncode(ReadOnlySpan<byte> value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] Base64UrlDecode(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        padded += (padded.Length % 4) switch { 2 => "==", 3 => "=", 0 => string.Empty, _ => throw new FormatException() };
        return Convert.FromBase64String(padded);
    }
}
