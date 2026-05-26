#!/usr/bin/env bash
# ============================================================
# modules/delete_users.sh — Permanently remove a user account
# Linux User & Access Management Automation  v1.0.0
# Usage : ./modules/delete_users.sh [OPTIONS] <username>
# WARNING: Destructive. Home directory is backed up by default.
# ============================================================
# shellcheck shell=bash
# shellcheck source=../config.conf
set -euo pipefail

_delu_load_config() {
    local cfg
    cfg="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    # shellcheck disable=SC1091
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "${LOG_FILE:-}" ]] && _delu_load_config

_delu_log() {
    local level="$1"; shift
    local ts msg
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    msg="[$ts] [$level] [DELETE_USERS] $*"
    printf '%s\n' "$msg"
    printf '%s\n' "$msg" >> "${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_delu_dry() {
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        _delu_log "DRY" "Would run: $*"
        return 0
    fi
    "$@"
}

# ── Delete a single user ──────────────────────────────────────────────────────
_delu_delete_user() {
    local username="${1:?username required}"
    local remove_home="${2:-false}"
    local backup_home="${3:-true}"

    # Validate user exists
    if ! id "$username" &>/dev/null; then
        _delu_log "ERROR" "User '$username' does not exist"
        return 1
    fi

    # Safety: refuse to delete system accounts (UID below threshold)
    local uid
    uid=$(id -u "$username")
    if [[ $uid -lt ${SYSTEM_UID_MIN:-1000} ]]; then
        _delu_log "ERROR" "Refusing to delete system user '$username' (UID=$uid < ${SYSTEM_UID_MIN:-1000})"
        return 1
    fi

    # Safety: refuse to delete the user running the script
    local running_user="${SUDO_USER:-$(logname 2>/dev/null || true)}"
    if [[ -n "$running_user" && "$username" == "$running_user" ]]; then
        _delu_log "ERROR" "Refusing to delete the currently logged-in user '$username'"
        return 1
    fi

    local home_dir
    home_dir=$(getent passwd "$username" | cut -d: -f6)
    _delu_log "INFO" "Preparing to delete: $username | UID=$uid | home=$home_dir"

    # ── Backup home directory ──────────────────────────────────────────────────
    if [[ "$backup_home" == "true" && -d "${home_dir:-}" ]]; then
        if [[ "${DRY_RUN:-false}" != "true" ]]; then
            local backup_dir="/var/backup/usermgmt/homes"
            local backup_file
            backup_file="${backup_dir}/${username}_$(date +%Y%m%d_%H%M%S).tar.gz"
            mkdir -p "$backup_dir"
            chmod 700 "$backup_dir"
            if tar -czf "$backup_file" \
                    -C "$(dirname "$home_dir")" \
                    "$(basename "$home_dir")" 2>/dev/null; then
                chmod 600 "$backup_file"
                _delu_log "INFO" "Home directory archived → $backup_file"
            else
                _delu_log "WARN" "Home directory backup failed — continuing with deletion"
            fi
        else
            _delu_log "DRY" "Would archive $home_dir → /var/backup/usermgmt/homes/${username}_<ts>.tar.gz"
        fi
    fi

    # ── Terminate active sessions ──────────────────────────────────────────────
    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        pkill -SIGTERM -u "$username" 2>/dev/null || true
        sleep 1
        pkill -SIGKILL -u "$username" 2>/dev/null || true
    else
        _delu_log "DRY" "Would terminate all sessions for $username"
    fi

    # ── Remove the account ─────────────────────────────────────────────────────
    if [[ "$remove_home" == "true" ]]; then
        _delu_dry userdel -r "$username"
    else
        _delu_dry userdel "$username"
    fi

    _delu_log "OK" "DELETED: $username (UID=$uid) by=${SUDO_USER:-root} remove_home=$remove_home backup=$backup_home"
    return 0
}

# ── Main entry point ──────────────────────────────────────────────────────────
run_delete_user() {
    local username="${1:?username required}"
    local remove_home="${REMOVE_HOME:-false}"
    local backup_home="${BACKUP_HOME:-true}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\n' >&2; exit 1; }
    [[ "${DRY_RUN:-false}" == "true" ]] && _delu_log "WARN" "=== DRY-RUN MODE — no system changes ==="

    # Interactive confirmation when not in dry-run
    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        printf '\n'
        printf '  ⚠  WARNING: Deleting user '\''%s'\'' is PERMANENT.\n' "$username"
        [[ "$backup_home" == "true" ]] \
            && printf '  Home directory will be archived before deletion.\n'
        [[ "$remove_home" == "true" ]] \
            && printf '  Home directory WILL BE REMOVED after archiving.\n'
        printf '\n'
        local confirm
        read -r -p "  Type the username to confirm: " confirm
        if [[ "$confirm" != "$username" ]]; then
            printf '  Confirmation mismatch — aborting.\n'
            exit 1
        fi
    fi

    _delu_delete_user "$username" "$remove_home" "$backup_home"
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    DRY_RUN=false
    REMOVE_HOME=false
    BACKUP_HOME=true
    USERNAME=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)     DRY_RUN=true ;;
            --remove-home) REMOVE_HOME=true ;;
            --no-backup)   BACKUP_HOME=false ;;
            --help|-h)
                printf 'Usage: %s [OPTIONS] <username>\n\n' "$0"
                printf 'Options:\n'
                printf '  --dry-run       Simulate (no changes)\n'
                printf '  --remove-home   Also delete home directory (backup first by default)\n'
                printf '  --no-backup     Skip home directory backup (dangerous!)\n'
                printf '  --help          Show this help\n\n'
                printf 'Default backup path: /var/backup/usermgmt/homes/\n\n'
                printf 'Example:\n'
                printf '  sudo %s --remove-home jsmith\n' "$0"
                exit 0 ;;
            -*)
                printf '[ERROR] Unknown flag: %s\n' "$1" >&2; exit 1 ;;
            *)
                USERNAME="$1" ;;
        esac
        shift
    done

    [[ -n "$USERNAME" ]] || {
        printf 'Usage: %s [--dry-run] [--remove-home] [--no-backup] <username>\n' "$0" >&2
        exit 1
    }

    export DRY_RUN REMOVE_HOME BACKUP_HOME
    run_delete_user "$USERNAME"
fi
