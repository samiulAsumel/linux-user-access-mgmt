#!/usr/bin/env bash
# modules/expire_accounts.sh — Check and auto-disable accounts past their expiry
# Usage: ./modules/expire_accounts.sh [--dry-run] [--warn-only] [--report]
# Designed to run weekly via cron or systemd timer.
# shellcheck shell=bash
set -euo pipefail

_ea_load_config() {
    local cfg
    cfg="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "${LOG_FILE:-}" ]] && _ea_load_config

_ea_log() {
    local level="$1"; shift
    local ts; ts=$(date '+%Y-%m-%d %H:%M:%S')
    local msg="[$ts] [$level] [EXPIRE_ACCTS] $*"
    echo "$msg"
    echo "$msg" >> "${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_ea_dry() {
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        _ea_log "DRY" "Would run: $*"
        return 0
    fi
    "$@"
}

# ── Get account expiry epoch ──────────────────────────────────────────────────
_ea_expiry_epoch() {
    local username="$1"
    local expiry; expiry=$(chage -l "$username" 2>/dev/null | grep "Account expires" | awk -F': ' '{print $2}')
    if [[ -z "$expiry" || "$expiry" == "never" ]]; then
        echo ""
        return
    fi
    date -d "$expiry" +%s 2>/dev/null || echo ""
}

# ── Check all accounts for expiry ────────────────────────────────────────────
run_expire_accounts() {
    local warn_only="${WARN_ONLY:-false}"
    local now; now=$(date +%s)
    local warn_epoch; warn_epoch=$((now + (${EXPIRY_WARN_DAYS:-30} * 86400)))

    [[ $EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }

    _ea_log "INFO" "━━━ Checking account expiry (warn_days=${EXPIRY_WARN_DAYS:-30} auto_disable=${AUTO_DISABLE_EXPIRED:-true})"
    [[ "${DRY_RUN:-false}" == "true" ]] && _ea_log "WARN" "=== DRY-RUN MODE ==="

    local expired_count=0
    local warning_count=0
    local disabled_count=0
    local expiry_report=()

    while IFS=: read -r username _ uid _ _ home shell; do
        [[ $uid -lt "${SYSTEM_UID_MIN:-1000}" ]] && continue
        [[ "$shell" == "/sbin/nologin" || "$shell" == "/bin/false" ]] && continue

        local exp_epoch; exp_epoch=$(_ea_expiry_epoch "$username")
        [[ -z "$exp_epoch" ]] && continue   # No expiry set

        local exp_date; exp_date=$(chage -l "$username" 2>/dev/null | grep "Account expires" | awk -F': ' '{print $2}')
        local days_until=$(( (exp_epoch - now) / 86400 ))

        if [[ $exp_epoch -le $now ]]; then
            # Account has expired
            expired_count=$((expired_count + 1))
            _ea_log "WARN" "EXPIRED: $username (expiry: $exp_date, ${days_until}d ago)"
            expiry_report+=("EXPIRED|${username}|${exp_date}|${days_until}")

            if [[ "${AUTO_DISABLE_EXPIRED:-true}" == "true" && "$warn_only" != "true" ]]; then
                # Check if already locked
                local pw_status; pw_status=$(passwd -S "$username" 2>/dev/null | awk '{print $2}')
                if [[ "$pw_status" != "L" && "$pw_status" != "LK" ]]; then
                    _ea_log "INFO" "Auto-disabling expired account: $username"
                    _ea_dry usermod -L "$username"
                    _ea_dry pkill -SIGTERM -u "$username" 2>/dev/null || true
                    _ea_log "OK" "DISABLED: $username (expired $exp_date)"
                    disabled_count=$((disabled_count + 1))
                else
                    _ea_log "INFO" "Account '$username' already locked — skipping auto-disable"
                fi
            fi

        elif [[ $exp_epoch -le $warn_epoch ]]; then
            # Account expiring soon
            warning_count=$((warning_count + 1))
            _ea_log "INFO" "EXPIRING SOON: $username in ${days_until} days (expiry: $exp_date)"
            expiry_report+=("WARNING|${username}|${exp_date}|${days_until}")
        fi

    done < /etc/passwd

    echo ""
    echo "╔═══════════════════════════════════════════════════╗"
    echo "║         Account Expiry Check Summary              ║"
    echo "╠═══════════════════════════════════════════════════╣"
    printf "║  %-25s : %-18s ║\n" "Expired accounts" "$expired_count"
    printf "║  %-25s : %-18s ║\n" "Expiring within ${EXPIRY_WARN_DAYS:-30}d" "$warning_count"
    printf "║  %-25s : %-18s ║\n" "Auto-disabled" "$disabled_count"
    echo "╚═══════════════════════════════════════════════════╝"
    echo ""

    if [[ ${#expiry_report[@]} -gt 0 ]]; then
        echo "  Account Expiry Details:"
        echo "  ─────────────────────────────────────────────"
        printf "  %-10s %-20s %-15s %s\n" "STATUS" "Username" "Expiry Date" "Days"
        echo "  ─────────────────────────────────────────────"
        for entry in "${expiry_report[@]}"; do
            IFS='|' read -r status uname exp_d days <<< "$entry"
            printf "  %-10s %-20s %-15s %s\n" "$status" "$uname" "$exp_d" "${days}d"
        done
        echo ""
    fi

    # Email report if configured
    if [[ "${SEND_REPORT_EMAIL:-false}" == "true" ]] && \
       [[ -n "${ADMIN_EMAIL:-}" ]] && \
       [[ $((expired_count + warning_count)) -gt 0 ]] && \
       command -v mail &>/dev/null; then
        {
            echo "Account Expiry Report — $(date '+%Y-%m-%d')"
            echo "Expired: $expired_count  |  Expiring Soon: $warning_count  |  Auto-disabled: $disabled_count"
            echo ""
            for entry in "${expiry_report[@]}"; do
                IFS='|' read -r status uname exp_d days <<< "$entry"
                echo "$status  $uname  expiry=$exp_d  days=$days"
            done
        } | mail -s "[UserMgmt] Account Expiry Report — $(date +%Y-%m-%d)" "${ADMIN_EMAIL}" 2>/dev/null || true
        _ea_log "INFO" "Expiry report emailed to $ADMIN_EMAIL"
    fi

    _ea_log "INFO" "━━━ Expiry check done — expired=$expired_count warning=$warning_count disabled=$disabled_count"
}

# ── Set expiry for a specific account ────────────────────────────────────────
run_set_expiry() {
    local username="${1:?username required}"
    local expiry_date="${2:?expiry date required (YYYY-MM-DD or 'never')}"

    [[ $EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }

    id "$username" &>/dev/null || { echo "[ERROR] User '$username' not found"; exit 1; }

    if [[ "$expiry_date" == "never" ]]; then
        _ea_dry chage -E -1 "$username"
        _ea_log "OK" "Expiry cleared (never expires) for $username"
    else
        date -d "$expiry_date" &>/dev/null 2>&1 || { echo "[ERROR] Invalid date: $expiry_date"; exit 1; }
        _ea_dry chage -E "$expiry_date" "$username"
        _ea_log "OK" "Expiry set to $expiry_date for $username"
    fi
}

# ── Extend account expiry by N days ──────────────────────────────────────────
run_extend_expiry() {
    local username="${1:?username required}"
    local extend_days="${2:?number of days required}"

    [[ $EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }

    id "$username" &>/dev/null || { echo "[ERROR] User '$username' not found"; exit 1; }

    local current_expiry; current_expiry=$(chage -l "$username" 2>/dev/null | grep "Account expires" | awk -F': ' '{print $2}')

    local new_expiry
    if [[ -z "$current_expiry" || "$current_expiry" == "never" ]]; then
        new_expiry=$(date -d "+${extend_days} days" +%Y-%m-%d)
    else
        new_expiry=$(date -d "${current_expiry} +${extend_days} days" +%Y-%m-%d)
    fi

    _ea_dry chage -E "$new_expiry" "$username"
    _ea_log "OK" "Expiry extended by ${extend_days}d for $username → new expiry: $new_expiry"
    echo "  New expiry: $new_expiry"
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    DRY_RUN=false
    WARN_ONLY=false
    ACTION="check"
    ARGS=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)    DRY_RUN=true ;;
            --warn-only)  WARN_ONLY=true ;;
            check)        ACTION="check" ;;
            set-expiry)   ACTION="set-expiry" ;;
            extend)       ACTION="extend" ;;
            --help|-h)
                cat <<'EOF'
Usage: expire_accounts.sh [--dry-run] [--warn-only] <action> [args...]

Actions:
  check                       Scan all accounts for expiry (default)
  set-expiry <user> <date>    Set expiry date (YYYY-MM-DD) or 'never'
  extend     <user> <days>    Extend current expiry by N days

Flags:
  --dry-run    Simulate actions without making changes
  --warn-only  Log warnings but do not auto-disable expired accounts
EOF
                exit 0 ;;
            *) ARGS+=("$1") ;;
        esac
        shift
    done

    case "$ACTION" in
        check)       run_expire_accounts ;;
        set-expiry)  run_set_expiry "${ARGS[@]}" ;;
        extend)      run_extend_expiry "${ARGS[@]}" ;;
        *) echo "Usage: $0 [--dry-run] [--warn-only] check|set-expiry|extend [args]"; exit 1 ;;
    esac
fi
