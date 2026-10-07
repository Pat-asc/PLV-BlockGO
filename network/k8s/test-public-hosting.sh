#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NETWORK_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy-k8s.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/blockgo-public-hosting.XXXXXX")"

cleanup() {
    rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_contains() {
    local file="$1" expected="$2"
    grep -F -q -- "$expected" "$file" || fail "${file} does not contain ${expected}"
}

run_plan() {
    local render_dir="$1" host="$2"
    shift 2
    env \
        -u BLOCKGO_ALLOWED_ORIGINS \
        BLOCKGO_PUBLIC_HOST="$host" \
        BLOCKGO_PUBLIC_IP=203.0.113.10 \
        BLOCKGO_PUBLIC_SCHEME=https \
        BLOCKGO_PUBLIC_TLS_SECRET=rotation-tls \
        BLOCKGO_PUBLIC_HOSTING_CONFIG_FILE="$TEST_ROOT/missing.env" \
        BLOCKGO_RENDER_DIR="$render_dir" \
        "$@" \
        bash "$DEPLOY_SCRIPT" production hosting-plan
}

cd "$NETWORK_ROOT"
fabric_config_hash_before="$(sha256sum config/configtx-k8s.yaml | awk '{print $1}')"

if env -u BLOCKGO_PUBLIC_HOST \
    BLOCKGO_PUBLIC_IP=203.0.113.10 \
    BLOCKGO_PUBLIC_HOSTING_CONFIG_FILE="$TEST_ROOT/missing.env" \
    BLOCKGO_RENDER_DIR="$TEST_ROOT/missing-host" \
    bash "$DEPLOY_SCRIPT" production hosting-plan >"$TEST_ROOT/missing-host.log" 2>&1; then
    fail "production accepted a missing public host"
fi
assert_contains "$TEST_ROOT/missing-host.log" "BLOCKGO_PUBLIC_HOST must be set"

for invalid_host in 'https://example.com' 'example.com/path' 'bad host.example'; do
    if run_plan "$TEST_ROOT/invalid" "$invalid_host" >"$TEST_ROOT/invalid.log" 2>&1; then
        fail "production accepted invalid hostname ${invalid_host}"
    fi
done

if BLOCKGO_PUBLIC_HOST=example.com \
    BLOCKGO_PUBLIC_IP=203.0.113.10 \
    BLOCKGO_PUBLIC_SCHEME=http \
    BLOCKGO_PUBLIC_HOSTING_CONFIG_FILE="$TEST_ROOT/missing.env" \
    BLOCKGO_RENDER_DIR="$TEST_ROOT/insecure-production" \
    bash "$DEPLOY_SCRIPT" production hosting-plan >"$TEST_ROOT/insecure-production.log" 2>&1; then
    fail "production accepted an insecure public HTTP scheme"
fi
assert_contains "$TEST_ROOT/insecure-production.log" "Production requires BLOCKGO_PUBLIC_SCHEME=https"

if run_plan "$TEST_ROOT/invalid-ip" example.com BLOCKGO_PUBLIC_IP=999.1.1.1 >"$TEST_ROOT/invalid-ip.log" 2>&1; then
    fail "production accepted an invalid public IPv4 address"
fi
assert_contains "$TEST_ROOT/invalid-ip.log" "BLOCKGO_PUBLIC_IP must be a valid IPv4 address"

if env -u BLOCKGO_PUBLIC_IP \
    BLOCKGO_PUBLIC_HOST=example.com \
    BLOCKGO_PUBLIC_SCHEME=https \
    BLOCKGO_PUBLIC_TLS_SECRET=example-tls \
    BLOCKGO_PUBLIC_HOSTING_CONFIG_FILE="$TEST_ROOT/missing.env" \
    BLOCKGO_RENDER_DIR="$TEST_ROOT/missing-ip" \
    bash "$DEPLOY_SCRIPT" production hosting-plan >"$TEST_ROOT/missing-ip.log" 2>&1; then
    fail "production accepted a missing public IPv4 address"
fi
assert_contains "$TEST_ROOT/missing-ip.log" "BLOCKGO_PUBLIC_IP must be set"

if run_plan "$TEST_ROOT/wildcard" example.com BLOCKGO_ALLOWED_ORIGINS='*' >"$TEST_ROOT/wildcard.log" 2>&1; then
    fail "production accepted wildcard CORS"
fi

cat >"$TEST_ROOT/hosting.env" <<'ENV'
BLOCKGO_PUBLIC_HOST=file.example.edu.ph
BLOCKGO_PUBLIC_IP=203.0.113.11
BLOCKGO_PUBLIC_SCHEME=https
BLOCKGO_PUBLIC_TLS_SECRET=file-tls
ENV
env -u BLOCKGO_PUBLIC_HOST -u BLOCKGO_PUBLIC_IP -u BLOCKGO_PUBLIC_SCHEME -u BLOCKGO_PUBLIC_TLS_SECRET \
    BLOCKGO_PUBLIC_HOSTING_CONFIG_FILE="$TEST_ROOT/hosting.env" \
    BLOCKGO_RENDER_DIR="$TEST_ROOT/from-file" \
    bash "$DEPLOY_SCRIPT" production hosting-plan >"$TEST_ROOT/from-file.log"
assert_contains "$TEST_ROOT/from-file/15-main-ingress.yaml" "- host: file.example.edu.ph"
assert_contains "$TEST_ROOT/from-file/02-public-hosting.yaml" 'BLOCKGO_PUBLIC_IP: "203.0.113.11"'

BLOCKGO_PUBLIC_HOST=environment.example.edu.ph \
    BLOCKGO_PUBLIC_HOSTING_CONFIG_FILE="$TEST_ROOT/hosting.env" \
    BLOCKGO_RENDER_DIR="$TEST_ROOT/from-environment" \
    bash "$DEPLOY_SCRIPT" production hosting-plan >"$TEST_ROOT/from-environment.log"
assert_contains "$TEST_ROOT/from-environment/15-main-ingress.yaml" "- host: environment.example.edu.ph"

BLOCKGO_PUBLIC_HOST=render.example.edu.ph \
    BLOCKGO_PUBLIC_IP=203.0.113.12 \
    BLOCKGO_PUBLIC_TLS_SECRET=render-tls \
    BLOCKGO_PUBLIC_HOSTING_CONFIG_FILE="$TEST_ROOT/missing.env" \
    BLOCKGO_RENDER_DIR="$TEST_ROOT/production-full" \
    PRODUCTION_IMAGE_REPOSITORY=asia-southeast1-docker.pkg.dev/example-project/blockgo \
    PRODUCTION_IMAGE_TAG=immutable-test-tag \
    GKE_REGION=asia-southeast1 \
    bash -c 'source "$1" production hosting-plan; prepare_manifests' _ "$DEPLOY_SCRIPT" \
    >"$TEST_ROOT/production-full.log"
assert_contains "$TEST_ROOT/production-full/12-frontend-ha.yaml" 'image: asia-southeast1-docker.pkg.dev/example-project/blockgo/frontend:immutable-test-tag'
assert_contains "$TEST_ROOT/production-full/08-middleware-api.yaml" 'FABRIC_HA_ENABLED: "false"'
if grep -R -E -q '(^|[[:space:]{])storage: (2|5)Gi' "$TEST_ROOT/production-full"; then
    fail 'production render retained a PVC smaller than the 10Gi pd-standard minimum'
fi
assert_contains "$TEST_ROOT/production-full/15-postgres-backup.yaml" 'ephemeral-storage: 2Gi'
if grep -R -q '__GKE_ZONE_[ABC]__' "$TEST_ROOT/production-full"; then
    fail "GKE zone placeholder was not rendered"
fi

BLOCKGO_PUBLIC_HOST=render.example.edu.ph \
    BLOCKGO_PUBLIC_IP=203.0.113.12 \
    BLOCKGO_PUBLIC_TLS_SECRET=render-tls \
    BLOCKGO_PUBLIC_HOSTING_CONFIG_FILE="$TEST_ROOT/missing.env" \
    BLOCKGO_RENDER_DIR="$TEST_ROOT/production-secondary" \
    PRODUCTION_IMAGE_REPOSITORY=asia-southeast1-docker.pkg.dev/example-project/blockgo \
    PRODUCTION_IMAGE_TAG=immutable-test-tag \
    GKE_REGION=asia-southeast1 \
    DEPLOY_SECONDARY_PEERS=true \
    bash -c 'source "$1" production hosting-plan; prepare_manifests' _ "$DEPLOY_SCRIPT" \
    >"$TEST_ROOT/production-secondary.log"
assert_contains "$TEST_ROOT/production-secondary/08-middleware-api.yaml" 'FABRIC_HA_ENABLED: "true"'

BLOCKGO_PUBLIC_HOSTING_CONFIG_FILE="$TEST_ROOT/missing.env" \
    BLOCKGO_RENDER_DIR="$TEST_ROOT/local-full" \
    bash -c 'source "$1" local verify; prepare_manifests' _ "$DEPLOY_SCRIPT" \
    >"$TEST_ROOT/local-full.log"
assert_contains "$TEST_ROOT/local-full/02-public-hosting.yaml" 'BLOCKGO_PUBLIC_HOST: "localhost"'
assert_contains "$TEST_ROOT/local-full/02-public-hosting.yaml" 'BLOCKGO_PUBLIC_IP: "127.0.0.1"'
if grep -R -q 'registry.example.com/plv-repo/' "$TEST_ROOT/local-full"; then
    fail "local profile retained production image placeholders"
fi

run_plan "$TEST_ROOT/first" blockgo.example.edu.ph \
    BLOCKGO_ALLOWED_ORIGINS='https://blockgo.example.edu.ph,https://www.blockgo.example.edu.ph' \
    >"$TEST_ROOT/first.log"

assert_contains "$TEST_ROOT/first/15-main-ingress.yaml" "- host: blockgo.example.edu.ph"
assert_contains "$TEST_ROOT/first/15-main-ingress.yaml" "- blockgo.example.edu.ph"
assert_contains "$TEST_ROOT/first/15-main-ingress.yaml" "secretName: rotation-tls"
assert_contains "$TEST_ROOT/first/02-public-hosting.yaml" 'BLOCKGO_PUBLIC_ORIGIN: "https://blockgo.example.edu.ph"'
assert_contains "$TEST_ROOT/first/02-public-hosting.yaml" 'BLOCKGO_PUBLIC_API_URL: "https://blockgo.example.edu.ph/api"'
assert_contains "$TEST_ROOT/first/02-public-hosting.yaml" 'BLOCKGO_PUBLIC_WEBSOCKET_URL: "wss://blockgo.example.edu.ph"'
assert_contains "$TEST_ROOT/first/02-public-hosting.yaml" 'BLOCKGO_DNS_PROVIDER: "Cloudflare"'
assert_contains "$TEST_ROOT/first/02-public-hosting.yaml" 'BLOCKGO_CLOUDFLARE_PROXY: "Enabled"'
assert_contains "$TEST_ROOT/first/02-public-hosting.yaml" 'BLOCKGO_ORIGIN_HTTPS: "Required"'
assert_contains "$TEST_ROOT/first/02-public-hosting.yaml" 'CORS_ORIGINS: "https://blockgo.example.edu.ph,https://www.blockgo.example.edu.ph"'
assert_contains "$TEST_ROOT/first/12-frontend-nginx-config.yaml" "sub_filter '__BLOCKGO_RUNTIME_PUBLIC_ORIGIN__' 'https://blockgo.example.edu.ph';"

if grep -R -q -E '__BLOCKGO_PUBLIC_[A-Z_]+__|__BLOCKGO_ALLOWED_ORIGINS__' "$TEST_ROOT/first"; then
    fail "rendered hosting manifests contain unresolved placeholders"
fi

run_plan "$TEST_ROOT/second" rotated.example.net >"$TEST_ROOT/second.log"
assert_contains "$TEST_ROOT/second/15-main-ingress.yaml" "- host: rotated.example.net"
if grep -R -q 'blockgo.example.edu.ph' "$TEST_ROOT/second"; then
    fail "a previous public hostname leaked into a later render"
fi

if find "$TEST_ROOT/first" -type f \( -name '06-orderer*' -o -name '07-peer*' \) | grep -q .; then
    fail "hosting plan rendered Fabric orderer or peer manifests"
fi
if grep -q 'type:[[:space:]]*LoadBalancer' "$SCRIPT_DIR"/06-orderer-*.yaml "$SCRIPT_DIR"/07-peer-*.yaml; then
    fail "an orderer or peer Service is publicly exposed"
fi
if ! grep -q 'grpcs://orderer-1.plv-main-campus.svc.cluster.local:7050' "$SCRIPT_DIR/02-configmap-secret.yaml"; then
    fail "primary internal orderer endpoint changed"
fi
for endpoint in \
    'grpcs://orderer-2.plv-main-campus.svc.cluster.local:7050' \
    'grpcs://orderer-3.plv-annex-campus.svc.cluster.local:7050' \
    'grpcs://orderer-4.plv-annex-campus.svc.cluster.local:7050' \
    'grpcs://orderer-5.plv-pubad-campus.svc.cluster.local:7050' \
    'grpcs://orderer-6.plv-pubad-campus.svc.cluster.local:7050' \
    'grpcs://peer-registrar-2.plv-main-campus.svc.cluster.local:7051' \
    'grpcs://peer-faculty-2.plv-annex-campus.svc.cluster.local:7051' \
    'grpcs://peer-department-2.plv-pubad-campus.svc.cluster.local:7051'; do
    grep -q "$endpoint" "$SCRIPT_DIR/08-middleware-api.yaml" || fail "internal Fabric endpoint changed: ${endpoint}"
done
for endpoint in \
    'grpcs://peer-registrar.plv-main-campus.svc.cluster.local:7051' \
    'grpcs://peer-faculty.plv-annex-campus.svc.cluster.local:7051' \
    'grpcs://peer-department.plv-pubad-campus.svc.cluster.local:7051'; do
    grep -q "$endpoint" ../middleware/src/fabric/gateway-manager.js || fail "primary internal peer endpoint changed: ${endpoint}"
done

if grep -R -q 'plv-blockgo.com' ../frontend/src ../frontend/public "$SCRIPT_DIR/15-main-ingress.yaml"; then
    fail "frontend or ingress source still hardcodes the former public hostname"
fi
assert_contains ../frontend/src/services/api.js "return '/api';"
assert_contains "$SCRIPT_DIR/08-middleware-api.yaml" 'configMapRef: { name: blockgo-public-hosting }'
assert_contains "$SCRIPT_DIR/14-client-app.yaml" 'configMapRef: { name: blockgo-public-hosting }'
assert_contains ../client-app/Program.cs 'builder.Configuration["CORS_ORIGINS"]'

auth_manifest="$(sed -n '/name: auth-service$/,/name: fabric-identity-service$/p' "$SCRIPT_DIR/08-middleware-api.yaml")"
grep -F -q 'configMapRef: { name: blockgo-public-hosting }' <<< "$auth_manifest" \
    || fail "auth-service does not consume the authoritative public origin"
if grep -F -q 'secretKeyRef: { name: blockgo-secrets, key: FRONTEND_URL' <<< "$auth_manifest"; then
    fail "auth-service still overrides the public origin from blockgo-secrets"
fi

mock_bin="$TEST_ROOT/mock-bin"
mkdir -p "$mock_bin"

command -v openssl >/dev/null 2>&1 || fail "openssl is required for public TLS regression tests"
openssl_subject='/CN=tls.example.com'
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) openssl_subject='//CN=tls.example.com' ;;
esac
openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$TEST_ROOT/tls.key" \
    -out "$TEST_ROOT/tls.crt" \
    -days 1 \
    -subj "$openssl_subject" \
    -addext 'subjectAltName=DNS:tls.example.com' \
    >/dev/null 2>&1
