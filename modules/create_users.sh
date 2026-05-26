#!/usr/bin/env bash
# ============================================================
# modules/create_users.sh — Bulk user creation from CSV
# Linux User & Access Management Automation  v1.0.0
# Target : RHEL 9 / CentOS Stream 9 / Rocky Linux 9
# Usage  : ./modules/create_users.sh [--dry-run] <csv_file>
#          Sourced by user_manager.sh or executed standalone.
# Requires: root, openssl, useradd, chpasswd, chage, groupadd
# ============================================================
# shellcheck shell=bash
# shellcheck source=../config.conf
set -euo pipefail

# ── Load configuration ────────────────────────────────────────────────────────
_cu_load_config() {
    local cfg
    cfg="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    if [[ -f "$cfg" ]]; then
        # shellcheck disable=SC1091
        source "$cfg"
    else
        printf '%s\n' "[WARN] config.conf not found — using built-in defaults" >&2
    fi
}
[[ -z "${LOG_FILE:-}" ]] && _cu_load_config

# ── Logging ───────────────────────────────────────────────────────────────────
_cu_log() {
    local level="$1"; shift
    local ts msg
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    msg="[$ts] [$level] [CREATE_USERS] $*"
    printf '%s\n' "$msg"
    printf '%s\n' "$msg" >> "${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
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
    local pass
    # Ensure character-class diversity: letters, digits, special
    pass=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9!@#$%' | head -c "$length")
    # Guarantee at least one of each required class (last 4 chars)
    local pad="Aa1!"
    pass="${pass:0:$(( length - 4 ))}${pad}"
    printf '%s' "$pass"
}

# ── Deploy SSH public key ─────────────────────────────────────────────────────
_cu_deploy_ssh_key() {
    local username="$1"
    local key_file="$2"
    local home_dir="$3"

    # Resolve key path — try absolute, then SSH_KEYS_DIR, then project ssh-keys/
    local key_path proj_root
    key_path="${SSH_KEYS_DIR:-/etc/usermgmt/ssh-keys}/${key_file}"
    if [[ ! -f "$key_path" ]]; then
        proj_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
        key_path="${proj_root}/ssh-keys/${key_file}"
    fi

    if [[ ! -f "$key_path" ]]; then
        _cu_log "WARN" "SSH key file not found: $key_file — skipping SSH for $username"
        return 0
    fi

    # Validate it is a real public key
    if ! ssh-keygen -l -f "$key_path" &>/dev/null; then
        _cu_log "WARN" "Invalid SSH public key: $key_file — skipping for $username"
        return 0
    fi

    local ssh_dir auth_keys key_fp key_type
    ssh_dir="${home_dir}/.ssh"
    auth_keys="${ssh_dir}/authorized_keys"
    key_fp=$(ssh-keygen -l -f "$key_path" 2>/dev/null | awk '{print $2}')
    key_type=$(ssh-keygen -l -f "$key_path" 2>/dev/null | awk '{print $4}')

    _cu_dry mkdir -p "$ssh_dir"
    _cu_dry chmod "${SSH_DIR_PERM:-700}" "$ssh_dir"

    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        # Prevent duplicate key
        if [[ -f "$auth_keys" ]] && grep -qF "$(cat "$key_path")" "$auth_keys" 2>/dev/null; then
            _cu_log "WARN" "SSH key already present for $username — skipping"
            return 0
        fi
        cat "$key_path" >> "$auth_keys"
    else
        _cu_log "DRY" "Would append $key_file → ${auth_keys}"
    fi

    _cu_dry chmod "${SSH_KEYS_PERM:-600}" "$auth_keys"
    _cu_dry chown -R "${username}:${username}" "$ssh_dir"
    _cu_log "OK" "SSH key deployed for $username — ${key_type} ${key_fp}"
}

