#!/usr/bin/env bash
# modules/set_permissions.sh — ACL and group assignment for users/directories
# Usage: ./modules/set_permissions.sh [--dry-run] [--user USER] [--dir DIR] [--acl PERM]
# Requires: root, setfacl, getfacl (acl package)
# shellcheck shell=bash
set -euo pipefail

_sp_load_config() {
    local cfg
    cfg="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "${LOG_FILE:-}" ]] && _sp_load_config

_sp_log() {
    local level="$1"; shift
    local ts; ts=$(date '+%Y-%m-%d %H:%M:%S')
    local msg="[$ts] [$level] [SET_PERMS] $*"
    echo "$msg"
    echo "$msg" >> "${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_sp_dry() {
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        _sp_log "DRY" "Would run: $*"
        return 0
    fi
    "$@"
}

# ── Check ACL tools are available ─────────────────────────────────────────────
_sp_check_acl() {
    if ! command -v setfacl &>/dev/null; then
        _sp_log "ERROR" "setfacl not found — install: dnf install acl"
        return 1
    fi
}

# ── Add user to group ─────────────────────────────────────────────────────────
run_add_user_to_group() {
    local username="${1:?username required}"
    local group="${2:?group required}"

    [[ $EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }

    if ! id "$username" &>/dev/null; then
        _sp_log "ERROR" "User '$username' does not exist"
        return 1
    fi

    if ! getent group "$group" &>/dev/null; then
        _sp_log "INFO" "Group '$group' does not exist — creating"
        _sp_dry groupadd "$group"
    fi

    # Check if already a member
    if id -nG "$username" 2>/dev/null | grep -qw "$group"; then
        _sp_log "WARN" "User '$username' is already in group '$group'"
        return 0
    fi

    _sp_dry usermod -aG "$group" "$username"
    _sp_log "OK" "Added $username to group $group"
}

# ── Remove user from group ────────────────────────────────────────────────────
run_remove_user_from_group() {
    local username="${1:?username required}"
    local group="${2:?group required}"

    [[ $EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }

    if ! id "$username" &>/dev/null; then
        _sp_log "ERROR" "User '$username' does not exist"
        return 1
    fi

    _sp_dry gpasswd -d "$username" "$group"
    _sp_log "OK" "Removed $username from group $group"
}

# ── Set POSIX ACL on a directory ──────────────────────────────────────────────
run_set_acl() {
    local target_dir="${1:?directory required}"
    local acl_spec="${2:?ACL spec required}"   # e.g. "u:jsmith:rwx" or "g:devs:rx"
    local recursive="${3:-false}"
    local default_acl="${4:-false}"

    [[ $EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }
    _sp_check_acl || return 1

    if [[ ! -d "$target_dir" ]]; then
        _sp_log "ERROR" "Directory not found: $target_dir"
        return 1
    fi

    local setfacl_args=("-m" "$acl_spec")
    [[ "$recursive" == "true" ]] && setfacl_args+=("-R")

    _sp_log "INFO" "Setting ACL: $acl_spec on $target_dir (recursive=$recursive default=$default_acl)"
    _sp_dry setfacl "${setfacl_args[@]}" "$target_dir"

    # Also set as default ACL so new files inherit
    if [[ "$default_acl" == "true" ]]; then
        local default_spec="d:${acl_spec}"
        _sp_dry setfacl -m "$default_spec" "$target_dir"
        _sp_log "INFO" "Default ACL set: $default_spec on $target_dir"
    fi

    _sp_log "OK" "ACL applied: $acl_spec → $target_dir"

    # Show current ACL
    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        _sp_log "INFO" "Current ACL for $target_dir:"
        getfacl "$target_dir" 2>/dev/null | grep -v "^#" | while read -r line; do
            _sp_log "INFO" "  $line"
        done
    fi
}

# ── Remove ACL from directory ─────────────────────────────────────────────────
run_remove_acl() {
    local target_dir="${1:?directory required}"
    local username="${2:-}"
    local group="${3:-}"

    [[ $EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }
    _sp_check_acl || return 1

    if [[ -n "$username" ]]; then
        _sp_dry setfacl -x "u:${username}" "$target_dir"
        _sp_dry setfacl -x "d:u:${username}" "$target_dir" 2>/dev/null || true
        _sp_log "OK" "Removed ACL for user $username on $target_dir"
    fi
    if [[ -n "$group" ]]; then
        _sp_dry setfacl -x "g:${group}" "$target_dir"
        _sp_dry setfacl -x "d:g:${group}" "$target_dir" 2>/dev/null || true
        _sp_log "OK" "Removed ACL for group $group on $target_dir"
    fi
}

# ── Set shared directory with SGID ───────────────────────────────────────────
run_setup_shared_dir() {
    local dir="${1:?directory required}"
    local owner_group="${2:?owner group required}"
    local permissions="${3:-2775}"   # SGID + rwxrwxr-x typical for shared dirs

    [[ $EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }

    if [[ ! -d "$dir" ]]; then
        _sp_log "INFO" "Creating shared directory: $dir"
        _sp_dry mkdir -p "$dir"
    fi

    if ! getent group "$owner_group" &>/dev/null; then
        _sp_log "INFO" "Group '$owner_group' does not exist — creating"
        _sp_dry groupadd "$owner_group"
    fi

    _sp_dry chown "root:${owner_group}" "$dir"
    _sp_dry chmod "$permissions" "$dir"

    # Set default ACL so all new files inherit group ownership
    if command -v setfacl &>/dev/null; then
        _sp_dry setfacl -d -m "g:${owner_group}:rwx" "$dir"
    fi

    _sp_log "OK" "Shared directory ready: $dir (group=$owner_group mode=$permissions)"
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    DRY_RUN=false
    ACTION=""
    ARGS=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)    DRY_RUN=true ;;
            add-group)    ACTION="add-group" ;;
            remove-group) ACTION="remove-group" ;;
            set-acl)      ACTION="set-acl" ;;
            remove-acl)   ACTION="remove-acl" ;;
            shared-dir)   ACTION="shared-dir" ;;
            --help|-h)
                cat <<'EOF'
Usage: set_permissions.sh [--dry-run] <action> [args...]

Actions:
  add-group    <username> <group>              Add user to group
  remove-group <username> <group>              Remove user from group
  set-acl      <dir> <acl_spec> [recursive] [default]
                                               Set POSIX ACL (e.g. u:jsmith:rwx)
  remove-acl   <dir> [username] [group]        Remove ACL entries
  shared-dir   <dir> <group> [permissions]     Create SGID shared directory

Examples:
  ./set_permissions.sh add-group jsmith developers
  ./set_permissions.sh set-acl /srv/data u:jsmith:rwx true true
  ./set_permissions.sh shared-dir /srv/finance finance 2775
EOF
                exit 0 ;;
            *) ARGS+=("$1") ;;
        esac
        shift
    done

    case "$ACTION" in
        add-group)    run_add_user_to_group "${ARGS[@]}" ;;
        remove-group) run_remove_user_from_group "${ARGS[@]}" ;;
        set-acl)      run_set_acl "${ARGS[@]}" ;;
        remove-acl)   run_remove_acl "${ARGS[@]}" ;;
        shared-dir)   run_setup_shared_dir "${ARGS[@]}" ;;
        *)
            echo "Usage: $0 [--dry-run] <add-group|remove-group|set-acl|remove-acl|shared-dir> [args...]"
            exit 1 ;;
    esac
fi
