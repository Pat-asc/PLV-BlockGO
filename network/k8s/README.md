# K8s Deployment Guide for PLV BLOCKGO

## Quick Start

### 1. Prerequisites
- Kubernetes cluster (v1.24+) running (local: Docker Desktop, minikube, kind)
- `kubectl` CLI installed and configured
- Sufficient resources: 4 CPU cores and 8GB RAM for the local profile; size
  production clusters from measured load (16GB RAM or more is recommended)
- Production: Google Cloud SDK, Docker, a GCP project, and three zones in one
  GKE region

### 2. Deploy to Kubernetes

```bash
# Navigate to the network directory
cd ../network
chmod +x ./full_deploy.sh

# Local testing profile
./k8s/deploy-k8s.sh local apply

# The local frontend and API gateway are exposed automatically at:
# http://localhost:8080

# Create or connect to the regional GKE cluster (one node pool node per zone)
export GCP_PROJECT_ID="project-fa00844e-5237-451f-a95"
export GKE_CLUSTER_NAME="blockgo-prod"
export GKE_REGION="asia-east1"
# Recommended: a least-privilege GKE node service account
export GKE_NODE_SERVICE_ACCOUNT="blockgo-gke@your-project.iam.gserviceaccount.com"
./k8s/deploy-k8s.sh production gke-setup

# Generate/refresh Fabric identities first. Production TLS certificates must
# contain the Kubernetes service DNS names for all six peers and orderers.
./full_deploy.sh

# Production/GKE profile. Use an Artifact Registry path and immutable tag.
export PRODUCTION_IMAGE_REPOSITORY="asia-east1-docker.pkg.dev/project-fa00844e-5237-451f-a95/blockgo"
export PRODUCTION_IMAGE_TAG="<release-or-commit-sha>"
export BLOCKGO_PUBLIC_HOST="plv-blockgo.com"
export BLOCKGO_PUBLIC_IP="136.81.171.96"
export BLOCKGO_PUBLIC_SCHEME="https"
export BLOCKGO_PUBLIC_TLS_SECRET="blockgo-public-tls"
./k8s/deploy-k8s.sh production apply

# Monitor deployment status
./k8s/deploy-k8s.sh local status

# View edge-gateway logs
kubectl logs deployment/middleware-api -n plv-fabric -f
```

The local `apply` command rebuilds `frontend:latest`, the shared .NET
`client-app:latest` image, the shared middleware image, and all three chaincode
images directly from the current workspace before restarting the Kubernetes
Deployments. The .NET image runs as a gateway plus five independently deployed
services; the middleware image runs as its existing gateway and internal
services. The command also stops before
deployment if the required college grade-equivalent or Fabric timestamp fixes
are missing. This prevents Docker Desktop from silently reusing stale frontend
or backend images after a code change. Chaincode Deployments are restarted even
when their Fabric package IDs are unchanged, ensuring rebuilt chaincode images
also take effect.

Production `apply` builds and publishes the application images from this source
revision, generates a separate six-consenter channel block, validates certificate
expiry, CA chains, private-key matches, and Kubernetes DNS SANs, and then deploys
the HA topology. Local channel artifacts remain three-consenter artifacts.

### Public hosting and Cloudflare DNS

Cloudflare remains the authoritative public DNS/proxy layer. The Kubernetes
ingress is the origin behind Cloudflare, while PostgreSQL, CouchDB, peers,
orderers, and middleware-to-Fabric traffic continue to use Kubernetes internal
DNS. Changing the website hostname never requires regenerating Fabric TLS/MSP
material or changing a Fabric channel.

Production requires a hostname-only `BLOCKGO_PUBLIC_HOST`, its GKE origin IPv4
address in `BLOCKGO_PUBLIC_IP`, and `BLOCKGO_PUBLIC_SCHEME=https`. Production
rejects HTTP; the HTTP exception is confined to the explicit `local` profile.
Public-hosting
configuration precedence is:

1. Explicit environment variables.
2. `k8s/production-hosting.env`, when present.
3. Safe defaults for the scheme (`https`), TLS Secret
   (`blockgo-public-tls`), and allowed origins (the configured public origin).