# ── Create a single user from CSV fields ──────────────────────────────────────
_cu_create_user() {
    local username="$1"
    local full_name="$2"
    local email="$3"
    local department="$4"
    local groups="$5"
    local shell="$6"
    local expiry_date="$7"
    local ssh_key_file="$8"

    # ── Validate username ──────────────────────────────────────────────────────
    if ! [[ "$username" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
        _cu_log "ERROR" "Invalid username: '$username' — must match ^[a-z_][a-z0-9_-]{0,31}$"
        return 1
    fi

    # ── Check for existing user ────────────────────────────────────────────────
    if id "$username" &>/dev/null; then
        _cu_log "WARN" "User '$username' already exists — skipping (use usermod to modify)"
        return 2
    fi

    # ── Validate shell ─────────────────────────────────────────────────────────
    local user_shell="${shell:-${DEFAULT_SHELL:-/bin/bash}}"
    if [[ -n "$user_shell" ]] && ! grep -qx "$user_shell" /etc/shells 2>/dev/null; then
        _cu_log "WARN" "Shell '$user_shell' not in /etc/shells — falling back to /bin/bash"
        user_shell="/bin/bash"
    fi

    # ── Build secondary groups list ────────────────────────────────────────────
    local secondary_groups="" grp
    if [[ -n "$groups" ]]; then
        local IFS_SAVED="$IFS"
        IFS=':'; read -ra grp_arr <<< "$groups"; IFS="$IFS_SAVED"
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

    # Append DEFAULT_GROUPS if configured
    if [[ -n "${DEFAULT_GROUPS:-}" ]]; then
        secondary_groups="${secondary_groups:+${secondary_groups},}${DEFAULT_GROUPS}"
    fi

    # ── Create user account ────────────────────────────────────────────────────
    local useradd_args=("-m" "-c" "$full_name" "-s" "$user_shell")
    [[ -n "$secondary_groups" ]] && useradd_args+=("-G" "$secondary_groups")

    _cu_log "INFO" "Creating: $username | '$full_name' | dept=$department | groups=${secondary_groups:-none}"
    if ! _cu_dry useradd "${useradd_args[@]}" "$username"; then
        _cu_log "ERROR" "useradd failed for '$username'"
        return 1
    fi

    # ── Set password ───────────────────────────────────────────────────────────
    local password
    password=$(_cu_gen_password)
    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        echo "${username}:${password}" | chpasswd
        if [[ "${PASS_FORCE_CHANGE:-true}" == "true" ]]; then
            chage -d 0 "$username"
        fi
    else
        _cu_log "DRY" "Would set password (force change on first login) for $username"
    fi

    # ── Apply password aging policy ────────────────────────────────────────────
    _cu_dry chage \
        -m "${PASS_MIN_DAYS:-1}" \
        -M "${PASS_MAX_DAYS:-90}" \
        -W "${PASS_WARN_DAYS:-14}" \
        -I "${PASS_INACTIVE_DAYS:-30}" \
        "$username"

    # ── Set account expiry ─────────────────────────────────────────────────────
    if [[ -n "$expiry_date" ]]; then
        if date -d "$expiry_date" &>/dev/null 2>&1; then
            _cu_dry chage -E "$expiry_date" "$username"
            _cu_log "INFO" "Account expiry set: $username → $expiry_date"
        else
            _cu_log "WARN" "Invalid expiry date '$expiry_date' for $username — skipping"
        fi
    fi

    # ── Set home directory permissions (700) ───────────────────────────────────
    local home_dir
    home_dir=$(getent passwd "$username" 2>/dev/null | cut -d: -f6)
    if [[ -d "${home_dir:-}" ]]; then
        _cu_dry chmod 700 "$home_dir"
    fi

    # ── Deploy SSH public key ──────────────────────────────────────────────────
    if [[ -n "$ssh_key_file" && -n "${home_dir:-}" ]]; then
        _cu_deploy_ssh_key "$username" "$ssh_key_file" "$home_dir"
    fi

    # ── Audit log ─────────────────────────────────────────────────────────────
    local created_by="${SUDO_USER:-root}"
    _cu_log "OK" "CREATED: $username by $created_by | dept=$department | groups=${secondary_groups:-none} | expiry=${expiry_date:-never} | ssh=${ssh_key_file:-none}"

    # Emit credential line to be captured by caller
    printf 'CRED:%s:%s\n' "$username" "$password"
    return 0
}

# ── Validate CSV header ───────────────────────────────────────────────────────
_cu_validate_header() {
    local header="$1"
    local expected="username,full_name,email,department,groups,shell,expiry_date,ssh_key_file"
    # Normalise: strip CR, trailing spaces
    header="${header//$'\r'/}"
    header="${header%"${header##*[![:space:]]}"}"
    if [[ "$header" != "$expected" ]]; then
        printf '[ERROR] Invalid CSV header.\n' >&2
        printf '[ERROR] Expected: %s\n' "$expected" >&2
        printf '[ERROR] Got:      %s\n' "$header"  >&2
        return 1
    fi
    return 0
}

# ── Main entry point ──────────────────────────────────────────────────────────
run_create_users() {
    local csv_file="${1:?CSV file path is required}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\n' >&2; exit 1; }
    [[ -f "$csv_file" ]] || { printf '[ERROR] CSV not found: %s\n' "$csv_file" >&2; exit 1; }

    _cu_log "INFO" "━━━ Bulk user creation started — source: $csv_file"
    [[ "${DRY_RUN:-false}" == "true" ]] && _cu_log "WARN" "=== DRY-RUN MODE — zero system changes will be made ==="

    local line_num=0 created=0 failed=0 skipped=0
    local creds_file
    creds_file=$(mktemp /tmp/usermgmt_creds_XXXXXX)
    chmod 600 "$creds_file"

    while IFS=',' read -r username full_name email department groups shell expiry_date ssh_key_file; do
        line_num=$(( line_num + 1 ))

        # Validate and skip header
        if [[ $line_num -eq 1 ]]; then
            _cu_validate_header \
                "${username},${full_name},${email},${department},${groups},${shell},${expiry_date},${ssh_key_file}" \
                || exit 1
            continue
        fi

        # Strip carriage returns and leading/trailing spaces from all fields
        username="${username//$'\r'/}";         username="${username#"${username%%[! ]*}"}"
        shell="${shell//$'\r'/}";               shell="${shell#"${shell%%[! ]*}"}"
        expiry_date="${expiry_date//$'\r'/}";   expiry_date="${expiry_date#"${expiry_date%%[! ]*}"}"
        ssh_key_file="${ssh_key_file//$'\r'/}"; ssh_key_file="${ssh_key_file#"${ssh_key_file%%[! ]*}"}"

        # Skip blank lines and comment lines
        [[ -z "$username" || "$username" =~ ^[[:space:]]*# ]] && { skipped=$(( skipped + 1 )); continue; }

        local result exit_code
        result=$(_cu_create_user \
            "$username" "$full_name" "$email" "$department" \
            "$groups" "$shell" "$expiry_date" "$ssh_key_file" 2>&1)
        exit_code=$?

        printf '%s\n' "$result"

        if [[ $exit_code -eq 0 ]]; then
            created=$(( created + 1 ))
            # Capture CRED: lines
            printf '%s\n' "$result" | grep '^CRED:' >> "$creds_file" 2>/dev/null || true
        elif [[ $exit_code -eq 2 ]]; then
            skipped=$(( skipped + 1 ))
        else
            failed=$(( failed + 1 ))
            _cu_log "ERROR" "Failed to process CSV line $line_num: $username"
        fi

    done < "$csv_file"

    # ── Summary ────────────────────────────────────────────────────────────────
    printf '\n'
    printf '╔═════════════════════════════════════════════════════╗\n'
    printf '║           User Creation Summary                     ║\n'
    printf '╠═════════════════════════════════════════════════════╣\n'
    printf '║  %-24s : %-24s ║\n' "Total rows processed" "$(( line_num - 1 ))"
    printf '║  %-24s : %-24s ║\n' "Successfully created" "$created"
    printf '║  %-24s : %-24s ║\n' "Failed" "$failed"
    printf '║  %-24s : %-24s ║\n' "Skipped (dup/blank)" "$skipped"
    printf '╚═════════════════════════════════════════════════════╝\n'

    if [[ $created -gt 0 && "${DRY_RUN:-false}" != "true" ]]; then
        printf '\n  ⚠  Generated credentials (distribute securely and DELETE file):\n'
        printf '  ┌──────────────────────────────────────────────────┐\n'
        while IFS=':' read -r _ user pass; do
            printf '  │  %-18s  %-28s │\n' "$user" "$pass"
        done < "$creds_file"
        printf '  └──────────────────────────────────────────────────┘\n'
        printf '  Saved to: %s\n' "$creds_file"
        printf '  All passwords must be changed on first login (chage -d 0).\n'
    fi
    printf '\n'

    _cu_log "INFO" "━━━ Bulk creation complete — created=$created failed=$failed skipped=$skipped"
    [[ $failed -eq 0 ]]
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    DRY_RUN=false
    CSV_FILE=""

    for _arg in "$@"; do
        case "$_arg" in
            --dry-run) DRY_RUN=true ;;
            --help|-h)
                printf 'Usage: %s [--dry-run] <users.csv>\n\n' "$0"
                printf 'CSV format (header required):\n'
                printf '  username,full_name,email,department,groups,shell,expiry_date,ssh_key_file\n\n'
                printf 'Options:\n'
                printf '  --dry-run   Simulate without making any system changes\n'
                printf '  --help      Show this help\n\n'
                printf 'Example:\n'
                printf '  sudo %s --dry-run templates/users_template.csv\n' "$0"
                exit 0 ;;
            -*)
                printf '[ERROR] Unknown flag: %s\n' "$_arg" >&2; exit 1 ;;
            *)
                CSV_FILE="$_arg" ;;
        esac
    done

    [[ -n "$CSV_FILE" ]] || {
        printf 'Usage: %s [--dry-run] <users.csv>\n' "$0" >&2; exit 1
    }

    export DRY_RUN
    run_create_users "$CSV_FILE"
fi
