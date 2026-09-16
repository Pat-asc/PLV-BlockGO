#!/usr/bin/env bash
set -Eeuo pipefail

# ============================================================
# BlockGo - Hyperledger Fabric Orderer Recovery Controller
# ============================================================
#
# Commands:
#   ./repair-orderers.sh audit
#   ./repair-orderers.sh verify
#   ./repair-orderers.sh repair 3
#   ./repair-orderers.sh repair-failed   # only NOT-READY nodes with active target panic
#
# Safety:
#   - Never deletes PVCs
#   - Never regenerates crypto
#   - Never recreates channels
#   - Never edits chain blockfiles
#   - Repairs one orderer at a time
#   - Backs up system-channel Raft state first
#   - Restores original Raft state automatically if repair fails
#
# Production mapping:
#   orderer-1,2 -> plv-main-campus
#   orderer-3,4 -> plv-annex-campus
#   orderer-5,6 -> plv-pubad-campus
#
# Exact target failure:
#   "Could not append block: unexpected Previous block hash"
# ============================================================

WAIT_SECONDS="${WAIT_SECONDS:-240}"
HELPER_READY_TIMEOUT="${HELPER_READY_TIMEOUT:-180}"
DETACH_WAIT_SECONDS="${DETACH_WAIT_SECONDS:-15}"
HELPER_IMAGE="${HELPER_IMAGE:-busybox:1.36.1}"
RESTORE_FAILED_REPLICA="${RESTORE_FAILED_REPLICA:-false}"
FORCE_REPAIR="${FORCE_REPAIR:-false}"

export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

say() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

warn() {
  printf '\nWARNING: %s\n' "$*" >&2
}

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

is_true() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

ns_for() {
  case "$1" in
    1|2) echo "plv-main-campus" ;;
    3|4) echo "plv-annex-campus" ;;
    5|6) echo "plv-pubad-campus" ;;
    *) die "Orderer number must be 1-6." ;;
  esac
}

deployment_for() {
  echo "orderer-$1"
}

latest_pod_for() {
  local n="$1"
  local ns
  ns="$(ns_for "$n")"

  kubectl get pods     -n "$ns"     -l "app=orderer-$n"     --sort-by=.metadata.creationTimestamp     -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}'     2>/dev/null | awk 'NF {p=$0} END {print p}'
}

pvc_for() {
  local n="$1"
  local ns dep pvc

  ns="$(ns_for "$n")"
  dep="$(deployment_for "$n")"

  pvc="$(
    kubectl get deployment "$dep"       -n "$ns"       -o jsonpath='{range .spec.template.spec.volumes[?(@.name=="orderer-storage")]}{.persistentVolumeClaim.claimName}{end}'       2>/dev/null || true
  )"

  [[ -n "$pvc" ]] || die "Could not determine PVC for $dep in $ns."
  printf '%s\n' "$pvc"
}

zone_for_pvc() {
  local ns="$1"
  local pvc="$2"
  local pv zone

  pv="$(
    kubectl get pvc "$pvc"       -n "$ns"       -o jsonpath='{.spec.volumeName}'       2>/dev/null || true
  )"

  [[ -n "$pv" ]] || return 0

  zone="$(
    kubectl get pv "$pv"       -o jsonpath='{range .spec.nodeAffinity.required.nodeSelectorTerms[*].matchExpressions[*]}{.key}{"="}{.values[0]}{"\n"}{end}'       2>/dev/null       | awk -F= '$1=="topology.gke.io/zone" || $1=="topology.kubernetes.io/zone" {print $2; exit}'
  )"

  printf '%s' "$zone"
}

replicas_for() {
  local n="$1"

  kubectl get deployment "orderer-$n"     -n "$(ns_for "$n")"     -o jsonpath='{.spec.replicas}'     2>/dev/null || echo 0
}


pod_is_ready() {
  local n="$1"
  local ns pod ready

  ns="$(ns_for "$n")"
  pod="$(latest_pod_for "$n")"

  [[ -n "$pod" ]] || return 1

  ready="$(
    kubectl get pod "$pod" \
      -n "$ns" \
      -o jsonpath='{.status.containerStatuses[0].ready}' \
      2>/dev/null || echo false
  )"

  [[ "$ready" == "true" ]]
}