tls_cert_b64="$(base64 < "$TEST_ROOT/tls.crt" | tr -d '\r\n')"
tls_key_b64="$(base64 < "$TEST_ROOT/tls.key" | tr -d '\r\n')"

cat >"$mock_bin/kubectl" <<'MOCK'
#!/usr/bin/env bash
case "$*" in
    *'.type'*) printf '%s' 'kubernetes.io/tls' ;;
    *'.data.tls\.crt'*) printf '%s' "$MOCK_TLS_CERT_B64" ;;
    *'.data.tls\.key'*) printf '%s' "$MOCK_TLS_KEY_B64" ;;
    *) echo "unexpected kubectl TLS query: $*" >&2; exit 99 ;;
esac
MOCK
chmod +x "$mock_bin/kubectl"

PATH="$mock_bin:$PATH" \
    MOCK_TLS_CERT_B64="$tls_cert_b64" \
    MOCK_TLS_KEY_B64="$tls_key_b64" \
    BLOCKGO_PUBLIC_HOST=tls.example.com \
    BLOCKGO_PUBLIC_IP=203.0.113.15 \
    BLOCKGO_PUBLIC_SCHEME=https \
    BLOCKGO_PUBLIC_TLS_SECRET=rotation-tls \
    BLOCKGO_PUBLIC_HOSTING_CONFIG_FILE="$TEST_ROOT/missing.env" \
    bash -c 'source "$1" production hosting-plan; validate_public_host_settings; validate_public_tls_secret' _ "$DEPLOY_SCRIPT" \
    >"$TEST_ROOT/valid-tls.log"
