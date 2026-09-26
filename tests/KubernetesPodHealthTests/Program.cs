using System.Net;
using System.Net.Security;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Client_app.Services;

var passed = 0;
static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}
void Pass(string name)
{
    passed++;
    Console.WriteLine($"PASS: {name}");
}

using var rootKey = RSA.Create(2048);
var rootRequest = new CertificateRequest("CN=BlockGO Kubernetes Test CA", rootKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
rootRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
rootRequest.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
rootRequest.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(rootRequest.PublicKey, false));
using var root = rootRequest.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(30));

using var serverKey = RSA.Create(2048);
var serverRequest = new CertificateRequest("CN=kubernetes.default.svc", serverKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
serverRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
serverRequest.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
serverRequest.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(
    new OidCollection { new("1.3.6.1.5.5.7.3.1") }, true));
var san = new SubjectAlternativeNameBuilder();
san.AddDnsName("kubernetes.default.svc");
serverRequest.CertificateExtensions.Add(san.Build());
serverRequest.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(serverRequest.PublicKey, false));
var serial = RandomNumberGenerator.GetBytes(16);
using var issuedServer = serverRequest.Create(root, DateTimeOffset.UtcNow.AddHours(-1), DateTimeOffset.UtcNow.AddDays(7), serial);
using var server = issuedServer.CopyWithPrivateKey(serverKey);