ready_count() {
  local count=0
  local n ns pod ready

  for n in 1 2 3 4 5 6; do
    ns="$(ns_for "$n")"
    pod="$(latest_pod_for "$n")"

    if [[ -n "$pod" ]]; then
      ready="$(
        kubectl get pod "$pod"           -n "$ns"           -o jsonpath='{.status.containerStatuses[0].ready}'           2>/dev/null || echo false
      )"

      [[ "$ready" == "true" ]] && count=$((count + 1))
    fi
  done

  printf '%s\n' "$count"
}

has_previous_hash_failure() {
  local n="$1"
  local ns pod output

  ns="$(ns_for "$n")"
  pod="$(latest_pod_for "$n")"

  [[ -n "$pod" ]] || return 1

  # SAFETY: a currently Ready orderer must never be auto-repaired merely
  # because --previous logs contain an old panic from an earlier restart.
  if pod_is_ready "$n"; then
    return 1
  fi

  output="$(
    {
      kubectl logs "$pod" \
        -n "$ns" \
        -c orderer \
        --tail=200 \
        2>&1 || true

      kubectl logs "$pod" \
        -n "$ns" \
        -c orderer \
        --previous \
        --tail=200 \
        2>&1 || true
    }
  )"

  grep -qE \
    'unexpected Previous block hash|Could not append block' \
    <<<"$output"
}

has_historical_previous_hash_failure() {
  local n="$1"
  local ns pod output

  ns="$(ns_for "$n")"
  pod="$(latest_pod_for "$n")"

  [[ -n "$pod" ]] || return 1

  output="$(
    {
      kubectl logs "$pod" \
        -n "$ns" \
        -c orderer \
        --tail=200 \
        2>&1 || true

      kubectl logs "$pod" \
        -n "$ns" \
        -c orderer \
        --previous \
        --tail=200 \
        2>&1 || true
    }
  )"

  grep -qE \
    'unexpected Previous block hash|Could not append block' \
    <<<"$output"
}

print_failure_signature() {
  local n="$1"
  local ns pod

  ns="$(ns_for "$n")"
  pod="$(latest_pod_for "$n")"

  [[ -n "$pod" ]] || return 0

  {
    kubectl logs "$pod"       -n "$ns"       -c orderer       --tail=200       2>&1 || true

    kubectl logs "$pod"       -n "$ns"       -c orderer       --previous       --tail=200       2>&1 || true
  } | grep -E       'unexpected Previous block hash|Could not append block|panic:|PANI'     | tail -n 20 || true
}

audit_one() {
  local n="$1"
  local ns dep pod pvc replicas

  ns="$(ns_for "$n")"
  dep="$(deployment_for "$n")"
  pod="$(latest_pod_for "$n")"
  pvc="$(pvc_for "$n")"
  replicas="$(replicas_for "$n")"

  echo
  echo "============================================================"
  echo "$dep"
  echo "namespace : $ns"
  echo "PVC       : $pvc"
  echo "replicas  : $replicas"
  echo "============================================================"

  if [[ -z "$pod" ]]; then
    echo "Pod: <none>"
    return 0
  fi

  kubectl get pod "$pod"     -n "$ns"     -o custom-columns='POD:.metadata.name,READY:.status.containerStatuses[0].ready,PHASE:.status.phase,RESTARTS:.status.containerStatuses[0].restartCount'     --no-headers || true

  if pod_is_ready "$n"; then
    echo
    echo "Current state: HEALTHY / READY"

    if has_historical_previous_hash_failure "$n"; then
      echo "Historical previous-block-hash panic exists in old/previous logs."
      echo "This node will NOT be selected by repair-failed."
    else
      echo "No previous-block-hash panic detected in recent/previous logs."
    fi
  elif has_previous_hash_failure "$n"; then
    echo
    echo "Current state: UNHEALTHY"
    echo "Detected active: PREVIOUS_BLOCK_HASH_MISMATCH"
    print_failure_signature "$n"
  else
    echo
    echo "Current state: UNHEALTHY or not Ready"
    echo "No target previous-block-hash panic detected."
  fi
}

audit_all() {
  say "Auditing all six orderers"

  local n
  for n in 1 2 3 4 5 6; do
    audit_one "$n"
  done

  echo
  say "Current Ready orderers: $(ready_count)/6"

  echo
  say "Orderer PVCs"
  kubectl get pvc -A | grep -E 'orderer-[1-6]-pvc' || true
}

