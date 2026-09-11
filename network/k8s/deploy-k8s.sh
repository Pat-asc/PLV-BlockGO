#!/usr/bin/env bash

# Deploy PLV BLOCKGO Multi-Campus Fabric Network to Kubernetes.
# Usage:
#   ./k8s/deploy-k8s.sh local apply
#   ./k8s/deploy-k8s.sh production apply
#   ./k8s/deploy-k8s.sh local verify
#   ./k8s/deploy-k8s.sh production status
#   ./k8s/deploy-k8s.sh production gke-setup
#   ./k8s/deploy-k8s.sh local delete
#   ./k8s/deploy-k8s.sh local repair-fabric
#   ./k8s/deploy-k8s.sh local diagnose
#   ./k8s/deploy-k8s.sh local rebootstrap-peers
# Known local auto-repairs: Fabric LevelDB/index failures plus missing IPFS FlatFS blocks/SHARDING metadata
# repair-fabric also scans IPFS nodes; local apply uses the same guarded IPFS SHARDING recovery automatically.

set -euo pipefail

SCRIPT_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(dirname "$SCRIPT_SOURCE")"
NETWORK_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$NETWORK_ROOT"

PROFILE="${K8S_PROFILE:-local}"
ACTION="${1:-apply}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-20m}"
PRODUCTION_IMAGE_REPOSITORY="${PRODUCTION_IMAGE_REPOSITORY:-}"
PRODUCTION_IMAGE_TAG="${PRODUCTION_IMAGE_TAG:-}"
LOCAL_IMAGE_TAG="${LOCAL_IMAGE_TAG:-blockgo-local-$(date -u +%Y%m%d%H%M%S)}"
ORDERER_FAILURE_DETECTION_SECONDS="${ORDERER_FAILURE_DETECTION_SECONDS:-45}"
ORDERER_REPAIR_POD_IMAGE="${ORDERER_REPAIR_POD_IMAGE:-alpine:latest}"
PEER_FAILURE_DETECTION_SECONDS="${PEER_FAILURE_DETECTION_SECONDS:-45}"
PEER_REPAIR_POD_IMAGE="${PEER_REPAIR_POD_IMAGE:-alpine:latest}"
IPFS_FAILURE_DETECTION_SECONDS="${IPFS_FAILURE_DETECTION_SECONDS:-45}"
IPFS_REPAIR_POD_IMAGE="${IPFS_REPAIR_POD_IMAGE:-alpine:3.20}"
PVC_BINDING_TIMEOUT_SECONDS="${PVC_BINDING_TIMEOUT_SECONDS:-180}"
REPAIR_AUDIT_DIR="${REPAIR_AUDIT_DIR:-./k8s/.repair-audit}"
PEER_DETECTED_FAILURE_TYPE=""
ORDERER_DETECTED_FAILURE_TYPE=""
ACTIVE_REPAIR_DEPLOYMENT=""
ACTIVE_REPAIR_NAMESPACE=""
ACTIVE_REPAIR_REPLICAS=""
ACTIVE_REPAIR_POD=""
FABRIC_CHANNEL_NAME="${FABRIC_CHANNEL_NAME:-registrar-channel}"
PEER_REBOOTSTRAP_TARGETS="${PEER_REBOOTSTRAP_TARGETS:-}"
PEER_REBOOTSTRAP_POD_IMAGE="${PEER_REBOOTSTRAP_POD_IMAGE:-alpine:3.20}"
REINSTALL_CHAINCODE_AFTER_REBOOTSTRAP="${REINSTALL_CHAINCODE_AFTER_REBOOTSTRAP:-true}"
PEER_ALLOW_PRODUCTION_REBOOTSTRAP="${PEER_ALLOW_PRODUCTION_REBOOTSTRAP:-false}"
if [[ "${1:-}" == "local" || "${1:-}" == "production" ]]; then
    PROFILE="$1"
    ACTION="${2:-apply}"
elif [[ "${2:-}" == "local" || "${2:-}" == "production" ]]; then
    PROFILE="$2"
elif [[ "${1:-}" == "apply" || "${1:-}" == "delete" || "${1:-}" == "status" || "${1:-}" == "verify" || "${1:-}" == "gke-setup" || "${1:-}" == "repair-fabric" || "${1:-}" == "diagnose" || "${1:-}" == "rebootstrap-peers" ]]; then
    ACTION="$1"
elif [[ "${2:-}" == "apply" || "${2:-}" == "delete" || "${2:-}" == "status" || "${2:-}" == "verify" || "${2:-}" == "gke-setup" || "${2:-}" == "repair-fabric" || "${2:-}" == "diagnose" || "${2:-}" == "rebootstrap-peers" ]]; then
    ACTION="$2"
fi

case "$PROFILE" in
    local|production) ;;
    *)
        echo "ERROR: Profile must be 'local' or 'production'."
        exit 1
        ;; 
esac

case "$ACTION" in
    apply|delete|status|verify|gke-setup|repair-fabric|diagnose|rebootstrap-peers) ;;
    *)
        echo "Usage: $0 [local|production] [apply|delete|status|verify|gke-setup|repair-fabric|diagnose|rebootstrap-peers]"
        exit 1
        ;;
esac

export PROFILE
export K8S_PROFILE="$PROFILE"

# Local repair-fabric escalates automatically from conservative LevelDB repairs to
# peer re-bootstrap only when ledgerProvider/openIDStore remains unrecoverable.
# Production never performs this escalation unless explicitly enabled.
if [[ -z "${PEER_AUTO_REBOOTSTRAP_ON_LEDGER_PROVIDER+x}" ]]; then
    if [[ "$PROFILE" == "local" ]]; then
        PEER_AUTO_REBOOTSTRAP_ON_LEDGER_PROVIDER="true"
    else
        PEER_AUTO_REBOOTSTRAP_ON_LEDGER_PROVIDER="false"
    fi
fi
export PEER_AUTO_REBOOTSTRAP_ON_LEDGER_PROVIDER

if [[ -z "${VERIFY_FABRIC_CHANNEL_AFTER_REPAIR+x}" ]]; then
    if [[ "$PROFILE" == "local" ]]; then
        VERIFY_FABRIC_CHANNEL_AFTER_REPAIR="true"
    else
        VERIFY_FABRIC_CHANNEL_AFTER_REPAIR="false"
    fi
fi
export VERIFY_FABRIC_CHANNEL_AFTER_REPAIR

if [[ -z "${ORDERER_AUTO_REPAIR_LEVELDB+x}" ]]; then
    if [[ "$PROFILE" == "local" ]]; then
        ORDERER_AUTO_REPAIR_LEVELDB="true"
    else
        ORDERER_AUTO_REPAIR_LEVELDB="false"
    fi
fi
export ORDERER_AUTO_REPAIR_LEVELDB
if [[ -z "${PEER_AUTO_REPAIR_LEVELDB_LOCKS+x}" ]]; then
    if [[ "$PROFILE" == "local" ]]; then
        PEER_AUTO_REPAIR_LEVELDB_LOCKS="true"
    else
        PEER_AUTO_REPAIR_LEVELDB_LOCKS="false"
    fi
fi
export PEER_AUTO_REPAIR_LEVELDB_LOCKS

# The transient store contains proposal/private-write data that has not yet become
# committed ledger state. Rebuilding it is acceptable for the local development
# profile after the peer has been stopped, but production requires an explicit opt-in.
if [[ -z "${PEER_AUTO_REPAIR_TRANSIENT_STORE+x}" ]]; then
    if [[ "$PROFILE" == "local" ]]; then
        PEER_AUTO_REPAIR_TRANSIENT_STORE="true"
    else
        PEER_AUTO_REPAIR_TRANSIENT_STORE="false"
    fi
fi
export PEER_AUTO_REPAIR_TRANSIENT_STORE

# The ledger-provider ID store tracks the peer's ledger/channel inventory and is not
# disposable. For the specific LevelDB "entry point missing/corrupted" startup panic,
# local recovery is limited to repairing an invalid/missing CURRENT pointer when an
# intact MANIFEST-* file exists. The database directory itself is never deleted.
if [[ -z "${PEER_AUTO_REPAIR_LEDGER_PROVIDER_CURRENT+x}" ]]; then
    if [[ "$PROFILE" == "local" ]]; then
        PEER_AUTO_REPAIR_LEDGER_PROVIDER_CURRENT="true"
    else
        PEER_AUTO_REPAIR_LEDGER_PROVIDER_CURRENT="false"
    fi
fi
export PEER_AUTO_REPAIR_LEDGER_PROVIDER_CURRENT

# Kubo FlatFS requires blocks/SHARDING.  Local deployments automatically repair
# only this missing metadata file; existing block files are never deleted.  Production
# requires an explicit opt-in because persistent IPFS repositories should be backed up.
if [[ -z "${IPFS_AUTO_REPAIR_SHARDING+x}" ]]; then
    if [[ "$PROFILE" == "local" ]]; then
        IPFS_AUTO_REPAIR_SHARDING="true"
    else
        IPFS_AUTO_REPAIR_SHARDING="false"
    fi
fi
export IPFS_AUTO_REPAIR_SHARDING

if [[ "$PROFILE" == "local" ]]; then
    export KUBECTL_REMOTE_COMMAND_WEBSOCKETS="${KUBECTL_REMOTE_COMMAND_WEBSOCKETS:-false}"
fi

NAMESPACES=(plv-fabric plv-main-campus plv-annex-campus plv-pubad-campus)
TMP_K8S_DIR="./k8s/.tmp-k8s"
LOCAL_STATIC_PVS=(
    pv-orderer-1
    pv-orderer-2
    pv-orderer-3
    pv-fabric-ca-registrar
    pv-fabric-ca-faculty
    pv-fabric-ca-department
    pv-peer-registrar-1
    pv-couchdb-registrar-1
    pv-couchdb-wallet-registrar
    pv-peer-faculty-1
    pv-couchdb-faculty-1
    pv-couchdb-wallet-faculty
    pv-peer-department-1
    pv-couchdb-department-1
    pv-couchdb-wallet-department
    pv-postgres-main
    pv-ipfs-1
    pv-ipfs-2
    pv-ipfs-3
    pv-couchdb-backup
)

echo "======================================"
echo "PLV BLOCKGO K8s Deployment Script - Hardened"
echo "======================================"
echo "Profile: $PROFILE"
echo "Action: $ACTION"
echo ""

validate_script_integrity() {
    local shebang_count main_count
    shebang_count="$(grep -c '^#!.*bash' "$SCRIPT_SOURCE" 2>/dev/null || true)"
    main_count="$(grep -c '^[[:space:]]*main "\$@"' "$SCRIPT_SOURCE" 2>/dev/null || true)"

    if [[ "${shebang_count:-0}" != "1" || "${main_count:-0}" != "1" ]]; then
        echo "ERROR: deploy-k8s.sh appears to contain concatenated or duplicate script copies."
        echo "Expected exactly one Bash shebang and one main invocation; found shebangs=${shebang_count:-0}, main calls=${main_count:-0}."
        echo "Replace the file with a clean copy before deploying."
        return 1
    fi

    if grep -q $'\r$' "$SCRIPT_SOURCE" 2>/dev/null; then
        echo "ERROR: deploy-k8s.sh uses Windows CRLF line endings."
        echo "Fix it with: sed -i 's/\r$//' k8s/deploy-k8s.sh"
        echo "Also keep the provided .gitattributes file so future checkouts use LF."
        return 1
    fi
}

init_repair_audit() {
    mkdir -p "$REPAIR_AUDIT_DIR"
    touch "$REPAIR_AUDIT_DIR/repairs.log"
}

log_repair_action() {
    local kind="$1" deployment="$2" namespace="$3" detail="$4"
    init_repair_audit
    printf '%s | profile=%s | kind=%s | namespace=%s | deployment=%s | %s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PROFILE" "$kind" "$namespace" "$deployment" "$detail" \
        >> "$REPAIR_AUDIT_DIR/repairs.log"
}

register_active_repair() {
    ACTIVE_REPAIR_DEPLOYMENT="$1"
    ACTIVE_REPAIR_NAMESPACE="$2"
    ACTIVE_REPAIR_REPLICAS="$3"
    ACTIVE_REPAIR_POD="$4"
}

clear_active_repair() {
    ACTIVE_REPAIR_DEPLOYMENT=""
    ACTIVE_REPAIR_NAMESPACE=""
    ACTIVE_REPAIR_REPLICAS=""
    ACTIVE_REPAIR_POD=""
}

cleanup_active_repair() {
    [[ -z "$ACTIVE_REPAIR_DEPLOYMENT" || -z "$ACTIVE_REPAIR_NAMESPACE" ]] && return 0
    echo "Recovery cleanup: restoring ${ACTIVE_REPAIR_NAMESPACE}/deployment/${ACTIVE_REPAIR_DEPLOYMENT} after an interrupted repair." >&2
    if [[ -n "$ACTIVE_REPAIR_POD" ]]; then
        kubectl delete pod "$ACTIVE_REPAIR_POD" -n "$ACTIVE_REPAIR_NAMESPACE" --ignore-not-found --wait=false >/dev/null 2>&1 || true
    fi
    if [[ -n "$ACTIVE_REPAIR_REPLICAS" ]]; then
        kubectl scale deployment "$ACTIVE_REPAIR_DEPLOYMENT" -n "$ACTIVE_REPAIR_NAMESPACE" \
            --replicas="$ACTIVE_REPAIR_REPLICAS" >/dev/null 2>&1 || true
    fi
    clear_active_repair
}

trap cleanup_active_repair EXIT
trap 'cleanup_active_repair; exit 130' INT TERM

cluster_preflight() {
    local bad_nodes disk_pressure memory_pressure
    bad_nodes="$(kubectl get nodes --no-headers 2>/dev/null | awk '$2 != "Ready" {count++} END {print count+0}')"
    disk_pressure="$(kubectl get nodes -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="DiskPressure")].status}{"\n"}{end}' 2>/dev/null | grep -c '^True$' || true)"
    memory_pressure="$(kubectl get nodes -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="MemoryPressure")].status}{"\n"}{end}' 2>/dev/null | grep -c '^True$' || true)"

    if (( ${bad_nodes:-0} > 0 )); then
        echo "ERROR: ${bad_nodes} Kubernetes node(s) are not Ready."
        kubectl get nodes -o wide || true
        return 1
    fi
    if (( ${disk_pressure:-0} > 0 )); then
        echo "ERROR: Kubernetes reports DiskPressure; refusing a persistence-heavy deployment/repair."
        kubectl describe nodes | grep -A4 -B2 'DiskPressure' || true
        return 1
    fi
    if (( ${memory_pressure:-0} > 0 )); then
        echo "WARNING: Kubernetes reports MemoryPressure. Local deployment may be unstable."
    fi
}

diagnose_cluster() {
    echo "======================================"
    echo "PLV BLOCKGO Cluster Diagnostics"
    echo "======================================"
    kubectl get nodes -o wide || true
    echo ""
    echo "Unhealthy / restarting pods:"
    kubectl get pods -A -o wide 2>/dev/null | awk 'NR==1 || $4 != "Running" || $5 !~ /^0([[:space:]]|$)/' || true
    echo ""
    echo "PersistentVolumeClaims:"
    kubectl get pvc -A || true
    echo ""
    echo "Recent warning events:"
    kubectl get events -A --field-selector type=Warning --sort-by=.lastTimestamp 2>/dev/null | tail -n 60 || true
    echo ""
    echo "Fabric recovery signatures:"

    local entry deployment namespace failure_type found=0
    for entry in \
        'orderer-1|plv-main-campus' \
        'orderer-2|plv-main-campus' \
        'orderer-3|plv-annex-campus'; do
        IFS='|' read -r deployment namespace <<< "$entry"
        if kubectl get deployment "$deployment" -n "$namespace" >/dev/null 2>&1 && \
           orderer_leveldb_corruption_detected "$deployment" "$namespace"; then
            echo "  RECOVERABLE: ${namespace}/${deployment}: orderer block-index LevelDB corruption"
            found=$((found + 1))
        fi
    done
    for entry in \
        'peer-registrar|plv-main-campus' \
        'peer-faculty|plv-annex-campus' \
        'peer-department|plv-pubad-campus'; do
        IFS='|' read -r deployment namespace <<< "$entry"
        if kubectl get deployment "$deployment" -n "$namespace" >/dev/null 2>&1; then
            failure_type="$(peer_recoverable_corruption_type "$deployment" "$namespace" || true)"
            if [[ -n "$failure_type" ]]; then
                echo "  RECOVERABLE: ${namespace}/${deployment}: ${failure_type}"
                found=$((found + 1))
            fi
        fi
    done
    if (( found == 0 )); then
        echo "  No known recoverable Fabric corruption signatures detected."
    fi

    echo ""
    echo "Peer network IDs:"
    for entry in \
        'peer-registrar|plv-main-campus' \
        'peer-faculty|plv-annex-campus' \
        'peer-department|plv-pubad-campus'; do
        IFS='|' read -r deployment namespace <<< "$entry"
        if kubectl get deployment "$deployment" -n "$namespace" >/dev/null 2>&1; then
            local network_id
            network_id="$(kubectl get deployment "$deployment" -n "$namespace" -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="CORE_PEER_NETWORKID")].value}' 2>/dev/null || true)"
            echo "  ${namespace}/${deployment}: ${network_id:-<from core.yaml/default>}"
        fi
    done
}

wait_for_all_pvcs_bound() {
    local deadline=$((SECONDS + PVC_BINDING_TIMEOUT_SECONDS)) pending
    while (( SECONDS < deadline )); do
        pending="$(kubectl get pvc -A --no-headers 2>/dev/null | awk '$3 != "Bound" && $3 != "Lost" {count++} END {print count+0}')"
        if (( ${pending:-0} == 0 )); then
            return 0
        fi
        sleep 3
    done
    echo "ERROR: One or more PVCs did not become Bound within ${PVC_BINDING_TIMEOUT_SECONDS}s."
    kubectl get pvc -A || true
    return 1
}

check_kubectl() {
    if ! command -v kubectl >/dev/null 2>&1; then
        echo "ERROR: kubectl not found. Please install kubectl."
        exit 1
    fi
    echo "kubectl is installed"
}

check_cluster() {
    if ! kubectl cluster-info >/dev/null 2>&1; then
        echo "ERROR: Cannot connect to Kubernetes cluster. Check your kubeconfig."
        exit 1
    fi
    echo "Connected to Kubernetes cluster"
}

apply_manifest() {
    local manifest="$1"
    if [[ ! -f "$manifest" ]]; then
        echo "ERROR: Manifest $manifest not found."
        exit 1
    fi
    kubectl apply -f "$manifest"
}

apply_peer_manifest() {
    local manifest="$1"
    local output=""

    if output="$(kubectl apply -f "$manifest" 2>&1)"; then
        echo "$output"
        return
    fi

    echo "$output"
    if grep -q 'StatefulSet.*is invalid: spec: Forbidden: updates to statefulset spec' <<< "$output" &&
       ! grep -Eq '(^error:|Error from server)' <<< "$output"; then
        echo "Existing CouchDB volume-claim settings are immutable; keeping them and applying the mutable health-probe patch."
        return
    fi

    return 1
}

apply_couchdb_health_probes() {
    local patch_file="./k8s/couchdb-health-probe-json-patch.json"
    local entry=""
    local statefulset=""
    local namespace=""

    for entry in \
        "couchdb-registrar|plv-main-campus" \
        "couchdb-wallet-registrar|plv-main-campus" \
        "couchdb-faculty|plv-annex-campus" \
        "couchdb-wallet-faculty|plv-annex-campus" \
        "couchdb-department|plv-pubad-campus" \
        "couchdb-wallet-department|plv-pubad-campus"; do
        IFS='|' read -r statefulset namespace <<< "$entry"
        kubectl patch statefulset "$statefulset" -n "$namespace" \
            --type=json --patch-file "$patch_file"
    done
}

apply_manifest_if_exists() {
    local manifest="$1"
    if [[ -f "$manifest" ]]; then
        kubectl apply -f "$manifest"
    else
        echo "Manifest $manifest not found. Skipping."
    fi
}

deploy_observability() {
    local monitoring_dir="../monitoring"
    if [[ ! -f "$monitoring_dir/observability-stack.yaml" ]]; then
        echo "ERROR: Observability stack manifest not found."
        exit 1
    fi

    if ! kubectl get secret grafana-admin -n plv-fabric >/dev/null 2>&1; then
        if ! command -v openssl >/dev/null 2>&1; then
            echo "ERROR: openssl is required to generate the initial Grafana admin secret."
            exit 1
        fi
        local grafana_password
        grafana_password="$(openssl rand -hex 24)"
        kubectl create secret generic grafana-admin -n plv-fabric \
            --from-literal=admin-user=admin \
            --from-literal=admin-password="$grafana_password" >/dev/null
        unset grafana_password
        echo "Created the Grafana admin secret. Grafana remains accessible only through the System Admin proxy."
    fi

    kubectl create configmap prometheus-config -n plv-fabric \
        --from-file=prometheus.yml="$monitoring_dir/prometheus.yaml" \
        --from-file=alert-rules.yml="$monitoring_dir/alert-rules.yaml" \
        --dry-run=client -o yaml | kubectl apply -f -

    kubectl create configmap grafana-dashboards -n plv-fabric \
        --from-file="$monitoring_dir/grafana-dashboard.json" \
        --from-file="$monitoring_dir/grafana-kubernetes-memory.json" \
        --from-file="$monitoring_dir/grafana-api-observability.json" \
        --from-file="$monitoring_dir/grafana-fabric.json" \
        --from-file="$monitoring_dir/grafana-postgresql.json" \
        --from-file="$monitoring_dir/grafana-workflows.json" \
        --from-file="$monitoring_dir/grafana-logs.json" \
        --dry-run=client -o yaml | kubectl apply -f -

    kubectl apply -f "$monitoring_dir/observability-stack.yaml"
}

# Local profile no longer imposes script-level RAM caps.  Kubernetes manifests may
# still define their own resource requests/limits, but deploy-k8s.sh does not shrink them
# or install a local LimitRange.

local_pv_root() {
    local path
    path="$(pwd)"

    local context
    context="$(kubectl config current-context 2>/dev/null || true)"

    if [[ "$context" == "docker-desktop" ]]; then
        if [[ "$path" =~ ^/mnt/([A-Za-z])/(.*)$ ]]; then
            local drive="${BASH_REMATCH[1],,}"
            echo "/run/desktop/mnt/host/${drive}/${BASH_REMATCH[2]}"
            return
        fi

        if [[ "$path" =~ ^/([A-Za-z])/(.*)$ ]]; then
            local drive="${BASH_REMATCH[1],,}"
            echo "/run/desktop/mnt/host/${drive}/${BASH_REMATCH[2]}"
            return
        fi

        if [[ "$path" =~ ^([A-Za-z]):[\\/](.*)$ ]]; then
            local drive="${BASH_REMATCH[1],,}"
            local rest="${BASH_REMATCH[2]//\\//}"
            echo "/run/desktop/mnt/host/${drive}/${rest}"
            return
        fi
    fi

    echo "$path"
}

local_recovery_path_for_claim() {
    local pv_root="$1"
    local namespace="$2"
    local claim="$3"

    case "$claim" in
        couchdb-wallet-storage-couchdb-wallet-registrar-0)
            echo "${pv_root}/fabric-k8s-data/couchdb-wallet-registrar"
            ;;
        couchdb-wallet-storage-couchdb-wallet-faculty-0)
            echo "${pv_root}/fabric-k8s-data/couchdb-wallet-faculty"
            ;;
        couchdb-wallet-storage-couchdb-wallet-department-0)
            echo "${pv_root}/fabric-k8s-data/couchdb-wallet-department"
            ;;
        *)
            echo "${pv_root}/fabric-k8s-data/recovered/${namespace}/${claim}"
            ;;
    esac
}

