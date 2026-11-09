using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

namespace Client_app.Services;

public static class ClientIpResolver
{
    private const string SectionName = "ClientIp";

    public static string? Resolve(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        var address = context.Connection.RemoteIpAddress;
        if (address?.IsIPv4MappedToIPv6 == true)
        {
            address = address.MapToIPv4();
        }

        return address?.ToString();
    }

    public static void ApplyTrustedClientHeader(HttpContext context, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(configuration);

        var proxyAddress = context.Connection.RemoteIpAddress;
        var headerName = configuration[$"{SectionName}:TrustedHeader"]?.Trim();
        var trustedProxyNetworks = configuration[$"{SectionName}:TrustedHeaderProxyNetworks"]?
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (proxyAddress is null || string.IsNullOrWhiteSpace(headerName) || trustedProxyNetworks is not { Length: > 0 })
        {
            return;
        }

        if (proxyAddress.IsIPv4MappedToIPv6)
        {
            proxyAddress = proxyAddress.MapToIPv4();
        }
        if (!trustedProxyNetworks.Select(ParseNetwork).Any(network => network.Contains(proxyAddress)))
        {
            return;
        }

        var headerValue = context.Request.Headers[headerName];
        if (headerValue.Count != 1 || !IPAddress.TryParse(headerValue[0], out var clientAddress))
        {
            return;
        }

        context.Connection.RemoteIpAddress = clientAddress.IsIPv4MappedToIPv6
            ? clientAddress.MapToIPv4()
            : clientAddress;
    }

    private static Microsoft.AspNetCore.HttpOverrides.IPNetwork ParseNetwork(string value) =>
        ForwardedHeadersConfiguration.ParseNetwork(value);
}

public static class ForwardedHeadersConfiguration
{
    private const string SectionName = "ForwardedHeaders";

    public static void Configure(ForwardedHeadersOptions options, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(configuration);

        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.ForwardLimit = configuration.GetValue<int?>($"{SectionName}:ForwardLimit") ?? 2;
        options.RequireHeaderSymmetry = false;

        foreach (var value in configuration.GetSection($"{SectionName}:KnownNetworks").Get<string[]>() ?? [])
        {
            options.KnownNetworks.Add(ParseNetwork(value));
        }

        foreach (var value in configuration.GetSection($"{SectionName}:KnownProxies").Get<string[]>() ?? [])
        {
            if (!IPAddress.TryParse(value, out var address))
            {
                throw new InvalidOperationException($"Invalid trusted proxy address '{value}'.");
            }

            options.KnownProxies.Add(address);
        }
    }

    internal static Microsoft.AspNetCore.HttpOverrides.IPNetwork ParseNetwork(string value)
    {
        var parts = value.Split('/', 2, StringSplitOptions.TrimEntries);
        if (parts.Length != 2 || !IPAddress.TryParse(parts[0], out var address) ||
            !int.TryParse(parts[1], out var prefixLength))
        {
            throw new InvalidOperationException($"Invalid trusted proxy network '{value}'. Expected CIDR notation.");
        }

        var maximumPrefixLength = address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork ? 32 : 128;
        if (prefixLength < 0 || prefixLength > maximumPrefixLength)
        {
            throw new InvalidOperationException($"Invalid prefix length in trusted proxy network '{value}'.");
        }

        return new Microsoft.AspNetCore.HttpOverrides.IPNetwork(address, prefixLength);
    }
}
