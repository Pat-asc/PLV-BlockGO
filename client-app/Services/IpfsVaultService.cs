using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Client_app.Services;

public interface IIpfsVaultService
{
    Task<string> UploadEncryptedAsync(byte[] content, string fileName, CancellationToken cancellationToken = default);
}

public sealed class IpfsVaultService : IIpfsVaultService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<IpfsVaultService> _logger;

    public IpfsVaultService(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILogger<IpfsVaultService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<string> UploadEncryptedAsync(
        byte[] content,
        string fileName,
        CancellationToken cancellationToken = default)
    {
        if (content.Length == 0) throw new InvalidOperationException("IPFS archive content is empty.");

        var encrypted = Encrypt(content, _configuration["IpfsEncryptionKey"]);
        using var multipart = new MultipartFormDataContent();
        multipart.Add(new ByteArrayContent(encrypted), "file", $"{Path.GetFileName(fileName)}.enc");

        var ipfsHost = Environment.GetEnvironmentVariable("IPFS_HOST") ?? "ipfs0";
        var apiUrl = _configuration["IpfsApiUrl"]
            ?? $"http://{ipfsHost}:5001/api/v0/add?cid-version=1&wrap-with-directory=false";
        using var client = _httpClientFactory.CreateClient();
        client.Timeout = RequestTimeout();
        using var response = await client.PostAsync(apiUrl, multipart, cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException($"IPFS upload was rejected with HTTP {(int)response.StatusCode}.");

        var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
        var cid = ParseCid(responseBody);
        if (string.IsNullOrWhiteSpace(cid))
            throw new InvalidOperationException("IPFS upload completed without returning a CID.");

        await DistributePinAsync(cid, cancellationToken);
        return cid;
    }

    public static byte[] Encrypt(byte[] content, string? configuredKey)
    {
        using var aes = Aes.Create();
        if (string.IsNullOrWhiteSpace(configuredKey))
            throw new InvalidOperationException("IPFS_ENCRYPTION_KEY is not configured.");
        var key = configuredKey;
        aes.Key = Encoding.UTF8.GetBytes(key.PadRight(32).Substring(0, 32));
        aes.GenerateIV();

        using var output = new MemoryStream();
        output.Write(aes.IV, 0, aes.IV.Length);
        using (var encryptor = aes.CreateEncryptor())
        using (var crypto = new CryptoStream(output, encryptor, CryptoStreamMode.Write))
            crypto.Write(content, 0, content.Length);
        return output.ToArray();
    }

    internal static string ParseCid(string responseBody)
    {
        var cid = string.Empty;
        foreach (var line in responseBody.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                using var document = JsonDocument.Parse(line);
                if (document.RootElement.TryGetProperty("Hash", out var hash))
                    cid = hash.GetString() ?? cid;
            }
            catch (JsonException) { }
        }
        return cid.Trim();
    }

    private async Task DistributePinAsync(string cid, CancellationToken cancellationToken)
    {
        var configuredNodes = Environment.GetEnvironmentVariable("IPFS_PEER_NODES");
        var nodes = (configuredNodes ?? Environment.GetEnvironmentVariable("IPFS_HOST")
                ?? "ipfs-api.plv-fabric.svc.cluster.local")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        await Task.WhenAll(nodes.Select(async node =>
        {
            using var client = _httpClientFactory.CreateClient();
            client.Timeout = RequestTimeout();
            var pinUrl = $"http://{node}:5001/api/v0/pin/add?arg={Uri.EscapeDataString(cid)}&recursive=true";
            using var response = await client.PostAsync(pinUrl, null, cancellationToken);
            if (!response.IsSuccessStatusCode)
                throw new HttpRequestException($"IPFS peer rejected the archive pin with HTTP {(int)response.StatusCode}.");
            _logger.LogInformation("IPFS archive CID {Cid} pinned on configured peer {Peer}", cid, node);
        }));
    }

    private TimeSpan RequestTimeout()
    {
        var configured = _configuration.GetValue<int?>("IpfsRequestTimeoutSeconds") ?? 30;
        return TimeSpan.FromSeconds(Math.Clamp(configured, 5, 120));
    }
}
