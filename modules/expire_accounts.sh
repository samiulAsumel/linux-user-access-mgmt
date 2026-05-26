#!/usr/bin/env bash
# ============================================================
# modules/expire_accounts.sh — Account expiry management
# Linux User & Access Management Automation  v1.0.0
# Usage : ./modules/expire_accounts.sh [OPTIONS] <action>
# Designed to run weekly via systemd timer or cron.
# ============================================================
# shellcheck shell=bash
# shellcheck source=../config.conf
set -euo pipefail

_ea_load_config() {
    local cfg
    cfg="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    # shellcheck disable=SC1091
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "${LOG_FILE:-}" ]] && _ea_load_config

_ea_log() {
    local level="$1"; shift
    local ts msg
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    msg="[$ts] [$level] [EXPIRE_ACCTS] $*"
    printf '%s\n' "$msg"
    printf '%s\n' "$msg" >> "${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_ea_dry() {
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        _ea_log "DRY" "Would run: $*"
        return 0
    fi
    "$@"
}

# ── Get account expiry as Unix epoch (-1 = never) ────────────────────────────
_ea_expiry_epoch() {
    local username="$1"
    local expiry
    expiry=$(chage -l "$username" 2>/dev/null | grep "Account expires" | awk -F': ' '{print $2}')
    if [[ -z "$expiry" || "$expiry" == "never" ]]; then
        printf '%s' "-1"
        return
    fi
    local ep
    ep=$(date -d "$expiry" +%s 2>/dev/null || printf '%s' "-1")
    printf '%s' "$ep"
}