assert_contains "$TEST_ROOT/valid-tls.log" "current certificate covers tls.example.com"

if PATH="$mock_bin:$PATH" \
    MOCK_TLS_CERT_B64="$tls_cert_b64" \
    MOCK_TLS_KEY_B64="$tls_key_b64" \
    BLOCKGO_PUBLIC_HOST=wrong.example.com \
    BLOCKGO_PUBLIC_IP=203.0.113.15 \
    BLOCKGO_PUBLIC_SCHEME=https \
    BLOCKGO_PUBLIC_TLS_SECRET=rotation-tls \
    BLOCKGO_PUBLIC_HOSTING_CONFIG_FILE="$TEST_ROOT/missing.env" \
    bash -c 'source "$1" production hosting-plan; validate_public_host_settings; validate_public_tls_secret' _ "$DEPLOY_SCRIPT" \
    >"$TEST_ROOT/wrong-host-tls.log" 2>&1; then
    fail "public TLS validation accepted a certificate for the wrong hostname"
fi
assert_contains "$TEST_ROOT/wrong-host-tls.log" "does not cover wrong.example.com"

cat >"$mock_bin/kubectl" <<'MOCK'
#!/usr/bin/env bash
case "$*" in
    'get nodes -o wide'|'get storageclass'|'get pvc -A'|'get pv'|'get pods -A'|'get svc -A'|'get ingress -A') ;;
    *'.data.BLOCKGO_PUBLIC_HOST}'*) printf '%s' 'plv-blockgo.com' ;;
    *'.data.BLOCKGO_PUBLIC_IP}'*) printf '%s' '136.81.171.96' ;;
    *'.data.BLOCKGO_PUBLIC_SCHEME}'*) printf '%s' 'https' ;;
    *'.data.BLOCKGO_PUBLIC_ORIGIN}'*) printf '%s' 'https://plv-blockgo.com' ;;
    *'.data.BLOCKGO_PUBLIC_WEBSOCKET_URL}'*) printf '%s' 'wss://plv-blockgo.com' ;;
    *'.data.CORS_ORIGINS}'*) printf '%s' 'https://plv-blockgo.com' ;;
    *'.spec.tls'*'secretName}'*) printf '%s' 'blockgo-public-tls' ;;
    *'.status.loadBalancer.ingress'*'.ip}'*) printf '%s' '136.81.171.96' ;;
    *'.status.loadBalancer.ingress'*'.hostname}'*) ;;
    *) echo "unexpected kubectl status query: $*" >&2; exit 99 ;;