wait_no_target_pod() {
  local n="$1"
  local max="${2:-120}"
  local elapsed=0

  while (( elapsed < max )); do
    if [[ -z "$(latest_pod_for "$n")" ]]; then
      return 0
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  return 1
}

delete_stale_helpers() {
  local n="$1"
  local ns
  ns="$(ns_for "$n")"

  kubectl delete pod     "repair-orderer-$n"     "inspect-orderer-$n-pvc"     -n "$ns"     --ignore-not-found     --wait=true     >/dev/null 2>&1 || true
}

create_helper() {
  local n="$1"
  local ns="$2"
  local pvc="$3"
  local zone="$4"
  local helper="$5"

  delete_stale_helpers "$n"

  if [[ -n "$zone" ]]; then
    cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: $helper
  namespace: $ns
spec:
  restartPolicy: Never
  nodeSelector:
    topology.kubernetes.io/zone: $zone
  containers:
    - name: repair
      image: $HELPER_IMAGE
      imagePullPolicy: IfNotPresent
      command: ["sh", "-c", "sleep 86400"]
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
        limits:
          cpu: 50m
          memory: 64Mi
      volumeMounts:
        - name: storage
          mountPath: /data
  volumes:
    - name: storage
      persistentVolumeClaim:
        claimName: $pvc
EOF
  else
    cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: $helper
  namespace: $ns
spec:
  restartPolicy: Never
  containers:
    - name: repair
      image: $HELPER_IMAGE
      imagePullPolicy: IfNotPresent
      command: ["sh", "-c", "sleep 86400"]
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
        limits:
          cpu: 50m
          memory: 64Mi
      volumeMounts:
        - name: storage
          mountPath: /data
  volumes:
    - name: storage
      persistentVolumeClaim:
        claimName: $pvc
EOF
  fi

  if ! kubectl wait       -n "$ns"       --for=condition=Ready       "pod/$helper"       --timeout="${HELPER_READY_TIMEOUT}s"; then

    echo
    echo "ERROR: Repair helper did not become Ready."
    kubectl describe pod "$helper" -n "$ns" || true
    kubectl get events       -n "$ns"       --field-selector "involvedObject.name=$helper"       --sort-by=.lastTimestamp || true
    return 1
  fi
}

write_manifest_and_move_state() {
  local ns="$1"
  local helper="$2"
  local backup_dir="$3"

  MSYS2_ARG_CONV_EXCL='*' kubectl exec     -n "$ns"     "$helper" --     sh -eu -c "
      root=/data/orderer
      wal=\$root/etcdraft/wal/system-channel
      snapshot=\$root/etcdraft/snapshot/system-channel
      backup='$backup_dir'

      test -d "\$root" || {
        echo 'ERROR: /data/orderer does not exist.'
        exit 1
      }

      test -d "\$wal" || {
        echo "ERROR: Expected system-channel WAL directory does not exist: \$wal"
        exit 1
      }

      mkdir -p "\$backup"

      {
        echo '===== BLOCKGO ORDERER REPAIR BACKUP ====='
        date -u
        echo
        echo '--- chain files ---'
        find "\$root/chains" -maxdepth 2 -type f -print 2>/dev/null | sort || true
        echo
        echo '--- chain hashes ---'
        sha256sum "\$root/chains/system-channel/blockfile_000000" 2>/dev/null || true
        sha256sum "\$root/chains/registrar-channel/blockfile_000000" 2>/dev/null || true
        echo
        echo '--- raft files ---'
        find "\$root/etcdraft" -maxdepth 3 -type f -print 2>/dev/null | sort || true
      } > "\$backup/manifest-before.txt"

      mv "\$wal" "\$backup/system-channel-wal"

      if [ -d "\$snapshot" ]; then
        mv "\$snapshot" "\$backup/system-channel-snapshot"
      fi

      mkdir -p "\$root/etcdraft/wal"
      mkdir -p "\$root/etcdraft/snapshot"

      printf '%s\n' 'repair-state-moved' > "\$backup/STATE"
      sync
    "
}

