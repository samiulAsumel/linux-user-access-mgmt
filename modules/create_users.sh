#!/usr/bin/env bash
# modules/create_users.sh — Bulk user creation from CSV manifest
# Usage: ./modules/create_users.sh [--dry-run] <csv_file>
#        Sourced by user_manager.sh or executed standalone.
# Requires: root, openssl, useradd, chpasswd, chage, groupadd
# shellcheck shell=bash
set -euo pipefail

# ── Load configuration ────────────────────────────────────────────────────────
_cu_load_config() {
    local cfg
    cfg="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    [[ -f "$cfg" ]] && source "$cfg" || echo "[WARN] config.conf not found — using defaults" >&2
}
[[ -z "${LOG_FILE:-}" ]] && _cu_load_config

# ── Logging ───────────────────────────────────────────────────────────────────
_cu_log() {
    local level="$1"; shift
    local ts; ts=$(date '+%Y-%m-%d %H:%M:%S')
    local msg="[$ts] [$level] [CREATE_USERS] $*"
    echo "$msg"
    echo "$msg" >> "${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_cu_dry() {
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        _cu_log "DRY" "Would run: $*"
        return 0
    fi
    "$@"
}

# ── Generate a cryptographically secure password ──────────────────────────────
_cu_gen_password() {
    local length="${PASS_MIN_LEN:-12}"
    # Ensure at least 12 chars with mixed character classes
    local pass
    pass=$(openssl rand -base64 18 | tr -dc 'a-zA-Z0-9!@#$%^' | head -c "$length")
    # Guarantee at least one upper, lower, digit, special
    pass="${pass:0:$((length-4))}Aa1!"
    echo "$pass"
}

# ── Deploy SSH public key ─────────────────────────────────────────────────────
_cu_deploy_ssh_key() {
    local username="$1"
    local key_file="$2"
    local home_dir="$3"

    # Resolve key path
    local key_path="${SSH_KEYS_DIR:-/etc/usermgmt/ssh-keys}/${key_file}"
    if [[ ! -f "$key_path" ]]; then
        local proj_root; proj_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
        key_path="${proj_root}/ssh-keys/${key_file}"
    fi

    if [[ ! -f "$key_path" ]]; then
        _cu_log "WARN" "SSH key file not found: $key_file — skipping for $username"
        return 0
    fi

    # Validate key format
    if ! ssh-keygen -l -f "$key_path" &>/dev/null; then
        _cu_log "WARN" "SSH key '$key_file' is invalid — skipping for $username"
        return 0
    fi

    local ssh_dir="${home_dir}/.ssh"
    local auth_keys="${ssh_dir}/authorized_keys"

    _cu_dry mkdir -p "$ssh_dir"
    _cu_dry chmod "${SSH_DIR_PERM:-700}" "$ssh_dir"
    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        cat "$key_path" >> "$auth_keys"
    else
        _cu_log "DRY" "Would append $key_file to $auth_keys"
    fi
    _cu_dry chmod "${SSH_KEYS_PERM:-600}" "$auth_keys"
    _cu_dry chown -R "${username}:${username}" "$ssh_dir"
    _cu_log "OK" "SSH key deployed for $username ← $key_file"
}