esac
MOCK
PATH="$mock_bin:$PATH" \
    BLOCKGO_PUBLIC_HOSTING_CONFIG_FILE="$TEST_ROOT/missing.env" \
    bash -c 'source "$1" production status; show_status' _ "$DEPLOY_SCRIPT" \
    >"$TEST_ROOT/status.log"
assert_contains "$TEST_ROOT/status.log" "Public URL:       https://plv-blockgo.com"
assert_contains "$TEST_ROOT/status.log" "Public IP:        136.81.171.96"
assert_contains "$TEST_ROOT/status.log" "DNS Provider:     Cloudflare"
assert_contains "$TEST_ROOT/status.log" "Cloudflare Proxy: Enabled"
assert_contains "$TEST_ROOT/status.log" "TLS:              HTTPS"
assert_contains "$TEST_ROOT/status.log" "TLS Secret:       blockgo-public-tls"
assert_contains "$TEST_ROOT/status.log" "Origin HTTPS:     Required"
assert_contains "$TEST_ROOT/status.log" "Fabric TLS: Unchanged"

cat >"$mock_bin/kubectl" <<'MOCK'
#!/usr/bin/env bash
echo "kubectl must not run during a hosting dry run" >&2
exit 99
MOCK
chmod +x "$mock_bin/kubectl"
PATH="$mock_bin:$PATH" \
    BLOCKGO_HOSTING_DRY_RUN=true \
    BLOCKGO_PUBLIC_HOST=dry-run.example.com \
    BLOCKGO_PUBLIC_IP=203.0.113.13 \
    BLOCKGO_PUBLIC_TLS_SECRET=rotation-tls \
    BLOCKGO_PUBLIC_HOSTING_CONFIG_FILE="$TEST_ROOT/missing.env" \
    BLOCKGO_RENDER_DIR="$TEST_ROOT/dry-run" \
    bash "$DEPLOY_SCRIPT" production apply-hosting >"$TEST_ROOT/dry-run.log"
