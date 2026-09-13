# Free API security gate

The Feature/API workflow tests the isolated middleware microservice stack on
`http://127.0.0.1:4000`. It never targets staging or production.

## Flow

1. `heavy-tests` runs frontend, middleware, chaincode, .NET, Docker-image, and
   frontend-route checks.
2. `free-api-security` starts disposable PostgreSQL and middleware containers.
3. Schemathesis executes schema, property, fuzz, and malformed-input checks from
   `openapi-ci.yaml`.
4. OWASP ZAP imports the same OpenAPI document and actively checks the API for
   SQL/NoSQL injection, command/code injection, path traversal, SSRF, XXE, and
   server-side template injection. `zap-rules.tsv` makes those alert IDs blocking.
5. Nuclei blocks HIGH and CRITICAL vulnerability matches.
6. The required Feature/API gate permits promotion to `Staging-and-Testing` only
   when both preceding jobs succeed.

## Reports

Each workflow run retains ZAP HTML/JSON/Markdown reports and Nuclei JSONL results
for 14 days. Schemathesis publishes its coverage artifact using the repository's
artifact-retention setting. The OpenAPI contract is also checked against the
middleware route map by `npm run test:api` so documentation drift fails before
scanning begins.

Protected operations are scanned anonymously in this CI profile. They must reject
the request with HTTP 401 or 403 before any Fabric mutation is attempted. Public
authentication and settings-read inputs run against a disposable PostgreSQL database.