# ── Scan and act on all accounts ─────────────────────────────────────────────
run_expire_accounts() {
    local warn_only="${WARN_ONLY:-false}"
    local now warn_epoch
    now=$(date +%s)
    warn_epoch=$(( now + ( ${EXPIRY_WARN_DAYS:-30} * 86400 ) ))

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\n' >&2; exit 1; }

    _ea_log "INFO" "━━━ Account expiry scan (warn_days=${EXPIRY_WARN_DAYS:-30} auto_disable=${AUTO_DISABLE_EXPIRED:-true})"
    [[ "${DRY_RUN:-false}" == "true" ]] && _ea_log "WARN" "=== DRY-RUN MODE ==="

    local expired_count=0 warning_count=0 disabled_count=0
    local -a expiry_report=()

    while IFS=: read -r username _ uid _ _ _home shell; do
        [[ $uid -lt ${SYSTEM_UID_MIN:-1000} ]] && continue
        [[ "$shell" == "/sbin/nologin" || "$shell" == "/bin/false" ]] && continue

        local exp_epoch
        exp_epoch=$(_ea_expiry_epoch "$username")
        [[ "$exp_epoch" == "-1" ]] && continue    # No expiry configured

        local exp_date days_until
        exp_date=$(chage -l "$username" 2>/dev/null | grep "Account expires" | awk -F': ' '{print $2}')
        days_until=$(( ( exp_epoch - now ) / 86400 ))

        if [[ $exp_epoch -le $now ]]; then
            expired_count=$(( expired_count + 1 ))
            _ea_log "WARN" "EXPIRED: $username (expiry: $exp_date, ${days_until}d ago)"
            expiry_report+=( "EXPIRED|${username}|${exp_date}|${days_until}" )

            if [[ "${AUTO_DISABLE_EXPIRED:-true}" == "true" && "$warn_only" != "true" ]]; then
                local pw_status
                pw_status=$(passwd -S "$username" 2>/dev/null | awk '{print $2}')
                if [[ "$pw_status" != "L" && "$pw_status" != "LK" ]]; then
                    _ea_log "INFO" "Auto-disabling expired account: $username"
                    _ea_dry usermod -L "$username"
                    if [[ "${DRY_RUN:-false}" != "true" ]]; then
                        pkill -SIGTERM -u "$username" 2>/dev/null || true
                    fi
                    _ea_log "OK" "DISABLED: $username (expired $exp_date)"
                    disabled_count=$(( disabled_count + 1 ))
                else
                    _ea_log "INFO" "Account '$username' already locked — skipping auto-disable"
                fi
            fi

        elif [[ $exp_epoch -le $warn_epoch ]]; then
            warning_count=$(( warning_count + 1 ))
            _ea_log "INFO" "EXPIRING SOON: $username in ${days_until}d (expiry: $exp_date)"
            expiry_report+=( "WARNING|${username}|${exp_date}|${days_until}" )
        fi

    done < /etc/passwd

    # ── Summary ────────────────────────────────────────────────────────────────
    printf '\n'
    printf '╔════════════════════════════════════════════════════╗\n'
    printf '║         Account Expiry Check Summary               ║\n'
    printf '╠════════════════════════════════════════════════════╣\n'
    printf '║  %-28s : %-18s ║\n' "Expired accounts" "$expired_count"
    printf '║  %-28s : %-18s ║\n' "Expiring within ${EXPIRY_WARN_DAYS:-30}d" "$warning_count"
    printf '║  %-28s : %-18s ║\n' "Auto-disabled" "$disabled_count"
    printf '╚════════════════════════════════════════════════════╝\n'

    if [[ ${#expiry_report[@]} -gt 0 ]]; then
        printf '\n  Account Expiry Details:\n'
        printf '  ─────────────────────────────────────────────────────\n'
        printf '  %-10s %-20s %-15s %s\n' "STATUS" "Username" "Expiry" "Days"
        printf '  ─────────────────────────────────────────────────────\n'
        local entry status uname exp_d days
        for entry in "${expiry_report[@]}"; do
            IFS='|' read -r status uname exp_d days <<< "$entry"
            printf '  %-10s %-20s %-15s %s\n' "$status" "$uname" "$exp_d" "${days}d"
        done
    fi
    printf '\n'

    # Email summary if configured and something noteworthy occurred
    local total_notable=$(( expired_count + warning_count ))
    if [[ "${SEND_REPORT_EMAIL:-false}" == "true" ]] \
    && [[ -n "${ADMIN_EMAIL:-}" ]] \
    && [[ $total_notable -gt 0 ]] \
    && command -v mail &>/dev/null; then
        {
            printf 'Account Expiry Report — %s\n' "$(date '+%Y-%m-%d')"
            printf 'Expired: %d  |  Expiring Soon: %d  |  Auto-disabled: %d\n\n' \
                "$expired_count" "$warning_count" "$disabled_count"
            local e s u d di
            for e in "${expiry_report[@]}"; do
                IFS='|' read -r s u d di <<< "$e"
                printf '%-10s  %-20s  expiry=%-15s  days=%s\n' "$s" "$u" "$d" "$di"
            done
        } | mail -s "[UserMgmt] Account Expiry Report — $(date +%Y-%m-%d)" "${ADMIN_EMAIL}" 2>/dev/null || true
        _ea_log "INFO" "Expiry report emailed to $ADMIN_EMAIL"
    fi

    _ea_log "INFO" "━━━ Scan done — expired=$expired_count warning=$warning_count disabled=$disabled_count"
}

# ── Set a specific expiry date ────────────────────────────────────────────────
run_set_expiry() {
    local username="${1:?username required}"
    local expiry_date="${2:?expiry date required (YYYY-MM-DD or 'never')}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\n' >&2; exit 1; }
    id "$username" &>/dev/null || { printf '[ERROR] User '\''%s'\'' not found\n' "$username"; exit 1; }

    if [[ "$expiry_date" == "never" ]]; then
        _ea_dry chage -E -1 "$username"
        _ea_log "OK" "Expiry cleared (never expires) for $username"
    else
        date -d "$expiry_date" &>/dev/null 2>&1 \
            || { printf '[ERROR] Invalid date: %s\n' "$expiry_date"; exit 1; }
        _ea_dry chage -E "$expiry_date" "$username"
        _ea_log "OK" "Expiry set → $expiry_date for $username"
    fi
}

# ── Extend account expiry by N days ──────────────────────────────────────────
run_extend_expiry() {
    local username="${1:?username required}"
    local extend_days="${2:?number of days required}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\n' >&2; exit 1; }
    id "$username" &>/dev/null || { printf '[ERROR] User '\''%s'\'' not found\n' "$username"; exit 1; }

    local current_expiry new_expiry
    current_expiry=$(chage -l "$username" 2>/dev/null | grep "Account expires" | awk -F': ' '{print $2}')

    if [[ -z "$current_expiry" || "$current_expiry" == "never" ]]; then
        new_expiry=$(date -d "+${extend_days} days" +%Y-%m-%d)
    else
        new_expiry=$(date -d "${current_expiry} +${extend_days} days" +%Y-%m-%d)
    fi

    _ea_dry chage -E "$new_expiry" "$username"
    _ea_log "OK" "Expiry extended by ${extend_days}d for $username → $new_expiry"
    printf '  New expiry: %s\n' "$new_expiry"
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    DRY_RUN=false
    WARN_ONLY=false
    ACTION="check"
    ARGS=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)   DRY_RUN=true ;;
            --warn-only) WARN_ONLY=true ;;
            check)       ACTION="check" ;;
            set-expiry)  ACTION="set-expiry" ;;
            extend)      ACTION="extend" ;;
            --help|-h)
                cat <<'HELP'
Usage: expire_accounts.sh [OPTIONS] <action> [args]

Actions:
  check                        Scan all regular users for expiry
  set-expiry <user> <date>     Set expiry to YYYY-MM-DD (or 'never')
  extend     <user> <days>     Extend current expiry by N days

Options:
  --dry-run    Show what would happen without making changes
  --warn-only  Log warnings but do NOT auto-disable expired accounts
  --help       Show this help

Examples:
  sudo ./expire_accounts.sh check
  sudo ./expire_accounts.sh --dry-run check
  sudo ./expire_accounts.sh set-expiry jsmith 2026-12-31
  sudo ./expire_accounts.sh extend acontractor 90
HELP
                exit 0 ;;
            *)
                ARGS+=("$1") ;;
        esac
        shift
    done

    export DRY_RUN WARN_ONLY

    case "$ACTION" in
        check)      run_expire_accounts ;;
        set-expiry) run_set_expiry "${ARGS[@]}" ;;
        extend)     run_extend_expiry "${ARGS[@]}" ;;
        *)
            printf 'Usage: %s [--dry-run] [--warn-only] check|set-expiry|extend [args]\n' "$0" >&2
            exit 1 ;;
    esac
fi