assert_contains "$TEST_ROOT/dry-run.log" "Dry run only: no Kubernetes resources were changed."
if BLOCKGO_HOSTING_DRY_RUN=true bash "$DEPLOY_SCRIPT" local apply-hosting >"$TEST_ROOT/local-hosting.log" 2>&1; then
    fail "local profile accepted the production-only hosting action"
fi

cat >"$mock_bin/kubectl" <<'MOCK'
#!/usr/bin/env bash
if [[ "${1:-}" == "cluster-info" ]]; then
    exit 1
fi
echo "unexpected kubectl operation: $*" >&2
exit 99
MOCK
if PATH="$mock_bin:$PATH" \
    BLOCKGO_PUBLIC_HOST=offline.example.com \
    BLOCKGO_PUBLIC_IP=203.0.113.14 \
    BLOCKGO_PUBLIC_TLS_SECRET=rotation-tls \
    BLOCKGO_PUBLIC_HOSTING_CONFIG_FILE="$TEST_ROOT/missing.env" \
    BLOCKGO_RENDER_DIR="$TEST_ROOT/offline" \
    bash "$DEPLOY_SCRIPT" production apply-hosting >"$TEST_ROOT/offline.log" 2>&1; then
    fail "apply-hosting succeeded while the Kubernetes API was unavailable"
