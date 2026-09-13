#!/usr/bin/env bash

# Join selected organization peers to the application channel.
# Compatible with the original usage:
#   ./k8s/join-peers.sh
#   ./k8s/join-peers.sh registrar-channel
# Recovery-target usage:
#   ./k8s/join-peers.sh registrar-channel --targets peer-registrar,peer-faculty
#   TARGET_PEERS=peer-registrar,peer-faculty ./k8s/join-peers.sh registrar-channel

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NETWORK_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$NETWORK_ROOT"

PROFILE="${K8S_PROFILE:-local}"
CHANNEL_NAME="registrar-channel"
TARGET_PEERS="${TARGET_PEERS:-}"
PEER_JOIN_ATTEMPTS="${PEER_JOIN_ATTEMPTS:-30}"
PEER_JOIN_RETRY_SECONDS="${PEER_JOIN_RETRY_SECONDS:-5}"
PEER_SYNC_TIMEOUT_SECONDS="${PEER_SYNC_TIMEOUT_SECONDS:-600}"
VERIFY_PEER_CONVERGENCE="${VERIFY_PEER_CONVERGENCE:-true}"

if [[ "${1:-}" != "" && "${1:-}" != --* ]]; then
    CHANNEL_NAME="$1"
    shift
fi

while (($#)); do
    case "$1" in
        --targets)
            [[ $# -ge 2 ]] || { echo "ERROR: --targets requires a comma-separated value." >&2; exit 2; }
            TARGET_PEERS="$2"
            shift 2
            ;;
        --targets=*)
            TARGET_PEERS="${1#*=}"
            shift
            ;;
        --no-convergence-check)
            VERIFY_PEER_CONVERGENCE="false"
            shift
            ;;
        *)
            echo "ERROR: Unknown argument: $1" >&2
            exit 2
            ;;
    esac
done

ARTIFACTS_DIR="./channel-artifacts-final"
if [[ "$PROFILE" == "production" ]]; then
    ARTIFACTS_DIR="./channel-artifacts-k8s"
fi
CHANNEL_BLOCK="${ARTIFACTS_DIR}/${CHANNEL_NAME}.block"

if [[ "$PROFILE" == "local" ]]; then
    export KUBECTL_REMOTE_COMMAND_WEBSOCKETS="${KUBECTL_REMOTE_COMMAND_WEBSOCKETS:-false}"
fi

[[ -s "$CHANNEL_BLOCK" ]] || {
    echo "ERROR: Channel block not found or empty: $CHANNEL_BLOCK" >&2
    exit 1
}

is_true() {
    case "${1:-}" in
        1|true|TRUE|yes|YES|on|ON) return 0 ;;
        *) return 1 ;;
    esac
}

peer_selected() {
    local deployment="$1"
    [[ -z "$TARGET_PEERS" ]] && return 0
    local normalized=",${TARGET_PEERS// /},"
    [[ "$normalized" == *",${deployment},"* ]]
}

latest_peer_pod() {
    local deployment="$1"
    local namespace="$2"
    kubectl get pods -n "$namespace" -l "app=${deployment}" \
        --sort-by=.metadata.creationTimestamp \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null | awk 'NF {p=$0} END {print p}'
}

peer_exec() {
    local namespace="$1"
    local pod="$2"
    local msp_id="$3"
    local tls_override="$4"
    shift 4

    MSYS_NO_PATHCONV=1 kubectl exec -n "$namespace" "$pod" -c peer -- env \
        CORE_PEER_TLS_ENABLED=true \
        CORE_PEER_TLS_ROOTCERT_FILE=/var/hyperledger/tls/ca.crt \
        CORE_PEER_TLS_SERVERHOSTOVERRIDE="$tls_override" \
        CORE_PEER_LOCALMSPID="$msp_id" \
        CORE_PEER_MSPCONFIGPATH=/tmp/blockgo-admin-msp \
        CORE_PEER_ADDRESS=127.0.0.1:7051 \
        "$@"
}