The optional file is non-secret; use `k8s/production-hosting.env.example` as a
template. Never put Cloudflare credentials, TLS private keys, database
passwords, or application secrets in that file. The referenced TLS Secret must
already exist in `plv-fabric` with type `kubernetes.io/tls`. Before changing the
ingress, the deployment validates that `tls.crt` is current, covers the public
hostname, and matches `tls.key`.

Create the public origin certificate Secret separately from every Fabric TLS
Secret. Use either a Cloudflare Origin CA certificate or a publicly trusted
certificate that covers `plv-blockgo.com`:

```bash
kubectl create namespace plv-fabric --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret tls blockgo-public-tls \
  --namespace plv-fabric \
  --cert=/secure/path/plv-blockgo.com-origin.crt \
  --key=/secure/path/plv-blockgo.com-origin.key
```

In Cloudflare, configure an orange-cloud proxied `A` record for
`plv-blockgo.com` pointing to `136.81.171.96`, and set SSL/TLS encryption mode
to **Full (strict)**. The Kubernetes ingress terminates HTTPS again at the GCP
origin. The current ingress exposes only `plv-blockgo.com`; `www.plv-blockgo.com`
should be redirected at Cloudflare unless a second ingress host and a certificate
SAN for `www.plv-blockgo.com` are deliberately added.

Render and validate a hosting change without accessing Kubernetes:

```bash
export BLOCKGO_PUBLIC_HOST="plv-blockgo.com"
export BLOCKGO_PUBLIC_IP="136.81.171.96"
export BLOCKGO_PUBLIC_SCHEME="https"
export BLOCKGO_PUBLIC_TLS_SECRET="blockgo-public-tls"

./k8s/deploy-k8s.sh production hosting-plan
```

Apply only public hosting, CORS, frontend Nginx, and ingress configuration:

```bash
./k8s/deploy-k8s.sh production apply-hosting
```

For a future domain rotation:

```bash
export BLOCKGO_PUBLIC_HOST="blockgo.example.edu.ph"
export BLOCKGO_PUBLIC_IP="203.0.113.10"
export BLOCKGO_PUBLIC_SCHEME="https"
export BLOCKGO_PUBLIC_TLS_SECRET="blockgo-public-tls"
export BLOCKGO_ALLOWED_ORIGINS="https://blockgo.example.edu.ph"

./k8s/deploy-k8s.sh production hosting-plan
./k8s/deploy-k8s.sh production apply-hosting
```

The command discovers either the ingress IP address or provider hostname and
prints the Cloudflare DNS action. It never calls a Cloudflare API and never
stores a Cloudflare token. If allocation is not complete, it reports that the
external ingress address is pending. Browser API, SignalR, and IPFS requests
remain same-origin (`/api`, `/chatHub`, and `/ipfs`).
Because the page is HTTPS, the browser upgrades the SignalR/WebSocket endpoint
to `wss://<public-host>/chatHub`; no production `ws://` endpoint is configured.

`./k8s/deploy-k8s.sh production status` reports the configured public URL and
IP, Cloudflare proxy expectation, HTTPS/TLS Secret state, strict origin HTTPS
requirement, and the separate unchanged Fabric TLS boundary.

The hosting-only action does not apply or restart orderers or peers, run
`InitLedger`, install chaincode, modify channels, regenerate Fabric crypto, or
touch database/ledger PVCs.

### Automated PostgreSQL backups

Production deploys the `postgres-backup` CronJob in `plv-main-campus`. At
00:00 and 12:00 UTC it runs `pg_dump`, compresses the SQL dump, encrypts it
with GnuPG AES-256, creates a SHA-256 checksum, and uploads both files under
`gs://BUCKET/postgres/DATABASE/TIMESTAMP/`. The unencrypted archive exists only
inside the Job's temporary `emptyDir` and is removed when the Job exits.

Add these values to `network/.env` before running `production apply`:

```dotenv
POSTGRES_BACKUP_GCS_BUCKET=your-private-blockgo-backups
POSTGRES_BACKUP_ENCRYPTION_KEY=<strong-random-passphrase-kept-outside-the-cluster>
```

`production gke-setup` enables Workload Identity Federation for GKE. After the
bucket exists, grant only object-creation access to the Kubernetes service
account used by the CronJob:

```bash
export GCP_PROJECT_ID="your-project"
export POSTGRES_BACKUP_GCS_BUCKET="your-private-blockgo-backups"
export GCP_PROJECT_NUMBER="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"
export POSTGRES_BACKUP_PRINCIPAL="principal://iam.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${GCP_PROJECT_ID}.svc.id.goog/subject/ns/plv-main-campus/sa/postgres-backup"

gcloud storage buckets create "gs://${POSTGRES_BACKUP_GCS_BUCKET}" \
  --project="$GCP_PROJECT_ID" \
  --location="$GKE_REGION" \
  --uniform-bucket-level-access

gcloud storage buckets add-iam-policy-binding "gs://${POSTGRES_BACKUP_GCS_BUCKET}" \
  --member="$POSTGRES_BACKUP_PRINCIPAL" \
  --role=roles/storage.objectCreator \
  --condition=None
```

Configure a Cloud Storage lifecycle rule on the bucket for the required backup
retention period. Keep the encryption passphrase in a separate recovery vault;
losing it makes the uploaded backups unusable.

Test one backup without waiting for the schedule:

```bash
JOB_NAME="postgres-backup-manual-$(date +%s)"
kubectl create job --from=cronjob/postgres-backup "$JOB_NAME" -n plv-main-campus
kubectl wait --for=condition=complete "job/$JOB_NAME" -n plv-main-campus --timeout=2h
kubectl logs "job/$JOB_NAME" -n plv-main-campus
```

The backup executable runs in the purpose-built Linux workload image from
`k8s/postgres-backup/Dockerfile`; `pg_dump`, GPG, and the Google Cloud CLI are
not required on a developer laptop. GitHub Actions validates the shell script
and Kubernetes schema on `ubuntu-latest`. Windows developers should continue
running `deploy-k8s.sh` through Git Bash or WSL as the existing deployment
runner expects Bash. The local profile prepares and validates the manifest but
does not deploy the cloud backup CronJob or require GCS credentials.

The local profile does not create application HPAs because Docker Desktop does
not expose the `metrics.k8s.io` resource metrics API by default. The production
profile applies `11a-application-hpa.yaml`; confirm the target cluster provides
the resource metrics API before deploying.

The local profile is tuned for an 8GB Docker Desktop Kubernetes node. It runs
one replica of each application service, uses no-surge restarts, removes any
production `ResourceQuota`/`LimitRange` objects left behind in the local
namespaces, and applies bounded per-service memory settings. Production
replicas, admission policies, and resource settings are unchanged.

### 3. Verify Deployment

```bash
# Check all pods running
kubectl get pods -n plv-fabric
kubectl get pods -n plv-main-campus

# Check services
kubectl get svc -n plv-fabric
kubectl get svc -n plv-main-campus

# Check persistent volumes
kubectl get pvc --all-namespaces
```

### 4. Access the API

For the local profile, use `http://localhost:8080`. The frontend Nginx service
routes browser requests to the middleware, C# backend, SignalR hub, and IPFS
services inside Kubernetes. The deployment script owns the background
port-forward and `./k8s/deploy-k8s.sh local delete` stops it forcefully.

The public compatibility API remains on `middleware-api:4000`. It routes to
independently deployed auth, Fabric identity, ledger, upload, and settings
services. Direct gateway access is optional for debugging:

```bash
# Port-forward middleware API
kubectl port-forward -n plv-fabric svc/middleware-api 4000:4000

# Test health endpoint
curl http://localhost:4000/api/health
curl http://localhost:4000/api/ready
```

The readiness response reports each internal service independently. Internal
Services are ClusterIP-only and are not exposed through Ingress.

The existing `client-app-service:5000` address is also retained as a stable
compatibility endpoint, but it now selects `dotnet-api-gateway` rather than a
monolithic backend. The gateway routes requests to these ClusterIP-only .NET
services:

| .NET service | Internal port | Responsibility |
|---|---:|---|
| `dotnet-auth-service` | 5101 | Authentication, accounts, password resets, and enrollment requests |
| `dotnet-academic-service` | 5102 | Curricula, grade templates, sectioning, dashboards, and search |
| `dotnet-grade-service` | 5103 | Grade workflows, student records, and bulk uploads |
| `dotnet-operations-service` | 5104 | Settings, monitoring, support tickets, and keep-alive tasks |
| `dotnet-realtime-service` | 5105 | SignalR `/chatHub` connections and notifications |