using (var tlsHandler = KubernetesPodHealthProbe.CreateTlsHandler(root))
{
    var validator = tlsHandler.ServerCertificateCustomValidationCallback
        ?? throw new InvalidOperationException("The Kubernetes TLS handler has no certificate validator.");
    Check(validator(new HttpRequestMessage(), server, null, SslPolicyErrors.RemoteCertificateChainErrors),
        "A server certificate signed by the mounted CA was rejected.");
    Check(!validator(new HttpRequestMessage(), server, null, SslPolicyErrors.RemoteCertificateNameMismatch),
        "Hostname mismatch was accepted.");
    using var unrelatedKey = RSA.Create(2048);
    var unrelatedRequest = new CertificateRequest("CN=unrelated", unrelatedKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
    using var unrelated = unrelatedRequest.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
    Check(!validator(new HttpRequestMessage(), unrelated, null, SslPolicyErrors.RemoteCertificateChainErrors),
        "An unrelated certificate was accepted; TLS validation appears bypassed.");
}
Pass("custom-root TLS validation trusts only the mounted CA and preserves hostname checks");

var missingAll = await KubernetesPodHealthProbe.CheckAsync(
    new KubernetesPodHealthOptions("kubernetes.default.svc", "443", Path.Combine(Path.GetTempPath(), $"missing-{Guid.NewGuid():N}"), TimeSpan.FromSeconds(1)),
    CancellationToken.None);
Check(missingAll.Status == "not_configured" && missingAll.Message == "In-cluster Kubernetes monitoring is not configured.",
    "Missing service-account files were not classified as not configured.");
Pass("missing Kubernetes environment/service-account files");

var testDirectory = Path.Combine(Path.GetTempPath(), $"blockgo-kubernetes-health-{Guid.NewGuid():N}");
Directory.CreateDirectory(testDirectory);
try
{
    const string bearerToken = "test-service-account-token-never-return";
    await File.WriteAllTextAsync(Path.Combine(testDirectory, "namespace"), "plv-fabric");
    await File.WriteAllTextAsync(Path.Combine(testDirectory, "ca.crt"), root.ExportCertificatePem());
    var missingToken = await KubernetesPodHealthProbe.CheckAsync(
        new KubernetesPodHealthOptions("kubernetes.default.svc", "443", testDirectory, TimeSpan.FromSeconds(1)),
        CancellationToken.None);
    Check(missingToken.Status == "not_configured" && missingToken.Message == "In-cluster Kubernetes monitoring is not configured.",
        "A missing service-account token was not handled safely.");
    Pass("missing Kubernetes service-account token");

    await File.WriteAllTextAsync(Path.Combine(testDirectory, "token"), bearerToken);
    File.Delete(Path.Combine(testDirectory, "ca.crt"));
    var missingCa = await KubernetesPodHealthProbe.CheckAsync(
        new KubernetesPodHealthOptions("kubernetes.default.svc", "443", testDirectory, TimeSpan.FromSeconds(1)),
        CancellationToken.None);
    Check(missingCa.Status == "not_configured" && missingCa.Message == "In-cluster Kubernetes monitoring is not configured.",
        "A missing Kubernetes CA was not handled safely.");
    Pass("missing Kubernetes service-account CA");

    await File.WriteAllTextAsync(Path.Combine(testDirectory, "ca.crt"), root.ExportCertificatePem());
    using (var loadedRoot = X509Certificate2.CreateFromPem(await File.ReadAllTextAsync(Path.Combine(testDirectory, "ca.crt"))))
        Check(loadedRoot.RawData.SequenceEqual(root.RawData), "The test CA PEM did not round-trip.");
    var options = new KubernetesPodHealthOptions("kubernetes.default.svc", "443", testDirectory, TimeSpan.FromSeconds(1));

    HttpRequestMessage? capturedRequest = null;
    var success = await KubernetesPodHealthProbe.CheckAsync(options, CancellationToken.None, loadedRoot =>
    {
        Check(loadedRoot.RawData.SequenceEqual(root.RawData), "The mounted CA was not supplied to the handler factory.");
        return new StubHandler((request, _) =>
        {
            capturedRequest = request;
            return Response(HttpStatusCode.OK, """
                {"items":[
                  {"status":{"phase":"Running","containerStatuses":[{"ready":true},{"ready":true}]}},
                  {"status":{"phase":"Running","containerStatuses":[{"ready":true}]}}
                ]}
                """);
        });
    });
    Check(success.Status == "healthy" && success.RunningPods == 2 && success.Message == "2/2 pods ready; 2 running.",
        $"Healthy pod counts are incorrect: {success.Status}, {success.RunningPods}, {success.Message}");
    Check(capturedRequest?.Method == HttpMethod.Get &&
          capturedRequest.RequestUri?.DnsSafeHost == "kubernetes.default.svc" &&
          capturedRequest.RequestUri?.AbsolutePath == "/api/v1/namespaces/plv-fabric/pods" &&
          capturedRequest.Headers.Authorization?.Scheme == "Bearer" &&
          capturedRequest.Headers.Authorization.Parameter == bearerToken,
        "The namespace-scoped request or bearer authentication is incorrect.");
    Pass("valid CA, bearer token, namespace endpoint, and all-ready pod counts");

    async Task<KubernetesPodHealthResult> StatusResponse(HttpStatusCode statusCode, string content = "{}") =>
        await KubernetesPodHealthProbe.CheckAsync(options, CancellationToken.None,
            _ => new StubHandler((_, _) => Response(statusCode, content)));

    var unauthorized = await StatusResponse(HttpStatusCode.Unauthorized);
    Check(unauthorized.Status == "unavailable" && unauthorized.Message == "Kubernetes monitoring authentication was rejected.",
        "HTTP 401 status mapping is incorrect.");
    Pass("HTTP 401 authentication warning");

    var forbidden = await StatusResponse(HttpStatusCode.Forbidden);
    Check(forbidden.Status == "unavailable" && forbidden.Message == "Kubernetes monitoring does not have permission to list pods.",
        "HTTP 403 status mapping is incorrect.");
    Pass("HTTP 403 RBAC warning");

    var serverError = await StatusResponse(HttpStatusCode.InternalServerError);
    Check(serverError.Status == "unavailable" && serverError.Message == "Kubernetes API returned HTTP 500.",
        "HTTP 500 status mapping is incorrect.");
    Pass("HTTP 500 API failure");

    var timeoutOptions = options with { Timeout = TimeSpan.FromMilliseconds(50) };
    var timeout = await KubernetesPodHealthProbe.CheckAsync(timeoutOptions, CancellationToken.None,
        _ => new StubHandler(async (_, cancellationToken) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK);
        }));
    Check(timeout.Status == "unavailable" && timeout.Message == "Kubernetes API request timed out.", "Timeout mapping is incorrect.");
    Pass("Kubernetes API timeout");

    var malformed = await StatusResponse(HttpStatusCode.OK, "{\"unexpected\":true}");
    Check(malformed.Status == "unavailable" && malformed.Message == "Kubernetes API returned an invalid response.",
        "Malformed response mapping is incorrect.");
    Pass("malformed Kubernetes response");

    var partiallyReady = await StatusResponse(HttpStatusCode.OK, """
        {"items":[
          {"status":{"phase":"Running","containerStatuses":[{"ready":true}]}},
          {"status":{"phase":"Running","containerStatuses":[{"ready":false}]}}
        ]}
        """);
    Check(partiallyReady.Status == "warning" && partiallyReady.RunningPods == 2 &&
          partiallyReady.Message == "1/2 pods ready; 2 running.",
        "A running pod with an unready container was counted as ready or marked down.");
    Pass("running pods with an unready container produce a count-based warning");

    var tlsFailure = await KubernetesPodHealthProbe.CheckAsync(options, CancellationToken.None,
        _ => new StubHandler((_, _) => throw new HttpRequestException(
            $"credential={bearerToken}", new AuthenticationException("certificate rejected"))));
    Check(tlsFailure.Status == "unavailable" &&
          tlsFailure.Message == "Secure connection to the Kubernetes API could not be established using the mounted service-account CA." &&
          !tlsFailure.Message.Contains(bearerToken, StringComparison.Ordinal),
        "TLS failure leaked credentials or returned the wrong safe message.");
    Pass("TLS failure is credential-safe");
}
finally
{
    Directory.Delete(testDirectory, recursive: true);
}

Console.WriteLine($"RESULT: {passed} passed, 0 failed");

static Task<HttpResponseMessage> Response(HttpStatusCode statusCode, string content) =>
    Task.FromResult(new HttpResponseMessage(statusCode)
    {
        Content = new StringContent(content, Encoding.UTF8, "application/json")
    });

sealed class StubHandler(
    Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
        send(request, cancellationToken);
}
