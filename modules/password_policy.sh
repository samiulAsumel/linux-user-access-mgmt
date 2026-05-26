#!/usr/bin/env bash
# modules/password_policy.sh — Enforce password policy via PAM and chage
# Usage: ./modules/password_policy.sh [--dry-run] [--user USER | --all]
# Configures: /etc/security/pwquality.conf, /etc/pam.d/system-auth, chage
# shellcheck shell=bash
set -euo pipefail

_pp_load_config() {
    local cfg
    cfg="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "${LOG_FILE:-}" ]] && _pp_load_config

_pp_log() {
    local level="$1"; shift
    local ts; ts=$(date '+%Y-%m-%d %H:%M:%S')
    local msg="[$ts] [$level] [PASSWORD_POLICY] $*"
    echo "$msg"
    echo "$msg" >> "${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_pp_dry() {
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        _pp_log "DRY" "Would run: $*"
        return 0
    fi
    "$@"
}

# ── Configure PAM pwquality ───────────────────────────────────────────────────
run_configure_pwquality() {
    local pwq_conf="/etc/security/pwquality.conf"

    _pp_log "INFO" "Configuring pwquality: $pwq_conf"

    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        [[ -f "$pwq_conf" ]] && cp "$pwq_conf" "${pwq_conf}.bak.$(date +%Y%m%d%H%M%S)"
    fi

    local min_len="${PASS_MIN_LEN:-12}"

    local pwq_content="# /etc/security/pwquality.conf
# Managed by linux-user-access-mgmt — $(date '+%Y-%m-%d %H:%M:%S')
# Manual edits will be overwritten on next policy run.

# Minimum password length
minlen = ${min_len}

# Minimum number of character class changes (uppercase, lowercase, digit, special)
minclass = 4

# Maximum number of consecutive same characters
maxrepeat = 3

# Maximum number of consecutive characters from same class
maxclassrepeat = 4

# Ensure at least 1 digit
dcredit = -1

# Ensure at least 1 uppercase
ucredit = -1

# Ensure at least 1 lowercase
lcredit = -1

# Ensure at least 1 special character
ocredit = -1

# Reject passwords based on dictionary words
dictcheck = 1

# Reject passwords containing the username
usercheck = 1

# Number of recent passwords to remember (managed in /etc/security/opasswd)
# (set in PAM pam_pwhistory.so)
"

    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        _pp_log "DRY" "Would write pwquality config to $pwq_conf"
        echo "--- Preview ---"
        echo "$pwq_content"
        echo "--- End Preview ---"
    else
        echo "$pwq_content" > "$pwq_conf"
        chmod 644 "$pwq_conf"
        _pp_log "OK" "pwquality configured: minlen=$min_len dcredit=-1 ucredit=-1 lcredit=-1 ocredit=-1"
    fi
}

# ── Apply chage aging policy to a single user ─────────────────────────────────
_pp_apply_aging() {
    local username="${1:?username required}"

    if ! id "$username" &>/dev/null; then
        _pp_log "ERROR" "User '$username' does not exist"
        return 1
    fi

    # Skip system users
    local uid; uid=$(id -u "$username")
    [[ $uid -lt "${SYSTEM_UID_MIN:-1000}" ]] && return 0

    _pp_log "INFO" "Applying aging policy to $username (min=${PASS_MIN_DAYS:-1} max=${PASS_MAX_DAYS:-90} warn=${PASS_WARN_DAYS:-14} inactive=${PASS_INACTIVE_DAYS:-30})"

    _pp_dry chage \
        -m "${PASS_MIN_DAYS:-1}" \
        -M "${PASS_MAX_DAYS:-90}" \
        -W "${PASS_WARN_DAYS:-14}" \
        -I "${PASS_INACTIVE_DAYS:-30}" \
        "$username"

    _pp_log "OK" "Password aging set for: $username"
}

# ── Apply aging policy to all regular users ───────────────────────────────────
run_apply_aging_all() {
    [[ $EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }

    _pp_log "INFO" "━━━ Applying password aging to all regular users"
    [[ "${DRY_RUN:-false}" == "true" ]] && _pp_log "WARN" "=== DRY-RUN MODE ==="

    local applied=0 skipped=0

    while IFS=: read -r username _ uid _ _ home shell; do
        [[ $uid -lt "${SYSTEM_UID_MIN:-1000}" ]] && continue
        [[ "$shell" == "/sbin/nologin" || "$shell" == "/bin/false" ]] && continue
        if _pp_apply_aging "$username"; then
            applied=$((applied+1))
        else
            skipped=$((skipped+1))
        fi
    done < /etc/passwd

    echo ""
    echo "╔══════════════════════════════════════════════╗"
    echo "║       Password Policy Applied                ║"
    echo "╠══════════════════════════════════════════════╣"
    printf "║  %-22s : %-18s ║\n" "Users updated" "$applied"
    printf "║  %-22s : %-18s ║\n" "Skipped" "$skipped"
    printf "║  %-22s : %-18s ║\n" "Max age (days)" "${PASS_MAX_DAYS:-90}"
    printf "║  %-22s : %-18s ║\n" "Warn period (days)" "${PASS_WARN_DAYS:-14}"
    printf "║  %-22s : %-18s ║\n" "Inactive lockout" "${PASS_INACTIVE_DAYS:-30}"
    echo "╚══════════════════════════════════════════════╝"
    echo ""

    _pp_log "INFO" "━━━ Policy applied — updated=$applied skipped=$skipped"
}

# ── Show current chage info for a user ────────────────────────────────────────
run_show_aging() {
    local username="${1:?username required}"
    id "$username" &>/dev/null || { echo "[ERROR] User '$username' not found"; exit 1; }
    echo ""
    echo "  Password aging for: $username"
    echo "  ─────────────────────────────────"
    chage -l "$username" | while read -r line; do
        echo "  $line"
    done
    echo ""
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    DRY_RUN=false
    ACTION=""
    TARGET=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)     DRY_RUN=true ;;
            --all)         ACTION="all" ;;
            --pwquality)   ACTION="pwquality" ;;
            --user)        shift; TARGET="${1:?username required}"; ACTION="user" ;;
            --show)        shift; run_show_aging "${1:?username required}"; exit 0 ;;
            --help|-h)
                cat <<'EOF'
Usage: password_policy.sh [--dry-run] <action>

Actions:
  --pwquality      Configure /etc/security/pwquality.conf
  --all            Apply chage aging policy to ALL regular users
  --user <name>    Apply chage aging policy to a specific user
  --show <name>    Show current password aging for a user
EOF
                exit 0 ;;
            *) echo "[ERROR] Unknown argument: $1" >&2; exit 1 ;;
        esac
        shift
    done

    case "$ACTION" in
        pwquality) run_configure_pwquality ;;
        all)       run_apply_aging_all ;;
        user)
            [[ $EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }
            _pp_apply_aging "$TARGET"
            ;;
        *)
            echo "Usage: $0 [--dry-run] --all | --pwquality | --user <name> | --show <name>"
            exit 1 ;;
    esac
fi
