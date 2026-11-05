using Client_app.Services;

var now = new DateTimeOffset(2026, 10, 7, 0, 0, 0, TimeSpan.Zero);
var issuer = new GrafanaSessionTokenService("stable-production-secret", TimeSpan.FromHours(8), () => now);
var token = issuer.Create("System-Admin@PLV.edu.ph");

var restartedReplica = new GrafanaSessionTokenService("stable-production-secret", TimeSpan.FromHours(8), () => now.AddHours(1));
Check("session survives replica/restart", restartedReplica.TryValidate(token, out var actor) && actor == "system-admin@plv.edu.ph");

var wrongSecretReplica = new GrafanaSessionTokenService("different-secret", TimeSpan.FromHours(8), () => now.AddHours(1));
Check("untrusted replica/session is rejected", !wrongSecretReplica.TryValidate(token, out _));

var tampered = token[..^1] + (token[^1] == 'A' ? 'B' : 'A');
Check("tampered cookie is rejected", !restartedReplica.TryValidate(tampered, out _));

var expiredReplica = new GrafanaSessionTokenService("stable-production-secret", TimeSpan.FromHours(8), () => now.AddHours(9));
Check("expired cookie is rejected", !expiredReplica.TryValidate(token, out _));

Console.WriteLine("All Grafana session checks passed.");

static void Check(string name, bool passed)
{
    if (!passed) throw new InvalidOperationException($"{name} failed.");
    Console.WriteLine($"PASS: {name}");
}