# ── Create a single user ──────────────────────────────────────────────────────
_cu_create_user() {
    local username="$1" full_name="$2" email="$3"
    local department="$4" groups="$5" shell="$6"
    local expiry_date="$7" ssh_key_file="$8"

    # ── Validate username (POSIX: lowercase, digit, underscore, hyphen) ────────
    if ! [[ "$username" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
        _cu_log "ERROR" "Invalid username: '$username' (must match ^[a-z_][a-z0-9_-]{0,31}$)"
        return 1
    fi

    # ── Check for existing user ────────────────────────────────────────────────
    if id "$username" &>/dev/null; then
        _cu_log "WARN" "User '$username' already exists — skipping"
        return 2
    fi

    # ── Validate shell ─────────────────────────────────────────────────────────
    local user_shell="${shell:-${DEFAULT_SHELL:-/bin/bash}}"
    if [[ -n "$user_shell" ]] && ! grep -qx "$user_shell" /etc/shells 2>/dev/null; then
        _cu_log "WARN" "Shell '$user_shell' not in /etc/shells — falling back to /bin/bash"
        user_shell="/bin/bash"
    fi

    # ── Process groups (colon-separated) ──────────────────────────────────────
    local secondary_groups=""
    if [[ -n "$groups" ]]; then
        local IFS_OLD="$IFS"; IFS=':'; read -ra grp_arr <<< "$groups"; IFS="$IFS_OLD"
        for grp in "${grp_arr[@]}"; do
            grp="${grp// /}"
            [[ -z "$grp" ]] && continue
            if ! getent group "$grp" &>/dev/null; then
                _cu_log "INFO" "Group '$grp' does not exist — creating"
                _cu_dry groupadd "$grp" || _cu_log "WARN" "Failed to create group '$grp'"
            fi
            secondary_groups="${secondary_groups:+${secondary_groups},}${grp}"
        done
    fi

    # Merge with DEFAULT_GROUPS
    if [[ -n "${DEFAULT_GROUPS:-}" ]]; then
        secondary_groups="${secondary_groups:+${secondary_groups},}${DEFAULT_GROUPS}"
    fi

    # ── Build useradd command ──────────────────────────────────────────────────
    local useradd_args=("-m" "-c" "$full_name" "-s" "$user_shell")
    [[ -n "$secondary_groups" ]] && useradd_args+=("-G" "$secondary_groups")

    _cu_log "INFO" "Creating: $username | name='$full_name' | dept=$department | groups=${secondary_groups:-none}"
    _cu_dry useradd "${useradd_args[@]}" "$username" || {
        _cu_log "ERROR" "useradd failed for '$username'"
        return 1
    }

    # ── Set password ───────────────────────────────────────────────────────────
    local password; password=$(_cu_gen_password)
    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        echo "${username}:${password}" | chpasswd
        [[ "${PASS_FORCE_CHANGE:-true}" == "true" ]] && chage -d 0 "$username"
    else
        _cu_log "DRY" "Would set password and force change on first login for $username"
    fi

    # ── Apply password aging policy ────────────────────────────────────────────
    _cu_dry chage \
        -m "${PASS_MIN_DAYS:-1}" \
        -M "${PASS_MAX_DAYS:-90}" \
        -W "${PASS_WARN_DAYS:-14}" \
        -I "${PASS_INACTIVE_DAYS:-30}" \
        "$username"

    # ── Set account expiry date ────────────────────────────────────────────────
    if [[ -n "$expiry_date" ]]; then
        if date -d "$expiry_date" &>/dev/null 2>&1; then
            _cu_dry chage -E "$expiry_date" "$username"
            _cu_log "INFO" "Account expiry: $username → $expiry_date"
        else
            _cu_log "WARN" "Invalid expiry date '$expiry_date' for $username — skipping"
        fi
    fi

    # ── Set home directory permissions (700) ───────────────────────────────────
    local home_dir; home_dir=$(getent passwd "$username" 2>/dev/null | cut -d: -f6)
    if [[ -d "${home_dir:-}" ]]; then
        _cu_dry chmod 700 "$home_dir"
    fi

    # ── Deploy SSH public key ──────────────────────────────────────────────────
    if [[ -n "$ssh_key_file" && -n "${home_dir:-}" ]]; then
        _cu_deploy_ssh_key "$username" "$ssh_key_file" "$home_dir"
    fi

    # ── Log success + emit credentials ────────────────────────────────────────
    local created_by="${SUDO_USER:-root}"
    _cu_log "OK" "CREATED: $username (by $created_by) dept=$department groups=${secondary_groups:-none} expiry=${expiry_date:-never} ssh=${ssh_key_file:-none}"

    # Output the credential line (captured by caller)
    echo "CRED:${username}:${password}"
    return 0
}

# ── Validate CSV header ───────────────────────────────────────────────────────
_cu_validate_header() {
    local header="$1"
    local expected="username,full_name,email,department,groups,shell,expiry_date,ssh_key_file"
    # Normalize: strip CR, trailing spaces
    header="${header//$'\r'/}"
    header="${header%% }"
    if [[ "$header" != "$expected" ]]; then
        echo "[ERROR] Invalid CSV header." >&2
        echo "[ERROR] Expected: $expected" >&2
        echo "[ERROR] Got:      $header" >&2
        return 1
    fi
}

# ── Main entry point ──────────────────────────────────────────────────────────
run_create_users() {
    local csv_file="${1:?CSV file required}"

    [[ $EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }
    [[ -f "$csv_file" ]] || { echo "[ERROR] CSV not found: $csv_file" >&2; exit 1; }

    _cu_log "INFO" "━━━ Bulk user creation started from: $csv_file"
    [[ "${DRY_RUN:-false}" == "true" ]] && _cu_log "WARN" "=== DRY-RUN MODE — no system changes ==="

    local line_num=0 created=0 failed=0 skipped=0
    local creds_file; creds_file=$(mktemp /tmp/usermgmt_creds_XXXXXX)
    chmod 600 "$creds_file"

    while IFS=',' read -r username full_name email department groups shell expiry_date ssh_key_file; do
        line_num=$((line_num + 1))

        if [[ $line_num -eq 1 ]]; then
            _cu_validate_header "${username},${full_name},${email},${department},${groups},${shell},${expiry_date},${ssh_key_file}" || exit 1
            continue
        fi

        # Skip blanks and comment lines
        local stripped="${username//$'\r'/}"; stripped="${stripped// /}"
        [[ -z "$stripped" || "$stripped" =~ ^# ]] && { skipped=$((skipped+1)); continue; }

        # Trim whitespace from all fields
        username="${username//$'\r'/}"; username="${username// /}"
        shell="${shell//$'\r'/}";       shell="${shell// /}"
        expiry_date="${expiry_date//$'\r'/}"; expiry_date="${expiry_date// /}"
        ssh_key_file="${ssh_key_file//$'\r'/}"; ssh_key_file="${ssh_key_file// /}"

        local result
        if result=$(_cu_create_user "$username" "$full_name" "$email" \
                    "$department" "$groups" "$shell" "$expiry_date" "$ssh_key_file" 2>&1); then
            created=$((created + 1))
            # Extract credential line
            grep "^CRED:" <<< "$result" >> "$creds_file" 2>/dev/null || true
        else
            local exit_code=$?
            [[ $exit_code -eq 2 ]] && skipped=$((skipped+1)) || failed=$((failed+1))
        fi

    done < "$csv_file"

    echo ""
    echo "╔═══════════════════════════════════════════════════╗"
    echo "║           User Creation Summary                   ║"
    echo "╠═══════════════════════════════════════════════════╣"
    printf "║  %-20s : %-25s ║\n" "Rows processed" "$((line_num - 1))"
    printf "║  %-20s : %-25s ║\n" "Successfully created" "$created"
    printf "║  %-20s : %-25s ║\n" "Failed" "$failed"
    printf "║  %-20s : %-25s ║\n" "Skipped (dup/blank)" "$skipped"
    echo "╚═══════════════════════════════════════════════════╝"

    if [[ $created -gt 0 && "${DRY_RUN:-false}" != "true" ]]; then
        # Format credentials file for display
        echo ""
        echo "  ⚠  Generated credentials (distribute securely):"
        echo "  ┌──────────────────────────────────────────────┐"
        while IFS=':' read -r _prefix user pass; do
            printf "  │  %-15s  %s\n" "$user" "$pass"
        done < "$creds_file"
        echo "  └──────────────────────────────────────────────┘"
        echo "  Saved to: $creds_file — DELETE after distributing!"
        echo "  All users must change password on first login."
    fi
    echo ""

    _cu_log "INFO" "━━━ Bulk creation done — created=$created failed=$failed skipped=$skipped"
    [[ $failed -eq 0 ]]
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    DRY_RUN=false
    CSV_FILE=""
    for arg in "$@"; do
        case "$arg" in
            --dry-run) DRY_RUN=true ;;
            --help|-h)
                echo "Usage: $0 [--dry-run] <users.csv>"
                echo "       CSV format: username,full_name,email,department,groups,shell,expiry_date,ssh_key_file"
                exit 0 ;;
            -*)
                echo "[ERROR] Unknown flag: $arg" >&2; exit 1 ;;
            *)  CSV_FILE="$arg" ;;
        esac
    done
    [[ -n "$CSV_FILE" ]] || { echo "Usage: $0 [--dry-run] <users.csv>"; exit 1; }
    run_create_users "$CSV_FILE"
fi
