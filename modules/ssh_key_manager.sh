#!/usr/bin/env bash
# modules/ssh_key_manager.sh — Deploy, rotate, revoke SSH public keys
# Usage: ./modules/ssh_key_manager.sh [--dry-run] <action> [args...]
# shellcheck shell=bash
set -euo pipefail

_skm_load_config() {
    local cfg
    cfg="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "${LOG_FILE:-}" ]] && _skm_load_config

_skm_log() {
    local level="$1"; shift
    local ts; ts=$(date '+%Y-%m-%d %H:%M:%S')
    local msg="[$ts] [$level] [SSH_KEY_MGR] $*"
    echo "$msg"
    echo "$msg" >> "${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_skm_dry() {
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        _skm_log "DRY" "Would run: $*"
        return 0
    fi
    "$@"
}

# ── Resolve and validate home directory ───────────────────────────────────────
_skm_home_dir() {
    local username="$1"
    id "$username" &>/dev/null || { _skm_log "ERROR" "User '$username' not found"; return 1; }
    getent passwd "$username" | cut -d: -f6
}

# ── Deploy an SSH public key ──────────────────────────────────────────────────
run_ssh_deploy() {
    local username="${1:?username required}"
    local key_file="${2:?key file required}"

    [[ $EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }

    local home_dir; home_dir=$(_skm_home_dir "$username")
    local ssh_dir="${home_dir}/.ssh"
    local auth_keys="${ssh_dir}/authorized_keys"

    # Resolve key file path
    local key_path="${key_file}"
    if [[ ! -f "$key_path" ]]; then
        key_path="${SSH_KEYS_DIR:-/etc/usermgmt/ssh-keys}/${key_file}"
    fi
    if [[ ! -f "$key_path" ]]; then
        local proj_root; proj_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
        key_path="${proj_root}/ssh-keys/${key_file}"
    fi
    if [[ ! -f "$key_path" ]]; then
        _skm_log "ERROR" "Key file not found: $key_file"
        _skm_log "ERROR" "Searched: $SSH_KEYS_DIR, project ssh-keys/, and absolute path"
        return 1
    fi

    # Validate key
    if ! ssh-keygen -l -f "$key_path" &>/dev/null; then
        _skm_log "ERROR" "Invalid SSH public key: $key_path"
        return 1
    fi
    local key_type; key_type=$(ssh-keygen -l -f "$key_path" 2>/dev/null | awk '{print $4}')
    local key_fp;   key_fp=$(ssh-keygen -l -f "$key_path" 2>/dev/null | awk '{print $2}')
    _skm_log "INFO" "Deploying $key_type key ($key_fp) for $username"

    # Check for duplicate
    if [[ "${DRY_RUN:-false}" != "true" ]] && [[ -f "$auth_keys" ]]; then
        local pub_content; pub_content=$(cat "$key_path")
        if grep -qF "$pub_content" "$auth_keys" 2>/dev/null; then
            _skm_log "WARN" "Key already present in $auth_keys for $username — skipping"
            return 0
        fi
    fi

    _skm_dry mkdir -p "$ssh_dir"
    _skm_dry chmod "${SSH_DIR_PERM:-700}" "$ssh_dir"

    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        cat "$key_path" >> "$auth_keys"
    else
        _skm_log "DRY" "Would append key to $auth_keys"
    fi

    _skm_dry chmod "${SSH_KEYS_PERM:-600}" "$auth_keys"
    _skm_dry chown -R "${username}:${username}" "$ssh_dir"

    _skm_log "OK" "SSH key deployed for $username ← $key_file ($key_type)"
}

# ── List SSH keys for a user ──────────────────────────────────────────────────
run_ssh_list() {
    local username="${1:?username required}"

    local home_dir; home_dir=$(_skm_home_dir "$username")
    local auth_keys="${home_dir}/.ssh/authorized_keys"

    if [[ ! -f "$auth_keys" ]]; then
        echo "  No authorized_keys found for $username"
        return 0
    fi

    echo ""
    echo "  SSH authorized keys for $username:"
    echo "  ─────────────────────────────────────────────"
    local i=0
    while IFS= read -r line; do
        [[ -z "$line" || "$line" =~ ^# ]] && continue
        i=$((i+1))
        local tmp; tmp=$(mktemp)
        echo "$line" > "$tmp"
        local fp; fp=$(ssh-keygen -l -f "$tmp" 2>/dev/null | awk '{print $2}' || echo "invalid")
        local ktype; ktype=$(ssh-keygen -l -f "$tmp" 2>/dev/null | awk '{print $4}' || echo "")
        local comment; comment=$(echo "$line" | awk '{print $NF}')
        rm -f "$tmp"
        printf "  [%2d] %s %s  %s\n" "$i" "$fp" "$ktype" "$comment"
    done < "$auth_keys"
    echo ""
}

# ── Revoke (remove) all SSH keys for a user ───────────────────────────────────
run_ssh_revoke_all() {
    local username="${1:?username required}"

    [[ $EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }

    local home_dir; home_dir=$(_skm_home_dir "$username")
    local auth_keys="${home_dir}/.ssh/authorized_keys"

    if [[ ! -f "$auth_keys" ]]; then
        _skm_log "WARN" "No authorized_keys for $username"
        return 0
    fi

    _skm_log "INFO" "Revoking all SSH keys for $username"
    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        local key_count; key_count=$(grep -c "^[^#]" "$auth_keys" 2>/dev/null || echo "0")
        > "$auth_keys"
        chmod 600 "$auth_keys"
        _skm_log "OK" "Revoked $key_count SSH key(s) for $username"
    else
        _skm_log "DRY" "Would empty $auth_keys for $username"
    fi
}

# ── Rotate key: replace old with new ─────────────────────────────────────────
run_ssh_rotate() {
    local username="${1:?username required}"
    local new_key_file="${2:?new key file required}"

    [[ $EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }

    _skm_log "INFO" "Rotating SSH key for $username"
    run_ssh_revoke_all "$username"
    run_ssh_deploy "$username" "$new_key_file"
    _skm_log "OK" "SSH key rotated for $username"
}

# ── Audit: check all users' SSH key status ───────────────────────────────────
run_ssh_audit() {
    [[ $EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }

    echo ""
    echo "  SSH Key Audit — $(date '+%Y-%m-%d %H:%M:%S')"
    echo "  ──────────────────────────────────────────────────────"
    printf "  %-20s %-10s %s\n" "Username" "Keys" "Fingerprints"
    echo "  ──────────────────────────────────────────────────────"

    while IFS=: read -r username _ uid _ _ home shell; do
        [[ $uid -lt "${SYSTEM_UID_MIN:-1000}" ]] && continue
        [[ "$shell" == "/sbin/nologin" || "$shell" == "/bin/false" ]] && continue

        local auth_keys="${home}/.ssh/authorized_keys"
        if [[ ! -f "$auth_keys" ]]; then
            printf "  %-20s %-10s %s\n" "$username" "0" "(no keys)"
            continue
        fi

        local key_count; key_count=$(grep -c "^[^#]" "$auth_keys" 2>/dev/null || echo "0")
        if [[ "$key_count" -eq 0 ]]; then
            printf "  %-20s %-10s %s\n" "$username" "0" "(empty)"
            continue
        fi

        local fps=()
        while IFS= read -r line; do
            [[ -z "$line" || "$line" =~ ^# ]] && continue
            local tmp; tmp=$(mktemp)
            echo "$line" > "$tmp"
            local fp; fp=$(ssh-keygen -l -f "$tmp" 2>/dev/null | awk '{print $2}' || echo "invalid")
            fps+=("$fp")
            rm -f "$tmp"
        done < "$auth_keys"

        printf "  %-20s %-10s %s\n" "$username" "$key_count" "${fps[0]:-}"
        for ((j=1; j<${#fps[@]}; j++)); do
            printf "  %-20s %-10s %s\n" "" "" "${fps[$j]}"
        done
    done < /etc/passwd
    echo ""
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    DRY_RUN=false
    ACTION=""
    ARGS=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run) DRY_RUN=true ;;
            deploy|list|revoke|rotate|audit) ACTION="$1" ;;
            --help|-h)
                cat <<'EOF'
Usage: ssh_key_manager.sh [--dry-run] <action> [args...]

Actions:
  deploy <username> <keyfile>    Deploy public key to user's authorized_keys
  list   <username>              List all authorized keys for user
  revoke <username>              Remove ALL keys for user (offboarding)
  rotate <username> <keyfile>    Revoke all and deploy new key
  audit                          Audit SSH keys across all regular users

Examples:
  ./ssh_key_manager.sh deploy jsmith jsmith.pub
  ./ssh_key_manager.sh rotate jsmith jsmith_new.pub
  ./ssh_key_manager.sh audit
EOF
                exit 0 ;;
            *) ARGS+=("$1") ;;
        esac
        shift
    done

    case "$ACTION" in
        deploy) run_ssh_deploy "${ARGS[@]}" ;;
        list)   run_ssh_list   "${ARGS[@]}" ;;
        revoke) run_ssh_revoke_all "${ARGS[@]}" ;;
        rotate) run_ssh_rotate "${ARGS[@]}" ;;
        audit)  run_ssh_audit ;;
        *)
            echo "Usage: $0 [--dry-run] <deploy|list|revoke|rotate|audit> [args...]"
            exit 1 ;;
    esac
fi
