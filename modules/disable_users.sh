#!/usr/bin/env bash
# ============================================================
# modules/disable_users.sh — Lock and expire user accounts
# Linux User & Access Management Automation  v1.0.0
# Usage : ./modules/disable_users.sh [--dry-run] \
#             [--reason "TEXT"] <username|csv_file>
# ============================================================
# shellcheck shell=bash
# shellcheck source=../config.conf
set -euo pipefail

_du_load_config() {
    local cfg
    cfg="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    # shellcheck disable=SC1091
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "${LOG_FILE:-}" ]] && _du_load_config

_du_log() {
    local level="$1"; shift
    local ts msg
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    msg="[$ts] [$level] [DISABLE_USERS] $*"
    printf '%s\n' "$msg"
    printf '%s\n' "$msg" >> "${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_du_dry() {
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        _du_log "DRY" "Would run: $*"
        return 0
    fi
    "$@"
}

# ── Notify admin ──────────────────────────────────────────────────────────────
_du_notify_admin() {
    local username="$1"
    local reason="$2"
    [[ "${NOTIFY_ON_DISABLE:-true}" != "true" ]] && return 0
    [[ -z "${ADMIN_EMAIL:-}" ]] && return 0
    local ts
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    local body
    body="$(printf '[UserMgmt] Account Disabled: %s\n\nUsername : %s\nReason   : %s\nTime     : %s\nAction by: %s\nServer   : %s\n\nThis is an automated notification.' \
        "$username" "$username" "$reason" "$ts" "${SUDO_USER:-root}" "$(hostname -f 2>/dev/null || hostname)")"
    if command -v mail &>/dev/null; then
        printf '%s\n' "$body" \
            | mail -s "[UserMgmt] Account Disabled: $username" "${ADMIN_EMAIL}" 2>/dev/null || true
    fi
}

# ── Disable a single user account ────────────────────────────────────────────
_du_disable_user() {
    local username="${1:?username required}"
    local reason="${2:-Offboarding}"

    if ! id "$username" &>/dev/null; then
        _du_log "ERROR" "User '$username' does not exist — skipping"
        return 1
    fi

    # Safety: refuse to disable system users
    local uid
    uid=$(id -u "$username")
    if [[ $uid -lt ${SYSTEM_UID_MIN:-1000} ]]; then
        _du_log "ERROR" "Refusing to disable system user '$username' (UID=$uid < ${SYSTEM_UID_MIN:-1000})"
        return 1
    fi

    # Report current lock state
    local pw_status
    pw_status=$(passwd -S "$username" 2>/dev/null | awk '{print $2}')
    if [[ "$pw_status" == "L" || "$pw_status" == "LK" ]]; then
        _du_log "WARN" "User '$username' already appears locked (passwd status: $pw_status)"
    fi

    _du_log "INFO" "Disabling: $username | reason='$reason'"

    # 1. Lock the account (prepends ! to password hash in /etc/shadow)
    _du_dry usermod -L "$username"

    # 2. Set hard expiry to the epoch beginning (effectively expired)
    _du_dry usermod -e 1 "$username"

    # 3. Terminate all active sessions
    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        pkill -SIGTERM -u "$username" 2>/dev/null || true
        sleep 2
        pkill -SIGKILL -u "$username" 2>/dev/null || true
        _du_log "INFO" "Sessions terminated for $username"
    else
        _du_log "DRY" "Would terminate all sessions for $username"
    fi

    # 4. Stamp GECOS field with an auditable disable record
    local current_comment suffix new_comment
    current_comment=$(getent passwd "$username" | cut -d: -f5)
    suffix="[DISABLED:$(date +%Y-%m-%d):${SUDO_USER:-root}:${reason}]"
    new_comment="${current_comment} ${suffix}"
    # GECOS is capped at 255 chars
    _du_dry usermod -c "${new_comment:0:255}" "$username"

    _du_log "OK" "DISABLED: $username — by=${SUDO_USER:-root} reason=$reason uid=$uid"

    # 5. Admin notification
    [[ "${DRY_RUN:-false}" != "true" ]] && _du_notify_admin "$username" "$reason"
    return 0
}

# ── Main entry point ──────────────────────────────────────────────────────────
run_disable_users() {
    local target="${1:?username or CSV file required}"
    local reason="${2:-Offboarding}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\n' >&2; exit 1; }
    [[ "${DRY_RUN:-false}" == "true" ]] && _du_log "WARN" "=== DRY-RUN MODE — no system changes ==="

    local disabled=0 failed=0

    if [[ -f "$target" ]]; then
        _du_log "INFO" "━━━ Bulk disable from CSV: $target"
        while IFS=',' read -r username _rest; do
            username="${username//$'\r'/}"
            username="${username// /}"
            [[ -z "$username" || "$username" == "username" || "$username" =~ ^# ]] && continue
            if _du_disable_user "$username" "$reason"; then
                disabled=$(( disabled + 1 ))
            else
                failed=$(( failed + 1 ))
            fi
        done < "$target"
    else
        _du_log "INFO" "━━━ Disabling single user: $target"
        if _du_disable_user "$target" "$reason"; then
            disabled=1
        else
            failed=1
        fi
    fi

    printf '\n'
    printf '╔═══════════════════════════════════════════╗\n'
    printf '║       Disable Users Summary               ║\n'
    printf '╠═══════════════════════════════════════════╣\n'
    printf '║  %-18s : %-20s ║\n' "Disabled" "$disabled"
    printf '║  %-18s : %-20s ║\n' "Failed" "$failed"
    printf '╚═══════════════════════════════════════════╝\n'
    printf '\n'

    _du_log "INFO" "━━━ Disable complete — disabled=$disabled failed=$failed"
    [[ $failed -eq 0 ]]
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    DRY_RUN=false
    REASON="Offboarding"
    TARGET=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run) DRY_RUN=true ;;
            --reason)
                shift
                REASON="${1:?Reason text required after --reason}"
                ;;
            --help|-h)
                printf 'Usage: %s [OPTIONS] <username|csv_file>\n\n' "$0"
                printf 'Options:\n'
                printf '  --dry-run          Show what would happen (no changes)\n'
                printf '  --reason TEXT      Reason for disabling (recorded in GECOS)\n'
                printf '  --help             Show this help\n\n'
                printf 'Arguments:\n'
                printf '  username           Single username to disable\n'
                printf '  csv_file           CSV file with usernames in first column\n\n'
                printf 'Example:\n'
                printf '  sudo %s --reason "Resigned 2026-05-27" jsmith\n' "$0"
                exit 0 ;;
            -*)
                printf '[ERROR] Unknown flag: %s\n' "$1" >&2; exit 1 ;;
            *)
                TARGET="$1" ;;
        esac
        shift
    done

    [[ -n "$TARGET" ]] || {
        printf 'Usage: %s [--dry-run] [--reason TEXT] <username|csv_file>\n' "$0" >&2; exit 1
    }

    export DRY_RUN
    run_disable_users "$TARGET" "$REASON"
fi