repair_lost_local_pvcs() {
    if [[ "$PROFILE" != "local" ]]; then
        return
    fi

    local pv_root
    pv_root="$(local_pv_root)"
    local namespace
    local claim
    local volume
    local claim_uid
    local storage_class
    local storage_size
    local recovery_path
    local referenced_namespace
    local referenced_claim
    local phase

    for namespace in "${NAMESPACES[@]}"; do
        while IFS= read -r claim; do
            [[ -z "$claim" ]] && continue

            volume="$(kubectl get pvc "$claim" -n "$namespace" -o jsonpath='{.spec.volumeName}')"
            claim_uid="$(kubectl get pvc "$claim" -n "$namespace" -o jsonpath='{.metadata.uid}')"
            storage_class="$(kubectl get pvc "$claim" -n "$namespace" -o jsonpath='{.spec.storageClassName}')"
            storage_size="$(kubectl get pvc "$claim" -n "$namespace" -o jsonpath='{.spec.resources.requests.storage}')"

            if [[ -z "$volume" || -z "$claim_uid" || -z "$storage_class" || -z "$storage_size" ]]; then
                echo "ERROR: Lost PVC ${namespace}/${claim} is missing binding metadata and cannot be repaired safely."
                return 1
            fi

            echo "Repairing Lost PVC ${namespace}/${claim} (volume ${volume})..."
            if kubectl get pv "$volume" >/dev/null 2>&1; then
                referenced_namespace="$(kubectl get pv "$volume" -o jsonpath='{.spec.claimRef.namespace}')"
                referenced_claim="$(kubectl get pv "$volume" -o jsonpath='{.spec.claimRef.name}')"
                if [[ "$referenced_namespace" != "$namespace" || "$referenced_claim" != "$claim" ]]; then
                    echo "ERROR: PV ${volume} is reserved for ${referenced_namespace}/${referenced_claim}; refusing to reassign it."
                    return 1
                fi
                kubectl patch pv "$volume" --type=merge \
                    -p "{\"spec\":{\"claimRef\":{\"apiVersion\":\"v1\",\"kind\":\"PersistentVolumeClaim\",\"name\":\"${claim}\",\"namespace\":\"${namespace}\",\"uid\":\"${claim_uid}\"}}}" >/dev/null
            else
                recovery_path="$(local_recovery_path_for_claim "$pv_root" "$namespace" "$claim")"
                echo "The old dynamic PV is gone; recreating ${volume} at retained path ${recovery_path}."
                cat <<EOF | kubectl apply -f - >/dev/null
apiVersion: v1
kind: PersistentVolume
metadata:
  name: ${volume}
spec:
  capacity:
    storage: ${storage_size}
  volumeMode: Filesystem
  accessModes:
  - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: ${storage_class}
  claimRef:
    apiVersion: v1
    kind: PersistentVolumeClaim
    namespace: ${namespace}
    name: ${claim}
    uid: ${claim_uid}
  hostPath:
    path: ${recovery_path}
    type: DirectoryOrCreate
EOF
            fi

            phase=""
            for _ in $(seq 1 30); do
                phase="$(kubectl get pvc "$claim" -n "$namespace" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
                [[ "$phase" == "Bound" ]] && break
                sleep 2
            done
            if [[ "$phase" != "Bound" ]]; then
                echo "ERROR: PVC ${namespace}/${claim} remained ${phase:-Unknown} after recovery."
                kubectl describe pvc "$claim" -n "$namespace" || true
                return 1
            fi
        done < <(
            kubectl get pvc -n "$namespace" \
                -o jsonpath='{range .items[?(@.status.phase=="Lost")]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true
        )
    done
}

wait_rollout() {
    local resource="$1"
    local namespace="$2"
    if kubectl get "$resource" -n "$namespace" >/dev/null 2>&1; then
        if ! kubectl rollout status "$resource" -n "$namespace" --timeout="$ROLLOUT_TIMEOUT"; then
            echo "ERROR: ${resource} did not become ready in ${namespace}."
            kubectl get pods -n "$namespace" -o wide || true
            kubectl get pvc -n "$namespace" || true
            kubectl get events -n "$namespace" --sort-by=.lastTimestamp | tail -n 30 || true
            return 1
        fi
    else
        echo "Resource $resource not found in $namespace. Skipping rollout wait."
    fi
}

is_true() {
    case "${1:-}" in
        1|true|TRUE|yes|YES|on|ON) return 0 ;;
        *) return 1 ;;
    esac
}

ipfs_pod_name() {
    local statefulset="$1"
    local namespace="$2"
    local ordinal_pod="${statefulset}-0"

    if kubectl get pod "$ordinal_pod" -n "$namespace" >/dev/null 2>&1; then
        printf '%s\n' "$ordinal_pod"
        return 0
    fi

    kubectl get pods -n "$namespace" -l "app=${statefulset}" \
        --sort-by=.metadata.creationTimestamp \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null | tail -n 1
}

ipfs_missing_sharding_detected() {
    local statefulset="$1"
    local namespace="$2"
    local pod logs previous_logs combined

    pod="$(ipfs_pod_name "$statefulset" "$namespace")"
    [[ -n "$pod" ]] || return 1

    logs="$(kubectl logs "$pod" -n "$namespace" --all-containers=true --tail=250 2>&1 || true)"
    previous_logs="$(kubectl logs "$pod" -n "$namespace" --all-containers=true --previous --tail=250 2>&1 || true)"
    combined="${logs}"$'\n'"${previous_logs}"

    if grep -Fq 'directory missing SHARDING file: /data/ipfs/blocks' <<< "$combined"; then
        echo "Detected missing IPFS FlatFS SHARDING metadata in ${namespace}/${statefulset}." >&2
        return 0
    fi
    return 1
}

ipfs_statefulset_ready() {
    local statefulset="$1"
    local namespace="$2"
    local desired ready

    desired="$(kubectl get statefulset "$statefulset" -n "$namespace" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
    ready="$(kubectl get statefulset "$statefulset" -n "$namespace" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
    desired="${desired:-0}"
    ready="${ready:-0}"
    (( desired > 0 && ready >= desired ))
}

show_ipfs_diagnostics() {
    local statefulset="$1"
    local namespace="$2"
    local pod
    echo "IPFS diagnostics for ${namespace}/statefulset/${statefulset}:"
    kubectl get statefulset "$statefulset" -n "$namespace" -o wide || true
    kubectl get pods -n "$namespace" -l "app=${statefulset}" -o wide || true
    kubectl get pvc -n "$namespace" || true
    pod="$(ipfs_pod_name "$statefulset" "$namespace")"
    if [[ -n "$pod" ]]; then
        echo "Current IPFS logs for ${namespace}/${pod}:"
        kubectl logs "$pod" -n "$namespace" --all-containers=true --tail=200 || true
        echo "Previous IPFS logs for ${namespace}/${pod}:"
        kubectl logs "$pod" -n "$namespace" --all-containers=true --previous --tail=200 || true
    fi
    kubectl get events -n "$namespace" --sort-by=.lastTimestamp | tail -n 40 || true
}