For direct .NET gateway diagnostics:

```bash
kubectl port-forward -n plv-fabric svc/dotnet-api-gateway 5000:5000
curl http://localhost:5000/health
curl http://localhost:5000/api/ready
```

`/api/ready` reports the availability of all five internal .NET services.

### System Administrator Portal

The system administrator uses the normal frontend login page and is routed to
the dedicated monitoring portal. This role is database-only: it is not enrolled
with a Fabric CA, does not receive a Fabric wallet, and does not load academic
grade or chat features.

Set a strong, unique password in `network/.env` before deployment to provision
the account through the internal bootstrap job:

```dotenv
BOOTSTRAP_SYSTEM_ADMIN_EMAIL=system-admin@plv.edu.ph
BOOTSTRAP_SYSTEM_ADMIN_PASS=<strong-unique-password>
```

The bootstrap creates the account only when it does not exist and never prints
the password. Changing the environment variable later does not rotate an
existing account password.

Cluster resource metrics and alerts are optional. Set `PROMETHEUS_URL` to a URL
reachable from the `client-app` pod when Prometheus is deployed. Without it,
the portal still checks frontend, middleware, backend, and PostgreSQL health and
reports Prometheus as `not configured`.

### 5. Fabric Network Bootstrap

`deploy-k8s.sh ... apply` automatically joins all configured orderers and peers to
`registrar-channel`, installs the organization-specific CCaaS packages,
approves and commits the chaincode, and initializes the genesis record.

To rerun the idempotent bootstrap manually:

```bash
./k8s/init-channel.sh
./k8s/join-peers.sh
./k8s/install-chaincode.sh
```

The local scripts default `KUBECTL_REMOTE_COMMAND_WEBSOCKETS=false` so Fabric
bootstrap remains compatible with Docker Desktop 4.80 / Kubernetes 1.36. Set
the variable explicitly to override that transport choice. Docker Desktop
4.83 and later contain the upstream `kubectl exec`/`attach` fix.

Set `FABRIC_BOOTSTRAP=false` when running `deploy-k8s.sh` only when manifests
must be applied without changing Fabric channel or chaincode state.

### 6. CouchDB Data Locations

- Wallet CouchDB services store Fabric identities only. They do not store
  grades. A successful `local apply` starts authenticated, localhost-only
  Kubernetes port-forwards automatically:

  - Registrar: `http://localhost:5990/_utils/`
  - Faculty: `http://localhost:6990/_utils/`
  - Department: `http://localhost:7990/_utils/`

  The deployment script tracks these helper processes and stops them during
  `./k8s/deploy-k8s.sh local delete`. If a tunnel exits because its pod is
  replaced, rerunning `local apply` recreates and verifies it.
- Peer CouchDB services store Fabric world state. For Compose, the registrar
  peer database is exposed at `http://localhost:5986/_utils/`. A successful
  Kubernetes `local apply` now preserves that same address with an
  authenticated, localhost-only `5986:5984` port-forward:

```bash
kubectl port-forward --address=127.0.0.1 -n plv-main-campus svc/couchdb-registrar 5986:5984
```

Production CouchDB Services remain `ClusterIP` and are never published by this
script. Inspect production databases only from a trusted administrative host
using an explicit `kubectl port-forward`, VPN, or equivalent private access;
do not expose CouchDB directly through a public Ingress or LoadBalancer.

After bootstrap, CouchDB creates `registrar-channel_registrar`. It contains the
genesis record and grades that have completed registrar finalization. Grades
that are still being encoded, reviewed, returned, or department-approved remain
in PostgreSQL `pending_grade_records` until finalization succeeds.

## Architecture Overview

### Namespaces
- **plv-fabric**: Core blockchain + IPFS + API middleware
- **plv-main-campus**: Registrar org (orderer, peer, CA)
- **plv-annex-campus**: Faculty org (CA, peer, CouchDB)
- **plv-pubad-campus**: Department org (CA, peer, CouchDB)

### Components