prepare_admin_msp() {
    local namespace="$1"
    local pod="$2"
    local admin_msp="$3"

    MSYS_NO_PATHCONV=1 kubectl exec -n "$namespace" "$pod" -c peer -- rm -rf /tmp/blockgo-admin-msp >/dev/null
    MSYS_NO_PATHCONV=1 kubectl cp "$admin_msp" "$namespace/$pod:/tmp/blockgo-admin-msp" -c peer >/dev/null
}

wait_peer_ready() {
    local deployment="$1"
    local namespace="$2"
    local pod=""

    for _ in $(seq 1 "$PEER_JOIN_ATTEMPTS"); do
        pod="$(latest_peer_pod "$deployment" "$namespace")"
        if [[ -n "$pod" ]] && kubectl wait --for=condition=Ready "pod/$pod" -n "$namespace" --timeout=20s >/dev/null 2>&1; then
            printf '%s\n' "$pod"
            return 0
        fi
        sleep "$PEER_JOIN_RETRY_SECONDS"
    done
    return 1
}

peer_channel_info() {
    local deployment="$1"
    local namespace="$2"
    local org="$3"
    local msp_id="$4"
    local peer_number="${5:-0}"
    local domain="${org}.capstone.com"
    local tls_override="peer${peer_number}.${domain}"
    local admin_msp="./crypto-config-final-v2/peerOrganizations/${domain}/users/Admin@${domain}/msp"
    local pod

    pod="$(latest_peer_pod "$deployment" "$namespace")"
    [[ -n "$pod" ]] || return 1
    [[ -d "$admin_msp" ]] || return 1
    prepare_admin_msp "$namespace" "$pod" "$admin_msp"
    peer_exec "$namespace" "$pod" "$msp_id" "$tls_override" peer channel getinfo -c "$CHANNEL_NAME" 2>/dev/null
}

join_peer() {
    local deployment="$1"
    local namespace="$2"
    local org="$3"
    local msp_id="$4"
    local peer_number="${5:-0}"
    local domain="${org}.capstone.com"
    local tls_override="peer${peer_number}.${domain}"
    local admin_msp="./crypto-config-final-v2/peerOrganizations/${domain}/users/Admin@${domain}/msp"
    local attempts="$PEER_JOIN_ATTEMPTS"

    peer_selected "$deployment" || {
        echo "[FILTER] Skipping $deployment; not selected by --targets/TARGET_PEERS."
        return 0
    }

    [[ -d "$admin_msp" ]] || {
        echo "ERROR: Admin MSP not found: $admin_msp" >&2
        return 1
    }

    for attempt in $(seq 1 "$attempts"); do
        local pod=""
        local channels=""
        local info=""
        pod="$(latest_peer_pod "$deployment" "$namespace")"

        if [[ -n "$pod" ]] && kubectl wait --for=condition=Ready "pod/$pod" -n "$namespace" --timeout=20s >/dev/null 2>&1; then
            prepare_admin_msp "$namespace" "$pod" "$admin_msp"

            channels="$(peer_exec "$namespace" "$pod" "$msp_id" "$tls_override" peer channel list 2>/dev/null || true)"
            if grep -Fq "$CHANNEL_NAME" <<<"$channels"; then
                info="$(peer_exec "$namespace" "$pod" "$msp_id" "$tls_override" peer channel getinfo -c "$CHANNEL_NAME" 2>/dev/null || true)"
                echo "[SKIP] $deployment is already joined to $CHANNEL_NAME."
                [[ -n "$info" ]] && echo "       $info"
                return 0
            fi

            echo "[JOIN] Joining $deployment to $CHANNEL_NAME (attempt $attempt/$attempts)..."
            MSYS_NO_PATHCONV=1 kubectl cp "$CHANNEL_BLOCK" "$namespace/$pod:/tmp/${CHANNEL_NAME}.block" -c peer >/dev/null
            if peer_exec "$namespace" "$pod" "$msp_id" "$tls_override" \
                peer channel join -b "/tmp/${CHANNEL_NAME}.block"; then
                # A successful proposal can return before the ledger is fully caught up.
                for _ in $(seq 1 30); do
                    channels="$(peer_exec "$namespace" "$pod" "$msp_id" "$tls_override" peer channel list 2>/dev/null || true)"
                    if grep -Fq "$CHANNEL_NAME" <<<"$channels"; then
                        info="$(peer_exec "$namespace" "$pod" "$msp_id" "$tls_override" peer channel getinfo -c "$CHANNEL_NAME" 2>/dev/null || true)"
                        echo "[OK] $deployment joined $CHANNEL_NAME."
                        [[ -n "$info" ]] && echo "     $info"
                        return 0
                    fi
                    sleep 2
                done
            fi
        fi

        sleep "$PEER_JOIN_RETRY_SECONDS"
    done

    echo "ERROR: Failed to join $deployment to $CHANNEL_NAME after $attempts attempts." >&2
    return 1
}