rollback_state() {
  local n="$1"
  local ns="$2"
  local dep="$3"
  local pvc="$4"
  local zone="$5"
  local helper="$6"
  local backup_dir="$7"
  local original_replicas="$8"

  say "ROLLBACK: stopping orderer-$n"

  kubectl scale deployment/"$dep"     -n "$ns"     --replicas=0 >/dev/null

  if ! wait_no_target_pod "$n" 180; then
    warn "orderer-$n pod did not disappear during rollback."
    return 1
  fi

  delete_stale_helpers "$n"
  sleep "$DETACH_WAIT_SECONDS"

  say "ROLLBACK: mounting $pvc"

  if ! create_helper "$n" "$ns" "$pvc" "$zone" "$helper"; then
    warn "Could not mount PVC for automatic rollback."
    warn "Original backup remains at $backup_dir."
    return 1
  fi

  say "ROLLBACK: restoring original system-channel Raft state"

  if ! MSYS2_ARG_CONV_EXCL='*' kubectl exec       -n "$ns"       "$helper" --       sh -eu -c "
        root=/data/orderer
        backup='$backup_dir'
        failed=\$backup/failed-repair-state

        test -d "\$backup/system-channel-wal" || {
          echo 'ERROR: Original WAL backup is missing.'
          exit 1
        }

        mkdir -p "\$failed"

        if [ -d "\$root/etcdraft/wal/system-channel" ]; then
          mv "\$root/etcdraft/wal/system-channel"              "\$failed/system-channel-wal"
        fi

        if [ -d "\$root/etcdraft/snapshot/system-channel" ]; then
          mv "\$root/etcdraft/snapshot/system-channel"              "\$failed/system-channel-snapshot"
        fi

        mv "\$backup/system-channel-wal"            "\$root/etcdraft/wal/system-channel"

        if [ -d "\$backup/system-channel-snapshot" ]; then
          mv "\$backup/system-channel-snapshot"              "\$root/etcdraft/snapshot/system-channel"
        fi

        printf '%s\n' 'rolled-back' > "\$backup/STATE"
        sync
      "; then

    warn "Automatic rollback command failed."

    kubectl delete pod "$helper"       -n "$ns"       --ignore-not-found       --wait=true >/dev/null 2>&1 || true

    return 1
  fi

  kubectl delete pod "$helper"     -n "$ns"     --ignore-not-found     --wait=true >/dev/null 2>&1 || true

  say "Rollback completed successfully."

  if is_true "$RESTORE_FAILED_REPLICA"; then
    say "Restoring original replica count: $original_replicas"

    kubectl scale deployment/"$dep"       -n "$ns"       --replicas="$original_replicas" >/dev/null
  else
    say "Leaving orderer-$n scaled DOWN after rollback."
    echo "To restore the original replica count manually:"
    echo "  kubectl scale deployment/$dep -n $ns --replicas=$original_replicas"
  fi

  echo
  echo "Backup and failed-attempt data preserved at:"
  echo "  $backup_dir"

  return 0
}