| Component | Type | Replicas | Storage |
|-----------|------|----------|---------|
| PostgreSQL | StatefulSet | local: 1; production: 6 (1 writer + 5 streaming standbys) | 20Gi each |
| Fabric Orderer | Deployment | local: 3; production: 6 | 10Gi each |
| Fabric Peer | Deployment | 3 primary; 3 optional secondary | 20Gi each |
| Fabric CA | Deployment | 3 | production: 10Gi each; local: 2Gi |
| Peer state CouchDB | StatefulSet | 3 primary; 3 optional secondary | 10Gi each |
| Wallet CouchDB | StatefulSet | 3 | production: 10Gi each; local: 5Gi |
| Middleware gateway and services | Deployments | 2-4 each (HPA) | ephemeral |
| .NET gateway and services | Deployments | 2-4 each (HPA) | ephemeral |
| IPFS Nodes | StatefulSet | 3 (Main, Annex, Pubad) | production: 10Gi each; local: 5Gi source request |

## Storage

- **Local**: static host-path PVs bind to `fabric-storage`
- **GKE production**: `fabric-storage` uses the GKE PD CSI driver with
  `pd-standard` zonal persistent disks, `Retain`, and delayed binding. Existing
  PVCs are never shrunk automatically; the deployment preflight rejects a
  changed claim size on an existing installation.
  Production rendering raises local 2Gi/5Gi claims to the 10Gi minimum for
  zonal `pd-standard`; it does not rewrite the local profile manifests.

The five-worker cap uses at most 10 VM vCPUs. GKE's `maxSurge` setting is
per zone, so the three-zone node pool uses zero surge and one unavailable
node during upgrades under the 12-vCPU quota. Secondary Fabric peers are not
deployed by default; set `DEPLOY_SECONDARY_PEERS=true` only after checking
cluster capacity and the additional PVC costs.

### GKE three-zone placement

The production profile resolves `GKE_ZONE_A`, `GKE_ZONE_B`, and `GKE_ZONE_C`
from `GKE_REGION` (or from node labels) and replaces manifest placeholders before
apply. Every campus pair is split across zones, while orderers are balanced two
per zone. A complete zone loss leaves four of six orderers, which is exactly the
Raft majority; do not take another orderer down until the zone recovers.

PostgreSQL intentionally has one writable primary and five streaming standbys.
The manifests do not perform automatic leader election or service failover.
Promotion and repointing `postgres.plv-main-campus.svc.cluster.local` remain an
operator recovery procedure; use a PostgreSQL operator/repmgr before promising
automatic database failover.

The six-consenter block is for a fresh production channel. Do not replace the
configuration of an existing three-orderer channel with it; add or remove Raft
consenters one at a time through channel configuration updates.

### Private IPFS Web UI

The Main, Annex, and Pubad repositories use one private swarm key and
intentionally have no public bootstrap peers. They form a full mesh, while
`ipfs-ha-api` and `ipfs-ha-gateway` provide automatic campus failover. The
cluster bootstrap job copies every existing recursive Main pin to Annex and
Pubad; new academic-record uploads are pinned on all three nodes by `client-app`.
The `ipfs-pin-reconciler` also synchronizes manual Web UI/API pins every minute
and lets a campus node catch up after it returns from an outage.

Kubo therefore cannot fetch its Web UI DAG from the public network at runtime.
`09a-ipfs-webui-bootstrap.yaml` downloads the Web UI CAR that matches Kubo 0.41,
imports it into all three repositories, and recursively pins it. The deployment
script reruns this idempotent bootstrap after the private mesh is ready.

With the frontend port-forward running, open:

```text
http://localhost:8080/ipfs-webui/
```

The Web UI uses the same-origin `/api/v0/` proxy. Keep this management route
limited to trusted administrator networks in production; the application-facing
encrypted record download path remains `/ipfs/<cid>`.

## Security

