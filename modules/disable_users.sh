#!/usr/bin/env bash
# modules/disable_users.sh — Lock and expire user accounts (offboarding)
# Usage: ./modules/disable_users.sh [--dry-run] [--reason "TEXT"] <username|csv_file>
# shellcheck shell=bash
set -euo pipefail

_du_load_config() {
    local cfg
    cfg="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "${LOG_FILE:-}" ]] && _du_load_config

_du_log() {
    local level="$1"; shift
    local ts; ts=$(date '+%Y-%m-%d %H:%M:%S')
    local msg="[$ts] [$level] [DISABLE_USERS] $*"
    echo "$msg"
    echo "$msg" >> "${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_du_dry() {
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        _du_log "DRY" "Would run: $*"
        return 0
    fi
    "$@"
}

_du_notify_admin() {
    local username="$1" reason="$2"
    [[ "${NOTIFY_ON_DISABLE:-true}" != "true" ]] && return 0
    [[ -z "${ADMIN_EMAIL:-}" ]] && return 0
    local ts; ts=$(date '+%Y-%m-%d %H:%M:%S')
    local body="[UserMgmt] Account Disabled: $username

User account has been disabled.

Username : $username
Reason   : $reason
Time     : $ts
Action by: ${SUDO_USER:-root}
Server   : $(hostname -f 2>/dev/null || hostname)

This is an automated notification from the User Management System."

    if command -v mail &>/dev/null; then
        echo "$body" | mail -s "[UserMgmt] Account Disabled: $username" "${ADMIN_EMAIL}" 2>/dev/null || true
    fi
}

# ── Disable a single user account ────────────────────────────────────────────
_du_disable_user() {
    local username="${1:?username required}"
    local reason="${2:-Offboarding}"

    # Safety: validate user exists
    if ! id "$username" &>/dev/null; then
        _du_log "ERROR" "User '$username' does not exist — skipping"
        return 1
    fi

    # Safety: refuse to disable system users
    local uid; uid=$(id -u "$username")
    if [[ $uid -lt "${SYSTEM_UID_MIN:-1000}" ]]; then
        _du_log "ERROR" "Refusing to disable system user '$username' (UID=$uid)"
        return 1
    fi

    # Check if already locked
    local status; status=$(passwd -S "$username" 2>/dev/null | awk '{print $2}' || echo "?")
    if [[ "$status" == "L" || "$status" == "LK" ]]; then
        _du_log "WARN" "User '$username' appears already locked (passwd status: $status)"
    fi

    _du_log "INFO" "Disabling: $username | reason='$reason'"

    # 1. Lock the account (prepend ! to password hash in /etc/shadow)
    _du_dry usermod -L "$username"

    # 2. Expire the account immediately (January 2, 1970 = "expired")
    _du_dry usermod -e 1 "$username"

    # 3. Terminate all active sessions
    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        pkill -SIGTERM -u "$username" 2>/dev/null || true
        sleep 2
        pkill -SIGKILL -u "$username" 2>/dev/null || true
        _du_log "INFO" "Sessions terminated for $username"
    else
        _du_log "DRY" "Would kill all sessions for $username"
    fi

    # 4. Update GECOS comment with audit trail
    local current_comment; current_comment=$(getent passwd "$username" | cut -d: -f5)
    local suffix="[DISABLED:$(date +%Y-%m-%d):${SUDO_USER:-root}:${reason}]"
    local new_comment="${current_comment} ${suffix}"
    # GECOS field is limited to 255 chars
    _du_dry usermod -c "${new_comment:0:255}" "$username"

    _du_log "OK" "DISABLED: $username — by=${SUDO_USER:-root} reason=$reason uid=$uid"

    # 5. Notify admin
    [[ "${DRY_RUN:-false}" != "true" ]] && _du_notify_admin "$username" "$reason"

    return 0
}

# ── Main entry point ──────────────────────────────────────────────────────────
run_disable_users() {
    local target="${1:?username or CSV file required}"
    local reason="${2:-Offboarding}"

    [[ $EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }
    [[ "${DRY_RUN:-false}" == "true" ]] && _du_log "WARN" "=== DRY-RUN MODE — no system changes ==="

    local disabled=0 failed=0

    if [[ -f "$target" ]]; then
        _du_log "INFO" "━━━ Bulk disable from CSV: $target"
        while IFS=',' read -r username _rest; do
            username="${username//$'\r'/}"; username="${username// /}"
            [[ -z "$username" || "$username" == "username" || "$username" =~ ^# ]] && continue
            if _du_disable_user "$username" "$reason"; then
                disabled=$((disabled + 1))
            else
                failed=$((failed + 1))
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

    echo ""
    echo "╔═══════════════════════════════════════╗"
    echo "║       Disable Users Summary           ║"
    echo "╠═══════════════════════════════════════╣"
    printf "║  %-18s : %-14s ║\n" "Disabled" "$disabled"
    printf "║  %-18s : %-14s ║\n" "Failed" "$failed"
    echo "╚═══════════════════════════════════════╝"
    echo ""

    _du_log "INFO" "━━━ Disable done — disabled=$disabled failed=$failed"
    [[ $failed -eq 0 ]]
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    DRY_RUN=false
    REASON="Offboarding"
    TARGET=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)       DRY_RUN=true ;;
            --reason)        shift; REASON="${1:?Reason text required}" ;;
            --help|-h)
                echo "Usage: $0 [--dry-run] [--reason TEXT] <username|csv_file>"
                echo ""
                echo "  --dry-run       Show what would happen without making changes"
                echo "  --reason TEXT   Reason for disabling (logged in GECOS)"
                echo ""
                echo "  <username>      Single username to disable"
                echo "  <csv_file>      CSV file with usernames in first column"
                exit 0 ;;
            -*)              echo "[ERROR] Unknown flag: $1" >&2; exit 1 ;;
            *)               TARGET="$1" ;;
        esac
        shift
    done

    [[ -n "$TARGET" ]] || { echo "Usage: $0 [--dry-run] [--reason TEXT] <username|csv_file>"; exit 1; }
    run_disable_users "$TARGET" "$REASON"
fi