repair_one() {
  local n="$1"
  local ns dep pvc zone helper stamp backup_dir
  local original_replicas original_pod state_moved=false

  case "$n" in
    1|2|3|4|5|6) ;;
    *) die "Orderer number must be 1-6." ;;
  esac

  ns="$(ns_for "$n")"
  dep="$(deployment_for "$n")"
  pvc="$(pvc_for "$n")"
  zone="$(zone_for_pvc "$ns" "$pvc")"
  helper="repair-orderer-$n"
  stamp="$(date -u '+%Y%m%dT%H%M%SZ')"
  backup_dir="/data/orderer/.blockgo-orderer-repair/$stamp"
  original_replicas="$(replicas_for "$n")"
  original_replicas="${original_replicas:-0}"
  original_pod="$(latest_pod_for "$n")"

  echo
  echo "============================================================"
  echo "BLOCKGO ORDERER REPAIR"
  echo "target     : orderer-$n"
  echo "namespace  : $ns"
  echo "PVC        : $pvc"
  echo "zone       : ${zone:-<auto>}"
  echo "replicas   : $original_replicas"
  echo "pod        : ${original_pod:-<none>}"
  echo "backup     : $backup_dir"
  echo "============================================================"

  if [[ -n "$original_pod" ]]; then
    if pod_is_ready "$n" && ! is_true "$FORCE_REPAIR"; then
      die "Refusing repair: orderer-$n is currently Ready. Historical --previous logs are not an active failure. FORCE_REPAIR=true is required to override."
    fi

    if has_previous_hash_failure "$n"; then
      say "Expected previous-block-hash failure detected."
      print_failure_signature "$n"
    elif ! is_true "$FORCE_REPAIR"; then
      die "Refusing repair: exact previous-block-hash failure is not present. Set FORCE_REPAIR=true only if you intentionally want to override this safeguard."
    else
      warn "FORCE_REPAIR=true: bypassing failure-signature safeguard."
    fi
  else
    warn "No target pod exists, so the failure signature cannot be re-read."
    warn "Continuing because you explicitly selected orderer-$n."
  fi

  say "Current Ready orderers before repair: $(ready_count)/6"

  say "Scaling only $dep down"

  kubectl scale deployment/"$dep"     -n "$ns"     --replicas=0

  if ! wait_no_target_pod "$n" 180; then
    die "$dep pod did not terminate."
  fi

  delete_stale_helpers "$n"
  sleep "$DETACH_WAIT_SECONDS"

  say "Creating temporary PVC helper"

  if ! create_helper "$n" "$ns" "$pvc" "$zone" "$helper"; then
    warn "Helper failed before persistent state was modified."

    if (( original_replicas > 0 )); then
      kubectl scale deployment/"$dep"         -n "$ns"         --replicas="$original_replicas" >/dev/null || true
    fi

    return 1
  fi

  say "Backing up and temporarily removing ONLY system-channel Raft runtime state"

  if ! write_manifest_and_move_state "$ns" "$helper" "$backup_dir"; then
    kubectl delete pod "$helper"       -n "$ns"       --ignore-not-found       --wait=true >/dev/null 2>&1 || true

    if (( original_replicas > 0 )); then
      kubectl scale deployment/"$dep"         -n "$ns"         --replicas="$original_replicas" >/dev/null || true
    fi

    return 1
  fi

  state_moved=true

  say "Unmounting PVC helper"

  kubectl delete pod "$helper"     -n "$ns"     --wait=true >/dev/null

  sleep "$DETACH_WAIT_SECONDS"

  say "Starting orderer-$n"

  kubectl scale deployment/"$dep"     -n "$ns"     --replicas=1

  local newpod=""
  local elapsed=0

  while (( elapsed < 120 )); do
    newpod="$(latest_pod_for "$n")"
    [[ -n "$newpod" ]] && break

    sleep 2
    elapsed=$((elapsed + 2))
  done

  if [[ -z "$newpod" ]]; then
    warn "No replacement pod appeared."

    rollback_state       "$n" "$ns" "$dep" "$pvc" "$zone" "$helper"       "$backup_dir" "$original_replicas"

    return 1
  fi

  echo "Replacement pod: $newpod"

  say "Waiting up to ${WAIT_SECONDS}s for Ready state"

  local deadline=$((SECONDS + WAIT_SECONDS))
  local ready=false

  while (( SECONDS < deadline )); do
    ready="$(
      kubectl get pod "$newpod"         -n "$ns"         -o jsonpath='{.status.containerStatuses[0].ready}'         2>/dev/null || echo false
    )"

    if [[ "$ready" == "true" ]]; then
      break
    fi

    if {
      kubectl logs "$newpod"         -n "$ns"         -c orderer         --tail=120         2>&1 || true
    } | grep -qE         'unexpected Previous block hash|Could not append block'; then
      break
    fi

    sleep 5
  done

  local logs

  logs="$(
    kubectl logs "$newpod"       -n "$ns"       -c orderer       --tail=250       2>&1 || true
  )"

  if [[ "$ready" == "true" ]] &&      ! grep -qE        'unexpected Previous block hash|Could not append block'        <<<"$logs"; then

    say "SUCCESS: orderer-$n is Ready."

    kubectl get pod "$newpod"       -n "$ns"       -o wide

    echo
    echo "Backup retained at:"
    echo "  $backup_dir"
    echo
    echo "Do NOT delete that backup until the complete Fabric network is stable."

    return 0
  fi

  echo
  warn "Repair attempt failed. Relevant new logs:"

  grep -E     'unexpected Previous block hash|Could not append block|panic:|PANI|ERRO|WARN|SERVICE_UNAVAILABLE'     <<<"$logs" | tail -n 60 || true

  if [[ "$state_moved" == "true" ]]; then
    say "Automatically rolling back original system-channel Raft state"

    if rollback_state         "$n" "$ns" "$dep" "$pvc" "$zone" "$helper"         "$backup_dir" "$original_replicas"; then
      return 1
    fi

    die "Repair AND automatic rollback failed. Leave orderer-$n scaled down and inspect backup at $backup_dir."
  fi

  return 1
}