### Secrets Management
- Runtime credentials are generated from `network/.env` into `blockgo-secrets`
- `02-configmap-secret.yaml` contains only non-secret ConfigMaps
- Required application keys: `JWT_SECRET`, `INTERNAL_API_KEY`, `IPFS_ENCRYPTION_KEY`, `BOOTSTRAP_REGISTRAR_PASS`, `VAULT_PASSWORD`
- System administrator provisioning requires `BOOTSTRAP_SYSTEM_ADMIN_PASS`; `BOOTSTRAP_SYSTEM_ADMIN_EMAIL` is optional
- Monitoring integration uses optional `PROMETHEUS_URL`
- Production also requires real `POSTGRES_PASS`, `POSTGRES_REPL_PASS`, and `COUCHDB_PASS`
- For production: Use HashiCorp Vault, AWS Secrets Manager, or Azure Key Vault

### RBAC
- ServiceAccounts per component
- ClusterRoles restrict pod access to necessary resources

### Network Policies
- Deny-all ingress by default
- Allow specific pod-to-pod communication
- Restrict egress to necessary services

### TLS/mTLS
- Enabled for all Fabric components (CORE_PEER_TLS_ENABLED=true)
- Certificate paths mounted from secrets

## Troubleshooting

### Pod stuck in Pending
```bash
kubectl describe pod <pod-name> -n <namespace>
# Check PVC, StorageClass, resource limits
```

### Pod CrashLoopBackOff
```bash
kubectl logs <pod-name> -n <namespace> --previous
# Check environment variables, volume mounts
```

### Networking issues between pods
```bash
kubectl exec -it <pod-name> -n <namespace> -- ping <service-name>
# Verify DNS resolution and network policies
```

### Database connection errors
```bash
# Check PostgreSQL service
kubectl get svc postgres -n plv-main-campus
kubectl exec -it postgres-0 -n plv-main-campus -- psql -U BLOCKGO -d ActivityLogs

# Verify credentials in Secret
kubectl get secret blockgo-secrets -n plv-fabric -o yaml
```

## Cleanup

```bash
# Force-stop local PLV workloads and remove their namespaces, claims, and PVs.
# Project Docker Compose services, port-forwards, and the failover watchdog are
# also stopped. Files under network/fabric-k8s-data are preserved.
./k8s/deploy-k8s.sh local delete

# Graceful manual alternative
kubectl delete namespace plv-fabric plv-main-campus plv-annex-campus plv-pubad-campus
```

## Production Considerations

1. **High Availability**
   - Six independently persisted orderers are balanced across three zones
   - Two independently persisted peers are deployed per campus in different zones
   - PodDisruptionBudgets retain at least one orderer and peer per campus namespace
   - Six PostgreSQL copies are deployed, but database promotion is deliberately manual

2. **Persistent Storage**
   - Replace host-path with cloud storage (EBS, GCP PD, Azure Disk)
   - Enable automated backups
   - Test disaster recovery

3. **Monitoring**
   - Prometheus, Grafana, Loki, Grafana Alloy, kube-state-metrics, and postgres_exporter are deployed from `../monitoring/observability-stack.yaml`
   - Prometheus configuration and alert rules are loaded from `../monitoring/prometheus.yaml` and `../monitoring/alert-rules.yaml`
   - Grafana automatically provisions the overview, Kubernetes memory, API, Fabric, PostgreSQL, workflow, and Loki log dashboards
   - Grafana is a private ClusterIP service and is exposed only through the backend-authorized System Admin portal proxy
   - Scrape gateway metrics from `middleware-api:4000/metrics` and discover the five internal middleware Services through pod annotations
   - Use kube-state-metrics and cAdvisor panels for frontend, client-app, gateway, auth, identity, ledger, upload, and settings deployment health
   - Use `/nginx-health`, `/api/backend/health`, `/api/health`, and `/api/ready` for runtime health checks
   - Enable audit logging
   - Set up alerts for frontend/client-app availability, pod restarts, and memory pressure

4. **Secrets**
   - Rotate credentials regularly
   - Use external secrets operator
   - Encrypt secrets at rest (etcd encryption)

5. **Scaling**
   - HPAs configured independently for the API gateway, auth, ledger, and upload workloads
   - Consider KPA (Knative) for auto-scaling
   - Monitor resource usage

## References

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Hyperledger Fabric on Kubernetes](https://hyperledger-fabric.readthedocs.io/)
- [IPFS Kubernetes Deployment](https://docs.ipfs.io/how-to/run-ipfs-inside-docker/)