repair_ipfs_missing_sharding() {
    local statefulset="$1"
    local namespace="$2"
    local desired_replicas pod volume_name claim helper stamp pod_count repair_rc=0

    desired_replicas="$(kubectl get statefulset "$statefulset" -n "$namespace" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
    desired_replicas="${desired_replicas:-1}"
    [[ "$desired_replicas" =~ ^[0-9]+$ ]] || desired_replicas=1
    (( desired_replicas > 0 )) || desired_replicas=1

    pod="$(ipfs_pod_name "$statefulset" "$namespace")"
    if [[ -z "$pod" ]]; then
        echo "ERROR: Cannot identify an IPFS pod for ${namespace}/${statefulset}."
        return 1
    fi

    volume_name="$(kubectl get pod "$pod" -n "$namespace" \
        -o jsonpath='{range .spec.containers[*].volumeMounts[?(@.mountPath=="/data/ipfs")]}{.name}{"\n"}{end}' \
        2>/dev/null | awk 'NF {print; exit}')"
    if [[ -n "$volume_name" ]]; then
        claim="$(kubectl get pod "$pod" -n "$namespace" \
            -o jsonpath="{.spec.volumes[?(@.name=='${volume_name}')].persistentVolumeClaim.claimName}" \
            2>/dev/null || true)"
    fi
    if [[ -z "${claim:-}" ]]; then
        claim="$(kubectl get pod "$pod" -n "$namespace" \
            -o jsonpath='{range .spec.volumes[*]}{.persistentVolumeClaim.claimName}{"\n"}{end}' \
            2>/dev/null | awk 'NF {print; exit}')"
    fi
    if [[ -z "${claim:-}" ]] || ! kubectl get pvc "$claim" -n "$namespace" >/dev/null 2>&1; then
        echo "ERROR: Could not safely identify the persistent IPFS PVC for ${namespace}/${statefulset}."
        return 1
    fi

    helper="${statefulset}-sharding-repair"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"

    echo "Stopping ${namespace}/statefulset/${statefulset} before repairing IPFS FlatFS metadata..."
    kubectl scale statefulset "$statefulset" -n "$namespace" --replicas=0 >/dev/null
    for _ in $(seq 1 60); do
        pod_count="$(kubectl get pods -n "$namespace" -l "app=${statefulset}" -o name 2>/dev/null | awk 'NF {c++} END {print c+0}')"
        [[ "${pod_count:-0}" == "0" ]] && break
        sleep 2
    done
    pod_count="$(kubectl get pods -n "$namespace" -l "app=${statefulset}" -o name 2>/dev/null | awk 'NF {c++} END {print c+0}')"
    if [[ "${pod_count:-0}" != "0" ]]; then
        echo "ERROR: IPFS pod is still running; refusing to modify its blockstore metadata."
        kubectl scale statefulset "$statefulset" -n "$namespace" --replicas="$desired_replicas" >/dev/null || true
        return 1
    fi

    kubectl delete pod "$helper" -n "$namespace" --ignore-not-found --wait=true >/dev/null 2>&1 || true
    if ! cat <<EOF | kubectl apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata:
  name: ${helper}
  namespace: ${namespace}
spec:
  restartPolicy: Never
  containers:
  - name: repair
    image: ${IPFS_REPAIR_POD_IMAGE}
    imagePullPolicy: IfNotPresent
    command: ["sh", "-c", "sleep 3600"]
    volumeMounts:
    - name: ipfs-data
      mountPath: /data/ipfs
  volumes:
  - name: ipfs-data
    persistentVolumeClaim:
      claimName: ${claim}
EOF
    then
        echo "ERROR: Could not create IPFS repair pod ${namespace}/${helper}."
        kubectl scale statefulset "$statefulset" -n "$namespace" --replicas="$desired_replicas" >/dev/null || true
        return 1
    fi

    if ! kubectl wait --for=condition=Ready "pod/${helper}" -n "$namespace" --timeout=90s >/dev/null; then
        echo "ERROR: IPFS repair pod ${namespace}/${helper} did not become Ready."
        kubectl describe pod "$helper" -n "$namespace" || true
        kubectl delete pod "$helper" -n "$namespace" --ignore-not-found --wait=false >/dev/null 2>&1 || true
        kubectl scale statefulset "$statefulset" -n "$namespace" --replicas="$desired_replicas" >/dev/null || true
        return 1
    fi

    echo "Repairing only /data/ipfs/blocks/SHARDING; existing IPFS blocks will not be deleted."
    if ! kubectl exec "$helper" -n "$namespace" -- sh -eu -c "
        repo=/data/ipfs
        blocks=\"\${repo}/blocks\"
        recovery=\"\${repo}/.blockgo-recovery/ipfs-sharding-${stamp}\"
        mkdir -p \"\${blocks}\" \"\${recovery}\"

        if [ -s \"\${blocks}/SHARDING\" ]; then
            echo 'SHARDING already exists; no modification is required.'
            exit 0
        fi

        [ -f \"\${repo}/datastore_spec\" ] && cp \"\${repo}/datastore_spec\" \"\${recovery}/datastore_spec\" || true
        [ -f \"\${repo}/config\" ] && cp \"\${repo}/config\" \"\${recovery}/config\" || true
        find \"\${blocks}\" -mindepth 1 -maxdepth 1 -print 2>/dev/null | head -n 200 > \"\${recovery}/blockstore-top-level.txt\" || true

        shard=''
        if [ -f \"\${repo}/datastore_spec\" ]; then
            shard=\$(grep -oE '/repo/flatfs/shard/v1/(next-to-last|prefix|suffix)/[0-9]+' \"\${repo}/datastore_spec\" | head -n 1 || true)
        fi
        if [ -z \"\${shard}\" ] && [ -f \"\${repo}/config\" ]; then
            shard=\$(grep -oE '/repo/flatfs/shard/v1/(next-to-last|prefix|suffix)/[0-9]+' \"\${repo}/config\" | head -n 1 || true)
        fi

        if [ -z \"\${shard}\" ]; then
            first_entry=\$(find \"\${blocks}\" -mindepth 1 -maxdepth 1 ! -name SHARDING -print -quit 2>/dev/null || true)
            if [ -z \"\${first_entry}\" ]; then
                shard='/repo/flatfs/shard/v1/next-to-last/2'
                echo 'Blockstore is empty; using Kubo FlatFS default next-to-last/2.'
            else
                echo 'ERROR: Existing block files are present but the shard function cannot be proven from datastore_spec/config.' >&2
                echo 'Refusing to guess a sharding scheme for a non-empty blockstore.' >&2
                exit 42
            fi
        fi

        printf '%s\\n' \"\${shard}\" > \"\${blocks}/SHARDING.tmp-${stamp}\"
        mv \"\${blocks}/SHARDING.tmp-${stamp}\" \"\${blocks}/SHARDING\"
        sync
        echo \"Recreated SHARDING with: \${shard}\"
        echo \"Recovery metadata: \${recovery}\"
    "; then
        repair_rc=$?
        echo "ERROR: IPFS SHARDING repair failed for ${namespace}/${statefulset} (exit ${repair_rc})."
        kubectl delete pod "$helper" -n "$namespace" --ignore-not-found --wait=false >/dev/null 2>&1 || true
        kubectl scale statefulset "$statefulset" -n "$namespace" --replicas="$desired_replicas" >/dev/null || true
        return 1
    fi

    kubectl delete pod "$helper" -n "$namespace" --ignore-not-found --wait=true >/dev/null 2>&1 || true
    echo "Starting ${namespace}/statefulset/${statefulset} after IPFS FlatFS metadata repair..."
    kubectl scale statefulset "$statefulset" -n "$namespace" --replicas="$desired_replicas" >/dev/null
    log_repair_action "ipfs-sharding" "$statefulset" "$namespace" "recreated missing blocks/SHARDING metadata; existing blocks preserved"
    return 0
}

ensure_ipfs_ready() {
    local statefulset="$1"
    local namespace="$2"
    local deadline=$((SECONDS + IPFS_FAILURE_DETECTION_SECONDS))

    if ! kubectl get statefulset "$statefulset" -n "$namespace" >/dev/null 2>&1; then
        echo "Resource statefulset/${statefulset} not found in ${namespace}. Skipping IPFS readiness check."
        return 0
    fi

    while (( SECONDS < deadline )); do
        if ipfs_statefulset_ready "$statefulset" "$namespace"; then
            return 0
        fi
        if ipfs_missing_sharding_detected "$statefulset" "$namespace"; then
            if ! is_true "$IPFS_AUTO_REPAIR_SHARDING"; then
                echo "ERROR: Missing IPFS blocks/SHARDING metadata detected in ${namespace}/${statefulset}, but automatic repair is disabled."
                show_ipfs_diagnostics "$statefulset" "$namespace"
                return 1
            fi
            echo "Known recoverable IPFS FlatFS SHARDING failure detected; starting guarded automatic recovery."
            repair_ipfs_missing_sharding "$statefulset" "$namespace" || return 1
            if kubectl rollout status "statefulset/${statefulset}" -n "$namespace" --timeout="$ROLLOUT_TIMEOUT"; then
                echo "Recovered ${namespace}/statefulset/${statefulset}; IPFS is ready again."
                return 0
            fi
            show_ipfs_diagnostics "$statefulset" "$namespace"
            return 1
        fi
        sleep 3
    done

    if kubectl rollout status "statefulset/${statefulset}" -n "$namespace" --timeout="$ROLLOUT_TIMEOUT"; then
        return 0
    fi
    if ipfs_missing_sharding_detected "$statefulset" "$namespace" && is_true "$IPFS_AUTO_REPAIR_SHARDING"; then
        repair_ipfs_missing_sharding "$statefulset" "$namespace" || return 1
        kubectl rollout status "statefulset/${statefulset}" -n "$namespace" --timeout="$ROLLOUT_TIMEOUT"
        return $?
    fi
    echo "ERROR: ${namespace}/statefulset/${statefulset} did not become Ready for an unrecognized reason."
    show_ipfs_diagnostics "$statefulset" "$namespace"
    return 1
}

repair_ipfs_storage() {
    local failures=0 entry statefulset namespace
    echo ""
    echo "Scanning IPFS nodes for recoverable FlatFS metadata failures..."
    for entry in \
        "ipfs-node|plv-fabric" \
        "ipfs-annex|plv-annex-campus" \
        "ipfs-pubad|plv-pubad-campus"; do
        IFS='|' read -r statefulset namespace <<< "$entry"
        if ! kubectl get statefulset "$statefulset" -n "$namespace" >/dev/null 2>&1; then
            echo "SKIP: ${namespace}/${statefulset} is not deployed."
            continue
        fi
        if ipfs_statefulset_ready "$statefulset" "$namespace"; then
            echo "OK: ${namespace}/${statefulset} is ready."
        elif ipfs_missing_sharding_detected "$statefulset" "$namespace"; then
            echo "REPAIR: ${namespace}/${statefulset} is missing blocks/SHARDING metadata."
            ensure_ipfs_ready "$statefulset" "$namespace" || failures=$((failures + 1))
        else
            echo "WARN: ${namespace}/${statefulset} is unhealthy, but the supported SHARDING signature was not found."
            show_ipfs_diagnostics "$statefulset" "$namespace"
            failures=$((failures + 1))
        fi
    done
    (( failures == 0 ))
}

latest_orderer_pod() {
    local deployment="$1"
    local namespace="$2"

    kubectl get pods -n "$namespace" -l "app=${deployment}" \
        --sort-by=.metadata.creationTimestamp \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null |
        tail -n 1
}

orderer_leveldb_corruption_detected() {
    local deployment="$1"
    local namespace="$2"
    local pod
    local logs=""
    local previous_logs=""

    pod="$(latest_orderer_pod "$deployment" "$namespace")"
    [[ -z "$pod" ]] && return 1

    logs="$(kubectl logs "$pod" -n "$namespace" -c orderer --tail=250 2>&1 || true)"
    previous_logs="$(kubectl logs "$pod" -n "$namespace" -c orderer --previous --tail=250 2>&1 || true)"

    if grep -Fq 'Error opening leveldb: database entry point either missing or corrupted' <<< "${logs}"$'\n'"${previous_logs}"; then
        echo "Detected Fabric orderer LevelDB index corruption in ${namespace}/${pod}." >&2
        return 0
    fi

    return 1
}

orderer_deployment_ready() {
    local deployment="$1"
    local namespace="$2"
    local desired
    local updated
    local available
    local ready

    desired="$(kubectl get deployment "$deployment" -n "$namespace" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
    updated="$(kubectl get deployment "$deployment" -n "$namespace" -o jsonpath='{.status.updatedReplicas}' 2>/dev/null || true)"
    available="$(kubectl get deployment "$deployment" -n "$namespace" -o jsonpath='{.status.availableReplicas}' 2>/dev/null || true)"
    ready="$(kubectl get deployment "$deployment" -n "$namespace" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"

    desired="${desired:-0}"
    updated="${updated:-0}"
    available="${available:-0}"
    ready="${ready:-0}"

    if ! (( desired > 0 && updated >= desired && available >= desired && ready >= desired )); then
        return 1
    fi

    local pod
    local pod_ready
    pod="$(latest_orderer_pod "$deployment" "$namespace")"
    [[ -z "$pod" ]] && return 1
    pod_ready="$(kubectl get pod "$pod" -n "$namespace" \
        -o jsonpath='{.status.containerStatuses[?(@.name=="orderer")].ready}' 2>/dev/null || true)"
    [[ "$pod_ready" == "true" ]]
}

show_orderer_diagnostics() {
    local deployment="$1"
    local namespace="$2"
    local pod

    echo "Orderer diagnostics for ${namespace}/deployment/${deployment}:"
    kubectl get deployment "$deployment" -n "$namespace" -o wide || true
    kubectl get pods -n "$namespace" -l "app=${deployment}" -o wide || true
    kubectl get pvc -n "$namespace" || true

    pod="$(latest_orderer_pod "$deployment" "$namespace")"
    if [[ -n "$pod" ]]; then
        echo "Current logs for ${namespace}/${pod}:"
        kubectl logs "$pod" -n "$namespace" -c orderer --tail=200 || true
        echo "Previous logs for ${namespace}/${pod}:"
        kubectl logs "$pod" -n "$namespace" -c orderer --previous --tail=200 || true
    fi

    kubectl get events -n "$namespace" --sort-by=.lastTimestamp | tail -n 40 || true
}

wait_for_orderer_or_known_failure() {
    local deployment="$1"
    local namespace="$2"
    local timeout_seconds="${3:-$ORDERER_FAILURE_DETECTION_SECONDS}"
    local deadline=$((SECONDS + timeout_seconds))

    while (( SECONDS < deadline )); do
        if orderer_deployment_ready "$deployment" "$namespace"; then
            return 0
        fi

        if orderer_leveldb_corruption_detected "$deployment" "$namespace"; then
            return 2
        fi

        sleep 5
    done

    if wait_rollout "deployment/${deployment}" "$namespace"; then
        return 0
    fi

    if orderer_leveldb_corruption_detected "$deployment" "$namespace"; then
        return 2
    fi

    return 1
}

repair_orderer_leveldb_index() {
    local deployment="$1"
    local namespace="$2"
    local desired_replicas
    local claim
    local repair_pod
    local stamp
    local pod_count
    local repair_rc=0

    desired_replicas="$(kubectl get deployment "$deployment" -n "$namespace" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
    desired_replicas="${desired_replicas:-1}"
    if [[ ! "$desired_replicas" =~ ^[0-9]+$ ]] || (( desired_replicas < 1 )); then
        desired_replicas=1
    fi

    claim="$(kubectl get deployment "$deployment" -n "$namespace" \
        -o jsonpath='{.spec.template.spec.volumes[?(@.name=="orderer-storage")].persistentVolumeClaim.claimName}' \
        2>/dev/null || true)"
    if [[ -z "$claim" ]]; then
        claim="${deployment}-pvc"
    fi

    if ! kubectl get pvc "$claim" -n "$namespace" >/dev/null 2>&1; then
        echo "ERROR: Cannot safely repair ${deployment}: PVC ${namespace}/${claim} was not found."
        return 1
    fi

    repair_pod="${deployment}-leveldb-repair"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"

    echo "Stopping ${namespace}/deployment/${deployment} before LevelDB recovery..."
    register_active_repair "$deployment" "$namespace" "$desired_replicas" "$repair_pod"
    log_repair_action "orderer-index" "$deployment" "$namespace" "detected; preparing guarded repair"
    kubectl scale deployment "$deployment" -n "$namespace" --replicas=0 >/dev/null

    for _ in $(seq 1 60); do
        pod_count="$(kubectl get pods -n "$namespace" -l "app=${deployment}" \
            -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null | awk 'NF {count++} END {print count+0}')"
        [[ "${pod_count:-0}" == "0" ]] && break
        sleep 2
    done

    pod_count="$(kubectl get pods -n "$namespace" -l "app=${deployment}" \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null | awk 'NF {count++} END {print count+0}')"
    if [[ "${pod_count:-0}" != "0" ]]; then
        echo "ERROR: Orderer pods are still running; refusing to modify LevelDB while it may be open."
        kubectl scale deployment "$deployment" -n "$namespace" --replicas="$desired_replicas" >/dev/null || true
        clear_active_repair
        return 1
    fi

    kubectl delete pod "$repair_pod" -n "$namespace" --ignore-not-found --wait=true >/dev/null 2>&1 || true

    if ! cat <<EOF | kubectl apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata:
  name: ${repair_pod}
  namespace: ${namespace}
  labels:
    app: ${repair_pod}
spec:
  restartPolicy: Never
  containers:
  - name: repair
    image: ${ORDERER_REPAIR_POD_IMAGE}
    imagePullPolicy: IfNotPresent
    command: ["sh", "-c", "sleep 3600"]
    volumeMounts:
    - name: orderer-storage
      mountPath: /var/hyperledger/production
  volumes:
  - name: orderer-storage
    persistentVolumeClaim:
      claimName: ${claim}
EOF
    then
        echo "ERROR: Could not create repair pod ${namespace}/${repair_pod}."
        kubectl scale deployment "$deployment" -n "$namespace" --replicas="$desired_replicas" >/dev/null || true
        clear_active_repair
        return 1
    fi

    if ! kubectl wait --for=condition=Ready "pod/${repair_pod}" -n "$namespace" --timeout=90s >/dev/null; then
        echo "ERROR: Repair pod ${namespace}/${repair_pod} did not become ready."
        kubectl describe pod "$repair_pod" -n "$namespace" || true
        kubectl delete pod "$repair_pod" -n "$namespace" --ignore-not-found --wait=false >/dev/null 2>&1 || true
        kubectl scale deployment "$deployment" -n "$namespace" --replicas="$desired_replicas" >/dev/null || true
        clear_active_repair
        return 1
    fi

    echo "Backing up the persisted orderer ledger and isolating only the corrupted block index..."
    if kubectl exec "$repair_pod" -n "$namespace" -- sh -eu -c "
        ledger_root=/var/hyperledger/production/orderer
        index_dir=\"\${ledger_root}/index\"
        backup_root=/var/hyperledger/production/orderer-recovery-backups
        backup_file=\"\${backup_root}/${deployment}-${stamp}.tgz\"
        corrupt_dir=\"\${ledger_root}/index.corrupt-${stamp}\"

        if [ ! -d \"\${ledger_root}\" ]; then
            echo 'ERROR: Orderer ledger root is missing.' >&2
            exit 20
        fi
        if [ ! -e \"\${index_dir}\" ]; then
            echo 'ERROR: Expected corrupted index directory is already absent; refusing an ambiguous repair.' >&2
            exit 21
        fi

        mkdir -p \"\${backup_root}\"
        echo \"Creating safety backup \${backup_file}\"
        tar -C /var/hyperledger/production -czf \"\${backup_file}\" orderer

        echo \"Moving corrupted index to \${corrupt_dir}\"
        mv \"\${index_dir}\" \"\${corrupt_dir}\"
        sync

        echo 'Preserved block data:'
        find \"\${ledger_root}/chains\" -maxdepth 2 -type f 2>/dev/null | head -n 20 || true
        echo \"Safety backup: \${backup_file}\"
        echo \"Corrupted index retained at: \${corrupt_dir}\"
    "; then
        :
    else
        repair_rc=$?
        echo "ERROR: LevelDB recovery step failed for ${namespace}/${deployment} (exit ${repair_rc})."
        kubectl delete pod "$repair_pod" -n "$namespace" --ignore-not-found --wait=false >/dev/null 2>&1 || true
        kubectl scale deployment "$deployment" -n "$namespace" --replicas="$desired_replicas" >/dev/null || true
        clear_active_repair
        return 1
    fi

    kubectl delete pod "$repair_pod" -n "$namespace" --ignore-not-found --wait=true >/dev/null 2>&1 || true

    echo "Starting ${namespace}/deployment/${deployment}; Fabric will rebuild the missing block index from chains/."
    kubectl scale deployment "$deployment" -n "$namespace" --replicas="$desired_replicas" >/dev/null
    log_repair_action "orderer-index" "$deployment" "$namespace" "index isolated; deployment restored to ${desired_replicas} replica(s)"
    clear_active_repair
    return 0
}

ensure_orderer_ready() {
    local deployment="$1"
    local namespace="$2"
    local initial_failure_type="${3:-}"
    local wait_rc=0

    if [[ "$initial_failure_type" == "index-corruption" ]]; then
        # Preserve the signature already captured by repair-fabric. The crashing pod
        # may be replaced before a second log read can see the same panic.
        wait_rc=2
    else
        wait_for_orderer_or_known_failure "$deployment" "$namespace" || wait_rc=$?
    fi
    if (( wait_rc == 0 )); then
        return 0
    fi

    if (( wait_rc != 2 )); then
        echo "ERROR: ${namespace}/deployment/${deployment} failed for an unrecognized reason."
        show_orderer_diagnostics "$deployment" "$namespace"
        return 1
    fi

    if ! is_true "$ORDERER_AUTO_REPAIR_LEVELDB"; then
        echo "ERROR: Recoverable Fabric LevelDB index corruption was detected in ${namespace}/${deployment}."
        echo "Automatic persisted-state repair is disabled for profile '${PROFILE}'."
        echo "After confirming backups, rerun with ORDERER_AUTO_REPAIR_LEVELDB=true to allow the guarded index rebuild."
        show_orderer_diagnostics "$deployment" "$namespace"
        return 1
    fi

    echo "Known recoverable orderer index corruption detected; starting guarded automatic recovery."
    repair_orderer_leveldb_index "$deployment" "$namespace" || return 1

    wait_rc=0
    wait_for_orderer_or_known_failure "$deployment" "$namespace" || wait_rc=$?
    if (( wait_rc == 0 )); then
        echo "Recovered ${namespace}/deployment/${deployment}; the orderer is ready again."
        return 0
    fi

    if (( wait_rc == 2 )); then
        echo "ERROR: The same LevelDB error returned after one index rebuild."
        echo "Refusing repeated automatic repairs because chains/ or other persisted data may also be damaged."
    else
        echo "ERROR: ${namespace}/deployment/${deployment} did not recover after rebuilding its block index."
    fi
    show_orderer_diagnostics "$deployment" "$namespace"
    return 1
}

latest_peer_pod() {
    local deployment="$1"
    local namespace="$2"

    kubectl get pods -n "$namespace" -l "app=${deployment}" \
        --sort-by=.metadata.creationTimestamp \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null |
        tail -n 1
}

peer_recoverable_corruption_type() {
    local deployment="$1"
    local namespace="$2"
    local pod
    local logs=""
    local previous_logs=""
    local combined=""
    local pod_list=""

    # Scan every currently visible pod newest-first. During a rollout Kubernetes may
    # create a fresh Pending pod before the old CrashLoop pod disappears. Looking only
    # at the newest pod loses the actual failure signature and caused false
    # "signature is no longer present" errors.
    pod_list="$(kubectl get pods -n "$namespace" -l "app=${deployment}" \
        --sort-by=.metadata.creationTimestamp \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)"

    while IFS= read -r pod; do
        [[ -z "$pod" ]] && continue

        logs="$(kubectl logs "$pod" -n "$namespace" -c peer --tail=350 2>&1 || true)"
        previous_logs="$(kubectl logs "$pod" -n "$namespace" -c peer --previous --tail=350 2>&1 || true)"
        combined="${logs}"$'\n'"${previous_logs}"

        if grep -Eq 'Error acquiring lock on file .*/transientStoreFileLock: database entry point either missing or corrupted' <<< "$combined"; then
            printf '%s\n' 'transient-lock'
            return 0
        fi

        if grep -Eq 'Error acquiring lock on file .*/ledgersData/fileLock/?(:|: ) database entry point either missing or corrupted' <<< "$combined" || \
           grep -Eq 'Error acquiring lock on file .*/ledgersData/fileLock: database entry point either missing or corrupted' <<< "$combined"; then
            printf '%s\n' 'ledger-lock'
            return 0
        fi

        # This signature is intentionally narrow. A generic "Error opening leveldb"
        # can refer to many peer databases and is NOT safe to auto-repair. We only
        # classify it as transient-store corruption when Fabric's transientstore
        # provider is present in the panic stack.
        if grep -Fq 'Error opening leveldb: database entry point either missing or corrupted' <<< "$combined" && \
           grep -Eq 'core/transientstore\.newStoreProvider|core/transientstore/store\.go:[0-9]+' <<< "$combined"; then
            printf '%s\n' 'transient-store'
            return 0
        fi

        # The ledger-provider LevelDB is the peer's ID store (ledger/channel inventory).
        # It is NOT safe to delete automatically. We classify this separately so the
        # repair path may attempt only a conservative CURRENT-pointer repair.
        if grep -Fq 'Error opening leveldb: database entry point either missing or corrupted' <<< "$combined" && \
           grep -Eq 'core/ledger/kvledger\.openIDStore|core/ledger/kvledger/kv_ledger_provider\.go:[0-9]+' <<< "$combined"; then
            printf '%s\n' 'ledger-provider'
            return 0
        fi
    done < <(printf '%s\n' "$pod_list" | awk 'NF' | tac)

    return 1
}

# Backward-compatible name for any existing helper calls or sourced usage.
peer_recoverable_lock_corruption_type() {
    peer_recoverable_corruption_type "$@"
}

peer_deployment_ready() {
    local deployment="$1"
    local namespace="$2"
    local desired
    local updated
    local available
    local ready
    local pod
    local pod_ready

    desired="$(kubectl get deployment "$deployment" -n "$namespace" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
    updated="$(kubectl get deployment "$deployment" -n "$namespace" -o jsonpath='{.status.updatedReplicas}' 2>/dev/null || true)"
    available="$(kubectl get deployment "$deployment" -n "$namespace" -o jsonpath='{.status.availableReplicas}' 2>/dev/null || true)"
    ready="$(kubectl get deployment "$deployment" -n "$namespace" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"

    desired="${desired:-0}"
    updated="${updated:-0}"
    available="${available:-0}"
    ready="${ready:-0}"

    if ! (( desired > 0 && updated >= desired && available >= desired && ready >= desired )); then
        return 1
    fi

    pod="$(latest_peer_pod "$deployment" "$namespace")"
    [[ -z "$pod" ]] && return 1
    pod_ready="$(kubectl get pod "$pod" -n "$namespace" \
        -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
    [[ "$pod_ready" == "True" ]]
}

show_peer_diagnostics() {
    local deployment="$1"
    local namespace="$2"
    local pod

    echo "Peer diagnostics for ${namespace}/deployment/${deployment}:"
    kubectl get deployment "$deployment" -n "$namespace" -o wide || true
    kubectl get pods -n "$namespace" -l "app=${deployment}" -o wide || true
    kubectl get pvc -n "$namespace" || true

    while IFS= read -r pod; do
        [[ -z "$pod" ]] && continue
        echo "Peer-container logs for ${namespace}/${pod}:"
        kubectl logs "$pod" -n "$namespace" -c peer --tail=250 2>&1 || true
        echo "Previous peer-container logs for ${namespace}/${pod}:"
        kubectl logs "$pod" -n "$namespace" -c peer --previous --tail=250 2>&1 || true
    done < <(
        kubectl get pods -n "$namespace" -l "app=${deployment}" \
            --sort-by=.metadata.creationTimestamp \
            -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null | tac
    )

    kubectl get events -n "$namespace" --sort-by=.lastTimestamp | tail -n 40 || true
}

wait_for_peer_or_known_failure() {
    local deployment="$1"
    local namespace="$2"
    local timeout_seconds="${3:-$PEER_FAILURE_DETECTION_SECONDS}"
    local deadline=$((SECONDS + timeout_seconds))
    local failure_type=""

    PEER_DETECTED_FAILURE_TYPE=""

    while (( SECONDS < deadline )); do
        if peer_deployment_ready "$deployment" "$namespace"; then
            return 0
        fi

        failure_type="$(peer_recoverable_corruption_type "$deployment" "$namespace" || true)"
        if [[ -n "$failure_type" ]]; then
            PEER_DETECTED_FAILURE_TYPE="$failure_type"
            echo "Detected recoverable Fabric peer ${failure_type} corruption in ${namespace}/deployment/${deployment}." >&2
            return 2
        fi

        sleep 5
    done

    if wait_rollout "deployment/${deployment}" "$namespace"; then
        return 0
    fi

    failure_type="$(peer_recoverable_corruption_type "$deployment" "$namespace" || true)"
    if [[ -n "$failure_type" ]]; then
        PEER_DETECTED_FAILURE_TYPE="$failure_type"
        echo "Detected recoverable Fabric peer ${failure_type} corruption in ${namespace}/deployment/${deployment}." >&2
        return 2
    fi

    return 1
}

repair_peer_leveldb_component() {
    local deployment="$1"
    local namespace="$2"
    local failure_type="$3"
    local desired_replicas
    local claim
    local repair_pod
    local stamp
    local pod_count
    local target_path
    local repair_rc=0

    case "$failure_type" in
        transient-lock)
            target_path="/var/hyperledger/production/transientStoreFileLock"
            ;;
        ledger-lock)
            target_path="/var/hyperledger/production/ledgersData/fileLock"
            ;;
        transient-store)
            target_path="/var/hyperledger/production/transientstore"
            ;;
        ledger-provider)
            target_path="/var/hyperledger/production/ledgersData/ledgerProvider"
            ;;
        *)
            echo "ERROR: Refusing unknown peer repair type '${failure_type}'."
            return 1
            ;;
    esac

    desired_replicas="$(kubectl get deployment "$deployment" -n "$namespace" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
    desired_replicas="${desired_replicas:-1}"
    if [[ ! "$desired_replicas" =~ ^[0-9]+$ ]] || (( desired_replicas < 1 )); then
        desired_replicas=1
    fi

    claim="$(kubectl get deployment "$deployment" -n "$namespace" \
        -o jsonpath='{.spec.template.spec.volumes[?(@.name=="peer-storage")].persistentVolumeClaim.claimName}' \
        2>/dev/null || true)"
    if [[ -z "$claim" ]]; then
        claim="$(kubectl get deployment "$deployment" -n "$namespace" \
            -o jsonpath='{range .spec.template.spec.volumes[*]}{.persistentVolumeClaim.claimName}{"\n"}{end}' \
            2>/dev/null | awk 'NF {print; exit}')"
    fi
    if [[ -z "$claim" ]]; then
        claim="${deployment}-pvc"
    fi

    if ! kubectl get pvc "$claim" -n "$namespace" >/dev/null 2>&1; then
        echo "ERROR: Cannot safely repair ${deployment}: peer PVC ${namespace}/${claim} was not found."
        return 1
    fi

    repair_pod="${deployment}-leveldb-repair"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"

    echo "Stopping ${namespace}/deployment/${deployment} before guarded peer LevelDB recovery..."
    register_active_repair "$deployment" "$namespace" "$desired_replicas" "$repair_pod"
    log_repair_action "peer-${failure_type}" "$deployment" "$namespace" "detected; preparing guarded repair"
    kubectl scale deployment "$deployment" -n "$namespace" --replicas=0 >/dev/null

    for _ in $(seq 1 60); do
        pod_count="$(kubectl get pods -n "$namespace" -l "app=${deployment}" \
            -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null | awk 'NF {count++} END {print count+0}')"
        [[ "${pod_count:-0}" == "0" ]] && break
        sleep 2
    done

    pod_count="$(kubectl get pods -n "$namespace" -l "app=${deployment}" \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null | awk 'NF {count++} END {print count+0}')"
    if [[ "${pod_count:-0}" != "0" ]]; then
        echo "ERROR: Peer pods are still running; refusing to modify persisted peer LevelDB data while the peer may have it open."
        kubectl scale deployment "$deployment" -n "$namespace" --replicas="$desired_replicas" >/dev/null || true
        clear_active_repair
        return 1
    fi

    kubectl delete pod "$repair_pod" -n "$namespace" --ignore-not-found --wait=true >/dev/null 2>&1 || true

    if ! cat <<EOF | kubectl apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata:
  name: ${repair_pod}
  namespace: ${namespace}
  labels:
    app: ${repair_pod}
spec:
  restartPolicy: Never
  containers:
  - name: repair
    image: ${PEER_REPAIR_POD_IMAGE}
    imagePullPolicy: IfNotPresent
    command: ["sh", "-c", "sleep 3600"]
    volumeMounts:
    - name: peer-storage
      mountPath: /var/hyperledger/production
  volumes:
  - name: peer-storage
    persistentVolumeClaim:
      claimName: ${claim}
EOF
    then
        echo "ERROR: Could not create peer repair pod ${namespace}/${repair_pod}."
        kubectl scale deployment "$deployment" -n "$namespace" --replicas="$desired_replicas" >/dev/null || true
        clear_active_repair
        return 1
    fi

    if ! kubectl wait --for=condition=Ready "pod/${repair_pod}" -n "$namespace" --timeout=90s >/dev/null; then
        echo "ERROR: Peer repair pod ${namespace}/${repair_pod} did not become ready."
        kubectl describe pod "$repair_pod" -n "$namespace" || true
        kubectl delete pod "$repair_pod" -n "$namespace" --ignore-not-found --wait=false >/dev/null 2>&1 || true
        kubectl scale deployment "$deployment" -n "$namespace" --replicas="$desired_replicas" >/dev/null || true
        clear_active_repair
        return 1
    fi

    if [[ "$failure_type" == "ledger-provider" ]]; then
        echo "Attempting conservative ledger-provider entry-point repair; the ID store itself will not be deleted."
    else
        echo "Preserving the corrupted peer LevelDB component and recreating only that component..."
    fi
    if kubectl exec "$repair_pod" -n "$namespace" -- sh -eu -c "
        target='${target_path}'
        corrupt=\"\${target}.corrupt-${stamp}\"
        recovery_root=/var/hyperledger/production/peer-recovery-notes

        if [ ! -e \"\${target}\" ]; then
            echo \"ERROR: Expected corrupted LevelDB component \${target} is absent; refusing an ambiguous repair.\" >&2
            exit 30
        fi

        mkdir -p \"\${recovery_root}\"

        if [ '${failure_type}' = 'ledger-provider' ]; then
            backup_file=\"\${recovery_root}/${deployment}-ledger-provider-${stamp}.tgz\"
            echo \"Creating ledger-provider safety backup: \${backup_file}\"
            tar -C /var/hyperledger/production/ledgersData -czf \"\${backup_file}\" ledgerProvider

            current=\"\${target}/CURRENT\"
            current_value=''
            if [ -f \"\${current}\" ]; then
                current_value=\$(tr -d '\\r\\n' < \"\${current}\" 2>/dev/null || true)
            fi

            # If CURRENT already names an existing MANIFEST, the failure is deeper
            # than a missing/corrupt entry pointer. Do not guess or overwrite it.
            if [ -n \"\${current_value}\" ] && [ -f \"\${target}/\${current_value}\" ]; then
                echo \"ERROR: ledgerProvider/CURRENT already points to existing \${current_value}; refusing automatic modification because the manifest or tables may be corrupted.\" >&2
                exit 31
            fi

            candidate=\$(find \"\${target}\" -maxdepth 1 -type f -name 'MANIFEST-*' -printf '%f\\n' 2>/dev/null | sort -V | tail -n 1)
            if [ -z \"\${candidate}\" ] || [ ! -f \"\${target}/\${candidate}\" ]; then
                echo 'ERROR: No intact MANIFEST-* candidate exists; the ledger-provider DB cannot be repaired safely by pointer reconstruction.' >&2
                exit 32
            fi

            if [ -e \"\${current}\" ]; then
                cp -a \"\${current}\" \"\${current}.corrupt-${stamp}\" || true
            fi
            printf '%s\\n' \"\${candidate}\" > \"\${current}.new\"
            mv \"\${current}.new\" \"\${current}\"
            sync

            printf '%s\\n' \
              'deployment=${deployment}' \
              'namespace=${namespace}' \
              'repair=${failure_type}' \
              'database=${target_path}' \
              'current_manifest='\"\${candidate}\" \
              'backup='\"\${backup_file}\" \
              > \"\${recovery_root}/${deployment}-${stamp}.txt\"

            echo \"Repaired ledgerProvider/CURRENT to point to \${candidate}.\"
            echo 'No channel block files, ledger-provider tables, CouchDB state, or private-data stores were deleted.'
        else
            printf '%s\\n' \
              'deployment=${deployment}' \
              'namespace=${namespace}' \
              'repair=${failure_type}' \
              'original=${target_path}' \
              'preserved='\"\${corrupt}\" \
              > \"\${recovery_root}/${deployment}-${stamp}.txt\"

            echo \"Moving corrupted peer LevelDB component \${target} to \${corrupt}\"
            mv \"\${target}\" \"\${corrupt}\"
            sync

            if [ '${failure_type}' = 'transient-store' ]; then
                echo 'Committed blockchain ledger data was not modified. The transient proposal/private-write cache will be recreated empty.'
            else
                echo 'Peer blockchain and application data were not modified.'
            fi
            echo \"Preserved corrupted component: \${corrupt}\"
        fi
    "; then
        :
    else
        repair_rc=$?
        echo "ERROR: Peer LevelDB recovery failed for ${namespace}/${deployment} (exit ${repair_rc})."
        if (( repair_rc == 32 )); then
            echo "The ledger-provider DB has no usable MANIFEST and requires peer re-bootstrap rather than another LevelDB micro-repair."
            echo "Next safe local recovery: ./k8s/deploy-k8s.sh local rebootstrap-peers"
        fi
        kubectl delete pod "$repair_pod" -n "$namespace" --ignore-not-found --wait=false >/dev/null 2>&1 || true
        kubectl scale deployment "$deployment" -n "$namespace" --replicas="$desired_replicas" >/dev/null || true
        clear_active_repair
        return 1
    fi

    kubectl delete pod "$repair_pod" -n "$namespace" --ignore-not-found --wait=true >/dev/null 2>&1 || true

    case "$failure_type" in
        transient-store)
            echo "Starting ${namespace}/deployment/${deployment}; Fabric will create a fresh transient-store LevelDB."
            ;;
        ledger-provider)
            echo "Starting ${namespace}/deployment/${deployment} after conservative ledger-provider CURRENT repair."
            ;;
        *)
            echo "Starting ${namespace}/deployment/${deployment}; Fabric will create a fresh lock LevelDB."
            ;;
    esac
    kubectl scale deployment "$deployment" -n "$namespace" --replicas="$desired_replicas" >/dev/null
    log_repair_action "peer-${failure_type}" "$deployment" "$namespace" "corrupted component isolated; deployment restored to ${desired_replicas} replica(s)"
    clear_active_repair
    return 0
}

ensure_peer_ready() {
    local deployment="$1"
    local namespace="$2"
    local initial_failure_type="${3:-}"
    local wait_rc=0
    local failure_type=""
    local attempts=0
    local max_repairs=3
    local -A attempted_repairs=()

    # repair-fabric may already have captured the signature from a pod that is being
    # replaced. Preserve that evidence instead of forcing a second lookup against a
    # brand-new Pending pod.
    failure_type="$initial_failure_type"

    while (( attempts <= max_repairs )); do
        if [[ -z "$failure_type" ]]; then
            wait_rc=0
            wait_for_peer_or_known_failure "$deployment" "$namespace" || wait_rc=$?
            if (( wait_rc == 0 )); then
                if (( attempts > 0 )); then
                    echo "Recovered ${namespace}/deployment/${deployment}; the Fabric peer is ready again."
                fi
                return 0
            fi

            if (( wait_rc != 2 )); then
                echo "ERROR: ${namespace}/deployment/${deployment} failed for an unrecognized reason."
                show_peer_diagnostics "$deployment" "$namespace"
                return 1
            fi

            failure_type="${PEER_DETECTED_FAILURE_TYPE:-}"
            if [[ -z "$failure_type" ]]; then
                # Last-chance lookup. This should rarely be needed because the wait
                # function now preserves the signature it saw.
                failure_type="$(peer_recoverable_corruption_type "$deployment" "$namespace" || true)"
            fi
        fi

        if [[ -z "$failure_type" ]]; then
            echo "ERROR: Peer corruption was detected but its type could not be retained."
            show_peer_diagnostics "$deployment" "$namespace"
            return 1
        fi

        if [[ -n "${attempted_repairs[$failure_type]:-}" ]]; then
            echo "ERROR: ${failure_type} corruption returned after it was already repaired once."
            echo "Refusing to repeat the same automatic repair; broader persisted peer data may be damaged."
            show_peer_diagnostics "$deployment" "$namespace"
            return 1
        fi

        case "$failure_type" in
            transient-lock|ledger-lock)
                if ! is_true "$PEER_AUTO_REPAIR_LEVELDB_LOCKS"; then
                    echo "ERROR: Recoverable Fabric peer ${failure_type} corruption was detected in ${namespace}/${deployment}."
                    echo "Automatic peer lock repair is disabled for profile '${PROFILE}'."
                    echo "After confirming backups, rerun with PEER_AUTO_REPAIR_LEVELDB_LOCKS=true."
                    show_peer_diagnostics "$deployment" "$namespace"
                    return 1
                fi
                ;;
            transient-store)
                if ! is_true "$PEER_AUTO_REPAIR_TRANSIENT_STORE"; then
                    echo "ERROR: Recoverable Fabric transient-store LevelDB corruption was detected in ${namespace}/${deployment}."
                    echo "Automatic transient-store rebuild is disabled for profile '${PROFILE}'."
                    echo "This repair preserves the damaged store by renaming it, but starts Fabric with an empty transient proposal/private-write cache."
                    echo "After confirming backups and that no transactions are in flight, rerun with PEER_AUTO_REPAIR_TRANSIENT_STORE=true."
                    show_peer_diagnostics "$deployment" "$namespace"
                    return 1
                fi
                ;;
            ledger-provider)
                if ! is_true "$PEER_AUTO_REPAIR_LEDGER_PROVIDER_CURRENT"; then
                    echo "ERROR: Fabric ledger-provider ID-store corruption was detected in ${namespace}/${deployment}."
                    echo "Automatic CURRENT-pointer repair is disabled for profile '${PROFILE}'."
                    echo "The ledger-provider DB will never be automatically deleted. After confirming backups, rerun with PEER_AUTO_REPAIR_LEDGER_PROVIDER_CURRENT=true to permit only the conservative entry-pointer repair."
                    show_peer_diagnostics "$deployment" "$namespace"
                    return 1
                fi
                ;;
            *)
                echo "ERROR: Unsupported peer repair type '${failure_type}'."
                show_peer_diagnostics "$deployment" "$namespace"
                return 1
                ;;
        esac

        if (( attempts >= max_repairs )); then
            echo "ERROR: Peer reached the guarded micro-repair limit (${max_repairs})."
            echo "If ledger-provider corruption remains, use: ./k8s/deploy-k8s.sh ${PROFILE} rebootstrap-peers"
            show_peer_diagnostics "$deployment" "$namespace"
            return 1
        fi

        attempted_repairs["$failure_type"]=1
        attempts=$((attempts + 1))
        echo "Known recoverable peer ${failure_type} corruption detected; starting guarded automatic recovery (${attempts}/${max_repairs})."
        repair_peer_leveldb_component "$deployment" "$namespace" "$failure_type" || return 1

        # A lock repair can expose an already-corrupted transient store on the next
        # start. Allow a different recognized repair type, but never repeat the same
        # type automatically.
        failure_type=""
    done

    echo "ERROR: Peer exceeded the guarded repair limit (${max_repairs})."
    show_peer_diagnostics "$deployment" "$namespace"
    return 1
}

ensure_peer_ready_with_rebootstrap() {
    local deployment="$1"
    local namespace="$2"
    local initial_failure_type="${3:-}"

    if ensure_peer_ready "$deployment" "$namespace" "$initial_failure_type"; then
        return 0
    fi

    # The bounded micro-repair ladder may expose ledgerProvider/openIDStore
    # corruption only after locks/transient state have been repaired. Detect that
    # final state and escalate automatically for local development.
    local final_failure_type=""
    sleep 2
    final_failure_type="$(peer_recoverable_corruption_type "$deployment" "$namespace" || true)"
    if [[ "$final_failure_type" != "ledger-provider" ]]; then
        return 1
    fi

    if ! is_true "$PEER_AUTO_REBOOTSTRAP_ON_LEDGER_PROVIDER"; then
        echo "ERROR: ${namespace}/${deployment} requires peer re-bootstrap, but automatic escalation is disabled."
        return 1
    fi
    if [[ "$PROFILE" == "production" ]] && ! is_true "$PEER_ALLOW_PRODUCTION_REBOOTSTRAP"; then
        echo "ERROR: ${namespace}/${deployment} requires peer re-bootstrap, but production re-bootstrap is disabled."
        return 1
    fi

    echo "AUTO-RECOVERY: ${namespace}/${deployment} reached ledgerProvider/openIDStore corruption."
    echo "Escalating from conservative LevelDB repair to preserved peer re-bootstrap + channel rejoin."

    local old_targets="$PEER_REBOOTSTRAP_TARGETS"
    local old_reinstall="$REINSTALL_CHAINCODE_AFTER_REBOOTSTRAP"
    PEER_REBOOTSTRAP_TARGETS="$deployment"
    export PEER_REBOOTSTRAP_TARGETS

    # During a full apply, bootstrap_fabric later runs install-chaincode.sh again.
    # Avoid doing the same chaincode bootstrap twice in the middle of deployment.
    if [[ "$ACTION" == "apply" ]]; then
        REINSTALL_CHAINCODE_AFTER_REBOOTSTRAP="false"
    fi
    export REINSTALL_CHAINCODE_AFTER_REBOOTSTRAP

    local rc=0
    rebootstrap_corrupt_peers || rc=$?

    PEER_REBOOTSTRAP_TARGETS="$old_targets"
    REINSTALL_CHAINCODE_AFTER_REBOOTSTRAP="$old_reinstall"
    export PEER_REBOOTSTRAP_TARGETS REINSTALL_CHAINCODE_AFTER_REBOOTSTRAP

    if (( rc != 0 )); then
        return "$rc"
    fi

    peer_deployment_ready "$deployment" "$namespace"
}

restart_peer_and_wait() {
    local deployment="$1"
    local namespace="$2"

    echo "Restarting ${namespace}/deployment/${deployment}..."
    kubectl rollout restart "deployment/${deployment}" -n "$namespace" >/dev/null
    ensure_peer_ready_with_rebootstrap "$deployment" "$namespace"
}

show_job_logs() {
    local job_name="$1"
    local namespace="$2"
    local pod
    local found=false

    while IFS= read -r pod; do
        [[ -z "$pod" ]] && continue
        found=true
        echo "Logs for ${namespace}/${pod}:"
        kubectl logs "$pod" -n "$namespace" --all-containers=true --prefix=true || true
    done < <(
        kubectl get pods -n "$namespace" -l "job-name=${job_name}" -o name 2>/dev/null || true
    )

    if [[ "$found" != "true" ]]; then
        echo "No pods remain for Job ${namespace}/${job_name}."
    fi
}

show_job_diagnostics() {
    local job_name="$1"
    local namespace="$2"

    show_job_logs "$job_name" "$namespace"
    kubectl describe job "$job_name" -n "$namespace" || true
    kubectl get pods -n "$namespace" -l "job-name=${job_name}" -o wide || true
    kubectl get events -n "$namespace" --sort-by=.lastTimestamp | tail -n 40 || true
}

wait_for_job_completion() {
    local job_name="$1"
    local namespace="$2"
    local timeout_seconds="$3"
    local deadline=$((SECONDS + timeout_seconds))
    local succeeded
    local failed_condition

    while (( SECONDS < deadline )); do
        if ! kubectl get job "$job_name" -n "$namespace" >/dev/null 2>&1; then
            echo "ERROR: Job ${namespace}/${job_name} disappeared while waiting for completion."
            return 1
        fi

        succeeded="$(kubectl get job "$job_name" -n "$namespace" -o jsonpath='{.status.succeeded}' 2>/dev/null || true)"
        if [[ "${succeeded:-0}" =~ ^[1-9][0-9]*$ ]]; then
            return 0
        fi

        failed_condition="$(
            kubectl get job "$job_name" -n "$namespace" \
                -o jsonpath='{range .status.conditions[?(@.type=="Failed")]}{.status}{"|"}{.reason}{"|"}{.message}{end}' \
                2>/dev/null || true
        )"
        if [[ "${failed_condition%%|*}" == "True" ]]; then
            echo "ERROR: Job ${namespace}/${job_name} failed: ${failed_condition}"
            return 1
        fi

        sleep 3
    done

    echo "ERROR: Timed out after ${timeout_seconds}s waiting for Job ${namespace}/${job_name}."
    return 1
}

append_default() {
    local file="$1"
    local key="$2"
    local value="$3"
    if ! grep -q "^${key}=" "$file"; then
        echo "${key}=${value}" >> "$file"
    fi
}

set_key() {
    local file="$1"
    local key="$2"
    local value="$3"
    local tmp_file="${file}.tmp"

    grep -v "^${key}=" "$file" > "$tmp_file" || true
    mv "$tmp_file" "$file"
    echo "${key}=${value}" >> "$file"
}

get_env_value() {
    local file="$1"
    local key="$2"
    grep "^${key}=" "$file" | tail -n 1 | cut -d '=' -f 2- || true
}

copy_key_if_missing() {
    local file="$1"
    local target="$2"
    local source="$3"
    local value

    if grep -q "^${target}=" "$file"; then
        return
    fi

    value="$(get_env_value "$file" "$source")"
    if [[ -n "$value" ]]; then
        echo "${target}=${value}" >> "$file"
    fi
}

require_keys() {
    local file="$1"
    shift
    local missing=""

    for required_key in "$@"; do
        if ! grep -q "^${required_key}=" "$file"; then
            missing="${missing} ${required_key}"
        fi
    done

    if [[ -n "$missing" ]]; then
        echo "ERROR: Missing required secrets:${missing}"
        echo "Set these in .env before deploying."
        exit 1
    fi
}

inject_configs() {
    echo "Injecting generated ConfigMaps and Secrets..."

    kubectl apply -f ./k8s/00-namespace.yaml >/dev/null

    if [[ "$PROFILE" == "local" ]]; then
        echo "Local RAM limiter disabled; removing script-managed LimitRanges."
        for ns in "${NAMESPACES[@]}"; do
            kubectl delete limitrange autopilot-shrink-ray -n "$ns" --ignore-not-found >/dev/null 2>&1 || true
        done
    else
        local default_limit_cpu="250m"
        local default_limit_memory="512Mi"
        local default_request_cpu="250m"
        local default_request_memory="512Mi"
        for ns in "${NAMESPACES[@]}"; do
            cat <<EOF | kubectl apply -n "$ns" -f -
apiVersion: v1
kind: LimitRange
metadata:
  name: autopilot-shrink-ray
spec:
  limits:
  - default:
      cpu: "${default_limit_cpu}"
      memory: "${default_limit_memory}"
    defaultRequest:
      cpu: "${default_request_cpu}"
      memory: "${default_request_memory}"
    type: Container
EOF
        done
    fi

    for ns in plv-main-campus plv-annex-campus plv-pubad-campus; do
        kubectl create configmap fabric-common-config \
            --from-file=core.yaml=./config/core.yaml \
            --from-file=orderer.yaml=./config/orderer.yaml \
            -n "$ns" --dry-run=client -o yaml | kubectl apply -f -
    done

    if [[ ! -f "./init-db-schema.sql" ]]; then
        echo "ERROR: ./init-db-schema.sql not found."
        exit 1
    fi

    if ! compgen -G "../migrations/[0-9][0-9][0-9]_*.sql" >/dev/null; then
        echo "ERROR: No numbered PostgreSQL migrations were found in ../migrations."
        exit 1
    fi

    for ns in plv-main-campus plv-annex-campus plv-pubad-campus; do
        kubectl create configmap postgres-init-script \
            --from-file=00-base-schema.sql=./init-db-schema.sql \
            -n "$ns" --dry-run=client -o yaml | kubectl apply -f -
    done

    local migration_config_args=()
    local migration_file
    for migration_file in ../migrations/[0-9][0-9][0-9]_*.sql; do
        migration_config_args+=("--from-file=$(basename "$migration_file")=$migration_file")
    done
    kubectl create configmap postgres-runtime-migrations \
        "${migration_config_args[@]}" \
        -n plv-main-campus --dry-run=client -o yaml | kubectl apply -f -

    if [[ ! -s "./k8s/backup_postgres.sh" ]]; then
        echo "ERROR: ./k8s/backup_postgres.sh is missing or empty."
        exit 1
    fi
    kubectl create configmap postgres-backup-script \
        --from-file=backup_postgres.sh=./k8s/backup_postgres.sh \
        -n plv-main-campus --dry-run=client -o yaml | kubectl apply -f -

    if [[ ! -f "./swarm.key" ]]; then
        echo "Generating missing IPFS swarm.key for this environment."
        printf "/key/swarm/psk/1.0.0/\n/base16/\n1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a\n" > ./swarm.key
    fi

    tr -d '\r' < ./swarm.key > ./swarm-clean.key
    for ns in plv-fabric plv-annex-campus plv-pubad-campus; do
        kubectl create configmap ipfs-swarm-key \
            --from-file=swarm.key=./swarm-clean.key \
            -n "$ns" --dry-run=client -o yaml | kubectl apply -f -
    done
    rm -f ./swarm-clean.key

    local env_file="./.env"
    local clean_env="./.clean.env"
    rm -f "$clean_env"
    touch "$clean_env"

    if [[ -f "$env_file" ]]; then
        tr -d '\r' < "$env_file" | grep -v '^#' | grep '=' | sort -u -t '=' -k 1,1 > "$clean_env"
    fi

    copy_key_if_missing "$clean_env" BOOTSTRAP_REGISTRAR_PASS BOOTSTRAP_REGISTRAR_PASSWORD
    copy_key_if_missing "$clean_env" BOOTSTRAP_REGISTRAR_PASSWORD BOOTSTRAP_REGISTRAR_PASS
    copy_key_if_missing "$clean_env" BOOTSTRAP_SYSTEM_ADMIN_PASS BOOTSTRAP_SYSTEM_ADMIN_PASSWORD
    copy_key_if_missing "$clean_env" BOOTSTRAP_SYSTEM_ADMIN_PASSWORD BOOTSTRAP_SYSTEM_ADMIN_PASS
    copy_key_if_missing "$clean_env" FABRIC_CA_REGISTRAR_PASS BOOTSTRAP_REGISTRAR_PASS
    copy_key_if_missing "$clean_env" FABRIC_CA_FACULTY_PASS BOOTSTRAP_REGISTRAR_PASS
    copy_key_if_missing "$clean_env" FABRIC_CA_DEPARTMENT_PASS BOOTSTRAP_REGISTRAR_PASS

    if [[ "$PROFILE" == "local" ]]; then
        copy_key_if_missing "$clean_env" VAULT_PASSWORD BOOTSTRAP_REGISTRAR_PASS
    fi

    require_keys "$clean_env" IPFS_ENCRYPTION_KEY JWT_SECRET INTERNAL_API_KEY BOOTSTRAP_REGISTRAR_PASS BOOTSTRAP_SYSTEM_ADMIN_PASS VAULT_PASSWORD
    require_keys "$clean_env" FABRIC_CA_REGISTRAR_PASS FABRIC_CA_FACULTY_PASS FABRIC_CA_DEPARTMENT_PASS

    if [[ "$PROFILE" == "production" ]]; then
        require_keys "$clean_env" POSTGRES_PASS POSTGRES_REPL_PASS COUCHDB_PASS POSTGRES_BACKUP_GCS_BUCKET POSTGRES_BACKUP_ENCRYPTION_KEY
    fi

    append_default "$clean_env" POSTGRES_USER "postgres"
    append_default "$clean_env" POSTGRES_PASS "password"
    append_default "$clean_env" POSTGRES_DB "ActivityLogs"
    append_default "$clean_env" POSTGRES_REPL_USER "replica"
    append_default "$clean_env" POSTGRES_REPL_PASS "replica_pass_123"
    append_default "$clean_env" COUCHDB_USER "PLVADMIN"
    append_default "$clean_env" COUCHDB_PASS "PLVSYSTEM2026"

    local package_ids
    local package_key
    local package_value
    package_ids="$(bash ./k8s/install-chaincode.sh --print-package-ids)" || {
        echo "ERROR: Failed to calculate deterministic chaincode package IDs."
        exit 1
    }
    while IFS='=' read -r package_key package_value; do
        case "$package_key" in
            CHAINCODE_ID_REGISTRAR|CHAINCODE_ID_FACULTY|CHAINCODE_ID_DEPARTMENT)
                set_key "$clean_env" "$package_key" "$package_value"
                ;;
        esac
    done <<< "$package_ids"

    set_key "$clean_env" MIDDLEWARE_URL "http://middleware-api.plv-fabric.svc.cluster.local:4000"
    set_key "$clean_env" POSTGRES_HOST "postgres.plv-main-campus.svc.cluster.local"

    local couch_user
    local couch_pass
    couch_user="$(get_env_value "$clean_env" COUCHDB_USER)"
    couch_pass="$(get_env_value "$clean_env" COUCHDB_PASS)"

    set_key "$clean_env" COUCHDB_URL "http://${couch_user}:${couch_pass}@couchdb-registrar.plv-main-campus.svc.cluster.local:5984"
    set_key "$clean_env" COUCHDB_WALLET_URL "http://${couch_user}:${couch_pass}@couchdb-wallet-registrar.plv-main-campus.svc.cluster.local:5985"
    set_key "$clean_env" COUCHD_WALLET_MAIN_URL "http://${couch_user}:${couch_pass}@couchdb-wallet-registrar.plv-main-campus.svc.cluster.local:5985"
    set_key "$clean_env" COUCHDB_WALLET_REGISTRAR_URL "http://${couch_user}:${couch_pass}@couchdb-wallet-registrar.plv-main-campus.svc.cluster.local:5985"
    set_key "$clean_env" COUCHDB_WALLET_FACULTY_URL "http://${couch_user}:${couch_pass}@couchdb-wallet-faculty.plv-annex-campus.svc.cluster.local:5985"
    set_key "$clean_env" COUCHDB_WALLET_DEPARTMENT_URL "http://${couch_user}:${couch_pass}@couchdb-wallet-department.plv-pubad-campus.svc.cluster.local:5985"

    set_key "$clean_env" FABRIC_CA_REGISTRAR_URL "https://ca-registrar.plv-main-campus.svc.cluster.local:7054"
    set_key "$clean_env" FABRIC_CA_FACULTY_URL "https://ca-faculty.plv-annex-campus.svc.cluster.local:7054"
    set_key "$clean_env" FABRIC_CA_DEPARTMENT_URL "https://ca-department.plv-pubad-campus.svc.cluster.local:7054"

    for ns in "${NAMESPACES[@]}"; do
        kubectl create secret generic blockgo-secrets \
            -n "$ns" --from-env-file="$clean_env" \
            --dry-run=client -o yaml | kubectl apply -f -
    done

    rm -f "$clean_env"
    echo "Generated ConfigMaps and Secrets are ready."
}

remove_local_memory_limits_from_generated_manifests() {
    if [[ "$PROFILE" != "local" ]]; then
        return
    fi

    echo "Removing local container memory limits from generated manifests..."
    local manifest
    local tmp_file
    for manifest in "$TMP_K8S_DIR"/*.yaml; do
        [[ -f "$manifest" ]] || continue
        tmp_file="${manifest}.ram-unlimited.tmp"
        awk '
            function leading_spaces(s) {
                match(s, /^[ ]*/)
                return RLENGTH
            }
            {
                current_indent = leading_spaces($0)
                if (in_limits && $0 !~ /^[[:space:]]*$/ && current_indent <= limits_indent) {
                    in_limits = 0
                }
                if ($0 ~ /^[[:space:]]*limits:[[:space:]]*$/) {
                    in_limits = 1
                    limits_indent = current_indent
                    print
                    next
                }
                if (in_limits && current_indent > limits_indent && $0 ~ /^[[:space:]]*memory:[[:space:]]*/) {
                    next
                }
                print
            }
        ' "$manifest" > "$tmp_file"
        mv "$tmp_file" "$manifest"
    done
}

clear_existing_local_memory_limits() {
    if [[ "$PROFILE" != "local" ]]; then
        return
    fi

    echo "Removing memory limits from existing local Deployments and StatefulSets..."
    local namespace
    local kind
    local resource
    local index
    local memory_limit
    local container_count

    for namespace in "${NAMESPACES[@]}"; do
        for kind in deployment statefulset; do
            while IFS= read -r resource; do
                [[ -n "$resource" ]] || continue
                container_count="$(kubectl get "$kind/$resource" -n "$namespace" \
                    -o jsonpath='{.spec.template.spec.containers[*].name}' 2>/dev/null | awk '{print NF}')"
                container_count="${container_count:-0}"
                for ((index=0; index<container_count; index++)); do
                    memory_limit="$(kubectl get "$kind/$resource" -n "$namespace" \
                        -o jsonpath="{.spec.template.spec.containers[$index].resources.limits.memory}" 2>/dev/null || true)"
                    [[ -n "$memory_limit" ]] || continue
                    kubectl patch "$kind/$resource" -n "$namespace" --type=json \
                        -p="[{\"op\":\"remove\",\"path\":\"/spec/template/spec/containers/$index/resources/limits/memory\"}]" \
                        >/dev/null 2>&1 || true
                done
            done < <(kubectl get "$kind" -n "$namespace" -o name 2>/dev/null | cut -d/ -f2)
        done
    done
}

prepare_manifests() {
    rm -rf "$TMP_K8S_DIR"
    mkdir -p "$TMP_K8S_DIR"
    cp ./k8s/*.yaml "$TMP_K8S_DIR/"

    if [[ "$PROFILE" == "local" ]]; then
        echo "Preparing local manifests with immutable source image tag ${LOCAL_IMAGE_TAG} and smaller storage."
        cp ./k8s/01b-persistent-volumes.local-kind.yaml.example "$TMP_K8S_DIR/01b-persistent-volumes.local-kind.yaml"
        local pv_root
        pv_root="$(local_pv_root)"
        echo "Local PV hostPath root: $pv_root"
        sed -i "s|\${PWD}|$pv_root|g" "$TMP_K8S_DIR/01b-persistent-volumes.local-kind.yaml"
        sed -i "s|registry.example.com/plv-repo/||g" "$TMP_K8S_DIR"/*.yaml
        local image_name
        for image_name in \
            fabric-middleware \
            client-app \
            frontend \
            registrar-chaincode \
            faculty-chaincode \
            department-chaincode \
            postgres-backup; do
            sed -i "s|${image_name}:latest|${image_name}:${LOCAL_IMAGE_TAG}|g" "$TMP_K8S_DIR"/*.yaml
        done
        sed -i 's/imagePullPolicy: Always/imagePullPolicy: Never/g' "$TMP_K8S_DIR"/*.yaml
        sed -i 's/value: file/value: none/g' "$TMP_K8S_DIR"/06-orderer*.yaml
        sed -i '/- name: ORDERER_ADMIN_TLS_ENABLED/{n;s/value: "true"/value: "false"/;}' "$TMP_K8S_DIR"/06-orderer*.yaml
        sed -i 's/storage: 100Gi/storage: 10Gi/g' "$TMP_K8S_DIR"/*.yaml
        sed -i 's/storage: 50Gi/storage: 10Gi/g' "$TMP_K8S_DIR"/*.yaml
        sed -i 's/storage: 30Gi/storage: 10Gi/g' "$TMP_K8S_DIR"/*.yaml
        sed -i 's/storage: 20Gi/storage: 10Gi/g' "$TMP_K8S_DIR"/*.yaml
        preserve_existing_local_pvc_request "$TMP_K8S_DIR/06-orderer-1.yaml" orderer-1-pvc plv-main-campus
        preserve_existing_local_pvc_request "$TMP_K8S_DIR/06-orderer-2.yaml" orderer-2-pvc plv-main-campus
        preserve_existing_local_pvc_request "$TMP_K8S_DIR/06-orderer-3.yaml" orderer-3-pvc plv-annex-campus
        preserve_existing_local_pvc_request "$TMP_K8S_DIR/07-peer-registrar.yaml" peer-registrar-pvc plv-main-campus
        preserve_existing_local_pvc_request "$TMP_K8S_DIR/07-peer-faculty.yaml" peer-faculty-pvc plv-annex-campus
        preserve_existing_local_pvc_request "$TMP_K8S_DIR/07-peer-department.yaml" peer-department-pvc plv-pubad-campus
        sed -i 's/replicas: [23]/replicas: 1/g' "$TMP_K8S_DIR/08-middleware-api.yaml"
        sed -i 's/replicas: [23]/replicas: 1/g' "$TMP_K8S_DIR/14-client-app.yaml"
        sed -i 's/FABRIC_CA_INSECURE_TLS: "false"/FABRIC_CA_INSECURE_TLS: "true"/' "$TMP_K8S_DIR/08-middleware-api.yaml"
        sed -i 's/FABRIC_DISCOVERY_ENABLED: "true"/FABRIC_DISCOVERY_ENABLED: "false"/' "$TMP_K8S_DIR/08-middleware-api.yaml"
        sed -i 's/FABRIC_HA_ENABLED: "true"/FABRIC_HA_ENABLED: "false"/' "$TMP_K8S_DIR/08-middleware-api.yaml"
        sed -i '/- name: IPFS_RUN_AS_ROOT/{n;s/value: "false"/value: "true"/;}' "$TMP_K8S_DIR/09-ipfs.yaml"
        sed -i '/^[[:space:]]*nodeSelector:[[:space:]]*$/,+1d' "$TMP_K8S_DIR"/*.yaml
        remove_local_memory_limits_from_generated_manifests
    else
        resolve_gke_zones
        echo "Preparing production manifests with the source-built image revision ${PRODUCTION_IMAGE_TAG}."
        local image_name
        for image_name in \
            fabric-middleware \
            client-app \
            frontend \
            registrar-chaincode \
            faculty-chaincode \
            department-chaincode \
            postgres-backup; do
            sed -i \
                "s|registry.example.com/plv-repo/${image_name}:latest|${PRODUCTION_IMAGE_REPOSITORY%/}/${image_name}:${PRODUCTION_IMAGE_TAG}|g" \
                "$TMP_K8S_DIR"/*.yaml
        done

        if grep -R -q 'registry.example.com/plv-repo/' "$TMP_K8S_DIR"; then
            echo "ERROR: Placeholder production image references remain after manifest preparation."
            return 1
        fi

        sed -i "s/__GKE_ZONE_A__/${GKE_ZONE_A}/g; s/__GKE_ZONE_B__/${GKE_ZONE_B}/g; s/__GKE_ZONE_C__/${GKE_ZONE_C}/g" "$TMP_K8S_DIR"/*.yaml
        if grep -R -q '__GKE_ZONE_[ABC]__' "$TMP_K8S_DIR"; then
            echo "ERROR: One or more GKE zone placeholders were not resolved."
            return 1
        fi
    fi
}

resolve_gke_zones() {
    if [[ -n "${GKE_REGION:-}" ]]; then
        GKE_ZONE_A="${GKE_ZONE_A:-${GKE_REGION}-a}"
        GKE_ZONE_B="${GKE_ZONE_B:-${GKE_REGION}-b}"
        GKE_ZONE_C="${GKE_ZONE_C:-${GKE_REGION}-c}"
    fi

    if [[ -z "${GKE_ZONE_A:-}" || -z "${GKE_ZONE_B:-}" || -z "${GKE_ZONE_C:-}" ]]; then
        local discovered_zones=()
        mapfile -t discovered_zones < <(
            kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.labels.topology\.kubernetes\.io/zone}{"\n"}{end}' 2>/dev/null |
                awk 'NF' | sort -u
        )
        if (( ${#discovered_zones[@]} < 3 )); then
            echo "ERROR: Production requires three GKE zones. Set GKE_REGION or GKE_ZONE_A/B/C."
            return 1
        fi
        GKE_ZONE_A="${GKE_ZONE_A:-${discovered_zones[0]}}"
        GKE_ZONE_B="${GKE_ZONE_B:-${discovered_zones[1]}}"
        GKE_ZONE_C="${GKE_ZONE_C:-${discovered_zones[2]}}"
    fi

    if [[ "$GKE_ZONE_A" == "$GKE_ZONE_B" || "$GKE_ZONE_A" == "$GKE_ZONE_C" || "$GKE_ZONE_B" == "$GKE_ZONE_C" ]]; then
        echo "ERROR: GKE_ZONE_A, GKE_ZONE_B, and GKE_ZONE_C must be distinct."
        return 1
    fi
    export GKE_ZONE_A GKE_ZONE_B GKE_ZONE_C
    echo "GKE zones: $GKE_ZONE_A, $GKE_ZONE_B, $GKE_ZONE_C"
}

validate_production_zone_nodes() {
    if [[ "$PROFILE" != "production" ]]; then
        return
    fi
    resolve_gke_zones
    local zone
    for zone in "$GKE_ZONE_A" "$GKE_ZONE_B" "$GKE_ZONE_C"; do
        if ! kubectl get nodes -l "topology.kubernetes.io/zone=${zone}" -o name | grep -q .; then
            echo "ERROR: No GKE node is available in required zone $zone."
            return 1
        fi
    done
}

generate_production_fabric_artifacts() {
    if [[ "$PROFILE" != "production" ]]; then
        return
    fi
    if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
        echo "ERROR: Docker is required to generate the six-consenter Fabric blocks."
        return 1
    fi

    mkdir -p ./channel-artifacts-k8s
    local workspace_path
    workspace_path="$(pwd)"
    echo "Generating fresh six-orderer production channel artifacts..."
    docker run --rm \
        -v "${workspace_path}/config/configtx-k8s.yaml:/fabric-config/configtx.yaml:ro" \
        -v "${workspace_path}/crypto-config-final-v2:/crypto-config-final-v2:ro" \
        -v "${workspace_path}/crypto-config-final-v2:/etc/hyperledger/fabric/crypto-config-final-v2:ro" \
        -v "${workspace_path}/channel-artifacts-k8s:/artifacts" \
        -e FABRIC_CFG_PATH=/fabric-config \
        hyperledger/fabric-tools:2.5.4 \
        configtxgen -profile UniversityGenesis -channelID system-channel -outputBlock /artifacts/orderer.genesis.block
    docker run --rm \
        -v "${workspace_path}/config/configtx-k8s.yaml:/fabric-config/configtx.yaml:ro" \
        -v "${workspace_path}/crypto-config-final-v2:/crypto-config-final-v2:ro" \
        -v "${workspace_path}/crypto-config-final-v2:/etc/hyperledger/fabric/crypto-config-final-v2:ro" \
        -v "${workspace_path}/channel-artifacts-k8s:/artifacts" \
        -e FABRIC_CFG_PATH=/fabric-config \
        hyperledger/fabric-tools:2.5.4 \
        configtxgen -profile RegistrarChannel -channelID registrar-channel -outputBlock /artifacts/registrar-channel.block
}

setup_gke_cluster() {
    if [[ "$PROFILE" != "production" ]]; then
        echo "ERROR: gke-setup is available only for the production profile."
        return 1
    fi
    for variable in GCP_PROJECT_ID GKE_CLUSTER_NAME GKE_REGION; do
        if [[ -z "${!variable:-}" ]]; then
            echo "ERROR: $variable is required for gke-setup."
            return 1
        fi
    done
    if ! command -v gcloud >/dev/null 2>&1; then
        echo "ERROR: gcloud is required for gke-setup."
        return 1
    fi

    GKE_ZONE_A="${GKE_ZONE_A:-${GKE_REGION}-a}"
    GKE_ZONE_B="${GKE_ZONE_B:-${GKE_REGION}-b}"
    GKE_ZONE_C="${GKE_ZONE_C:-${GKE_REGION}-c}"
    resolve_gke_zones
    local node_locations="${GKE_ZONE_A},${GKE_ZONE_B},${GKE_ZONE_C}"
    local node_service_account_args=()
    if [[ -n "${GKE_NODE_SERVICE_ACCOUNT:-}" ]]; then
        node_service_account_args+=(--service-account "$GKE_NODE_SERVICE_ACCOUNT")
    fi

    if ! gcloud container clusters describe "$GKE_CLUSTER_NAME" --project "$GCP_PROJECT_ID" --region "$GKE_REGION" >/dev/null 2>&1; then
        echo "Creating regional GKE cluster $GKE_CLUSTER_NAME across $node_locations..."
        gcloud container clusters create "$GKE_CLUSTER_NAME" \
            --project "$GCP_PROJECT_ID" \
            --region "$GKE_REGION" \
            --node-locations "$node_locations" \
            --num-nodes "${GKE_NODES_PER_ZONE:-1}" \
            --machine-type "${GKE_MACHINE_TYPE:-e2-standard-4}" \
            --disk-type pd-balanced \
            --disk-size "${GKE_NODE_DISK_GB:-100}" \
            --release-channel regular \
            --enable-ip-alias \
            --enable-shielded-nodes \
            --enable-dataplane-v2 \
            --workload-pool "${GCP_PROJECT_ID}.svc.id.goog" \
            --addons GcePersistentDiskCsiDriver,HttpLoadBalancing \
            "${node_service_account_args[@]}"
    else
        echo "Using existing regional GKE cluster $GKE_CLUSTER_NAME."
        gcloud container clusters update "$GKE_CLUSTER_NAME" \
            --project "$GCP_PROJECT_ID" --region "$GKE_REGION" \
            --workload-pool "${GCP_PROJECT_ID}.svc.id.goog" \
            --update-addons GcePersistentDiskCsiDriver=ENABLED
    fi

    gcloud container clusters get-credentials "$GKE_CLUSTER_NAME" --project "$GCP_PROJECT_ID" --region "$GKE_REGION"
    check_cluster
    resolve_gke_zones
    local cluster_location_type
    cluster_location_type="$(gcloud container clusters describe "$GKE_CLUSTER_NAME" --project "$GCP_PROJECT_ID" --region "$GKE_REGION" --format='value(locationType)')"
    if [[ "$cluster_location_type" != "REGIONAL" ]]; then
        echo "ERROR: $GKE_CLUSTER_NAME is not a regional GKE cluster."
        return 1
    fi
    local zone
    for zone in "$GKE_ZONE_A" "$GKE_ZONE_B" "$GKE_ZONE_C"; do
        if ! kubectl get nodes -l "topology.kubernetes.io/zone=${zone}" -o name | grep -q .; then
            echo "ERROR: The cluster has no schedulable node in required zone $zone."
            return 1
        fi
    done
    echo "GKE cluster is ready. Run: $0 production apply"
}

preserve_existing_local_pvc_request() {
    local manifest="$1"
    local claim="$2"
    local namespace="$3"
    local existing_request=""

    if ! existing_request="$(
        kubectl get pvc "$claim" -n "$namespace" \
            -o jsonpath='{.spec.resources.requests.storage}' 2>/dev/null
    )"; then
        return
    fi

    if [[ ! "$existing_request" =~ ^[0-9]+([.][0-9]+)?(Ei|Pi|Ti|Gi|Mi|Ki|E|P|T|G|M|K|m)?$ ]]; then
        echo "ERROR: Existing PVC ${namespace}/${claim} has an invalid storage request: ${existing_request}"
        return 1
    fi

    sed -i \
        "0,/^[[:space:]]*storage: 10Gi[[:space:]]*$/s//      storage: ${existing_request}/" \
        "$manifest"
    echo "Keeping existing PVC request ${namespace}/${claim} at ${existing_request}."
}

prepare_local_middleware_image() {
    if [[ "$PROFILE" != "local" ]]; then
        return
    fi

    echo "Building the local middleware microservices image (Docker cache enabled)..."
    docker build \
        -t "fabric-middleware:${LOCAL_IMAGE_TAG}" \
        -t fabric-middleware:latest \
        -f ../middleware/Dockerfile \
        ../middleware

    echo "Validating middleware microservice entrypoints..."
    docker run --rm --entrypoint node "fabric-middleware:${LOCAL_IMAGE_TAG}" -e '
        const scripts = require("/app/package.json").scripts || {};
        const required = ["start:gateway", "start:auth", "start:identity", "start:ledger", "start:upload", "start:settings"];
        const missing = required.filter((name) => !scripts[name]);
        if (missing.length > 0) {
            console.error(`Missing middleware scripts: ${missing.join(", ")}`);
            process.exit(1);
        }
        console.log("All middleware microservice entrypoints are present.");
    '
}

verify_required_application_fixes() {
    echo "Verifying required application fixes are present in the deployment source..."

    grep -q 'if (g >= 84) return "2.00"' ../frontend/src/utils/gradingHelpers.js || {
        echo "ERROR: The college grade-equivalent scale is missing from the frontend source."
        return 1
    }
    grep -q '>Grade</th><th className="px-4 py-3">Equivalent</th>' ../frontend/src/components/student/StudentHistoricalGrades.jsx || {
        echo "ERROR: The distinct Grade and Equivalent columns are missing from the student grade view."
        return 1
    }
    grep -q 'displayTransactionDate' ../frontend/src/components/student/StudentBlockchainTransactions.jsx || {
        echo "ERROR: The defensive transaction-date formatter is missing from the frontend source."
        return 1
    }
    grep -q 'NormalizeTransactionTimestamp' ../client-app/Controllers/StudentController.cs || {
        echo "ERROR: Fabric timestamp normalization is missing from the client-app source."
        return 1
    }
    grep -q 'if (rawAverage >= 84) return 2.00' ../client-app/Controllers/GradeController.cs || {
        echo "ERROR: The college grade-equivalent scale is missing from the client-app source."
        return 1
    }
    grep -q 'time.Unix(entry.Timestamp.Seconds' ../chaincode/main.go || {
        echo "ERROR: ISO transaction timestamps are missing from the chaincode source."
        return 1
    }
    grep -q 'ResetPasswordAsync(int userId' ../client-app/Services/IAccountProvisioningService.cs || {
        echo "ERROR: Role-limited manual password reset is missing from the client-app source."
        return 1
    }
    grep -q '"registrar" => target.Role is "student" or "faculty" or "department_admin"' ../client-app/Services/AccountProvisioningService.cs || {
        echo "ERROR: The Registrar password-reset role boundary is missing."
        return 1
    }
    grep -q '"system_admin" => target.Role == "registrar"' ../client-app/Services/AccountProvisioningService.cs || {
        echo "ERROR: The System Administrator password-reset role boundary is missing."
        return 1
    }
    grep -q 'HttpPost("registrar-correct/{recordId}")' ../client-app/Controllers/GradeController.cs || {
        echo "ERROR: The Registrar finalized-grade correction endpoint is missing."
        return 1
    }
    if grep -q 'Commit Corrected Grade' ../frontend/src/components/registrar/RegistrarGradesView.jsx; then
        echo "ERROR: The Registrar grade-correction frontend control must remain disabled."
        return 1
    fi
    grep -q 'Password Management' ../frontend/src/components/registrar/RegistrarGradesView.jsx || {
        echo "ERROR: The Registrar password-management frontend control is missing."
        return 1
    }

    grep -q 'const ActionReason' ../frontend/src/components/registrar/SystemLogs.jsx || {
        echo "ERROR: Human-readable Registrar activity-log rendering is missing."
        return 1
    }
    grep -q 'backToConversationList' ../frontend/src/components/shared/Chat.jsx || {
        echo "ERROR: The chat Back navigation control is missing."
        return 1
    }
    grep -q 'Permanently delete every message' ../frontend/src/components/shared/Chat.jsx || {
        echo "ERROR: Permanent direct-message deletion is missing from the chat frontend."
        return 1
    }
    grep -q 'Group invitations' ../frontend/src/components/shared/Chat.jsx || {
        echo "ERROR: Group invitation controls are missing from the chat frontend."
        return 1
    }
    grep -q 'CreateGroupChat' ../client-app/Controllers/ChatHub.cs || {
        echo "ERROR: Group-chat creation is missing from the chat hub."
        return 1
    }
    grep -q 'RespondToGroupInvitation' ../client-app/Controllers/ChatHub.cs || {
        echo "ERROR: Group invitation acceptance and decline are missing from the chat hub."
        return 1
    }
    grep -q 'TimeSpan.FromDays(30)' ../client-app/Controllers/ChatHub.cs || {
        echo "ERROR: The required 30-day chat history window is missing."
        return 1
    }
    grep -q 'DeleteHistoryAsync' ../client-app/Services/ChatCache.cs || {
        echo "ERROR: Permanent chat-cache deletion is missing."
        return 1
    }
    grep -q 'AddHostedService<BackendKeepAliveService>' ../client-app/Program.cs || {
        echo "ERROR: The backend-only keepalive service is not registered."
        return 1
    }
    grep -q 'DotnetServiceTopology.BuildGatewayConfiguration' ../client-app/Program.cs || {
        echo "ERROR: The ASP.NET microservice gateway is not configured."
        return 1
    }
    grep -q 'ServiceControllerFeatureProvider' ../client-app/Program.cs || {
        echo "ERROR: ASP.NET bounded-context controller isolation is not configured."
        return 1
    }
    local dotnet_deployment
    for dotnet_deployment in \
        dotnet-api-gateway \
        dotnet-auth-service \
        dotnet-academic-service \
        dotnet-grade-service \
        dotnet-operations-service \
        dotnet-realtime-service; do
        grep -q "name: ${dotnet_deployment}" ./k8s/14-client-app.yaml || {
            echo "ERROR: Missing ASP.NET microservice deployment ${dotnet_deployment}."
            return 1
        }
    done
    grep -q 'IntervalSeconds.*, 45' ../client-app/Services/BackendKeepAliveService.cs || {
        echo "ERROR: The 45-second backend keepalive interval is missing."
        return 1
    }
    grep -q 'MaximumRegistrarAccounts = 2' ../client-app/Services/AccountProvisioningService.cs || {
        echo "ERROR: The two-Registrar backend limit is missing."
        return 1
    }
    grep -q 'two-Registrar limit has been reached' ../frontend/src/components/system-admin/RegistrarAccountManagement.jsx || {
        echo "ERROR: The two-Registrar frontend limit state is missing."
        return 1
    }
    grep -q 'Network and Docker Issues' ../client-app/Controllers/SupportTicketsController.cs || {
        echo "ERROR: The fixed support-specialist choices are missing."
        return 1
    }
    grep -q 'Notice - (' ../client-app/Controllers/SupportTicketsController.cs || {
        echo "ERROR: The System Admin support broadcast format is missing."
        return 1
    }
    grep -q 'GF_USERS_DEFAULT_THEME' ../monitoring/observability-stack.yaml || {
        echo "ERROR: Grafana light-mode configuration is missing."
        return 1
    }
    grep -q 'sessionStorage' ../frontend/src/services/authSession.js || {
        echo "ERROR: Per-tab authentication storage is missing."
        return 1
    }
    grep -q "department_admin: '/department-admin'" ../frontend/src/services/authSession.js || {
        echo "ERROR: Stable role routes are missing from the frontend."
        return 1
    }
    grep -q 'try_files.*index.html' ./k8s/12-frontend-ha.yaml || {
        echo "ERROR: Kubernetes Nginx does not support direct role-route navigation."
        return 1
    }
    grep -q 'path: /' ./k8s/15-main-ingress.yaml || {
        echo "ERROR: The production ingress does not forward frontend role routes."
        return 1
    }
    grep -q 'chat_conversation_states' ../migrations/006_chat_conversation_states.sql || {
        echo "ERROR: Migration 006 for chat conversation state is missing or invalid."
        return 1
    }
    grep -q 'chat_group_messages' ../migrations/007_group_chats.sql || {
        echo "ERROR: Migration 007 for group chats is missing or invalid."
        return 1
    }
    grep -q 'assigned_specialist' ../migrations/008_support_ticket_specialist_assignments.sql || {
        echo "ERROR: Migration 008 for ticket specialties is missing or invalid."
        return 1
    }
    echo "Required grade, timestamp, password-reset, Registrar, and chat fixes are present."
}

prepare_local_application_images() {
    if [[ "$PROFILE" != "local" ]]; then
        return
    fi

    echo "Building the local client-app image from the current source..."
    docker build \
        -t "client-app:${LOCAL_IMAGE_TAG}" \
        -t client-app:latest \
        -f ../client-app/Dockerfile \
        ../client-app

    echo "Building the local frontend image from the current source..."
    docker build \
        -t "frontend:${LOCAL_IMAGE_TAG}" \
        -t frontend:latest \
        -f ../frontend/Dockerfile \
        ../frontend
}

validate_production_image_settings() {
    if [[ "$PROFILE" != "production" ]]; then
        return
    fi

    if [[ -z "$PRODUCTION_IMAGE_REPOSITORY" || "$PRODUCTION_IMAGE_REPOSITORY" == "registry.example.com/plv-repo" ]]; then
        echo "ERROR: Set PRODUCTION_IMAGE_REPOSITORY to the writable container repository used by the cluster."
        return 1
    fi
    if [[ -z "$PRODUCTION_IMAGE_TAG" || "$PRODUCTION_IMAGE_TAG" == "latest" ]]; then
        echo "ERROR: Set PRODUCTION_IMAGE_TAG to an immutable revision such as a release number or commit SHA; 'latest' is refused."
        return 1
    fi
    if [[ ! "$PRODUCTION_IMAGE_REPOSITORY" =~ ^[A-Za-z0-9._:/-]+$ ]]; then
        echo "ERROR: PRODUCTION_IMAGE_REPOSITORY contains unsupported characters."
        return 1
    fi
    if [[ ! "$PRODUCTION_IMAGE_TAG" =~ ^[A-Za-z0-9._-]+$ ]]; then
        echo "ERROR: PRODUCTION_IMAGE_TAG contains unsupported characters."
        return 1
    fi
}

prepare_production_source_images() {
    if [[ "$PROFILE" != "production" ]]; then
        return
    fi

    validate_production_image_settings
    if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
        echo "ERROR: Docker is required to build and publish production images."
        return 1
    fi

    local repository="${PRODUCTION_IMAGE_REPOSITORY%/}"
    local tag="$PRODUCTION_IMAGE_TAG"
    echo "Building production application images from the current workspace at ${repository}/*:${tag}..."

    docker build -t "${repository}/fabric-middleware:${tag}" -f ../middleware/Dockerfile ../middleware
    docker build -t "${repository}/client-app:${tag}" -f ../client-app/Dockerfile ../client-app
    docker build -t "${repository}/frontend:${tag}" -f ../frontend/Dockerfile ../frontend
    docker build -t "${repository}/registrar-chaincode:${tag}" -f ../chaincode/Dockerfile ../chaincode
    docker build -t "${repository}/postgres-backup:${tag}" -f ./k8s/postgres-backup/Dockerfile ./k8s/postgres-backup
    docker image tag "${repository}/registrar-chaincode:${tag}" "${repository}/faculty-chaincode:${tag}"
    docker image tag "${repository}/registrar-chaincode:${tag}" "${repository}/department-chaincode:${tag}"

    local image_name
    for image_name in \
        fabric-middleware \
        client-app \
        frontend \
        registrar-chaincode \
        faculty-chaincode \
        department-chaincode \
        postgres-backup; do
        echo "Publishing ${repository}/${image_name}:${tag}..."
        docker push "${repository}/${image_name}:${tag}"
    done
}

verify_deployment_inputs() {
    verify_required_application_fixes
    validate_production_image_settings
    prepare_manifests

    local image_repository=""
    local image_tag="$LOCAL_IMAGE_TAG"
    if [[ "$PROFILE" == "production" ]]; then
        image_repository="${PRODUCTION_IMAGE_REPOSITORY%/}/"
        image_tag="$PRODUCTION_IMAGE_TAG"
    fi

    local image_name
    local expected_image
    for image_name in \
        fabric-middleware \
        client-app \
        frontend \
        registrar-chaincode \
        faculty-chaincode \
        department-chaincode \
        postgres-backup; do
        expected_image="${image_repository}${image_name}:${image_tag}"
        if ! grep -R -F -q "image: ${expected_image}" "$TMP_K8S_DIR"; then
            echo "ERROR: Prepared manifests do not reference ${expected_image}."
            return 1
        fi
    done

    local required_file
    for required_file in \
        ./config/configtx-k8s.yaml \
        ./k8s/04d-postgres-additional-replicas.yaml \
        ./k8s/06-orderer-4.yaml \
        ./k8s/06-orderer-5.yaml \
        ./k8s/06-orderer-6.yaml \
        ./k8s/07-peer-secondary.yaml \
        ../migrations/006_chat_conversation_states.sql \
        ../migrations/007_group_chats.sql \
        ../migrations/008_support_ticket_specialist_assignments.sql \
        ./k8s/backup_postgres.sh \
        ./k8s/15-postgres-backup.yaml \
        ./k8s/postgres-backup/Dockerfile \
        ./k8s/couchdb-health-probe-json-patch.json \
        ../monitoring/grafana-dashboard.json \
        ../monitoring/grafana-kubernetes-memory.json \
        ../monitoring/grafana-api-observability.json \
        ../monitoring/grafana-fabric.json \
        ../monitoring/grafana-postgresql.json \
        ../monitoring/grafana-workflows.json \
        ../monitoring/grafana-logs.json \
        ../monitoring/observability-stack.yaml; do
        if [[ ! -s "$required_file" ]]; then
            echo "ERROR: Required deployment artifact ${required_file} is missing or empty."
            return 1
        fi
    done

    if ! grep -q 'postgres-runtime-migrations' ./k8s/04a-postgres-configmap.yaml; then
        echo "ERROR: The PostgreSQL migration Job is not wired to the generated migration ConfigMap."
        return 1
    fi

    echo "Deployment inputs verified for ${PROFILE}; no cluster resources were changed."
}

configure_local_application_rollouts() {
    if [[ "$PROFILE" != "local" ]]; then
        return
    fi

    echo "Configuring one-pod local application deployments without rollout surge..."
    local deployment
    local deployments=(
        middleware-api
        auth-service
        fabric-identity-service
        ledger-service
        grade-upload-service
        settings-service
        dotnet-api-gateway
        dotnet-auth-service
        dotnet-academic-service
        dotnet-grade-service
        dotnet-operations-service
        dotnet-realtime-service
        frontend
        ipfs-ha-router
    )

    for deployment in "${deployments[@]}"; do
        if ! kubectl get deployment "$deployment" -n plv-fabric >/dev/null 2>&1; then
            continue
        fi
        kubectl patch deployment "$deployment" -n plv-fabric --type=merge \
            -p '{"spec":{"strategy":{"type":"Recreate","rollingUpdate":null}}}' >/dev/null
    done

    local entry
    local namespace
    for entry in \
        "registrar-chaincode|plv-main-campus" \
        "faculty-chaincode|plv-annex-campus" \
        "department-chaincode|plv-pubad-campus"; do
        IFS='|' read -r deployment namespace <<< "$entry"
        if ! kubectl get deployment "$deployment" -n "$namespace" >/dev/null 2>&1; then
            continue
        fi
        kubectl patch deployment "$deployment" -n "$namespace" --type=merge \
            -p '{"spec":{"strategy":{"type":"Recreate","rollingUpdate":null}}}' >/dev/null
    done
}

restart_deployment_and_wait() {
    local deployment="$1"
    local namespace="$2"

    echo "Restarting ${namespace}/deployment/${deployment}..."
    kubectl rollout restart "deployment/${deployment}" -n "$namespace" >/dev/null
    wait_rollout "deployment/${deployment}" "$namespace"
}

deploy_orderer() {
    local manifest="$1"
    local deployment="$2"
    local namespace="$3"

    apply_manifest "$manifest"
    echo "Restarting ${namespace}/deployment/${deployment}..."
    kubectl rollout restart "deployment/${deployment}" -n "$namespace" >/dev/null
    ensure_orderer_ready "$deployment" "$namespace"
}

deploy_orderers_sequentially() {
    local orderers=(
        "$TMP_K8S_DIR/06-orderer-1.yaml|orderer-1|plv-main-campus"
        "$TMP_K8S_DIR/06-orderer-2.yaml|orderer-2|plv-main-campus"
        "$TMP_K8S_DIR/06-orderer-3.yaml|orderer-3|plv-annex-campus"
    )
    if [[ "$PROFILE" == "production" ]]; then
        orderers+=(
            "$TMP_K8S_DIR/06-orderer-4.yaml|orderer-4|plv-annex-campus"
            "$TMP_K8S_DIR/06-orderer-5.yaml|orderer-5|plv-pubad-campus"
            "$TMP_K8S_DIR/06-orderer-6.yaml|orderer-6|plv-pubad-campus"
        )
    fi

    if [[ "$PROFILE" == "production" ]]; then
        local consenter_count
        consenter_count="$(grep -c '^[[:space:]]*- Host: orderer-' ./config/configtx-k8s.yaml)"
        if [[ "$consenter_count" != "6" ]]; then
            echo "ERROR: Production configtx must declare six Raft consenters; found $consenter_count."
            return 1
        fi
        if ! grep -q 'replication-type: regional-pd' ./k8s/01a-storage-class.yaml; then
            echo "ERROR: Production storage must use GKE regional persistent disks."
            return 1
        fi
    fi
    local -A deployed=()
    local entry
    local manifest
    local deployment
    local namespace
    local desired
    local current
    local scheduled

    echo "Recovering interrupted orderer rollouts before normal sequential updates..."
    for entry in "${orderers[@]}"; do
        IFS='|' read -r manifest deployment namespace <<< "$entry"
        if ! kubectl get deployment "$deployment" -n "$namespace" >/dev/null 2>&1; then
            continue
        fi

        desired="$(kubectl get deployment "$deployment" -n "$namespace" -o jsonpath='{.spec.replicas}')"
        current="$(kubectl get deployment "$deployment" -n "$namespace" -o jsonpath='{.status.replicas}')"
        scheduled="$(
            kubectl get pods -n "$namespace" -l "app=${deployment}" \
                -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}' |
                awk 'NF { count++ } END { print count + 0 }'
        )"
        desired="${desired:-0}"
        current="${current:-0}"
        scheduled="${scheduled:-0}"

        if (( scheduled > desired )); then
            echo "${namespace}/deployment/${deployment} has ${scheduled} scheduled pods (${current} replica objects) for desired ${desired}; reconciling it first."
            deploy_orderer "$manifest" "$deployment" "$namespace"
            deployed["$deployment"]=true
        fi
    done

    echo "Deploying remaining orderers sequentially..."
    for entry in "${orderers[@]}"; do
        IFS='|' read -r manifest deployment namespace <<< "$entry"
        if [[ "${deployed[$deployment]:-}" == "true" ]]; then
            continue
        fi
        deploy_orderer "$manifest" "$deployment" "$namespace"
    done
}

configure_orderer_channel_endpoint_aliases() {
    if [[ "$PROFILE" == "production" ]]; then
        return
    fi
    local orderer_one_ip
    local orderer_two_ip
    local orderer_three_ip
    local patch
    local entry
    local deployment
    local namespace

    orderer_one_ip="$(kubectl get service orderer-1 -n plv-main-campus -o jsonpath='{.spec.clusterIP}')"
    orderer_two_ip="$(kubectl get service orderer-2 -n plv-main-campus -o jsonpath='{.spec.clusterIP}')"
    orderer_three_ip="$(kubectl get service orderer-3 -n plv-annex-campus -o jsonpath='{.spec.clusterIP}')"

    if [[ -z "$orderer_one_ip" || -z "$orderer_two_ip" || -z "$orderer_three_ip" ]]; then
        echo "ERROR: Could not resolve all orderer Service IPs for channel endpoint aliases."
        return 1
    fi

    patch="{\"spec\":{\"template\":{\"spec\":{\"hostAliases\":[{\"ip\":\"${orderer_one_ip}\",\"hostnames\":[\"orderer.capstone.com\"]},{\"ip\":\"${orderer_two_ip}\",\"hostnames\":[\"orderer2.capstone.com\"]},{\"ip\":\"${orderer_three_ip}\",\"hostnames\":[\"orderer3.capstone.com\"]}]}}}}"

    echo "Configuring Kubernetes resolution for the orderer endpoints embedded in existing channel artifacts..."
    for entry in \
        "orderer-1|plv-main-campus" \
        "orderer-2|plv-main-campus" \
        "orderer-3|plv-annex-campus"; do
        IFS='|' read -r deployment namespace <<< "$entry"
        kubectl patch deployment "$deployment" -n "$namespace" --type=merge -p "$patch" >/dev/null
        ensure_orderer_ready "$deployment" "$namespace"
    done
}

configure_peer_channel_endpoint_aliases() {
    if [[ "$PROFILE" == "production" ]]; then
        return
    fi
    local orderer_one_ip
    local orderer_two_ip
    local orderer_three_ip
    local registrar_peer_ip
    local faculty_peer_ip
    local department_peer_ip
    local patch
    local entry
    local deployment
    local namespace

    orderer_one_ip="$(kubectl get service orderer-1 -n plv-main-campus -o jsonpath='{.spec.clusterIP}')"
    orderer_two_ip="$(kubectl get service orderer-2 -n plv-main-campus -o jsonpath='{.spec.clusterIP}')"
    orderer_three_ip="$(kubectl get service orderer-3 -n plv-annex-campus -o jsonpath='{.spec.clusterIP}')"
    registrar_peer_ip="$(kubectl get service peer-registrar -n plv-main-campus -o jsonpath='{.spec.clusterIP}')"
    faculty_peer_ip="$(kubectl get service peer-faculty -n plv-annex-campus -o jsonpath='{.spec.clusterIP}')"
    department_peer_ip="$(kubectl get service peer-department -n plv-pubad-campus -o jsonpath='{.spec.clusterIP}')"

    if [[ -z "$orderer_one_ip" || -z "$orderer_two_ip" || -z "$orderer_three_ip" || \
          -z "$registrar_peer_ip" || -z "$faculty_peer_ip" || -z "$department_peer_ip" ]]; then
        echo "ERROR: Could not resolve all Fabric Service IPs for peer channel endpoint aliases."
        return 1
    fi

    patch="{\"spec\":{\"template\":{\"spec\":{\"hostAliases\":[{\"ip\":\"${orderer_one_ip}\",\"hostnames\":[\"orderer.capstone.com\"]},{\"ip\":\"${orderer_two_ip}\",\"hostnames\":[\"orderer2.capstone.com\"]},{\"ip\":\"${orderer_three_ip}\",\"hostnames\":[\"orderer3.capstone.com\"]},{\"ip\":\"${registrar_peer_ip}\",\"hostnames\":[\"peer0.registrar.capstone.com\"]},{\"ip\":\"${faculty_peer_ip}\",\"hostnames\":[\"peer0.faculty.capstone.com\"]},{\"ip\":\"${department_peer_ip}\",\"hostnames\":[\"peer0.department.capstone.com\"]}]}}}}"

    echo "Configuring Kubernetes resolution for the channel endpoints used by Fabric peers..."
    for entry in \
        "peer-registrar|plv-main-campus" \
        "peer-faculty|plv-annex-campus" \
        "peer-department|plv-pubad-campus"; do
        IFS='|' read -r deployment namespace <<< "$entry"
        kubectl patch deployment "$deployment" -n "$namespace" --type=merge -p "$patch" >/dev/null
        ensure_peer_ready_with_rebootstrap "$deployment" "$namespace"
    done
}

    prepare_local_chaincode_images() {
        if [[ "$PROFILE" != "local" ]]; then
            return
        fi

        echo "Building the local chaincode image from the current source..."
        docker build \
            -t "registrar-chaincode:${LOCAL_IMAGE_TAG}" \
            -t registrar-chaincode:latest \
            -f ../chaincode/Dockerfile \
            ../chaincode
        docker image tag "registrar-chaincode:${LOCAL_IMAGE_TAG}" "faculty-chaincode:${LOCAL_IMAGE_TAG}"
        docker image tag "registrar-chaincode:${LOCAL_IMAGE_TAG}" "department-chaincode:${LOCAL_IMAGE_TAG}"
        docker image tag "registrar-chaincode:${LOCAL_IMAGE_TAG}" faculty-chaincode:latest
        docker image tag "registrar-chaincode:${LOCAL_IMAGE_TAG}" department-chaincode:latest
    }

    deploy_manifests() {
    echo "Deploying K8s manifests..."
    verify_required_application_fixes
    prepare_local_middleware_image
    prepare_local_application_images
    prepare_local_chaincode_images
    prepare_production_source_images
    prepare_manifests

    apply_manifest "$TMP_K8S_DIR/00-namespace.yaml"
    apply_manifest "$TMP_K8S_DIR/01a-storage-class.yaml"
    if [[ "$PROFILE" == "local" ]]; then
        apply_manifest "$TMP_K8S_DIR/01b-persistent-volumes.local-kind.yaml"
        repair_lost_local_pvcs
    fi
    apply_manifest "$TMP_K8S_DIR/02-configmap-secret.yaml"
    apply_manifest "$TMP_K8S_DIR/03-Abac.yaml"
    apply_manifest "$TMP_K8S_DIR/04a-postgres-primary.yaml"

    echo "Waiting for PostgreSQL before applying schema migrations..."
    wait_rollout statefulset/postgres-primary plv-main-campus
    kubectl delete job postgres-schema-migrations -n plv-main-campus --ignore-not-found --wait=true >/dev/null
    apply_manifest "$TMP_K8S_DIR/04a-postgres-configmap.yaml"
    if ! wait_for_job_completion postgres-schema-migrations plv-main-campus 660; then
        echo "ERROR: PostgreSQL schema migrations failed."
        show_job_diagnostics postgres-schema-migrations plv-main-campus
        return 1
    fi
    show_job_logs postgres-schema-migrations plv-main-campus

    if [[ "$PROFILE" == "production" ]]; then
        apply_manifest "$TMP_K8S_DIR/04b-postgres-replica-annex.yaml"
        apply_manifest "$TMP_K8S_DIR/04c-postgres-replica-pubad.yaml"
        apply_manifest "$TMP_K8S_DIR/04d-postgres-additional-replicas.yaml"
    fi

    apply_manifest "$TMP_K8S_DIR/05-fabric-ca.yaml"
    deploy_orderers_sequentially
    configure_orderer_channel_endpoint_aliases
    apply_peer_manifest "$TMP_K8S_DIR/07-peer-registrar.yaml"
    apply_peer_manifest "$TMP_K8S_DIR/07-peer-faculty.yaml"
    apply_peer_manifest "$TMP_K8S_DIR/07-peer-department.yaml"
    if [[ "$PROFILE" == "production" ]]; then
        apply_peer_manifest "$TMP_K8S_DIR/07-peer-secondary.yaml"
    fi
    apply_couchdb_health_probes
    configure_peer_channel_endpoint_aliases
    apply_manifest "$TMP_K8S_DIR/08-middleware-api.yaml"
    apply_manifest "$TMP_K8S_DIR/09-ipfs.yaml"
    configure_local_application_rollouts
    ensure_ipfs_ready ipfs-node plv-fabric
    ensure_ipfs_ready ipfs-annex plv-annex-campus
    ensure_ipfs_ready ipfs-pubad plv-pubad-campus
    wait_rollout deployment/ipfs-ha-router plv-fabric
    kubectl delete job ipfs-cluster-bootstrap -n plv-fabric --ignore-not-found --wait=true >/dev/null
    apply_manifest "$TMP_K8S_DIR/09b-ipfs-cluster-bootstrap.yaml"
    if ! wait_for_job_completion ipfs-cluster-bootstrap plv-fabric 420; then
        echo "ERROR: IPFS private cluster bootstrap or pin replication failed."
        show_job_diagnostics ipfs-cluster-bootstrap plv-fabric
        return 1
    fi
    show_job_logs ipfs-cluster-bootstrap plv-fabric
    kubectl delete job ipfs-webui-bootstrap -n plv-fabric --ignore-not-found --wait=true >/dev/null
    apply_manifest "$TMP_K8S_DIR/09a-ipfs-webui-bootstrap.yaml"
    if ! wait_for_job_completion ipfs-webui-bootstrap plv-fabric 420; then
        echo "ERROR: IPFS Web UI bootstrap failed."
        show_job_diagnostics ipfs-webui-bootstrap plv-fabric
        return 1
    fi
    show_job_logs ipfs-webui-bootstrap plv-fabric
    apply_manifest "$TMP_K8S_DIR/09c-ipfs-pin-reconciler.yaml"
    apply_manifest "$TMP_K8S_DIR/10-ingress-network-policy.yaml"
    apply_manifest "$TMP_K8S_DIR/12a-redis.yaml"
    apply_manifest "$TMP_K8S_DIR/14-client-app.yaml"
    apply_manifest "$TMP_K8S_DIR/12-frontend-ha.yaml"
    apply_manifest "$TMP_K8S_DIR/13-cli.yaml"
    apply_manifest "$TMP_K8S_DIR/17-chaincode.yaml"
    apply_manifest "$TMP_K8S_DIR/18-faculty-chaincode.yaml"
    apply_manifest "$TMP_K8S_DIR/19-department-chaincode.yaml"

    if [[ "$PROFILE" == "production" ]]; then
        apply_manifest "$TMP_K8S_DIR/11-monitoring-pdb-quotas.yaml"
        apply_manifest "$TMP_K8S_DIR/11a-application-hpa.yaml"
        apply_manifest "$TMP_K8S_DIR/15-main-ingress.yaml"
        apply_manifest "$TMP_K8S_DIR/15-couchdb-backup.yaml"
        apply_manifest "$TMP_K8S_DIR/15-postgres-backup.yaml"
        apply_manifest "$TMP_K8S_DIR/16-firewall-config.yaml"
    else
        kubectl delete horizontalpodautoscaler \
            middleware-api-hpa auth-service-hpa ledger-service-hpa grade-upload-service-hpa \
            dotnet-api-gateway-hpa dotnet-auth-service-hpa dotnet-academic-service-hpa \
            dotnet-grade-service-hpa dotnet-operations-service-hpa dotnet-realtime-service-hpa client-app-hpa \
            -n plv-fabric --ignore-not-found
        echo "Skipping production-only autoscaling, ingress, backup, quota, and firewall manifests for local profile."
    fi

    deploy_observability

    configure_local_application_rollouts

    echo "Restarting Fabric peers sequentially to reload refreshed crypto Secrets..."
    restart_peer_and_wait peer-registrar plv-main-campus
    restart_peer_and_wait peer-faculty plv-annex-campus
    restart_peer_and_wait peer-department plv-pubad-campus
    if [[ "$PROFILE" == "production" ]]; then
        restart_peer_and_wait peer-registrar-2 plv-main-campus
        restart_peer_and_wait peer-faculty-2 plv-annex-campus
        restart_peer_and_wait peer-department-2 plv-pubad-campus
    fi

    echo "Restarting chaincode deployments sequentially to load the images built from current source..."
    restart_deployment_and_wait registrar-chaincode plv-main-campus
    restart_deployment_and_wait faculty-chaincode plv-annex-campus
    restart_deployment_and_wait department-chaincode plv-pubad-campus

    echo "Restarting application deployments sequentially..."
    restart_deployment_and_wait auth-service plv-fabric
    restart_deployment_and_wait fabric-identity-service plv-fabric
    restart_deployment_and_wait ledger-service plv-fabric
    restart_deployment_and_wait grade-upload-service plv-fabric
    restart_deployment_and_wait settings-service plv-fabric
    restart_deployment_and_wait middleware-api plv-fabric
    restart_deployment_and_wait dotnet-auth-service plv-fabric
    restart_deployment_and_wait dotnet-academic-service plv-fabric
    restart_deployment_and_wait dotnet-grade-service plv-fabric
    restart_deployment_and_wait dotnet-operations-service plv-fabric
    restart_deployment_and_wait dotnet-realtime-service plv-fabric
    restart_deployment_and_wait dotnet-api-gateway plv-fabric
    restart_deployment_and_wait frontend plv-fabric
    kubectl delete deployment client-app -n plv-fabric --ignore-not-found >/dev/null
    kubectl delete horizontalpodautoscaler client-app-hpa -n plv-fabric --ignore-not-found >/dev/null
    kubectl delete poddisruptionbudget client-app-pdb -n plv-fabric --ignore-not-found >/dev/null

    echo "Fabric and application deployments restarted sequentially."
    echo "Manifests deployed."
}

wait_deployments() {
    echo "Waiting for deployments to be ready..."
    wait_rollout statefulset/postgres-primary plv-main-campus
    wait_rollout deployment/redis-master plv-fabric
    wait_rollout deployment/fabric-ca-registrar plv-main-campus
    wait_rollout deployment/fabric-ca-faculty plv-annex-campus
    wait_rollout deployment/fabric-ca-department plv-pubad-campus
    ensure_orderer_ready orderer-1 plv-main-campus
    ensure_orderer_ready orderer-2 plv-main-campus
    ensure_orderer_ready orderer-3 plv-annex-campus
    wait_rollout statefulset/couchdb-registrar plv-main-campus
    wait_rollout statefulset/couchdb-wallet-registrar plv-main-campus
    wait_rollout statefulset/couchdb-faculty plv-annex-campus
    wait_rollout statefulset/couchdb-wallet-faculty plv-annex-campus
    wait_rollout statefulset/couchdb-department plv-pubad-campus
    wait_rollout statefulset/couchdb-wallet-department plv-pubad-campus
    ensure_peer_ready_with_rebootstrap peer-registrar plv-main-campus
    ensure_peer_ready_with_rebootstrap peer-faculty plv-annex-campus
    ensure_peer_ready_with_rebootstrap peer-department plv-pubad-campus
    ensure_ipfs_ready ipfs-node plv-fabric
    ensure_ipfs_ready ipfs-annex plv-annex-campus
    ensure_ipfs_ready ipfs-pubad plv-pubad-campus
    wait_rollout deployment/ipfs-ha-router plv-fabric
    wait_rollout deployment/auth-service plv-fabric
    wait_rollout deployment/fabric-identity-service plv-fabric
    wait_rollout deployment/ledger-service plv-fabric
    wait_rollout deployment/grade-upload-service plv-fabric
    wait_rollout deployment/settings-service plv-fabric
    wait_rollout deployment/middleware-api plv-fabric
    wait_rollout deployment/dotnet-auth-service plv-fabric
    wait_rollout deployment/dotnet-academic-service plv-fabric
    wait_rollout deployment/dotnet-grade-service plv-fabric
    wait_rollout deployment/dotnet-operations-service plv-fabric
    wait_rollout deployment/dotnet-realtime-service plv-fabric
    wait_rollout deployment/dotnet-api-gateway plv-fabric
    wait_rollout deployment/frontend plv-fabric
    wait_rollout deployment/prometheus plv-fabric
    wait_rollout deployment/kube-state-metrics plv-fabric
    wait_rollout deployment/loki plv-fabric
    wait_rollout deployment/alloy plv-fabric
    wait_rollout deployment/grafana plv-fabric
    wait_rollout deployment/postgres-exporter plv-main-campus

    if [[ "$PROFILE" == "production" ]]; then
        wait_rollout statefulset/postgres-replica-annex plv-annex-campus
        wait_rollout statefulset/postgres-replica-pubad plv-pubad-campus
        wait_rollout statefulset/postgres-replica-main plv-main-campus
        wait_rollout statefulset/postgres-replica-annex-2 plv-annex-campus
        wait_rollout statefulset/postgres-replica-pubad-2 plv-pubad-campus
        ensure_orderer_ready orderer-4 plv-annex-campus
        ensure_orderer_ready orderer-5 plv-pubad-campus
        ensure_orderer_ready orderer-6 plv-pubad-campus
        wait_rollout statefulset/couchdb-registrar-2 plv-main-campus
        wait_rollout statefulset/couchdb-faculty-2 plv-annex-campus
        wait_rollout statefulset/couchdb-department-2 plv-pubad-campus
        ensure_peer_ready_with_rebootstrap peer-registrar-2 plv-main-campus
        ensure_peer_ready_with_rebootstrap peer-faculty-2 plv-annex-campus
        ensure_peer_ready_with_rebootstrap peer-department-2 plv-pubad-campus
    fi

    echo "All requested rollouts are ready."
}

verify_deployed_application_revision() {
    echo "Verifying the deployed application revision and required chat migrations..."

    local migration_config
    migration_config="$(kubectl get configmap postgres-runtime-migrations -n plv-main-campus -o json)"
    grep -q '006_chat_conversation_states.sql' <<< "$migration_config" || {
        echo "ERROR: Migration 006 is absent from the deployed migration ConfigMap."
        return 1
    }
    grep -q '007_group_chats.sql' <<< "$migration_config" || {
        echo "ERROR: Migration 007 is absent from the deployed migration ConfigMap."
        return 1
    }
    grep -q '008_support_ticket_specialist_assignments.sql' <<< "$migration_config" || {
        echo "ERROR: Migration 008 is absent from the deployed migration ConfigMap."
        return 1
    }

    local migration_logs
    migration_logs="$(kubectl logs job/postgres-schema-migrations -n plv-main-campus --all-containers=true)"
    grep -q 'Applying 006_chat_conversation_states.sql' <<< "$migration_logs" || {
        echo "ERROR: Migration 006 was not observed in the completed migration Job."
        return 1
    }
    grep -q 'Applying 007_group_chats.sql' <<< "$migration_logs" || {
        echo "ERROR: Migration 007 was not observed in the completed migration Job."
        return 1
    }
    grep -q 'Applying 008_support_ticket_specialist_assignments.sql' <<< "$migration_logs" || {
        echo "ERROR: Migration 008 was not observed in the completed migration Job."
        return 1
    }

    local image_repository=""
    local image_tag=""
    if [[ "$PROFILE" == "local" ]]; then
        image_tag="$LOCAL_IMAGE_TAG"
    else
        image_repository="${PRODUCTION_IMAGE_REPOSITORY%/}/"
        image_tag="$PRODUCTION_IMAGE_TAG"
    fi

    local deployment_entry
    local deployment
    local namespace
    local image_name
    local expected_image
    local deployed_image
    for deployment_entry in \
        "middleware-api|plv-fabric|fabric-middleware" \
        "auth-service|plv-fabric|fabric-middleware" \
        "fabric-identity-service|plv-fabric|fabric-middleware" \
        "ledger-service|plv-fabric|fabric-middleware" \
        "grade-upload-service|plv-fabric|fabric-middleware" \
        "settings-service|plv-fabric|fabric-middleware" \
        "dotnet-api-gateway|plv-fabric|client-app" \
        "dotnet-auth-service|plv-fabric|client-app" \
        "dotnet-academic-service|plv-fabric|client-app" \
        "dotnet-grade-service|plv-fabric|client-app" \
        "dotnet-operations-service|plv-fabric|client-app" \
        "dotnet-realtime-service|plv-fabric|client-app" \
        "frontend|plv-fabric|frontend" \
        "registrar-chaincode|plv-main-campus|registrar-chaincode" \
        "faculty-chaincode|plv-annex-campus|faculty-chaincode" \
        "department-chaincode|plv-pubad-campus|department-chaincode"; do
        IFS='|' read -r deployment namespace image_name <<< "$deployment_entry"
        expected_image="${image_repository}${image_name}:${image_tag}"
        deployed_image="$(kubectl get deployment "$deployment" -n "$namespace" -o jsonpath='{.spec.template.spec.containers[0].image}')"
        if [[ "$deployed_image" != "$expected_image" ]]; then
            echo "ERROR: ${namespace}/${deployment} uses ${deployed_image}, expected ${expected_image}."
            return 1
        fi
    done

    local frontend_pod
    frontend_pod="$(kubectl get pods -n plv-fabric -l app=frontend -o jsonpath='{.items[0].metadata.name}')"
    if [[ -z "$frontend_pod" ]]; then
        echo "ERROR: No frontend pod is available for deployed-bundle verification."
        return 1
    fi
    kubectl exec "$frontend_pod" -n plv-fabric -- sh -ec \
        "grep -R -q 'Group invitations' /usr/share/nginx/html/static/js && \
         grep -R -q 'Permanently delete every message' /usr/share/nginx/html/static/js && \
         grep -R -q 'two-Registrar limit has been reached' /usr/share/nginx/html/static/js && \
         grep -R -q 'Delete Registrar' /usr/share/nginx/html/static/js && \
         grep -R -q 'kiosk&theme=light' /usr/share/nginx/html/static/js && \
         grep -R -q 'blockgo.auth.token' /usr/share/nginx/html/static/js && \
         grep -R -q '/department-admin' /usr/share/nginx/html/static/js && \
         ! grep -R -q 'New Login Tab' /usr/share/nginx/html/static/js && \
         ! grep -R -q 'Service Health' /usr/share/nginx/html/static/js && \
         ! grep -R -q 'Platform Services' /usr/share/nginx/html/static/js" || {
        echo "ERROR: The deployed frontend bundle does not contain all required administration, support, chat, and Grafana changes."
        return 1
    }

    kubectl exec "$frontend_pod" -n plv-fabric -- sh -ec \
        "for route in login registrar department-admin faculty student system-admin; do wget -qO- http://127.0.0.1/\${route} | grep -q '<div id=\"root\"></div>'; done" || {
        echo "ERROR: One or more frontend role deep links do not return the React application."
        return 1
    }

    local grafana_theme
    grafana_theme="$(kubectl get deployment grafana -n plv-fabric -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="GF_USERS_DEFAULT_THEME")].value}')"
    if [[ "$grafana_theme" != "light" ]]; then
        echo "ERROR: The deployed Grafana default theme is ${grafana_theme:-unset}, expected light."
        return 1
    fi

    local couchdb_entry
    local couchdb_statefulset
    local couchdb_namespace
    local couchdb_probe_path
    for couchdb_entry in \
        "couchdb-registrar|plv-main-campus" \
        "couchdb-wallet-registrar|plv-main-campus" \
        "couchdb-faculty|plv-annex-campus" \
        "couchdb-wallet-faculty|plv-annex-campus" \
        "couchdb-department|plv-pubad-campus" \
        "couchdb-wallet-department|plv-pubad-campus"; do
        IFS='|' read -r couchdb_statefulset couchdb_namespace <<< "$couchdb_entry"
        couchdb_probe_path="$(kubectl get statefulset "$couchdb_statefulset" -n "$couchdb_namespace" -o jsonpath='{.spec.template.spec.containers[0].readinessProbe.httpGet.path}')"
        if [[ "$couchdb_probe_path" != "/_up" ]]; then
            echo "ERROR: ${couchdb_namespace}/${couchdb_statefulset} does not use the authenticated CouchDB /_up readiness probe."
            return 1
        fi
    done

    echo "All custom deployments, migrations, CouchDB probes, multi-session routes, frontend features, and Grafana settings match this source revision."
}

bootstrap_application_accounts() {
    local job_name="blockgo-app-bootstrap"
    local bootstrap_resources="          resources:
            requests:
              memory: 128Mi
              cpu: 10m
            limits:
              memory: 192Mi
              cpu: 50m"

    if [[ "$PROFILE" == "local" ]]; then
        # Do not impose a RAM request/limit on the local bootstrap helper.
        bootstrap_resources="          resources:
            requests:
              cpu: 10m
            limits:
              cpu: 50m"
    fi

    echo "Bootstrapping application administrator accounts..."
    kubectl delete job "$job_name" -n plv-fabric --ignore-not-found --wait=true >/dev/null

    cat <<EOF | kubectl apply -f - >/dev/null
apiVersion: batch/v1
kind: Job
metadata:
  name: blockgo-app-bootstrap
  namespace: plv-fabric
  labels:
    app: blockgo-app-bootstrap
spec:
  backoffLimit: 2
  activeDeadlineSeconds: 300
  template:
    metadata:
      labels:
        app: blockgo-app-bootstrap
    spec:
      restartPolicy: Never
      containers:
      - name: bootstrap
        image: busybox:1.36.1
        imagePullPolicy: IfNotPresent
        env:
        - name: INTERNAL_API_KEY
          valueFrom:
            secretKeyRef:
              name: blockgo-secrets
              key: INTERNAL_API_KEY
        command: ["/bin/sh", "-ec"]
        args:
        - >-
          wget -T 15 -qO- --header="x-api-key: \${INTERNAL_API_KEY}"
          http://middleware-api.plv-fabric.svc.cluster.local:4000/api/bootstrap
${bootstrap_resources}
EOF

        if ! wait_for_job_completion "$job_name" plv-fabric 300; then
        echo "ERROR: Application account bootstrap failed."
        show_job_diagnostics "$job_name" plv-fabric
        return 1
    fi

    show_job_logs "$job_name" plv-fabric
    kubectl delete job "$job_name" -n plv-fabric --wait=false >/dev/null
    echo "Application administrator bootstrap completed."
}

bootstrap_fabric() {
    if [[ "${FABRIC_BOOTSTRAP:-true}" != "true" ]]; then
        echo "Skipping Fabric channel and chaincode bootstrap because FABRIC_BOOTSTRAP is not true."
        return
    fi

    echo "Bootstrapping the Fabric channel, peers, and chaincode..."
    bash ./k8s/init-channel.sh
    bash ./k8s/join-peers.sh
    bash ./k8s/install-chaincode.sh
}

uses_windows_host_networking() {
    [[ -r /proc/sys/kernel/osrelease ]] && \
        grep -qi microsoft /proc/sys/kernel/osrelease && \
        command -v powershell.exe >/dev/null 2>&1 && \
        command -v kubectl.exe >/dev/null 2>&1
}

local_http_ready() {
    local url="$1"
    local username="${2:-}"
    local password="${3:-}"

    if uses_windows_host_networking; then
        if [[ -n "$username" || -n "$password" ]]; then
            local auth_token
            auth_token="$(printf '%s' "${username}:${password}" | base64 | tr -d '\r\n')"
            powershell.exe -NoProfile -Command \
                "try { \$result = Invoke-RestMethod -Uri '${url}' -Headers @{ Authorization = 'Basic ${auth_token}' } -TimeoutSec 2; if (\$result.status -eq 'ok') { exit 0 } } catch {}; exit 1" \
                >/dev/null 2>&1
        else
            powershell.exe -NoProfile -Command \
                "try { \$result = Invoke-WebRequest -UseBasicParsing -Uri '${url}' -TimeoutSec 2; if (\$result.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" \
                >/dev/null 2>&1
        fi
        return
    fi

    if [[ -n "$username" || -n "$password" ]]; then
        curl -fsS --max-time 2 --user "${username}:${password}" "$url" 2>/dev/null |
            grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'
    else
        curl -fsS --max-time 2 "$url" >/dev/null 2>&1
    fi
}

start_local_port_forward_process() {
    local namespace="$1"
    local service="$2"
    local port_mapping="$3"
    local log_file="$4"

    if uses_windows_host_networking; then
        local windows_pid
        windows_pid="$(
            powershell.exe -NoProfile -Command \
                "\$process = Start-Process -FilePath 'kubectl.exe' -ArgumentList @('port-forward','--address=127.0.0.1','-n','${namespace}','service/${service}','${port_mapping}') -WindowStyle Hidden -PassThru; [Console]::Write(\$process.Id); exit 0" |
                tr -d '\r\n'
        )"
        if [[ ! "$windows_pid" =~ ^[0-9]+$ ]]; then
            echo "ERROR: Windows kubectl port-forward process did not return a valid PID."
            return 1
        fi
        LOCAL_PORT_FORWARD_PID="windows:${windows_pid}"
        return
    fi

    nohup kubectl port-forward --address=127.0.0.1 -n "$namespace" \
        "service/${service}" "$port_mapping" >"$log_file" 2>&1 </dev/null &
    LOCAL_PORT_FORWARD_PID="$!"
}

local_port_forward_process_alive() {
    local pid_reference="$1"
    if [[ "$pid_reference" == windows:* ]]; then
        local windows_pid="${pid_reference#windows:}"
        powershell.exe -NoProfile -Command \
            "if (Get-Process -Id ${windows_pid} -ErrorAction SilentlyContinue) { exit 0 }; exit 1" \
            >/dev/null 2>&1
        return
    fi
    [[ "$pid_reference" =~ ^[0-9]+$ ]] && kill -0 "$pid_reference" >/dev/null 2>&1
}

stop_local_port_forward_pid_file() {
    local pid_file="$1"
    local pid_reference=""
    if [[ ! -f "$pid_file" ]]; then
        return
    fi

    pid_reference="$(tr -d '[:space:]' < "$pid_file")"
    if [[ "$pid_reference" == windows:* ]]; then
        local windows_pid="${pid_reference#windows:}"
        if [[ "$windows_pid" =~ ^[0-9]+$ ]] && command -v powershell.exe >/dev/null 2>&1; then
            powershell.exe -NoProfile -Command \
                "Stop-Process -Id ${windows_pid} -Force -ErrorAction SilentlyContinue" \
                >/dev/null 2>&1 || true
        fi
    elif [[ "$pid_reference" =~ ^[0-9]+$ ]]; then
        kill -9 "$pid_reference" >/dev/null 2>&1 || true
    fi
    rm -f "$pid_file"
}

start_local_frontend() {
    local pid_file=".local-frontend-port-forward.pid"
    local log_file=".local-frontend-port-forward.log"
    local pid_reference=""

    if local_http_ready http://127.0.0.1:8080/nginx-health; then
        echo "Local frontend is already available at http://localhost:8080"
        return
    fi

    stop_local_port_forward_pid_file "$pid_file"

    rm -f "$log_file"
    start_local_port_forward_process \
        plv-fabric frontend-service 8080:80 "$log_file"
    pid_reference="$LOCAL_PORT_FORWARD_PID"
    echo "$pid_reference" > "$pid_file"

    for _ in $(seq 1 30); do
        if local_http_ready http://127.0.0.1:8080/nginx-health; then
            echo "Local frontend is available at http://localhost:8080"
            return
        fi
        if ! local_port_forward_process_alive "$pid_reference"; then
            break
        fi
        sleep 1
    done

    echo "ERROR: Frontend port-forward did not become ready."
    if [[ -f "$log_file" ]]; then
        tail -n 20 "$log_file"
    fi
    return 1
}

start_local_couchdb_port_forward() {
    local name="$1"
    local namespace="$2"
    local service="$3"
    local local_port="$4"
    local remote_port="$5"
    local database_role="$6"
    local couchdb_user="$7"
    local couchdb_pass="$8"
    local pid_file=".local-${name}-port-forward.pid"
    local log_file=".local-${name}-port-forward.log"
    local pid_reference=""
    local health_url="http://127.0.0.1:${local_port}/_up"

    if local_http_ready "$health_url" "$couchdb_user" "$couchdb_pass"; then
        echo "Local CouchDB ${database_role} ${name} is already available at http://localhost:${local_port}/_utils/"
        return
    fi

    stop_local_port_forward_pid_file "$pid_file"
    if command -v pkill >/dev/null 2>&1; then
        pkill -9 -f "[k]ubectl(.exe)?[[:space:]].*port-forward.*${service}.*${local_port}:${remote_port}" \
            >/dev/null 2>&1 || true
    fi

    rm -f "$log_file" "${log_file%.log}.error.log"
    start_local_port_forward_process \
        "$namespace" "$service" "${local_port}:${remote_port}" "$log_file"
    pid_reference="$LOCAL_PORT_FORWARD_PID"
    echo "$pid_reference" > "$pid_file"

    for _ in $(seq 1 30); do
        if local_http_ready "$health_url" "$couchdb_user" "$couchdb_pass"; then
            echo "Local CouchDB ${database_role} ${name} is available at http://localhost:${local_port}/_utils/"
            return
        fi
        if ! local_port_forward_process_alive "$pid_reference"; then
            break
        fi
        sleep 1
    done

    echo "ERROR: CouchDB ${database_role} port-forward ${name} did not become ready on localhost:${local_port}."
    if [[ -f "$log_file" ]]; then
        tail -n 20 "$log_file"
    fi
    return 1
}

start_local_couchdb_port_forwards() {
    local couchdb_user=""
    local couchdb_pass=""
    local entry=""
    local name=""
    local namespace=""
    local service=""
    local local_port=""
    local remote_port=""
    local database_role=""

    couchdb_user="$(
        kubectl get secret blockgo-secrets -n plv-fabric \
            -o jsonpath='{.data.COUCHDB_USER}' | base64 --decode
    )"
    couchdb_pass="$(
        kubectl get secret blockgo-secrets -n plv-fabric \
            -o jsonpath='{.data.COUCHDB_PASS}' | base64 --decode
    )"

    if [[ -z "$couchdb_user" || -z "$couchdb_pass" ]]; then
        echo "ERROR: CouchDB credentials could not be loaded from plv-fabric/blockgo-secrets."
        return 1
    fi

    echo "Starting authenticated localhost-only CouchDB port-forwards..."
    for entry in \
        "couchdb-registrar|plv-main-campus|couchdb-registrar|5986|5984|ledger" \
        "couchdb-wallet-registrar|plv-main-campus|couchdb-wallet-registrar|5990|5985|wallet" \
        "couchdb-wallet-faculty|plv-annex-campus|couchdb-wallet-faculty|6990|5985|wallet" \
        "couchdb-wallet-department|plv-pubad-campus|couchdb-wallet-department|7990|5985|wallet"; do
        IFS='|' read -r name namespace service local_port remote_port database_role <<< "$entry"
        start_local_couchdb_port_forward \
            "$name" "$namespace" "$service" "$local_port" "$remote_port" \
            "$database_role" \
            "$couchdb_user" "$couchdb_pass"
    done

    unset couchdb_user couchdb_pass
}

stop_local_helpers() {
    echo "Stopping project-local helper processes and Docker Compose services..."

    local port_forward_pid_file=""
    for port_forward_pid_file in \
        .local-frontend-port-forward.pid \
        .local-couchdb-registrar-port-forward.pid \
        .local-couchdb-wallet-registrar-port-forward.pid \
        .local-couchdb-wallet-faculty-port-forward.pid \
        .local-couchdb-wallet-department-port-forward.pid; do
        if [[ ! -f "$port_forward_pid_file" ]]; then
            continue
        fi
        stop_local_port_forward_pid_file "$port_forward_pid_file"
    done

    if [[ -f .watchdog.pid ]]; then
        local watchdog_pid
        watchdog_pid="$(tr -d '[:space:]' < .watchdog.pid)"
        if [[ "$watchdog_pid" =~ ^[0-9]+$ ]] && \
            ps -p "$watchdog_pid" -o command= 2>/dev/null | grep -q 'nginx_failover_watchdog.sh'; then
            kill -9 "$watchdog_pid" 2>/dev/null || true
        fi
        rm -f .watchdog.pid
    fi

    if command -v pkill >/dev/null 2>&1; then
        pkill -9 -f '[n]ginx_failover_watchdog.sh' 2>/dev/null || true
        pkill -9 -f '[k]ubectl(.exe)?[[:space:]].*port-forward.*(middleware-api|client-app|frontend|ipfs|couchdb)' 2>/dev/null || true
    fi

    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        local compose_args=(
            -f docker-compose-main.yaml
            -f docker-compose-annex.yaml
            -f docker-compose-pubad.yaml
        )
        docker compose "${compose_args[@]}" kill >/dev/null 2>&1 || true
        docker compose "${compose_args[@]}" down --remove-orphans --timeout 0 >/dev/null 2>&1 || true
    fi
}

collect_local_project_pvs() {
    LOCAL_PROJECT_PVS=("${LOCAL_STATIC_PVS[@]}")

    local pv
    local claim_namespace
    while read -r pv claim_namespace; do
        case "$claim_namespace" in
            plv-fabric|plv-main-campus|plv-annex-campus|plv-pubad-campus)
                if [[ " ${LOCAL_PROJECT_PVS[*]} " != *" $pv "* ]]; then
                    LOCAL_PROJECT_PVS+=("$pv")
                fi
                ;;
        esac
    done < <(
        kubectl get pv \
            -o custom-columns=NAME:.metadata.name,NAMESPACE:.spec.claimRef.namespace \
            --no-headers 2>/dev/null || true
    )
}

force_delete_namespace_workloads() {
    local namespace="$1"

    if ! kubectl get namespace "$namespace" >/dev/null 2>&1; then
        return
    fi

    echo "Force-stopping workloads in $namespace..."
    kubectl delete \
        deployment,statefulset,daemonset,replicaset,replicationcontroller,job,cronjob \
        --all -n "$namespace" --ignore-not-found --wait=false >/dev/null 2>&1 || true
    kubectl delete pod --all -n "$namespace" --ignore-not-found \
        --grace-period=0 --force --wait=false >/dev/null 2>&1 || true
    kubectl wait --for=delete pod --all -n "$namespace" --timeout=20s >/dev/null 2>&1 || true

    local pod
    while read -r pod; do
        [[ -z "$pod" ]] && continue
        kubectl patch "$pod" -n "$namespace" --type=merge \
            -p '{"metadata":{"finalizers":[]}}' >/dev/null 2>&1 || true
        kubectl delete "$pod" -n "$namespace" --ignore-not-found \
            --grace-period=0 --force --wait=false >/dev/null 2>&1 || true
    done < <(kubectl get pod -n "$namespace" -o name 2>/dev/null || true)

    kubectl delete pvc --all -n "$namespace" --ignore-not-found --wait=false >/dev/null 2>&1 || true

    local pvc
    while read -r pvc; do
        [[ -z "$pvc" ]] && continue
        kubectl patch "$pvc" -n "$namespace" --type=merge \
            -p '{"metadata":{"finalizers":[]}}' >/dev/null 2>&1 || true
        kubectl delete "$pvc" -n "$namespace" --ignore-not-found --wait=false >/dev/null 2>&1 || true
    done < <(kubectl get pvc -n "$namespace" -o name 2>/dev/null || true)
}

force_delete_local_resources() {
    echo "Force-deleting the local PLV deployment..."
    stop_local_helpers
    collect_local_project_pvs

    local namespace
    for namespace in "${NAMESPACES[@]}"; do
        force_delete_namespace_workloads "$namespace"
    done

    kubectl delete namespace "${NAMESPACES[@]}" \
        --ignore-not-found --wait=false >/dev/null 2>&1 || true

    local namespace_refs=()
    for namespace in "${NAMESPACES[@]}"; do
        namespace_refs+=("namespace/$namespace")
    done
    kubectl wait --for=delete "${namespace_refs[@]}" --timeout=45s >/dev/null 2>&1 || true

    local cleanup_failed=false
    for namespace in "${NAMESPACES[@]}"; do
        if kubectl get namespace "$namespace" >/dev/null 2>&1; then
            echo "ERROR: Namespace $namespace is still terminating. Refusing to force-finalize it because that can orphan PVCs."
            cleanup_failed=true
        fi
    done
    if [[ "$cleanup_failed" == "true" ]]; then
        return 1
    fi

    echo "Deleting local PersistentVolumes claimed by the PLV deployment..."
    local pv
    for pv in "${LOCAL_PROJECT_PVS[@]}"; do
        kubectl patch pv "$pv" --type=merge \
            -p '{"metadata":{"finalizers":[]}}' >/dev/null 2>&1 || true
        kubectl delete pv "$pv" --ignore-not-found --wait=false >/dev/null 2>&1 || true
    done

    cleanup_failed=false
    for namespace in "${NAMESPACES[@]}"; do
        if kubectl get namespace "$namespace" >/dev/null 2>&1; then
            echo "ERROR: Namespace $namespace is still present after forced cleanup."
            cleanup_failed=true
        fi
    done
    for pv in "${LOCAL_PROJECT_PVS[@]}"; do
        if kubectl get pv "$pv" >/dev/null 2>&1; then
            echo "ERROR: PersistentVolume $pv is still present after forced cleanup."
            cleanup_failed=true
        fi
    done

    if [[ "$cleanup_failed" == "true" ]]; then
        return 1
    fi

    echo "Local PLV workloads, namespaces, claims, and volumes were force-deleted."
    echo "Host files under ./fabric-k8s-data were preserved."
}

delete_resources() {
    if [[ "$PROFILE" == "local" ]]; then
        force_delete_local_resources
        return
    fi

    echo "Deleting K8s namespaces and namespace-scoped PVCs..."
    for ns in "${NAMESPACES[@]}"; do
        kubectl delete pvc --all -n "$ns" --ignore-not-found
    done
    kubectl delete namespace "${NAMESPACES[@]}" --ignore-not-found
    for ns in "${NAMESPACES[@]}"; do
        kubectl wait --for=delete "namespace/$ns" --timeout=5m 2>/dev/null || true
    done
    echo "Resources deleted."
}

repair_fabric_storage() {
    init_repair_audit
    echo "Cleaning stale Fabric repair helper pods from earlier interrupted runs..."
    local ns stale_pod
    for ns in plv-main-campus plv-annex-campus plv-pubad-campus; do
        while IFS= read -r stale_pod; do
            [[ -z "$stale_pod" ]] && continue
            case "$stale_pod" in
                *-leveldb-repair|*-lock-repair|*-rebootstrap)
                    kubectl delete pod "$stale_pod" -n "$ns" --ignore-not-found --wait=false >/dev/null 2>&1 || true
                    ;;
            esac
        done < <(kubectl get pods -n "$ns" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)
    done

    echo "======================================"
    echo "Fabric Persistent-State Recovery Scan"
    echo "======================================"
    echo "Recovery ladder:"
    echo "  1. orderer block-index LevelDB rebuild"
    echo "  2. peer transientStoreFileLock / ledgersData/fileLock rebuild"
    echo "  3. peer transient-store rebuild (local auto-repair; production opt-in)"
    echo "  4. conservative ledgerProvider CURRENT repair"
    echo "  5. local-only automatic peer re-bootstrap when ledgerProvider is beyond safe repair"
    echo "Channel blocks, old peer data, and old state CouchDB data are preserved before re-bootstrap."
    echo "Wallet CouchDB and Raft data are never reset by this action."
    echo ""

    local failures=0
    local entry=""
    local deployment=""
    local namespace=""
    local failure_type=""
    local post_failure_type=""
    local orderers=(
        "orderer-1|plv-main-campus"
        "orderer-2|plv-main-campus"
        "orderer-3|plv-annex-campus"
    )
    local peers=(
        "peer-registrar|plv-main-campus"
        "peer-faculty|plv-annex-campus"
        "peer-department|plv-pubad-campus"
    )
    local rebootstrap_targets=()

    if [[ "$PROFILE" == "production" ]]; then
        orderers+=(
            "orderer-4|plv-annex-campus"
            "orderer-5|plv-pubad-campus"
            "orderer-6|plv-pubad-campus"
        )
        peers+=(
            "peer-registrar-2|plv-main-campus"
            "peer-faculty-2|plv-annex-campus"
            "peer-department-2|plv-pubad-campus"
        )
    fi

    echo "Scanning Fabric orderers..."
    for entry in "${orderers[@]}"; do
        IFS='|' read -r deployment namespace <<< "$entry"
        if ! kubectl get deployment "$deployment" -n "$namespace" >/dev/null 2>&1; then
            echo "SKIP: ${namespace}/${deployment} is not deployed."
            continue
        fi

        if orderer_deployment_ready "$deployment" "$namespace"; then
            echo "OK: ${namespace}/${deployment} is ready."
            continue
        fi

        if orderer_leveldb_corruption_detected "$deployment" "$namespace"; then
            echo "REPAIR: ${namespace}/${deployment} has the known block-index LevelDB corruption."
            if ! ensure_orderer_ready "$deployment" "$namespace" "index-corruption"; then
                failures=$((failures + 1))
            fi
        else
            echo "WARN: ${namespace}/${deployment} is unhealthy, but no supported orderer corruption signature was found."
            show_orderer_diagnostics "$deployment" "$namespace"
            failures=$((failures + 1))
        fi
    done

    echo ""
    echo "Scanning Fabric peers..."
    for entry in "${peers[@]}"; do
        IFS='|' read -r deployment namespace <<< "$entry"
        if ! kubectl get deployment "$deployment" -n "$namespace" >/dev/null 2>&1; then
            echo "SKIP: ${namespace}/${deployment} is not deployed."
            continue
        fi

        if peer_deployment_ready "$deployment" "$namespace"; then
            echo "OK: ${namespace}/${deployment} is ready."
            continue
        fi

        failure_type="$(peer_recoverable_corruption_type "$deployment" "$namespace" || true)"
        if [[ -n "$failure_type" ]]; then
            echo "REPAIR: ${namespace}/${deployment} has known ${failure_type} LevelDB corruption."
            if ensure_peer_ready "$deployment" "$namespace" "$failure_type"; then
                continue
            fi
            sleep 2
            post_failure_type="$(peer_recoverable_corruption_type "$deployment" "$namespace" || true)"
            if [[ "$failure_type" == "ledger-provider" || "$post_failure_type" == "ledger-provider" ]]; then
                if is_true "$PEER_AUTO_REBOOTSTRAP_ON_LEDGER_PROVIDER"; then
                    echo "ESCALATE: ${namespace}/${deployment} requires peer re-bootstrap after ledgerProvider/openIDStore corruption."
                    rebootstrap_targets+=("$deployment")
                    continue
                fi
                echo "ERROR: ${namespace}/${deployment} requires re-bootstrap, but automatic escalation is disabled."
            fi
            failures=$((failures + 1))
        else
            echo "WARN: ${namespace}/${deployment} is unhealthy, but no supported peer corruption signature was found."
            show_peer_diagnostics "$deployment" "$namespace"
            failures=$((failures + 1))
        fi
    done

    if (( ${#rebootstrap_targets[@]} > 0 )); then
        if [[ "$PROFILE" == "production" ]] && ! is_true "$PEER_ALLOW_PRODUCTION_REBOOTSTRAP"; then
            echo "ERROR: ${#rebootstrap_targets[@]} peer(s) require re-bootstrap, but production re-bootstrap is disabled."
            echo "Set PEER_ALLOW_PRODUCTION_REBOOTSTRAP=true only after confirming external backups."
            failures=$((failures + ${#rebootstrap_targets[@]}))
        else
            local old_targets="$PEER_REBOOTSTRAP_TARGETS"
            local csv_targets
            csv_targets="$(IFS=,; echo "${rebootstrap_targets[*]}")"
            PEER_REBOOTSTRAP_TARGETS="$csv_targets"
            export PEER_REBOOTSTRAP_TARGETS
            echo ""
            echo "Automatically escalating to peer re-bootstrap for: ${csv_targets}"
            if rebootstrap_corrupt_peers; then
                echo "Automatic peer re-bootstrap and channel rejoin completed successfully."
            else
                echo "ERROR: Automatic peer re-bootstrap failed for one or more peers."
                failures=$((failures + 1))
            fi
            PEER_REBOOTSTRAP_TARGETS="$old_targets"
            export PEER_REBOOTSTRAP_TARGETS
        fi
    fi

    echo ""
    if (( failures > 0 )); then
        echo "ERROR: Fabric recovery scan completed with ${failures} unresolved workload(s)."
        echo "Unsupported or unsafe persisted data was not automatically deleted."
        return 1
    fi

    if is_true "$VERIFY_FABRIC_CHANNEL_AFTER_REPAIR"; then
        if [[ -f ./k8s/join-peers.sh ]]; then
            echo ""
            echo "Verifying channel membership and ledger access after recovery..."
            sed -i 's/\r$//' ./k8s/join-peers.sh
            chmod +x ./k8s/join-peers.sh
            MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' VERIFY_PEER_CONVERGENCE=true \
                bash ./k8s/join-peers.sh "$FABRIC_CHANNEL_NAME" \
                    --targets peer-registrar,peer-faculty,peer-department || {
                echo "ERROR: Fabric storage is healthy, but channel membership/ledger verification failed."
                return 1
            }
        else
            echo "WARN: ./k8s/join-peers.sh is missing; skipped channel verification."
        fi
    fi

    echo "Fabric recovery scan completed successfully."
    echo "All recoverable Fabric storage issues were handled and channel verification passed when enabled."
    echo "Run 'kubectl get pods -A' for the final Kubernetes status."
}


peer_rebootstrap_row() {
    local deployment="$1"
    case "$deployment" in
        peer-registrar)  echo "peer-registrar|plv-main-campus|couchdb-registrar|peer-registrar-pvc|couchdb-storage-couchdb-registrar-0" ;;
        peer-faculty)    echo "peer-faculty|plv-annex-campus|couchdb-faculty|peer-faculty-pvc|couchdb-storage-couchdb-faculty-0" ;;
        peer-department) echo "peer-department|plv-pubad-campus|couchdb-department|peer-department-pvc|couchdb-storage-couchdb-department-0" ;;
        *) return 1 ;;
    esac
}

peer_rebootstrap_selected() {
    local deployment="$1"
    [[ -z "$PEER_REBOOTSTRAP_TARGETS" ]] && return 0
    local normalized=",${PEER_REBOOTSTRAP_TARGETS// /},"
    [[ "$normalized" == *",${deployment},"* ]]
}

wait_for_workload_pods_gone() {
    local namespace="$1"
    local selector="$2"
    local timeout_seconds="${3:-120}"
    local deadline=$((SECONDS + timeout_seconds))
    local count

    while (( SECONDS < deadline )); do
        count="$(kubectl get pods -n "$namespace" -l "$selector" -o name 2>/dev/null | awk 'NF{n++} END{print n+0}')"
        [[ "${count:-0}" == "0" ]] && return 0
        sleep 2
    done
    return 1
}

rebootstrap_one_peer() {
    local deployment="$1"
    local namespace="$2"
    local couchdb_statefulset="$3"
    local peer_claim="$4"
    local couchdb_claim="$5"
    local peer_replicas couchdb_replicas helper stamp

    peer_replicas="$(kubectl get deployment "$deployment" -n "$namespace" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
    couchdb_replicas="$(kubectl get statefulset "$couchdb_statefulset" -n "$namespace" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
    peer_replicas="${peer_replicas:-1}"
    couchdb_replicas="${couchdb_replicas:-1}"
    [[ "$peer_replicas" =~ ^[0-9]+$ ]] || peer_replicas=1
    [[ "$couchdb_replicas" =~ ^[0-9]+$ ]] || couchdb_replicas=1
    (( peer_replicas > 0 )) || peer_replicas=1
    (( couchdb_replicas > 0 )) || couchdb_replicas=1

    kubectl get pvc "$peer_claim" -n "$namespace" >/dev/null 2>&1 || {
        echo "ERROR: Missing peer PVC ${namespace}/${peer_claim}."
        return 1
    }
    kubectl get pvc "$couchdb_claim" -n "$namespace" >/dev/null 2>&1 || {
        echo "ERROR: Missing state CouchDB PVC ${namespace}/${couchdb_claim}."
        return 1
    }

    helper="${deployment}-rebootstrap"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"

    echo "[REBOOTSTRAP] Stopping ${namespace}/${deployment} and ${couchdb_statefulset}..."
    kubectl scale deployment "$deployment" -n "$namespace" --replicas=0 >/dev/null
    kubectl scale statefulset "$couchdb_statefulset" -n "$namespace" --replicas=0 >/dev/null

    if ! wait_for_workload_pods_gone "$namespace" "app=${deployment}" 120; then
        echo "ERROR: Peer pods did not terminate; refusing to modify peer storage."
        kubectl scale statefulset "$couchdb_statefulset" -n "$namespace" --replicas="$couchdb_replicas" >/dev/null || true
        kubectl scale deployment "$deployment" -n "$namespace" --replicas="$peer_replicas" >/dev/null || true
        return 1
    fi
    if kubectl get pod "${couchdb_statefulset}-0" -n "$namespace" >/dev/null 2>&1; then
        if ! kubectl wait --for=delete "pod/${couchdb_statefulset}-0" -n "$namespace" --timeout=120s >/dev/null 2>&1; then
            echo "ERROR: ${couchdb_statefulset}-0 did not terminate; refusing to modify CouchDB storage."
            kubectl scale statefulset "$couchdb_statefulset" -n "$namespace" --replicas="$couchdb_replicas" >/dev/null || true
            kubectl scale deployment "$deployment" -n "$namespace" --replicas="$peer_replicas" >/dev/null || true
            return 1
        fi
    fi

    kubectl delete pod "$helper" -n "$namespace" --ignore-not-found --wait=true >/dev/null 2>&1 || true
    cat <<EOF | kubectl apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata:
  name: ${helper}
  namespace: ${namespace}
  labels:
    app: ${helper}
spec:
  restartPolicy: Never
  containers:
  - name: recovery
    image: ${PEER_REBOOTSTRAP_POD_IMAGE}
    imagePullPolicy: IfNotPresent
    command: ["sh", "-c", "sleep 3600"]
    volumeMounts:
    - name: peer-storage
      mountPath: /peer
    - name: couchdb-storage
      mountPath: /couchdb
  volumes:
  - name: peer-storage
    persistentVolumeClaim:
      claimName: ${peer_claim}
  - name: couchdb-storage
    persistentVolumeClaim:
      claimName: ${couchdb_claim}
EOF

    if ! kubectl wait --for=condition=Ready "pod/${helper}" -n "$namespace" --timeout=90s >/dev/null; then
        echo "ERROR: Re-bootstrap helper pod ${namespace}/${helper} did not become Ready."
        kubectl describe pod "$helper" -n "$namespace" || true
        kubectl delete pod "$helper" -n "$namespace" --ignore-not-found --wait=false >/dev/null 2>&1 || true
        kubectl scale statefulset "$couchdb_statefulset" -n "$namespace" --replicas="$couchdb_replicas" >/dev/null || true
        kubectl scale deployment "$deployment" -n "$namespace" --replicas="$peer_replicas" >/dev/null || true
        return 1
    fi

    echo "[REBOOTSTRAP] Preserving old peer ledger and state CouchDB data by rename, then creating clean local stores..."
    if ! kubectl exec "$helper" -n "$namespace" -c recovery -- sh -eu -c "
        stamp='${stamp}'
        peer_backup=/peer/rebootstrap-backups/\"\${stamp}\"
        couch_backup=/couchdb/.blockgo-rebootstrap-backups/\"\${stamp}\"
        mkdir -p \"\${peer_backup}\" \"\${couch_backup}\"

        # Fabric's peer filesystemPath contains the ledger and installed chaincodes.
        # Preserve all known Fabric-owned local databases instead of deleting them.
        for name in ledgersData transientstore transientStoreFileLock lifecycle snapshots; do
            if [ -e \"/peer/\${name}\" ]; then
                echo \"Preserving peer component /peer/\${name}\"
                mv \"/peer/\${name}\" \"\${peer_backup}/\"
            fi
        done

        # Reset only the peer state CouchDB volume. Wallet CouchDB is a different PVC
        # and is deliberately not mounted or changed by this helper.
        for path in /couchdb/* /couchdb/.[!.]* /couchdb/..?*; do
            [ -e \"\${path}\" ] || continue
            base=\$(basename \"\${path}\")
            [ \"\${base}\" = '.blockgo-rebootstrap-backups' ] && continue
            echo \"Preserving CouchDB component \${path}\"
            mv \"\${path}\" \"\${couch_backup}/\"
        done
        sync

        cat > \"\${peer_backup}/README.txt\" <<TXT
BLOCKGO peer re-bootstrap backup
Deployment: ${deployment}
Namespace: ${namespace}
Timestamp: ${stamp}
Reason: local ledger-provider LevelDB corruption
The old peer ledger was preserved, not deleted.
TXT
        echo \"Peer backup: \${peer_backup}\"
        echo \"State CouchDB backup: \${couch_backup}\"
    "; then
        echo "ERROR: Failed to preserve/reset local storage for ${namespace}/${deployment}."
        kubectl delete pod "$helper" -n "$namespace" --ignore-not-found --wait=false >/dev/null 2>&1 || true
        kubectl scale statefulset "$couchdb_statefulset" -n "$namespace" --replicas="$couchdb_replicas" >/dev/null || true
        kubectl scale deployment "$deployment" -n "$namespace" --replicas="$peer_replicas" >/dev/null || true
        return 1
    fi

    kubectl delete pod "$helper" -n "$namespace" --ignore-not-found --wait=true >/dev/null 2>&1 || true

    echo "[REBOOTSTRAP] Starting clean state CouchDB ${namespace}/${couchdb_statefulset}..."
    kubectl scale statefulset "$couchdb_statefulset" -n "$namespace" --replicas="$couchdb_replicas" >/dev/null
    if ! kubectl rollout status "statefulset/${couchdb_statefulset}" -n "$namespace" --timeout="$ROLLOUT_TIMEOUT"; then
        echo "ERROR: ${couchdb_statefulset} did not recover after its state volume reset."
        return 1
    fi

    echo "[REBOOTSTRAP] Starting clean peer ${namespace}/${deployment}..."
    kubectl scale deployment "$deployment" -n "$namespace" --replicas="$peer_replicas" >/dev/null
    if ! kubectl rollout status "deployment/${deployment}" -n "$namespace" --timeout="$ROLLOUT_TIMEOUT"; then
        echo "ERROR: ${deployment} did not start with a clean local peer ledger."
        show_peer_diagnostics "$deployment" "$namespace"
        return 1
    fi

    log_repair_action "peer-rebootstrap" "$deployment" "$namespace" "old peer filesystem and state CouchDB preserved; clean local stores started"
    echo "[OK] ${namespace}/${deployment} is clean and ready to rejoin ${FABRIC_CHANNEL_NAME}."
}

rebootstrap_corrupt_peers() {
    init_repair_audit

    if [[ "$PROFILE" == "production" ]] && ! is_true "$PEER_ALLOW_PRODUCTION_REBOOTSTRAP"; then
        echo "ERROR: Automatic peer re-bootstrap is disabled for production."
        echo "Set PEER_ALLOW_PRODUCTION_REBOOTSTRAP=true only after confirming external backups and recovery procedures."
        return 1
    fi

    local artifacts_dir="./channel-artifacts-final"
    [[ "$PROFILE" == "production" ]] && artifacts_dir="./channel-artifacts-k8s"
    local channel_block="${artifacts_dir}/${FABRIC_CHANNEL_NAME}.block"
    [[ -s "$channel_block" ]] || {
        echo "ERROR: Cannot re-bootstrap peers because channel block is missing or empty: ${channel_block}"
        return 1
    }

    local healthy_orderers=0 entry deployment namespace failure_type row
    for entry in "orderer-1|plv-main-campus" "orderer-2|plv-main-campus" "orderer-3|plv-annex-campus"; do
        IFS='|' read -r deployment namespace <<< "$entry"
        if orderer_deployment_ready "$deployment" "$namespace"; then
            healthy_orderers=$((healthy_orderers + 1))
        fi
    done
    if (( healthy_orderers < 1 )); then
        echo "ERROR: No healthy orderer is available. Refusing peer re-bootstrap because recovered peers need an ordering service to retrieve channel blocks."
        return 1
    fi
    echo "Healthy local orderers available: ${healthy_orderers}/3"

    local targets=()
    local candidate
    for candidate in peer-registrar peer-faculty peer-department; do
        peer_rebootstrap_selected "$candidate" || continue
        row="$(peer_rebootstrap_row "$candidate" || true)"
        [[ -n "$row" ]] || continue
        IFS='|' read -r deployment namespace _ _ _ <<< "$row"

        if [[ -n "$PEER_REBOOTSTRAP_TARGETS" ]]; then
            targets+=("$row")
            continue
        fi

        if peer_deployment_ready "$deployment" "$namespace"; then
            echo "SKIP: ${namespace}/${deployment} is already Ready."
            continue
        fi
        failure_type="$(peer_recoverable_corruption_type "$deployment" "$namespace" || true)"
        if [[ "$failure_type" == "ledger-provider" ]]; then
            targets+=("$row")
        else
            echo "SKIP: ${namespace}/${deployment} does not currently show ledger-provider corruption (${failure_type:-unknown failure})."
        fi
    done

    if (( ${#targets[@]} == 0 )); then
        echo "No peer requires ledger-provider re-bootstrap."
        return 0
    fi

    echo "======================================"
    echo "Fabric Peer Re-bootstrap"
    echo "======================================"
    echo "Channel: ${FABRIC_CHANNEL_NAME}"
    echo "The old peer ledger and state CouchDB are preserved by rename, not deleted."
    echo "Wallet CouchDB volumes are not modified."

    local target_names=()
    local couchdb_statefulset peer_claim couchdb_claim
    for row in "${targets[@]}"; do
        IFS='|' read -r deployment namespace couchdb_statefulset peer_claim couchdb_claim <<< "$row"
        target_names+=("$deployment")
        rebootstrap_one_peer "$deployment" "$namespace" "$couchdb_statefulset" "$peer_claim" "$couchdb_claim" || return 1
    done

    local csv_targets
    csv_targets="$(IFS=,; echo "${target_names[*]}")"
    echo "Rejoining recovered peers to ${FABRIC_CHANNEL_NAME}: ${csv_targets}"
    if [[ ! -f ./k8s/join-peers.sh ]]; then
        echo "ERROR: Missing ./k8s/join-peers.sh; cannot rejoin recovered peers."
        return 1
    fi
    sed -i 's/\r$//' ./k8s/join-peers.sh
    chmod +x ./k8s/join-peers.sh
    TARGET_PEERS="$csv_targets" VERIFY_PEER_CONVERGENCE=true \
    MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
        bash ./k8s/join-peers.sh "$FABRIC_CHANNEL_NAME" --targets "$csv_targets" || return 1

    if is_true "$REINSTALL_CHAINCODE_AFTER_REBOOTSTRAP"; then
        if [[ -x ./k8s/install-chaincode.sh || -f ./k8s/install-chaincode.sh ]]; then
            echo "Reinstalling chaincode packages/definitions needed by the recovered peers..."
            bash ./k8s/install-chaincode.sh || {
                echo "ERROR: Peers rejoined the channel, but chaincode reinstallation/bootstrap failed."
                echo "The ledger recovery is preserved; fix chaincode installation separately before using the application."
                return 1
            }
        else
            echo "WARN: ./k8s/install-chaincode.sh was not found; peer channel recovery succeeded but chaincode packages may need reinstalling."
        fi
    fi

    echo "Peer re-bootstrap completed. Verify with:"
    echo "  ./k8s/join-peers.sh ${FABRIC_CHANNEL_NAME} --targets ${csv_targets}"
    echo "  kubectl get pods -A"
}

show_status() {
    kubectl get pods -A
    kubectl get svc -A
}

main() {
    validate_script_integrity
    case "$ACTION" in
        verify)
            verify_deployment_inputs
            ;;
        apply)
            check_kubectl
            check_cluster
            cluster_preflight
            validate_production_zone_nodes
            validate_production_image_settings
            inject_configs
            clear_existing_local_memory_limits
            generate_production_fabric_artifacts

            echo "======================================"
            echo "Creating Fabric Crypto Secrets"
            echo "======================================"

            local_crypto_script="./k8s/create-crypto-secrets.sh"

            if [[ ! -f "$local_crypto_script" ]]; then
                echo "ERROR: Missing:"
                echo "  $local_crypto_script"
                exit 1
            fi
            sed -i 's/\r$//' "$local_crypto_script"
            chmod +x "$local_crypto_script"

            if ! bash "$local_crypto_script"; then
                echo "ERROR: Fabric crypto secret generation failed."
                echo "Kubernetes deployment has been stopped."
                exit 1
            fi

            echo "Crypto Secrets generated successfully."

            deploy_manifests
            wait_for_all_pvcs_bound
            wait_deployments
            verify_deployed_application_revision
            bootstrap_application_accounts
            if [[ "$PROFILE" == "local" ]]; then
                start_local_frontend
                start_local_couchdb_port_forwards
            fi
            bootstrap_fabric
            echo "Deployment complete."
            ;;
        delete)
            check_kubectl
            check_cluster
            delete_resources
            ;;
        status)
            check_kubectl
            check_cluster
            show_status
            ;;
        repair-fabric)
            check_kubectl
            check_cluster
            cluster_preflight
            local recovery_rc=0
            repair_fabric_storage || recovery_rc=1
            repair_ipfs_storage || recovery_rc=1
            return "$recovery_rc"
            ;;
        rebootstrap-peers)
            check_kubectl
            check_cluster
            cluster_preflight
            rebootstrap_corrupt_peers
            ;;
        diagnose)
            check_kubectl
            check_cluster
            diagnose_cluster
            ;;
        gke-setup)
            check_kubectl
            setup_gke_cluster
            ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
