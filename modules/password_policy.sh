#!/usr/bin/env bash
# ============================================================
# modules/password_policy.sh — Enforce password policies
# Linux User & Access Management Automation  v1.0.0
# Configures: /etc/security/pwquality.conf and chage aging
# Usage : ./modules/password_policy.sh [--dry-run] <action>
# ============================================================
# shellcheck shell=bash
# shellcheck source=../config.conf
set -euo pipefail

_pp_load_config() {
    local cfg
    cfg="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    # shellcheck disable=SC1091
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "${LOG_FILE:-}" ]] && _pp_load_config

_pp_log() {
    local level="$1"; shift
    local ts msg
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    msg="[$ts] [$level] [PASS_POLICY] $*"
    printf '%s\n' "$msg"
    printf '%s\n' "$msg" >> "${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_pp_dry() {
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        _pp_log "DRY" "Would run: $*"
        return 0
    fi
    "$@"
}

# ── Write /etc/security/pwquality.conf ───────────────────────────────────────
run_configure_pwquality() {
    local pwq_conf="/etc/security/pwquality.conf"
    local min_len="${PASS_MIN_LEN:-12}"

    _pp_log "INFO" "Configuring PAM pwquality: $pwq_conf (minlen=$min_len)"

    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        # Back up existing config
        if [[ -f "$pwq_conf" ]]; then
            # SC2155 fix: separate declare and assign
            local bak
            bak="${pwq_conf}.bak.$(date +%Y%m%d%H%M%S)"
            cp "$pwq_conf" "$bak"
            _pp_log "INFO" "Backed up existing config → $bak"
        fi
    fi

    # Build config content
    local pwq_content
    pwq_content="$(cat <<EOF
# /etc/security/pwquality.conf
# Managed by linux-user-access-mgmt — $(date '+%Y-%m-%d %H:%M:%S')
# Manual edits will be overwritten on next policy run.

# Minimum password length
minlen = ${min_len}

# Require at least one of each character class (negative = minimum count)
dcredit  = -1      # digits
ucredit  = -1      # uppercase
lcredit  = -1      # lowercase
ocredit  = -1      # special/other characters

# Minimum number of distinct character classes
minclass = 4

# Reject excessively repetitive passwords
maxrepeat      = 3
maxclassrepeat = 4

# Reject passwords based on the user's username
usercheck = 1

# Check against a dictionary of common passwords
dictcheck = 1
EOF
)"

    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        _pp_log "DRY" "Would write pwquality.conf:"
        printf '%s\n' "$pwq_content" | while IFS= read -r line; do
            _pp_log "DRY" "  $line"
        done
    else
        printf '%s\n' "$pwq_content" > "$pwq_conf"
        chmod 644 "$pwq_conf"
        _pp_log "OK" "pwquality.conf written: minlen=$min_len dcredit=-1 ucredit=-1 lcredit=-1 ocredit=-1"
    fi
}

# ── Apply chage aging policy to one user ─────────────────────────────────────
_pp_apply_aging() {
    local username="${1:?username required}"

    if ! id "$username" &>/dev/null; then
        _pp_log "ERROR" "User '$username' does not exist"
        return 1
    fi

    # Skip system users silently
    local uid
    uid=$(id -u "$username")
    [[ $uid -lt ${SYSTEM_UID_MIN:-1000} ]] && return 0

    _pp_log "INFO" "Aging policy → $username (min=${PASS_MIN_DAYS:-1} max=${PASS_MAX_DAYS:-90} warn=${PASS_WARN_DAYS:-14} inactive=${PASS_INACTIVE_DAYS:-30})"

    _pp_dry chage \
        -m "${PASS_MIN_DAYS:-1}" \
        -M "${PASS_MAX_DAYS:-90}" \
        -W "${PASS_WARN_DAYS:-14}" \
        -I "${PASS_INACTIVE_DAYS:-30}" \
        "$username"

    _pp_log "OK" "Aging applied: $username"
}

