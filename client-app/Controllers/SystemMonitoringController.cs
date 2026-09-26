using System.Diagnostics;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Npgsql;

namespace Client_app.Controllers
{
    [ApiController]
    [Authorize(Roles = "system_admin")]
    [Route("api/[controller]")]
    public sealed class SystemMonitoringController : ControllerBase
    {
        private readonly string _connectionString;
        private readonly string _middlewareUrl;
        private readonly string _frontendUrl;
        private readonly string _ipfsUrl;
        private readonly string _ledgerUrl;
        private readonly string? _prometheusUrl;
        private readonly string _grafanaUrl;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IMemoryCache _cache;
        private readonly string? _couchDbUser;
        private readonly string? _couchDbPassword;
        private const string GrafanaSessionCookie = "blockgo_grafana_session";
        private static readonly IReadOnlyDictionary<string, string> CouchDbTargets =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["registrar"] = "http://couchdb-registrar.plv-main-campus.svc.cluster.local:5984",
                ["faculty"] = "http://couchdb-faculty.plv-annex-campus.svc.cluster.local:5984",
                ["department"] = "http://couchdb-department.plv-pubad-campus.svc.cluster.local:5984"
            };
        private static readonly string[] SensitiveDocumentTerms =
        {
            "password", "secret", "privatekey", "private_key", "enrollmentsecret",
            "smtp_pass", "tls_key", "wallet", "credential"
        };

        public SystemMonitoringController(IConfiguration configuration, IHttpClientFactory httpClientFactory, IMemoryCache cache)
        {
            _connectionString = configuration.GetConnectionString("MasterConnection")
                ?? configuration.GetConnectionString("PostgresConnection")
                ?? throw new InvalidOperationException("A PostgreSQL connection is required.");
            _middlewareUrl = configuration["Middleware:Url"] ?? "http://middleware:4000";
            _frontendUrl = configuration["Monitoring:FrontendUrl"]
                ?? configuration["Frontend:Url"]
                ?? Environment.GetEnvironmentVariable("FRONTEND_URL")
                ?? "http://frontend-service";
            _ipfsUrl = configuration["IpfsUrl"]
                ?? configuration["Monitoring:IpfsUrl"]
                ?? "http://ipfs-ha-api.plv-fabric.svc.cluster.local:5001";
            _ledgerUrl = configuration["Monitoring:LedgerUrl"]
                ?? "http://ledger-service.plv-fabric.svc.cluster.local:4003";
            _prometheusUrl = configuration["Monitoring:PrometheusUrl"] ?? Environment.GetEnvironmentVariable("PROMETHEUS_URL");
            _grafanaUrl = configuration["Monitoring:GrafanaUrl"]
                ?? Environment.GetEnvironmentVariable("GRAFANA_URL")
                ?? "http://grafana.plv-fabric.svc.cluster.local:3000";
            _httpClientFactory = httpClientFactory;
            _cache = cache;
            _couchDbUser = configuration["COUCHDB_USER"] ?? Environment.GetEnvironmentVariable("COUCHDB_USER");
            _couchDbPassword = configuration["COUCHDB_PASS"] ?? Environment.GetEnvironmentVariable("COUCHDB_PASS");
        }