fi
assert_contains "$TEST_ROOT/offline.log" "Kubernetes changes were not applied because the cluster API is unavailable"

hosting_function="$(sed -n '/^apply_public_hosting()/,/^}/p' "$DEPLOY_SCRIPT")"
grep -F -q 'deployment/auth-service' <<< "$hosting_function" \
    || fail "hosting-only action does not restart the auth-service public-origin consumer"
if grep -F -q 'kubectl set env' <<< "$hosting_function"; then
    fail "hosting-only action imperatively duplicates ConfigMap environment values"
fi
for forbidden in deploy_orderers_sequentially bootstrap_fabric install-chaincode rebootstrap delete_resources 'kubectl delete' 'kubectl scale'; do
    if grep -F -q "$forbidden" <<< "$hosting_function"; then
        fail "hosting-only action contains forbidden operation ${forbidden}"
    fi
done

grep -q 'apply|apply-application|apply-hosting|hosting-plan' "$DEPLOY_SCRIPT" \
    || fail "deployment action allowlist does not preserve apply-application"

fabric_config_hash_after="$(sha256sum config/configtx-k8s.yaml | awk '{print $1}')"
[[ "$fabric_config_hash_before" == "$fabric_config_hash_after" ]] \
    || fail "hosting render modified historical Fabric channel configuration"

echo "Public-hosting regression tests passed."
