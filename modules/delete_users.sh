#!/usr/bin/env bash
# modules/delete_users.sh — Permanently remove a user account
# Usage: ./modules/delete_users.sh [--dry-run] [--remove-home] [--no-backup] <username>
# WARNING: This is destructive. Home backup is performed by default.
# shellcheck shell=bash
set -euo pipefail

_delu_load_config() {
    local cfg
    cfg="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "${LOG_FILE:-}" ]] && _delu_load_config

_delu_log() {
    local level="$1"; shift
    local ts; ts=$(date '+%Y-%m-%d %H:%M:%S')
    local msg="[$ts] [$level] [DELETE_USERS] $*"
    echo "$msg"
    echo "$msg" >> "${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
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

    # Safety: refuse to delete system accounts
    local uid; uid=$(id -u "$username")
    if [[ $uid -lt "${SYSTEM_UID_MIN:-1000}" ]]; then
        _delu_log "ERROR" "Refusing to delete system user '$username' (UID=$uid < ${SYSTEM_UID_MIN:-1000})"
        return 1
    fi

    # Safety: refuse to delete the current user running the script
    if [[ "$username" == "${SUDO_USER:-}" || "$username" == "$(logname 2>/dev/null || true)" ]]; then
        _delu_log "ERROR" "Refusing to delete the currently logged-in user '$username'"
        return 1
    fi

    local home_dir; home_dir=$(getent passwd "$username" | cut -d: -f6)
    _delu_log "INFO" "Deleting: $username | UID=$uid | home=$home_dir"

    # Backup home directory before deletion
    if [[ "$backup_home" == "true" && -d "${home_dir:-}" && "${DRY_RUN:-false}" != "true" ]]; then
        local backup_dir="/var/backup/usermgmt/homes"
        local backup_file="${backup_dir}/${username}_$(date +%Y%m%d_%H%M%S).tar.gz"
        mkdir -p "$backup_dir"
        chmod 700 "$backup_dir"
        if tar -czf "$backup_file" -C "$(dirname "$home_dir")" "$(basename "$home_dir")" 2>/dev/null; then
            chmod 600 "$backup_file"
            _delu_log "INFO" "Home directory archived: $backup_file"
        else
            _delu_log "WARN" "Home backup failed — proceeding with deletion anyway"
        fi
    elif [[ "${DRY_RUN:-false}" == "true" && "$backup_home" == "true" ]]; then
        _delu_log "DRY" "Would archive home directory $home_dir to /var/backup/usermgmt/homes/"
    fi

    # Terminate all active sessions
    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        pkill -SIGTERM -u "$username" 2>/dev/null || true
        sleep 1
        pkill -SIGKILL -u "$username" 2>/dev/null || true
    else
        _delu_log "DRY" "Would terminate sessions for $username"
    fi

    # Remove the user account
    local userdel_args=()
    [[ "$remove_home" == "true" ]] && userdel_args+=("-r")
    _delu_dry userdel "${userdel_args[@]}" "$username"

    _delu_log "OK" "DELETED: $username (UID=$uid) by=${SUDO_USER:-root} remove_home=$remove_home backup=$backup_home"
    return 0
}

# ── Main entry point ──────────────────────────────────────────────────────────
run_delete_user() {
    local username="${1:?username required}"
    local remove_home="${REMOVE_HOME:-false}"
    local backup_home="${BACKUP_HOME:-true}"

    [[ $EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }
    [[ "${DRY_RUN:-false}" == "true" ]] && _delu_log "WARN" "=== DRY-RUN MODE — no system changes ==="

    # Extra confirmation when actually deleting (not dry-run)
    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        echo ""
        echo "  ⚠  WARNING: Deleting user '$username' is PERMANENT."
        [[ "$backup_home" == "true" ]] && echo "  Home directory will be backed up first."
        [[ "$remove_home" == "true" ]] && echo "  Home directory WILL BE REMOVED."
        read -r -p "  Type the username to confirm deletion: " confirm
        if [[ "$confirm" != "$username" ]]; then
            echo "  Confirmation failed — aborting."
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
                echo "Usage: $0 [OPTIONS] <username>"
                echo ""
                echo "  --dry-run       Show what would happen (no changes)"
                echo "  --remove-home   Also delete the home directory"
                echo "  --no-backup     Skip home directory backup (dangerous)"
                echo ""
                echo "  Home backup default path: /var/backup/usermgmt/homes/"
                exit 0 ;;
            -*)  echo "[ERROR] Unknown flag: $1" >&2; exit 1 ;;
            *)   USERNAME="$1" ;;
        esac
        shift
    done

    [[ -n "$USERNAME" ]] || { echo "Usage: $0 [--dry-run] [--remove-home] [--no-backup] <username>"; exit 1; }
    run_delete_user "$USERNAME"
fi
