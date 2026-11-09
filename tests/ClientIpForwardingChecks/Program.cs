using System.Net;
using Client_app.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

var trustedConfiguration = new ConfigurationBuilder()
    .AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["ForwardedHeaders:ForwardLimit"] = "2",
        ["ForwardedHeaders:KnownNetworks:0"] = "10.76.0.0/14",
        ["ForwardedHeaders:KnownNetworks:1"] = "35.191.0.0/16",
        ["ClientIp:TrustedHeader"] = "CF-Connecting-IP",
        ["ClientIp:TrustedHeaderProxyNetworks"] = "104.16.0.0/13,2606:4700::/32"
    })
    .Build();

await Check("direct IPv4 request", "198.51.100.20", null, null, "198.51.100.20", "http");
await Check("trusted GKE gateway pod preserves the actual user IP", "10.76.3.71", "112.200.236.67", "https", "112.200.236.67", "https");
await Check("verified Cloudflare edge preserves the actual user IP", "35.191.10.9", "104.16.10.20", "https", "112.200.236.67", "https", "112.200.236.67");
await Check("multiple trusted proxy hops", "10.76.4.8", "203.0.113.25, 35.191.10.9", "https", "203.0.113.25", "https");
await Check("spoofed header from untrusted peer", "198.51.100.44", "203.0.113.99", "https", "198.51.100.44", "http");
await Check("untrusted direct client cannot spoof Cloudflare visitor header", "198.51.100.44", null, null, "198.51.100.44", "http", "112.200.236.67");
await Check("direct IPv6 request", "2001:db8::25", null, null, "2001:db8::25", "http");
await Check("IPv4-mapped IPv6 normalization", "::ffff:203.0.113.25", null, null, "203.0.113.25", "http");
await Check("trusted peer without forwarded headers", "10.76.5.3", null, null, "10.76.5.3", "http");

Console.WriteLine("All client IP forwarding checks passed.");

async Task Check(string name, string remoteAddress, string? forwardedFor, string? forwardedProto,
    string expectedAddress, string expectedScheme, string? trustedClientHeader = null)
{
    var options = new ForwardedHeadersOptions();
    ForwardedHeadersConfiguration.Configure(options, trustedConfiguration);

    var context = new DefaultHttpContext();
    context.Connection.RemoteIpAddress = IPAddress.Parse(remoteAddress);
    context.Request.Scheme = "http";
    if (forwardedFor is not null) context.Request.Headers["X-Forwarded-For"] = forwardedFor;
    if (forwardedProto is not null) context.Request.Headers["X-Forwarded-Proto"] = forwardedProto;
    if (trustedClientHeader is not null) context.Request.Headers["CF-Connecting-IP"] = trustedClientHeader;

    string? resolvedAddress = null;
    string? resolvedScheme = null;
    var middleware = new ForwardedHeadersMiddleware(
        next: nextContext =>
        {
            ClientIpResolver.ApplyTrustedClientHeader(nextContext, trustedConfiguration);
            resolvedAddress = ClientIpResolver.Resolve(nextContext);
            resolvedScheme = nextContext.Request.Scheme;
            return Task.CompletedTask;
        },
        loggerFactory: NullLoggerFactory.Instance,
        options: Options.Create(options));

    await middleware.Invoke(context);
    if (!string.Equals(resolvedAddress, expectedAddress, StringComparison.Ordinal) ||
        !string.Equals(resolvedScheme, expectedScheme, StringComparison.Ordinal))
    {
        throw new InvalidOperationException(
            $"{name} failed: expected {expectedAddress}/{expectedScheme}, got {resolvedAddress}/{resolvedScheme}.");
    }

    Console.WriteLine($"PASS: {name}");
}