# ── Apply aging to ALL regular users ─────────────────────────────────────────
run_apply_aging_all() {
    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\n' >&2; exit 1; }
    _pp_log "INFO" "━━━ Applying aging policy to all regular users"
    [[ "${DRY_RUN:-false}" == "true" ]] && _pp_log "WARN" "=== DRY-RUN MODE ==="

    local applied=0 skipped=0

    while IFS=: read -r username _ uid _ _ _home shell; do
        [[ $uid -lt ${SYSTEM_UID_MIN:-1000} ]] && continue
        [[ "$shell" == "/sbin/nologin" || "$shell" == "/bin/false" ]] && {
            skipped=$(( skipped + 1 ))
            continue
        }
        if _pp_apply_aging "$username"; then
            applied=$(( applied + 1 ))
        else
            skipped=$(( skipped + 1 ))
        fi
    done < /etc/passwd

    printf '\n'
    printf '╔══════════════════════════════════════════════════╗\n'
    printf '║       Password Aging Policy Applied              ║\n'
    printf '╠══════════════════════════════════════════════════╣\n'
    printf '║  %-24s : %-20s ║\n' "Users updated" "$applied"
    printf '║  %-24s : %-20s ║\n' "Skipped" "$skipped"
    printf '║  %-24s : %-20s ║\n' "Max age (days)" "${PASS_MAX_DAYS:-90}"
    printf '║  %-24s : %-20s ║\n' "Warn period (days)" "${PASS_WARN_DAYS:-14}"
    printf '║  %-24s : %-20s ║\n' "Inactive lockout" "${PASS_INACTIVE_DAYS:-30}"
    printf '╚══════════════════════════════════════════════════╝\n'
    printf '\n'
    _pp_log "INFO" "━━━ Policy applied — updated=$applied skipped=$skipped"
}

# ── Show current chage info ───────────────────────────────────────────────────
run_show_aging() {
    local username="${1:?username required}"
    id "$username" &>/dev/null || { printf '[ERROR] User '\''%s'\'' not found\n' "$username"; exit 1; }
    printf '\n  Password aging for: %s\n' "$username"
    printf '  ──────────────────────────────────────────\n'
    chage -l "$username" | while IFS= read -r line; do
        printf '  %s\n' "$line"
    done
    printf '\n'
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    DRY_RUN=false
    ACTION=""
    TARGET=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)   DRY_RUN=true ;;
            --all)       ACTION="all" ;;
            --pwquality) ACTION="pwquality" ;;
            --user)
                shift
                TARGET="${1:?username required after --user}"
                ACTION="user"
                ;;
            --show)
                shift
                run_show_aging "${1:?username required after --show}"
                exit 0 ;;
            --help|-h)
                cat <<'HELP'
Usage: password_policy.sh [--dry-run] <action>

Actions:
  --pwquality          Configure /etc/security/pwquality.conf (PAM)
  --all                Apply chage aging to ALL regular users
  --user <name>        Apply chage aging to a specific user
  --show <name>        Display current chage settings for a user

Options:
  --dry-run            Simulate without making changes
  --help               Show this help

Examples:
  sudo ./password_policy.sh --pwquality
  sudo ./password_policy.sh --all
  sudo ./password_policy.sh --user jsmith
  ./password_policy.sh --show jsmith
HELP
                exit 0 ;;
            *)
                printf '[ERROR] Unknown argument: %s\n' "$1" >&2; exit 1 ;;
        esac
        shift
    done

    export DRY_RUN

    case "$ACTION" in
        pwquality) run_configure_pwquality ;;
        all)       run_apply_aging_all ;;
        user)
            [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\n' >&2; exit 1; }
            _pp_apply_aging "$TARGET"
            ;;
        *)
            printf 'Usage: %s [--dry-run] --all | --pwquality | --user <name> | --show <name>\n' "$0" >&2
            exit 1 ;;
    esac
fi
