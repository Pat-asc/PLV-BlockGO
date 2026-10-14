using System.Diagnostics;
using System.Net;
using System.Net.Security;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;

namespace Client_app.Services;

public sealed record KubernetesPodHealthOptions(
    string? Host,
    string Port,
    string ServiceAccountPath,
    TimeSpan Timeout);

public sealed record KubernetesPodHealthResult(
    string Status,
    string Message,
    string Target,
    int? RunningPods,
    long LatencyMs);

public static class KubernetesPodHealthProbe
{
    private const string KubernetesApiTarget = "Kubernetes API";
    private const string UnavailableMessage = "Kubernetes API health check is unavailable.";
    private const string UnauthorizedMessage = "Kubernetes workload monitoring is not authorized.";

    public static async Task<KubernetesPodHealthResult> CheckAsync(
        KubernetesPodHealthOptions options,
        CancellationToken cancellationToken,
        Func<X509Certificate2, HttpMessageHandler>? handlerFactory = null)
    {
        var tokenPath = Path.Combine(options.ServiceAccountPath, "token");
        var namespacePath = Path.Combine(options.ServiceAccountPath, "namespace");
        var caPath = Path.Combine(options.ServiceAccountPath, "ca.crt");
        if (string.IsNullOrWhiteSpace(options.Host) ||
            !File.Exists(tokenPath) ||
            !File.Exists(caPath))
        {
            return Unavailable(0);
        }

        var stopwatch = Stopwatch.StartNew();
        try
        {
            var token = (await File.ReadAllTextAsync(tokenPath, cancellationToken)).Trim();
            var namespaceName = File.Exists(namespacePath)
                ? (await File.ReadAllTextAsync(namespacePath, cancellationToken)).Trim()
                : "default";
            if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(namespaceName) ||
                !int.TryParse(options.Port, out var port) || port is < 1 or > 65535)
            {
                return Unavailable(stopwatch.ElapsedMilliseconds);
            }

            var caPem = await File.ReadAllTextAsync(caPath, cancellationToken);
            using var trustedRoot = X509Certificate2.CreateFromPem(caPem);
            using var handler = handlerFactory?.Invoke(trustedRoot) ?? CreateTlsHandler(trustedRoot);
            using var client = new HttpClient(handler, disposeHandler: false) { Timeout = options.Timeout };
            var uri = new UriBuilder(Uri.UriSchemeHttps, options.Host, port,
                $"api/v1/namespaces/{Uri.EscapeDataString(namespaceName)}/pods").Uri;
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);

            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                return Result("unavailable", UnauthorizedMessage, namespaceName, null, stopwatch);
            if (!response.IsSuccessStatusCode)
                return Result("unavailable", UnavailableMessage, namespaceName, null, stopwatch);

            await using var body = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var document = await JsonDocument.ParseAsync(body, cancellationToken: cancellationToken);
            if (!document.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
                throw new JsonException("The Kubernetes pod list does not contain an items array.");

            var total = 0;
            var running = 0;
            var ready = 0;
            foreach (var pod in items.EnumerateArray())
            {
                if (pod.ValueKind != JsonValueKind.Object) throw new JsonException("A Kubernetes pod item is invalid.");
                total++;
                if (!pod.TryGetProperty("status", out var status) || status.ValueKind != JsonValueKind.Object) continue;
                if (status.TryGetProperty("phase", out var phase) &&
                    phase.ValueKind == JsonValueKind.String &&
                    string.Equals(phase.GetString(), "Running", StringComparison.Ordinal))
                {
                    running++;
                }

                if (!status.TryGetProperty("containerStatuses", out var containers) ||
                    containers.ValueKind != JsonValueKind.Array ||
                    containers.GetArrayLength() == 0)
                {
                    continue;
                }

                var allContainersReady = true;
                foreach (var container in containers.EnumerateArray())
                {
                    if (container.ValueKind != JsonValueKind.Object ||
                        !container.TryGetProperty("ready", out var isReady) ||
                        isReady.ValueKind is not (JsonValueKind.True or JsonValueKind.False) ||
                        !isReady.GetBoolean())
                    {
                        allContainersReady = false;
                        break;
                    }
                }
                if (allContainersReady) ready++;
            }

            var health = total > 0 && running == total && ready == total ? "healthy" : "warning";
            return Result(health, $"{ready}/{total} pods ready; {running} running.", namespaceName, running, stopwatch);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (TaskCanceledException)
        {
            return new KubernetesPodHealthResult("unavailable", "Kubernetes API health check timed out.", KubernetesApiTarget, null, stopwatch.ElapsedMilliseconds);
        }
        catch (HttpRequestException exception) when (ContainsTlsFailure(exception))
        {
            return Unavailable(stopwatch.ElapsedMilliseconds);
        }
        catch (CryptographicException)
        {
            return Unavailable(stopwatch.ElapsedMilliseconds);
        }
        catch (HttpRequestException)
        {
            return Unavailable(stopwatch.ElapsedMilliseconds);
        }
        catch (JsonException)
        {
            return Unavailable(stopwatch.ElapsedMilliseconds);
        }
        catch (IOException)
        {
            return Unavailable(stopwatch.ElapsedMilliseconds);
        }
        catch (UnauthorizedAccessException)
        {
            return Unavailable(stopwatch.ElapsedMilliseconds);
        }
    }

    public static HttpClientHandler CreateTlsHandler(X509Certificate2 trustedRoot)
    {
        ArgumentNullException.ThrowIfNull(trustedRoot);
        return new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback = (_, certificate, presentedChain, policyErrors) =>
                ValidateServerCertificate(certificate, policyErrors, trustedRoot, presentedChain)
        };
    }

    public static bool ValidateServerCertificate(
        X509Certificate2? certificate,
        SslPolicyErrors policyErrors,
        X509Certificate2 trustedRoot,
        X509Chain? presentedChain = null)
    {
        if (certificate is null ||
            policyErrors.HasFlag(SslPolicyErrors.RemoteCertificateNameMismatch) ||
            policyErrors.HasFlag(SslPolicyErrors.RemoteCertificateNotAvailable))
        {
            return false;
        }

        using var chain = new X509Chain();
        chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        chain.ChainPolicy.CustomTrustStore.Add(trustedRoot);
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        chain.ChainPolicy.VerificationFlags = X509VerificationFlags.NoFlag;
        chain.ChainPolicy.DisableCertificateDownloads = true;
        chain.ChainPolicy.ApplicationPolicy.Add(new Oid("1.3.6.1.5.5.7.3.1"));
        if (presentedChain is not null)
        {
            foreach (var element in presentedChain.ChainElements.Cast<X509ChainElement>().Skip(1))
            {
                if (!element.Certificate.RawData.SequenceEqual(trustedRoot.RawData))
                    chain.ChainPolicy.ExtraStore.Add(element.Certificate);
            }
        }
        return chain.Build(certificate);
    }

    private static KubernetesPodHealthResult Result(
        string status,
        string message,
        string namespaceName,
        int? runningPods,
        Stopwatch stopwatch) =>
        new(status, message, $"Namespace {namespaceName}", runningPods, stopwatch.ElapsedMilliseconds);

    private static KubernetesPodHealthResult Unavailable(long latencyMs) =>
        new("unavailable", UnavailableMessage, KubernetesApiTarget, null, latencyMs);

    private static bool ContainsTlsFailure(Exception exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            if (current is AuthenticationException) return true;
        }
        return false;
    }
}
