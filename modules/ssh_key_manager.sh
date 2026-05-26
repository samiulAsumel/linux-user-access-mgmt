#!/usr/bin/env bash
# ============================================================
# modules/ssh_key_manager.sh — SSH public key lifecycle
# Linux User & Access Management Automation  v1.0.0
# Actions: deploy | list | revoke | rotate | audit
# Usage  : ./modules/ssh_key_manager.sh [--dry-run] <action> [args]
# ============================================================
# shellcheck shell=bash
# shellcheck source=../config.conf
set -euo pipefail

_skm_load_config() {
    local cfg
    cfg="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    # shellcheck disable=SC1091
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "${LOG_FILE:-}" ]] && _skm_load_config

_skm_log() {
    local level="$1"; shift
    local ts msg
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    msg="[$ts] [$level] [SSH_KEY_MGR] $*"
    printf '%s\n' "$msg"
    printf '%s\n' "$msg" >> "${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_skm_dry() {
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        _skm_log "DRY" "Would run: $*"
        return 0
    fi
    "$@"
}

# ── Resolve home directory ────────────────────────────────────────────────────
_skm_home() {
    local username="$1"
    id "$username" &>/dev/null || {
        _skm_log "ERROR" "User '$username' not found"
        return 1
    }
    getent passwd "$username" | cut -d: -f6
}

# ── Resolve public key file path ──────────────────────────────────────────────
_skm_resolve_key() {
    local key_file="$1"
    local key_path

    # Try: exact path, SSH_KEYS_DIR, project ssh-keys/
    if [[ -f "$key_file" ]]; then
        printf '%s' "$key_file"
        return 0
    fi

    key_path="${SSH_KEYS_DIR:-/etc/usermgmt/ssh-keys}/${key_file}"
    if [[ -f "$key_path" ]]; then
        printf '%s' "$key_path"
        return 0
    fi

    local proj_root
    proj_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    key_path="${proj_root}/ssh-keys/${key_file}"
    if [[ -f "$key_path" ]]; then
        printf '%s' "$key_path"
        return 0
    fi

    return 1
}

# ── Deploy a public key ───────────────────────────────────────────────────────
run_ssh_deploy() {
    local username="${1:?username required}"
    local key_file="${2:?key file required}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\n' >&2; exit 1; }

    local home_dir ssh_dir auth_keys key_path key_type key_fp
    home_dir=$(_skm_home "$username")
    ssh_dir="${home_dir}/.ssh"
    auth_keys="${ssh_dir}/authorized_keys"

    if ! key_path=$(_skm_resolve_key "$key_file"); then
        _skm_log "ERROR" "Key file not found: $key_file"
        _skm_log "ERROR" "Searched: $key_file, ${SSH_KEYS_DIR:-/etc/usermgmt/ssh-keys}/$key_file, project ssh-keys/$key_file"
        return 1
    fi

    # Validate key format
    if ! ssh-keygen -l -f "$key_path" &>/dev/null; then
        _skm_log "ERROR" "Invalid SSH public key: $key_path"
        return 1
    fi

    key_type=$(ssh-keygen -l -f "$key_path" 2>/dev/null | awk '{print $4}')
    key_fp=$(ssh-keygen -l -f "$key_path"   2>/dev/null | awk '{print $2}')
    _skm_log "INFO" "Deploying $key_type key ($key_fp) for $username"

    # Prevent duplicates
    if [[ "${DRY_RUN:-false}" != "true" && -f "$auth_keys" ]]; then
        if grep -qF "$(cat "$key_path")" "$auth_keys" 2>/dev/null; then
            _skm_log "WARN" "Key already present in authorized_keys for $username — skipping"
            return 0
        fi
    fi

    _skm_dry mkdir -p "$ssh_dir"
    _skm_dry chmod "${SSH_DIR_PERM:-700}" "$ssh_dir"

    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        cat "$key_path" >> "$auth_keys"
    else
        _skm_log "DRY" "Would append $key_file → $auth_keys"
    fi

    _skm_dry chmod "${SSH_KEYS_PERM:-600}" "$auth_keys"
    _skm_dry chown -R "${username}:${username}" "$ssh_dir"
    _skm_log "OK" "SSH key deployed for $username ← $key_file ($key_type $key_fp)"
}

