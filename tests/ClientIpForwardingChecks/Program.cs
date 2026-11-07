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
        ["ForwardedHeaders:KnownNetworks:0"] = "10.72.0.0/16",
        ["ForwardedHeaders:KnownNetworks:1"] = "10.96.0.0/16",
        ["ForwardedHeaders:KnownNetworks:2"] = "35.191.0.0/16"
    })
    .Build();

await Check("direct IPv4 request", "198.51.100.20", null, null, "198.51.100.20", "http");
await Check("trusted X-Forwarded-For and proto", "10.72.4.8", "203.0.113.25", "https", "203.0.113.25", "https");
await Check("service-range proxy preserves the forwarded client IP", "10.96.2.82", "100.96.2.82", "https", "100.96.2.82", "https");
await Check("multiple trusted proxy hops", "10.72.4.8", "203.0.113.25, 35.191.10.9", "https", "203.0.113.25", "https");
await Check("spoofed header from untrusted peer", "198.51.100.44", "203.0.113.99", "https", "198.51.100.44", "http");
await Check("direct IPv6 request", "2001:db8::25", null, null, "2001:db8::25", "http");
await Check("IPv4-mapped IPv6 normalization", "::ffff:203.0.113.25", null, null, "203.0.113.25", "http");
await Check("trusted peer without forwarded headers", "10.72.9.3", null, null, "10.72.9.3", "http");

Console.WriteLine("All client IP forwarding checks passed.");

async Task Check(string name, string remoteAddress, string? forwardedFor, string? forwardedProto,
    string expectedAddress, string expectedScheme)
{
    var options = new ForwardedHeadersOptions();
    ForwardedHeadersConfiguration.Configure(options, trustedConfiguration);

    var context = new DefaultHttpContext();
    context.Connection.RemoteIpAddress = IPAddress.Parse(remoteAddress);
    context.Request.Scheme = "http";
    if (forwardedFor is not null) context.Request.Headers["X-Forwarded-For"] = forwardedFor;
    if (forwardedProto is not null) context.Request.Headers["X-Forwarded-Proto"] = forwardedProto;

    string? resolvedAddress = null;
    string? resolvedScheme = null;
    var middleware = new ForwardedHeadersMiddleware(
        next: nextContext =>
        {
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