# Registry rows: deployment|namespace|org|msp|peer-number
PEER_ROWS=(
    "peer-registrar|plv-main-campus|registrar|RegistrarMSP|0"
    "peer-faculty|plv-annex-campus|faculty|FacultyMSP|0"
    "peer-department|plv-pubad-campus|department|DepartmentMSP|0"
)
if [[ "$PROFILE" == "production" ]]; then
    PEER_ROWS+=(
        "peer-registrar-2|plv-main-campus|registrar|RegistrarMSP|1"
        "peer-faculty-2|plv-annex-campus|faculty|FacultyMSP|1"
        "peer-department-2|plv-pubad-campus|department|DepartmentMSP|1"
    )
fi

verify_selected_peer_convergence() {
    is_true "$VERIFY_PEER_CONVERGENCE" || return 0

    local selected_count=0
    local deadline=$((SECONDS + PEER_SYNC_TIMEOUT_SECONDS))
    local stable_checks=0
    local row deployment namespace org msp peer_number info height hash signature="" reference=""

    for row in "${PEER_ROWS[@]}"; do
        IFS='|' read -r deployment namespace org msp peer_number <<< "$row"
        if peer_selected "$deployment"; then
            selected_count=$((selected_count + 1))
        fi
    done

    if (( selected_count < 2 )); then
        echo "[INFO] Only one peer selected; skipping cross-peer convergence comparison."
        return 0
    fi

    echo "Waiting for selected peers to converge to the same ${CHANNEL_NAME} block height/hash..."
    while (( SECONDS < deadline )); do
        reference=""
        stable_checks=${stable_checks:-0}
        local all_ok=true

        for row in "${PEER_ROWS[@]}"; do
            IFS='|' read -r deployment namespace org msp peer_number <<< "$row"
            peer_selected "$deployment" || continue

            info="$(peer_channel_info "$deployment" "$namespace" "$org" "$msp" "$peer_number" || true)"
            height="$(sed -n 's/.*"height":\([0-9][0-9]*\).*/\1/p' <<< "$info" | tail -n1)"
            hash="$(sed -n 's/.*"currentBlockHash":"\([^"]*\)".*/\1/p' <<< "$info" | tail -n1)"

            if [[ -z "$height" || -z "$hash" ]]; then
                all_ok=false
                break
            fi

            signature="${height}|${hash}"
            if [[ -z "$reference" ]]; then
                reference="$signature"
            elif [[ "$signature" != "$reference" ]]; then
                all_ok=false
                break
            fi
        done

        if [[ "$all_ok" == "true" && -n "$reference" ]]; then
            stable_checks=$((stable_checks + 1))
            echo "[SYNC] Selected peers agree at height ${reference%%|*} (${stable_checks}/2 stable checks)."
            if (( stable_checks >= 2 )); then
                return 0
            fi
        else
            stable_checks=0
        fi
        sleep 5
    done

    echo "ERROR: Selected peers did not converge within ${PEER_SYNC_TIMEOUT_SECONDS}s." >&2
    return 1
}

echo "======================================"
echo "Fabric Peer Channel Join"
echo "======================================"
echo "Channel: $CHANNEL_NAME"
echo "Targets: ${TARGET_PEERS:-all configured peers}"

for row in "${PEER_ROWS[@]}"; do
    IFS='|' read -r deployment namespace org msp_id peer_number <<< "$row"
    join_peer "$deployment" "$namespace" "$org" "$msp_id" "$peer_number"
done

verify_selected_peer_convergence

echo "Selected peers are joined to $CHANNEL_NAME."