repair_failed() {
  local n
  local found=0

  say "Scanning all orderers for the exact previous-block-hash panic"

  for n in 1 2 3 4 5 6; do
    if has_previous_hash_failure "$n"; then
      found=1
      echo "orderer-$n: MATCH"
    else
      echo "orderer-$n: skip"
    fi
  done

  if (( found == 0 )); then
    say "No currently running pod exposes the target failure signature."
    return 0
  fi

  echo
  echo "repair-failed works ONE node at a time."
  echo "If one repair fails, this command stops immediately."
  echo

  for n in 1 2 3 4 5 6; do
    if has_previous_hash_failure "$n"; then
      if ! repair_one "$n"; then
        warn "Stopping repair-failed after orderer-$n did not recover."
        return 1
      fi

      say "Ready orderers after orderer-$n recovery: $(ready_count)/6"
    fi
  done
}

verify_all() {
  say "Orderer readiness"

  kubectl get pods -A -o wide |     grep -E 'orderer-[1-6]-' || true

  echo
  echo "Ready orderers: $(ready_count)/6"

  echo
  say "Checking local channel ledger files on Ready orderers"

  local n ns pod ready

  for n in 1 2 3 4 5 6; do
    ns="$(ns_for "$n")"
    pod="$(latest_pod_for "$n")"

    echo
    echo "===== orderer-$n ====="

    if [[ -z "$pod" ]]; then
      echo "No pod."
      continue
    fi

    ready="$(
      kubectl get pod "$pod"         -n "$ns"         -o jsonpath='{.status.containerStatuses[0].ready}'         2>/dev/null || echo false
    )"

    echo "pod=$pod ready=$ready"

    if [[ "$ready" != "true" ]]; then
      echo "Skipping filesystem check because container is not Ready."
      continue
    fi

    MSYS2_ARG_CONV_EXCL='*' kubectl exec       -n "$ns"       "$pod"       -c orderer --       sh -c '
        for channel in system-channel registrar-channel; do
          file="/var/hyperledger/production/orderer/chains/$channel/blockfile_000000"

          if [ -f "$file" ]; then
            echo "$channel: PRESENT"
            ls -lh "$file"
          else
            echo "$channel: MISSING"
          fi
        done
      ' || true
  done
}

usage() {
  cat <<'EOF'
BlockGo Fabric Orderer Recovery Controller

Usage:
  ./repair-orderers.sh audit
  ./repair-orderers.sh verify
  ./repair-orderers.sh repair <1|2|3|4|5|6>
  ./repair-orderers.sh repair-failed

Recommended:
  ./repair-orderers.sh audit
  ./repair-orderers.sh repair 3
  ./repair-orderers.sh verify

Environment:
  WAIT_SECONDS=240
  HELPER_READY_TIMEOUT=180
  DETACH_WAIT_SECONDS=15
  HELPER_IMAGE=busybox:1.36.1

  # Default false:
  # after failed repair + successful rollback, leave target down.
  RESTORE_FAILED_REPLICA=false

  # Normally leave false.
  FORCE_REPAIR=false

Examples:
  WAIT_SECONDS=300 ./repair-orderers.sh repair 3
  RESTORE_FAILED_REPLICA=true ./repair-orderers.sh repair 3

Important:
  This script only attempts recovery of system-channel Raft runtime state.
  It does NOT delete PVCs, regenerate Fabric crypto, recreate channels,
  or modify chain blockfiles.
EOF
}

main() {
  need kubectl
  need grep
  need awk
  need date
  need sed

  [[ $# -ge 1 ]] || {
    usage
    exit 1
  }

  case "$1" in
    audit)
      [[ $# -eq 1 ]] || die "audit takes no additional arguments."
      audit_all
      ;;

    verify)
      [[ $# -eq 1 ]] || die "verify takes no additional arguments."
      verify_all
      ;;

    repair)
      [[ $# -eq 2 ]] || die "Usage: ./repair-orderers.sh repair <1-6>"
      repair_one "$2"
      ;;

    repair-failed)
      [[ $# -eq 1 ]] || die "repair-failed takes no additional arguments."
      repair_failed
      ;;

    -h|--help|help)
      usage
      ;;

    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