# ── List keys for a user ──────────────────────────────────────────────────────
run_ssh_list() {
    local username="${1:?username required}"
    local home_dir auth_keys
    home_dir=$(_skm_home "$username")
    auth_keys="${home_dir}/.ssh/authorized_keys"

    if [[ ! -f "$auth_keys" ]]; then
        printf '\n  No authorized_keys found for %s\n\n' "$username"
        return 0
    fi

    printf '\n  SSH authorized keys for %s:\n' "$username"
    printf '  ──────────────────────────────────────────────────────\n'
    local i=0
    while IFS= read -r line; do
        [[ -z "$line" || "$line" =~ ^# ]] && continue
        i=$(( i + 1 ))
        local tmp fp ktype comment
        tmp=$(mktemp)
        printf '%s\n' "$line" > "$tmp"
        fp=$(ssh-keygen -l -f "$tmp" 2>/dev/null | awk '{print $2}' || printf 'invalid')
        ktype=$(ssh-keygen -l -f "$tmp" 2>/dev/null | awk '{print $4}' || printf '')
        comment=$(printf '%s' "$line" | awk '{print $NF}')
        rm -f "$tmp"
        printf '  [%2d] %s %-10s %s\n' "$i" "$fp" "$ktype" "$comment"
    done < "$auth_keys"
    printf '\n'
}

# ── Revoke all keys for a user ────────────────────────────────────────────────
run_ssh_revoke_all() {
    local username="${1:?username required}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\n' >&2; exit 1; }

    local home_dir auth_keys
    home_dir=$(_skm_home "$username")
    auth_keys="${home_dir}/.ssh/authorized_keys"

    if [[ ! -f "$auth_keys" ]]; then
        _skm_log "WARN" "No authorized_keys file for $username — nothing to revoke"
        return 0
    fi

    _skm_log "INFO" "Revoking all SSH keys for $username"

    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        local key_count
        key_count=$(grep -c '^[^#]' "$auth_keys" 2>/dev/null || printf '0')
        # Truncate file preserving ownership/permissions
        : > "$auth_keys"
        chmod 600 "$auth_keys"
        _skm_log "OK" "Revoked $key_count SSH key(s) for $username"
    else
        _skm_log "DRY" "Would empty $auth_keys for $username"
    fi
}

# ── Rotate key: revoke all then deploy new ───────────────────────────────────
run_ssh_rotate() {
    local username="${1:?username required}"
    local new_key_file="${2:?new key file required}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\n' >&2; exit 1; }

    _skm_log "INFO" "Rotating SSH key for $username"
    run_ssh_revoke_all "$username"
    run_ssh_deploy "$username" "$new_key_file"
    _skm_log "OK" "SSH key rotated for $username"
}

# ── Audit all users' SSH key status ──────────────────────────────────────────
run_ssh_audit() {
    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\n' >&2; exit 1; }

    printf '\n  SSH Key Audit — %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
    printf '  ──────────────────────────────────────────────────────────\n'
    printf '  %-22s %-8s %s\n' "Username" "Keys" "Fingerprints"
    printf '  ──────────────────────────────────────────────────────────\n'

    while IFS=: read -r username _ uid _ _ home shell; do
        [[ $uid -lt ${SYSTEM_UID_MIN:-1000} ]] && continue
        [[ "$shell" == "/sbin/nologin" || "$shell" == "/bin/false" ]] && continue

        local auth_keys="${home}/.ssh/authorized_keys"
        if [[ ! -f "$auth_keys" ]]; then
            printf '  %-22s %-8s %s\n' "$username" "0" "(no keys)"
            continue
        fi

        local key_count
        key_count=$(grep -c '^[^#]' "$auth_keys" 2>/dev/null || printf '0')

        if [[ "$key_count" -eq 0 ]]; then
            printf '  %-22s %-8s %s\n' "$username" "0" "(empty file)"
            continue
        fi

        local first=true
        while IFS= read -r keyline; do
            [[ -z "$keyline" || "$keyline" =~ ^# ]] && continue
            local tmp fp
            tmp=$(mktemp)
            printf '%s\n' "$keyline" > "$tmp"
            fp=$(ssh-keygen -l -f "$tmp" 2>/dev/null | awk '{print $2}' || printf 'invalid')
            rm -f "$tmp"
            if [[ "$first" == "true" ]]; then
                printf '  %-22s %-8s %s\n' "$username" "$key_count" "$fp"
                first=false
            else
                printf '  %-22s %-8s %s\n' "" "" "$fp"
            fi
        done < "$auth_keys"
    done < /etc/passwd
    printf '\n'
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    DRY_RUN=false
    ACTION=""
    ARGS=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)
                DRY_RUN=true ;;
            deploy|list|revoke|rotate|audit)
                ACTION="$1" ;;
            --help|-h)
                cat <<'HELP'
Usage: ssh_key_manager.sh [--dry-run] <action> [args...]

Actions:
  deploy <username> <keyfile>    Deploy public key to user's authorized_keys
  list   <username>              List all authorized keys with fingerprints
  revoke <username>              Remove ALL keys for user (offboarding)
  rotate <username> <keyfile>    Revoke all keys, then deploy the new key
  audit                          Show key summary for all regular users

Key file resolution order:
  1. Absolute path (if provided)
  2. SSH_KEYS_DIR (from config.conf, default /etc/usermgmt/ssh-keys/)
  3. Project ssh-keys/ directory

Examples:
  sudo ./ssh_key_manager.sh deploy jsmith jsmith.pub
  sudo ./ssh_key_manager.sh rotate acontractor acontractor_new.pub
  sudo ./ssh_key_manager.sh audit
HELP
                exit 0 ;;
            *)
                ARGS+=("$1") ;;
        esac
        shift
    done

    [[ -n "$ACTION" ]] || {
        printf 'Usage: %s [--dry-run] <deploy|list|revoke|rotate|audit> [args]\n' "$0" >&2
        exit 1
    }

    export DRY_RUN

    case "$ACTION" in
        deploy) run_ssh_deploy "${ARGS[@]}" ;;
        list)   run_ssh_list   "${ARGS[@]}" ;;
        revoke) run_ssh_revoke_all "${ARGS[@]}" ;;
        rotate) run_ssh_rotate "${ARGS[@]}" ;;
        audit)  run_ssh_audit ;;
    esac
fi