        [HttpPost("grafana/session")]
        public IActionResult CreateGrafanaSession()
        {
            var sessionToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            var cacheKey = GrafanaCacheKey(sessionToken);
            var actor = User.Identity?.Name ?? "system-admin@blockgo.local";
            _cache.Set(cacheKey, actor, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(8),
                SlidingExpiration = TimeSpan.FromMinutes(30)
            });
            Response.Cookies.Append(GrafanaSessionCookie, sessionToken, new CookieOptions
            {
                HttpOnly = true,
                Secure = Request.IsHttps,
                SameSite = SameSiteMode.Lax,
                Path = "/api/SystemMonitoring/grafana",
                MaxAge = TimeSpan.FromHours(8),
                IsEssential = true
            });
            return Ok(new { status = "Success", url = "/api/SystemMonitoring/grafana/" });
        }

        [AllowAnonymous]
        [AcceptVerbs("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")]
        [Route("grafana/{**path}")]
        public async Task ProxyGrafana(string? path, CancellationToken cancellationToken)
        {
            if (!TryGetGrafanaActor(out var actor))
            {
                Response.StatusCode = StatusCodes.Status401Unauthorized;
                await Response.WriteAsJsonAsync(new { status = "Error", message = "A System Admin Grafana session is required." }, cancellationToken);
                return;
            }

            var relativePath = (path ?? string.Empty).TrimStart('/');
            if (relativePath.Contains("://", StringComparison.Ordinal) || relativePath.Contains("..", StringComparison.Ordinal))
            {
                Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }

            // Grafana is configured with serve_from_sub_path at this public route. Forwarding
            // only the captured remainder makes Grafana redirect to its configured root URL;
            // HttpClient then follows that public localhost redirect from inside this pod and
            // fails with connection refused. Preserve the configured subpath on the upstream
            // request so Grafana serves the resource directly.
            var targetUrl = $"{_grafanaUrl.TrimEnd('/')}/api/SystemMonitoring/grafana/{relativePath}{Request.QueryString}";
            using var proxyRequest = new HttpRequestMessage(new HttpMethod(Request.Method), targetUrl);
            var requestHasBody = Request.ContentLength.GetValueOrDefault() > 0 || Request.Headers.ContainsKey("Transfer-Encoding");
            if (requestHasBody) proxyRequest.Content = new StreamContent(Request.Body);

            foreach (var header in Request.Headers)
            {
                if (header.Key.Equals("Host", StringComparison.OrdinalIgnoreCase) ||
                    header.Key.Equals("Authorization", StringComparison.OrdinalIgnoreCase) ||
                    header.Key.Equals("Cookie", StringComparison.OrdinalIgnoreCase) ||
                    header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) ||
                    header.Key.Equals("Connection", StringComparison.OrdinalIgnoreCase) ||
                    header.Key.Equals("Transfer-Encoding", StringComparison.OrdinalIgnoreCase) ||
                    header.Key.Equals("X-WEBAUTH-USER", StringComparison.OrdinalIgnoreCase) ||
                    header.Key.Equals("X-WEBAUTH-NAME", StringComparison.OrdinalIgnoreCase) ||
                    header.Key.Equals("X-Forwarded-Prefix", StringComparison.OrdinalIgnoreCase)) continue;
                if (!proxyRequest.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray()))
                    proxyRequest.Content?.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
            }
            proxyRequest.Headers.TryAddWithoutValidation("X-WEBAUTH-USER", actor);
            proxyRequest.Headers.TryAddWithoutValidation("X-WEBAUTH-NAME", "BlockGO System Administrator");
            proxyRequest.Headers.TryAddWithoutValidation("X-Forwarded-Prefix", "/api/SystemMonitoring/grafana");

            using var client = _httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromMinutes(5);
            using var proxyResponse = await client.SendAsync(proxyRequest, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            Response.StatusCode = (int)proxyResponse.StatusCode;
            foreach (var header in proxyResponse.Headers)
                Response.Headers.Append(header.Key, header.Value.ToArray());
            foreach (var header in proxyResponse.Content.Headers)
                Response.Headers.Append(header.Key, header.Value.ToArray());
            Response.Headers.Remove("transfer-encoding");
            Response.Headers.Remove("connection");
            Response.Headers.Remove("X-Frame-Options");
            Response.Headers["X-Frame-Options"] = "SAMEORIGIN";
            await proxyResponse.Content.CopyToAsync(Response.Body, cancellationToken);
        }

        [HttpGet("summary")]
        public async Task<IActionResult> Summary(CancellationToken cancellationToken)
        {
            var services = new List<object>();
            var database = new { status = "down", name = "", sizeBytes = (long?)null, activeConnections = (long?)null };
            var dbStopwatch = Stopwatch.StartNew();
            try
            {
                await using var connection = new NpgsqlConnection(_connectionString);
                await connection.OpenAsync(cancellationToken);
                await using var command = new NpgsqlCommand(@"
                    SELECT current_database(), pg_database_size(current_database()),
                           (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database());", connection);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                await reader.ReadAsync(cancellationToken);
                database = new { status = "healthy", name = reader.GetString(0), sizeBytes = (long?)reader.GetInt64(1), activeConnections = (long?)reader.GetInt64(2) };
                services.Add(Service("postgres", "PostgreSQL", "Data", "healthy", dbStopwatch.ElapsedMilliseconds, "Database query completed.", "PostgreSQL"));
            }
            catch (Exception exception)
            {
                services.Add(Service("postgres", "PostgreSQL", "Data", "down", dbStopwatch.ElapsedMilliseconds, SafeMessage(exception), "PostgreSQL"));
            }

            var frontendStopwatch = Stopwatch.StartNew();
            try
            {
                using var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(4);
                using var response = await client.GetAsync($"{_frontendUrl.TrimEnd('/')}/nginx-health", cancellationToken);
                services.Add(Service("frontend", "Frontend", "Application", response.IsSuccessStatusCode ? "healthy" : "down",
                    frontendStopwatch.ElapsedMilliseconds, $"HTTP {(int)response.StatusCode}", _frontendUrl));
            }
            catch (Exception exception)
            {
                services.Add(Service("frontend", "Frontend", "Application", "down", frontendStopwatch.ElapsedMilliseconds, SafeMessage(exception), _frontendUrl));
            }

            var middlewareStopwatch = Stopwatch.StartNew();
            try
            {
                using var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(4);
                using var response = await client.GetAsync($"{_middlewareUrl.TrimEnd('/')}/api/ready", cancellationToken);
                services.Add(Service("middleware", "Fabric Middleware", "Application", response.IsSuccessStatusCode ? "healthy" : "down",
                    middlewareStopwatch.ElapsedMilliseconds, $"HTTP {(int)response.StatusCode}", _middlewareUrl));
                using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
                if (document.RootElement.TryGetProperty("services", out var middlewareServices) &&
                    middlewareServices.ValueKind == JsonValueKind.Object)
                {
                    foreach (var dependency in middlewareServices.EnumerateObject())
                    {
                        var ready = dependency.Value.TryGetProperty("ready", out var readyValue) && readyValue.GetBoolean();
                        var detail = dependency.Value.TryGetProperty("status", out var statusValue)
                            ? statusValue.GetString() ?? "Ready"
                            : dependency.Value.TryGetProperty("error", out var errorValue)
                                ? errorValue.GetString() ?? "Dependency check failed."
                                : "Dependency check completed.";
                        var displayName = dependency.Name switch
                        {
                            "auth" => "Authentication Service",
                            "identity" => "Fabric Identity Service",
                            "ledger" => "Ledger Service",
                            "upload" => "Grade Upload Service",
                            "settings" => "Settings Service",
                            _ => $"Middleware {dependency.Name}"
                        };
                        services.Add(Service($"middleware-{dependency.Name}", displayName, "Middleware",
                            ready ? "healthy" : "down", middlewareStopwatch.ElapsedMilliseconds, detail, _middlewareUrl));
                    }
                }
            }
            catch (Exception exception)
            {
                services.Add(Service("middleware", "Fabric Middleware", "Application", "down", middlewareStopwatch.ElapsedMilliseconds, SafeMessage(exception), _middlewareUrl));
            }

            await AddIpfsHealthAsync(services, cancellationToken);
            await AddFabricHealthAsync(services, cancellationToken);
            var runningPods = await AddKubernetesHealthAsync(services, cancellationToken);

            services.Insert(0, Service("backend", "ASP.NET Core API", "Application", "healthy", 0, "Monitoring endpoint is responsive.", HttpContext.Request.Host.Value));
            var alerts = await LoadSecurityAlertsAsync(cancellationToken);
            var prometheusAvailable = false;
            if (!string.IsNullOrWhiteSpace(_prometheusUrl))
            {
                try
                {
                    using var client = _httpClientFactory.CreateClient();
                    client.Timeout = TimeSpan.FromSeconds(4);
                    using var response = await client.GetAsync($"{_prometheusUrl.TrimEnd('/')}/api/v1/alerts", cancellationToken);
                    prometheusAvailable = response.IsSuccessStatusCode;
                    if (response.IsSuccessStatusCode)
                    {
                        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
                        if (document.RootElement.TryGetProperty("data", out var data) && data.TryGetProperty("alerts", out var items))
                        {
                            foreach (var item in items.EnumerateArray())
                            {
                                var labels = item.TryGetProperty("labels", out var labelValue) ? labelValue : default;
                                var annotations = item.TryGetProperty("annotations", out var annotationValue) ? annotationValue : default;
                                alerts.Add(new
                                {
                                    name = JsonText(labels, "alertname", "Prometheus Alert"),
                                    severity = JsonText(labels, "severity", "warning"),
                                    component = JsonText(labels, "component", "infrastructure"),
                                    summary = JsonText(annotations, "summary", "An infrastructure alert is active.")
                                });
                            }
                        }
                    }
                }
                catch { }
            }

            var process = Process.GetCurrentProcess();
            var serviceStatuses = services.Select(item => JsonSerializer.Serialize(item)).ToArray();
            var hasDownService = serviceStatuses.Any(item => item.Contains("\"status\":\"down\"", StringComparison.Ordinal));
            var hasCriticalAlert = alerts.Any(item => JsonSerializer.Serialize(item).Contains("\"severity\":\"critical\"", StringComparison.OrdinalIgnoreCase));
            return Ok(new
            {
                generatedAt = DateTimeOffset.UtcNow,
                status = hasDownService ? "down" : hasCriticalAlert || alerts.Count > 0 ? "warning" : "healthy",
                services,
                database,
                runtime = new
                {
                    uptimeSeconds = (DateTime.UtcNow - process.StartTime.ToUniversalTime()).TotalSeconds,
                    workingSetBytes = process.WorkingSet64,
                    managedMemoryBytes = GC.GetTotalMemory(false),
                    threadCount = process.Threads.Count,
                    processorCount = Environment.ProcessorCount
                },
                infrastructure = new
                {
                    source = prometheusAvailable ? "prometheus" : "runtime",
                    cpuCores = (double?)null,
                    memoryBytes = (long?)null,
                    runningPods,
                    healthyFabricTargets = services.Count(item => JsonSerializer.Serialize(item).Contains("Fabric Middleware") && JsonSerializer.Serialize(item).Contains("healthy"))
                },
                alerts
            });
        }

        [HttpPost("security-events/{eventId:long}/resolve")]
        public async Task<IActionResult> ResolveSecurityEvent(long eventId, CancellationToken cancellationToken)
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = new NpgsqlCommand(@"
                UPDATE security_events
                SET resolved_at = CURRENT_TIMESTAMP,
                    resolved_by = (SELECT id FROM users WHERE LOWER(email) = LOWER(@actor))
                WHERE security_event_id = @eventId AND resolved_at IS NULL
                RETURNING security_event_id;", connection);
            command.Parameters.AddWithValue("actor", User.Identity?.Name ?? string.Empty);
            command.Parameters.AddWithValue("eventId", eventId);
            if (await command.ExecuteScalarAsync(cancellationToken) is null) return NotFound(new { status = "Error", message = "Open security event not found." });
            return Ok(new { status = "Success", message = "Security event resolved." });
        }

        [HttpGet("finalized-ledger")]
        public async Task<IActionResult> FinalizedLedger(
            [FromQuery] string? search,
            [FromQuery] string? source,
            [FromQuery] string? schoolYear,
            [FromQuery] string? semester,
            [FromQuery] DateTimeOffset? from,
            [FromQuery] DateTimeOffset? to,
            [FromQuery] int limit = 100,
            CancellationToken cancellationToken = default)
        {
            limit = Math.Clamp(limit, 1, 500);
            if (from.HasValue && to.HasValue && from > to)
                return BadRequest(new { status = "Error", message = "The from date must not be later than the to date." });

            var query = new List<string> { $"limit={limit}" };
            AddQuery(query, "search", search);
            AddQuery(query, "source", source);
            AddQuery(query, "schoolYear", schoolYear);
            AddQuery(query, "semester", semester);
            if (from.HasValue) AddQuery(query, "from", from.Value.ToString("O"));
            if (to.HasValue) AddQuery(query, "to", to.Value.ToString("O"));

            using var request = new HttpRequestMessage(
                HttpMethod.Get,
                $"{_middlewareUrl.TrimEnd('/')}/api/admin/ledger-transactions?{string.Join('&', query)}");
            if (Request.Headers.TryGetValue("Authorization", out var authorization))
                request.Headers.TryAddWithoutValidation("Authorization", authorization.ToString());

            using var client = _httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(20);
            using var response = await client.SendAsync(request, cancellationToken);
            var payload = await response.Content.ReadAsStringAsync(cancellationToken);
            return new ContentResult
            {
                StatusCode = (int)response.StatusCode,
                ContentType = response.Content.Headers.ContentType?.ToString() ?? "application/json",
                Content = payload
            };
        }

        [HttpGet("live-transactions")]
        public async Task<IActionResult> LiveTransactions(
            [FromQuery] long? afterAuditId,
            [FromQuery] string? action,
            [FromQuery] DateTimeOffset? from,
            [FromQuery] DateTimeOffset? to,
            [FromQuery] int limit = 100,
            CancellationToken cancellationToken = default)
        {
            limit = Math.Clamp(limit, 1, 500);
            if (afterAuditId < 0)
                return BadRequest(new { status = "Error", message = "afterAuditId must be zero or greater." });
            if (from.HasValue && to.HasValue && from > to)
                return BadRequest(new { status = "Error", message = "The from date must not be later than the to date." });

            var records = new List<object>();
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = new NpgsqlCommand(@"
                SELECT a.audit_id, a.action, a.entity_type, a.entity_id, a.actor_role,
                       a.description, a.timestamp,
                       COALESCE(fp.full_name, ap.full_name, sp.full_name, u.username, u.email, 'System') AS actor
                FROM audit_logs a
                LEFT JOIN users u ON u.id = a.user_id
                LEFT JOIN facultyprofiles fp ON fp.user_id = u.id
                LEFT JOIN adminprofiles ap ON ap.user_id = u.id
                LEFT JOIN studentprofiles sp ON sp.user_id = u.id
                WHERE (@afterAuditId IS NULL OR a.audit_id > @afterAuditId)
                  AND (@action IS NULL OR a.action ILIKE '%' || @action || '%')
                  AND (@fromDate IS NULL OR a.timestamp >= @fromDate)
                  AND (@toDate IS NULL OR a.timestamp < @toDate + INTERVAL '1 day')
                ORDER BY a.audit_id DESC
                LIMIT @limit;", connection);
            command.Parameters.Add("afterAuditId", NpgsqlTypes.NpgsqlDbType.Bigint).Value = (object?)afterAuditId ?? DBNull.Value;
            AddNullableText(command, "action", action);
            command.Parameters.Add("fromDate", NpgsqlTypes.NpgsqlDbType.TimestampTz).Value = (object?)from?.ToUniversalTime() ?? DBNull.Value;
            command.Parameters.Add("toDate", NpgsqlTypes.NpgsqlDbType.TimestampTz).Value = (object?)to?.ToUniversalTime() ?? DBNull.Value;
            command.Parameters.AddWithValue("limit", limit);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                records.Add(new
                {
                    auditId = reader.GetInt64(0),
                    action = TextOrNull(reader, 1),
                    entityType = TextOrNull(reader, 2),
                    entityId = TextOrNull(reader, 3),
                    actorRole = TextOrNull(reader, 4),
                    description = TextOrNull(reader, 5),
                    occurredAt = ValueOrNull(reader, 6),
                    actor = TextOrNull(reader, 7)
                });
            }
            return Ok(new { status = "Success", generatedAt = DateTimeOffset.UtcNow, count = records.Count, data = records });
        }

        [HttpGet("couchdb/{target}/databases")]
        public async Task<IActionResult> CouchDbDatabases(string target, CancellationToken cancellationToken)
        {
            if (!TryGetCouchDbTarget(target, out var targetUrl, out var failure)) return failure!;
            using var response = await SendCouchDbRequestAsync(targetUrl, "/_all_dbs", cancellationToken);
            if (!response.IsSuccessStatusCode)
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { status = "Error", message = "The selected CouchDB target is unavailable." });

            var databases = JsonSerializer.Deserialize<string[]>(await response.Content.ReadAsStringAsync(cancellationToken))
                ?.Where(IsBrowsableDatabase)
                .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
                .ToArray() ?? Array.Empty<string>();
            return Ok(new { status = "Success", target = target.ToLowerInvariant(), data = databases });
        }

        [HttpGet("couchdb/{target}/documents")]
        public async Task<IActionResult> CouchDbDocuments(
            string target,
            [FromQuery] string database,
            [FromQuery] int page = 1,
            CancellationToken cancellationToken = default)
        {
            if (!TryGetCouchDbTarget(target, out var targetUrl, out var failure)) return failure!;
            if (!IsBrowsableDatabase(database))
                return BadRequest(new { status = "Error", message = "A valid application state database is required." });
            page = Math.Clamp(page, 1, 10000);

            using var databasesResponse = await SendCouchDbRequestAsync(targetUrl, "/_all_dbs", cancellationToken);
            if (!databasesResponse.IsSuccessStatusCode)
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { status = "Error", message = "The selected CouchDB target is unavailable." });
            var databases = JsonSerializer.Deserialize<string[]>(await databasesResponse.Content.ReadAsStringAsync(cancellationToken)) ?? Array.Empty<string>();
            if (!databases.Any(value => string.Equals(value, database, StringComparison.Ordinal)))
                return NotFound(new { status = "Error", message = "The selected application state database was not found." });

            var path = $"/{Uri.EscapeDataString(database)}/_all_docs?include_docs=true&limit=11&skip={(page - 1) * 10}";
            using var response = await SendCouchDbRequestAsync(targetUrl, path, cancellationToken);
            if (!response.IsSuccessStatusCode)
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { status = "Error", message = "CouchDB documents could not be read." });

            var root = JsonNode.Parse(await response.Content.ReadAsStringAsync(cancellationToken))?.AsObject();
            var rows = root?["rows"]?.AsArray() ?? new JsonArray();
            var hasNextPage = rows.Count > 10;
            var documents = rows.Take(10).Select(row => new
            {
                id = row?["id"]?.GetValue<string>() ?? string.Empty,
                document = SanitizeDocument(row?["doc"])
            }).ToArray();
            return Ok(new
            {
                status = "Success",
                target = target.ToLowerInvariant(),
                database,
                page,
                pageSize = 10,
                hasNextPage,
                totalRows = root?["total_rows"]?.GetValue<int?>(),
                data = documents
            });
        }

        private async Task AddIpfsHealthAsync(List<object> services, CancellationToken cancellationToken)
        {
            var stopwatch = Stopwatch.StartNew();
            try
            {
                using var client = _httpClientFactory.CreateClient();
                // The HA router can make up to three 3-second upstream connection
                // attempts before a healthy campus answers. Keep this probe bounded,
                // but allow the configured failover path to finish.
                client.Timeout = TimeSpan.FromSeconds(12);
                using var response = await client.PostAsync($"{_ipfsUrl.TrimEnd('/')}/api/v0/version", null, cancellationToken);
                services.Add(Service("ipfs", "IPFS Cluster Gateway", "Storage", response.IsSuccessStatusCode ? "healthy" : "down",
                    stopwatch.ElapsedMilliseconds, $"HTTP {(int)response.StatusCode}", "Internal IPFS API"));
            }
            catch (Exception)
            {
                services.Add(Service("ipfs", "IPFS Cluster Gateway", "Storage", "down", stopwatch.ElapsedMilliseconds,
                    "The storage service is temporarily unreachable.", "Internal IPFS API"));
            }
        }

        private async Task AddFabricHealthAsync(List<object> services, CancellationToken cancellationToken)
        {
            var stopwatch = Stopwatch.StartNew();
            try
            {
                using var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(6);
                using var response = await client.GetAsync($"{_ledgerUrl.TrimEnd('/')}/api/ready", cancellationToken);
                using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
                if (!response.IsSuccessStatusCode || !document.RootElement.TryGetProperty("fabric", out var fabric) || fabric.ValueKind != JsonValueKind.Object)
                {
                    services.Add(Service("fabric-network", "Fabric Peers and Orderers", "Blockchain", "down", stopwatch.ElapsedMilliseconds,
                        $"HTTP {(int)response.StatusCode}", "Internal Fabric readiness"));
                    return;
                }

                foreach (var endpoint in fabric.EnumerateObject())
                {
                    var isOrderer = endpoint.Name.StartsWith("orderer", StringComparison.OrdinalIgnoreCase);
                    services.Add(Service($"fabric-{endpoint.Name.ToLowerInvariant()}", FabricEndpointName(endpoint.Name, isOrderer), "Blockchain", "healthy",
                        stopwatch.ElapsedMilliseconds, endpoint.Value.ToString(), isOrderer ? "Fabric orderer" : "Fabric peer"));
                }
            }
            catch (Exception exception)
            {
                services.Add(Service("fabric-network", "Fabric Peers and Orderers", "Blockchain", "down", stopwatch.ElapsedMilliseconds,
                    SafeMessage(exception), "Internal Fabric readiness"));
            }
        }

        private async Task<int?> AddKubernetesHealthAsync(List<object> services, CancellationToken cancellationToken)
        {
            const string serviceAccountPath = "/var/run/secrets/kubernetes.io/serviceaccount";
            var host = Environment.GetEnvironmentVariable("KUBERNETES_SERVICE_HOST");
            var port = Environment.GetEnvironmentVariable("KUBERNETES_SERVICE_PORT_HTTPS") ?? "443";
            if (string.IsNullOrWhiteSpace(host) || !System.IO.File.Exists($"{serviceAccountPath}/token"))
            {
                services.Add(Service("kubernetes", "Kubernetes Pods", "Infrastructure", "not_configured", 0,
                    "In-cluster Kubernetes service-account access is unavailable.", "Kubernetes API"));
                return null;
            }

            var stopwatch = Stopwatch.StartNew();
            try
            {
                var token = await System.IO.File.ReadAllTextAsync($"{serviceAccountPath}/token", cancellationToken);
                var namespaceName = System.IO.File.Exists($"{serviceAccountPath}/namespace")
                    ? (await System.IO.File.ReadAllTextAsync($"{serviceAccountPath}/namespace", cancellationToken)).Trim()
                    : "default";
                using var request = new HttpRequestMessage(HttpMethod.Get,
                    $"https://{host}:{port}/api/v1/namespaces/{Uri.EscapeDataString(namespaceName)}/pods");
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token.Trim());
                using var client = _httpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(5);
                using var response = await client.SendAsync(request, cancellationToken);
                if (!response.IsSuccessStatusCode)
                {
                    services.Add(Service("kubernetes", "Kubernetes Pods", "Infrastructure", "down", stopwatch.ElapsedMilliseconds,
                        $"Kubernetes API returned HTTP {(int)response.StatusCode}.", $"Namespace {namespaceName}"));
                    return null;
                }
                using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
                var pods = document.RootElement.GetProperty("items").EnumerateArray().ToList();
                var running = pods.Count(pod => pod.GetProperty("status").TryGetProperty("phase", out var phase) && phase.GetString() == "Running");
                var ready = pods.Count(pod => pod.GetProperty("status").TryGetProperty("containerStatuses", out var containers)
                    && containers.ValueKind == JsonValueKind.Array && containers.EnumerateArray().All(container => container.GetProperty("ready").GetBoolean()));
                var healthy = pods.Count > 0 && running == pods.Count && ready == pods.Count;
                services.Add(Service("kubernetes", "Kubernetes Pods", "Infrastructure", healthy ? "healthy" : "warning",
                    stopwatch.ElapsedMilliseconds, $"{ready}/{pods.Count} pods ready; {running} running.", $"Namespace {namespaceName}"));
                return running;
            }
            catch (Exception exception)
            {
                services.Add(Service("kubernetes", "Kubernetes Pods", "Infrastructure", "down", stopwatch.ElapsedMilliseconds,
                    SafeMessage(exception), "Kubernetes API"));
                return null;
            }
        }

        private bool TryGetCouchDbTarget(string target, out string targetUrl, out IActionResult? failure)
        {
            targetUrl = string.Empty;
            failure = null;
            if (!CouchDbTargets.TryGetValue(target ?? string.Empty, out targetUrl!))
            {
                failure = BadRequest(new { status = "Error", message = "Unknown CouchDB target." });
                return false;
            }
            if (string.IsNullOrWhiteSpace(_couchDbUser) || string.IsNullOrWhiteSpace(_couchDbPassword))
            {
                failure = StatusCode(StatusCodes.Status503ServiceUnavailable, new { status = "Error", message = "The protected CouchDB browser is not configured." });
                return false;
            }
            return true;
        }

        private async Task<HttpResponseMessage> SendCouchDbRequestAsync(string targetUrl, string path, CancellationToken cancellationToken)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, $"{targetUrl.TrimEnd('/')}{path}");
            var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{_couchDbUser}:{_couchDbPassword}"));
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", credentials);
            var client = _httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(8);
            return await client.SendAsync(request, cancellationToken);
        }

        private static bool IsBrowsableDatabase(string? database) =>
            !string.IsNullOrWhiteSpace(database)
            && database.Length <= 238
            && !database.StartsWith('_')
            && !database.Contains("wallet", StringComparison.OrdinalIgnoreCase)
            && database.All(character => char.IsAsciiLetterOrDigit(character) || character is '_' or '$' or '(' or ')' or '+' or '-');

        private static JsonNode? SanitizeDocument(JsonNode? node)
        {
            if (node is JsonObject source)
            {
                var copy = new JsonObject();
                foreach (var property in source)
                {
                    var normalized = property.Key.Replace("-", string.Empty).ToLowerInvariant();
                    copy[property.Key] = SensitiveDocumentTerms.Any(term => normalized.Contains(term.Replace("_", string.Empty), StringComparison.Ordinal))
                        ? JsonValue.Create("[REDACTED]")
                        : SanitizeDocument(property.Value);
                }
                return copy;
            }
            if (node is JsonArray array)
                return new JsonArray(array.Select(SanitizeDocument).ToArray());
            return node?.DeepClone();
        }

        private static string FabricEndpointName(string name, bool isOrderer)
        {
            var words = System.Text.RegularExpressions.Regex.Replace(name, "([a-z])([A-Z])", "$1 $2");
            return $"Fabric {(isOrderer ? "Orderer" : "Peer")} - {words}";
        }

        private async Task<List<object>> LoadSecurityAlertsAsync(CancellationToken cancellationToken)
        {
            var alerts = new List<object>();
            try
            {
                await using var connection = new NpgsqlConnection(_connectionString);
                await connection.OpenAsync(cancellationToken);
                await using var command = new NpgsqlCommand(@"
                    SELECT security_event_id, event_type, severity, attempted_identity, ip_address, details, created_at
                    FROM security_events
                    WHERE resolved_at IS NULL AND created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
                    ORDER BY created_at DESC LIMIT 100;", connection);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    var severity = reader.GetString(2).ToLowerInvariant();
                    alerts.Add(new
                    {
                        eventId = reader.GetInt64(0), name = reader.GetString(1).Replace('_', ' '),
                        severity = severity is "critical" or "high" ? "critical" : "warning",
                        component = "access-control",
                        summary = $"{(reader.IsDBNull(3) ? "Unknown identity" : reader.GetString(3))} from {(reader.IsDBNull(4) ? "unknown IP" : reader.GetString(4))}: {(reader.IsDBNull(5) ? "Access attempt denied." : reader.GetString(5))}",
                        occurredAt = reader.GetFieldValue<DateTimeOffset>(6)
                    });
                }
            }
            catch { }
            return alerts;
        }

        private static object Service(string id, string name, string layer, string status, long latencyMs, string message, string target) =>
            new { id, name, layer, status, latencyMs, message, target };
        private static string SafeMessage(Exception exception) => exception is TaskCanceledException ? "Health check timed out." : exception.Message;
        private static void AddNullableText(NpgsqlCommand command, string name, string? value) =>
            command.Parameters.Add(name, NpgsqlTypes.NpgsqlDbType.Text).Value =
                string.IsNullOrWhiteSpace(value) ? DBNull.Value : value.Trim();
        private static string? TextOrNull(NpgsqlDataReader reader, int ordinal) =>
            reader.IsDBNull(ordinal) ? null : reader.GetValue(ordinal).ToString();
        private static object? ValueOrNull(NpgsqlDataReader reader, int ordinal) =>
            reader.IsDBNull(ordinal) ? null : reader.GetValue(ordinal);
        private static void AddQuery(ICollection<string> query, string name, string? value)
        {
            if (!string.IsNullOrWhiteSpace(value))
                query.Add($"{Uri.EscapeDataString(name)}={Uri.EscapeDataString(value.Trim())}");
        }
        private static string JsonText(JsonElement element, string property, string fallback) =>
            element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var value) ? value.ToString() : fallback;

        private bool TryGetGrafanaActor(out string actor)
        {
            actor = string.Empty;

            if (User.Identity?.IsAuthenticated == true &&
                (User.IsInRole("system_admin") || User.Claims.Any(c => c.Type == "dbRole" && c.Value == "system_admin")))
            {
                actor = User.Identity?.Name ?? User.Claims.FirstOrDefault(c => c.Type == "email")?.Value ?? "system-admin@plv.edu.ph";
                return true;
            }

            string? sessionToken = null;
            if (Request.Cookies.TryGetValue(GrafanaSessionCookie, out var cookieToken) && !string.IsNullOrWhiteSpace(cookieToken))
            {
                sessionToken = cookieToken;
            }
            else if (Request.Query.TryGetValue(GrafanaSessionCookie, out var queryCookieToken) && !string.IsNullOrWhiteSpace(queryCookieToken))
            {
                sessionToken = queryCookieToken;
            }
            else if (Request.Query.TryGetValue("sessionToken", out var querySessionToken) && !string.IsNullOrWhiteSpace(querySessionToken))
            {
                sessionToken = querySessionToken;
            }

            if (!string.IsNullOrWhiteSpace(sessionToken)
                && _cache.TryGetValue(GrafanaCacheKey(sessionToken), out actor!)
                && !string.IsNullOrWhiteSpace(actor))
            {
                return true;
            }

            return false;
        }

        private static string GrafanaCacheKey(string sessionToken)
        {
            var digest = SHA256.HashData(Encoding.UTF8.GetBytes(sessionToken));
            return $"system-admin:grafana:{Convert.ToHexString(digest)}";
        }
    }
}
