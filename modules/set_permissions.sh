#!/usr/bin/env bash
# ============================================================
# modules/set_permissions.sh — ACL and group management
# Linux User & Access Management Automation  v1.0.0
# Usage : ./modules/set_permissions.sh [--dry-run] <action> [args]
# Requires: root; setfacl/getfacl from 'acl' package for ACL actions
# ============================================================
# shellcheck shell=bash
# shellcheck source=../config.conf
set -euo pipefail

_sp_load_config() {
    local cfg
    cfg="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    # shellcheck disable=SC1091
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "${LOG_FILE:-}" ]] && _sp_load_config

_sp_log() {
    local level="$1"; shift
    local ts msg
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    msg="[$ts] [$level] [SET_PERMS] $*"
    printf '%s\n' "$msg"
    printf '%s\n' "$msg" >> "${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_sp_dry() {
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        _sp_log "DRY" "Would run: $*"
        return 0
    fi
    "$@"
}

_sp_need_acl() {
    command -v setfacl &>/dev/null && return 0
    _sp_log "ERROR" "setfacl not found — install the 'acl' package: sudo dnf install acl"
    return 1
}

# ── Add user to group ─────────────────────────────────────────────────────────
run_add_user_to_group() {
    local username="${1:?username required}"
    local group="${2:?group name required}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\n' >&2; exit 1; }

    if ! id "$username" &>/dev/null; then
        _sp_log "ERROR" "User '$username' does not exist"
        return 1
    fi

    if ! getent group "$group" &>/dev/null; then
        _sp_log "INFO" "Group '$group' not found — creating it"
        _sp_dry groupadd "$group"
    fi

    if id -nG "$username" 2>/dev/null | tr ' ' '\n' | grep -qx "$group"; then
        _sp_log "WARN" "User '$username' is already a member of '$group' — skipping"
        return 0
    fi

    _sp_dry usermod -aG "$group" "$username"
    _sp_log "OK" "Added $username → group $group"
}

# ── Remove user from group ────────────────────────────────────────────────────
run_remove_user_from_group() {
    local username="${1:?username required}"
    local group="${2:?group name required}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\n' >&2; exit 1; }

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
    local acl_spec="${2:?ACL spec required}"    # e.g. "u:jsmith:rwx"
    local recursive="${3:-false}"
    local set_default="${4:-false}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\n' >&2; exit 1; }
    _sp_need_acl || return 1

    if [[ ! -d "$target_dir" ]]; then
        _sp_log "ERROR" "Directory not found: $target_dir"
        return 1
    fi

    local setfacl_args=("-m" "$acl_spec")
    [[ "$recursive" == "true" ]] && setfacl_args+=("-R")

    _sp_log "INFO" "Setting ACL: $acl_spec on $target_dir (recursive=$recursive default=$set_default)"
    _sp_dry setfacl "${setfacl_args[@]}" "$target_dir"

    # Set as default ACL so newly created files inherit it
    if [[ "$set_default" == "true" ]]; then
        local default_spec="d:${acl_spec}"
        _sp_dry setfacl -m "$default_spec" "$target_dir"
        _sp_log "INFO" "Default ACL set: $default_spec on $target_dir"
    fi

    _sp_log "OK" "ACL applied: $acl_spec → $target_dir"

    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        _sp_log "INFO" "Current ACLs for $target_dir:"
        getfacl "$target_dir" 2>/dev/null | grep -v '^#' | while IFS= read -r acl_line; do
            _sp_log "INFO" "  $acl_line"
        done || true
    fi
}

# ── Remove ACL entries from a directory ───────────────────────────────────────
run_remove_acl() {
    local target_dir="${1:?directory required}"
    local username="${2:-}"
    local group="${3:-}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\n' >&2; exit 1; }
    _sp_need_acl || return 1

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

# ── Create a shared directory with SGID bit ───────────────────────────────────
run_setup_shared_dir() {
    local dir="${1:?directory path required}"
    local owner_group="${2:?owner group required}"
    local permissions="${3:-2775}"    # SGID + rwxrwxr-x

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\n' >&2; exit 1; }

    if [[ ! -d "$dir" ]]; then
        _sp_log "INFO" "Creating shared directory: $dir"
        _sp_dry mkdir -p "$dir"
    fi

    if ! getent group "$owner_group" &>/dev/null; then
        _sp_log "INFO" "Group '$owner_group' not found — creating it"
        _sp_dry groupadd "$owner_group"
    fi

    _sp_dry chown "root:${owner_group}" "$dir"
    _sp_dry chmod "$permissions" "$dir"

    # Default ACL so all new files inherit group ownership
    if command -v setfacl &>/dev/null; then
        _sp_dry setfacl -d -m "g:${owner_group}:rwx" "$dir"
        _sp_log "INFO" "Default ACL set for group '$owner_group' on $dir"
    fi

    _sp_log "OK" "Shared directory ready: $dir (group=$owner_group mode=$permissions SGID)"
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    DRY_RUN=false
    ACTION=""
    ARGS=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)    DRY_RUN=true ;;
            add-group|remove-group|set-acl|remove-acl|shared-dir)
                ACTION="$1" ;;
            --help|-h)
                cat <<'HELP'
Usage: set_permissions.sh [--dry-run] <action> [args...]

Actions:
  add-group    <username> <group>
      Add user to an existing or new group

  remove-group <username> <group>
      Remove user from a group

  set-acl      <dir> <acl_spec> [recursive:true|false] [default:true|false]
      Set POSIX ACL (e.g. u:jsmith:rwx or g:devs:rx)

  remove-acl   <dir> [username] [group]
      Remove ACL entries for a user or group

  shared-dir   <dir> <group> [mode]
      Create an SGID shared directory (default mode: 2775)

Examples:
  ./set_permissions.sh add-group jsmith developers
  ./set_permissions.sh set-acl /srv/finance u:jsmith:rwx true true
  ./set_permissions.sh shared-dir /srv/engineering engineering 2775
HELP
                exit 0 ;;
            *)
                ARGS+=("$1") ;;
        esac
        shift
    done

    export DRY_RUN

    case "$ACTION" in
        add-group)    run_add_user_to_group "${ARGS[@]}" ;;
        remove-group) run_remove_user_from_group "${ARGS[@]}" ;;
        set-acl)      run_set_acl "${ARGS[@]}" ;;
        remove-acl)   run_remove_acl "${ARGS[@]}" ;;
        shared-dir)   run_setup_shared_dir "${ARGS[@]}" ;;
        *)
            printf 'Usage: %s [--dry-run] <add-group|remove-group|set-acl|remove-acl|shared-dir> [args]\n' "$0" >&2
            exit 1 ;;
    esac
fi
