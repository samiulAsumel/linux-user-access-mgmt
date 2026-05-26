#!/usr/bin/env bash
# user_manager.sh — Linux User & Access Management Automation  v1.0.0
# Interactive menu-driven orchestrator for all user management modules.
# Target: RHEL 9 / CentOS Stream 9 / Rocky Linux 9
# Usage:  sudo ./user_manager.sh [--dry-run] [--non-interactive]
# shellcheck shell=bash
set -euo pipefail

readonly VERSION="1.0.0"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly MODULES_DIR="${SCRIPT_DIR}/modules"
readonly TEMPLATES_DIR="${SCRIPT_DIR}/templates"
readonly LOG_DEFAULT="/var/log/usermgmt.log"

# ── Colours ───────────────────────────────────────────────────────────────────
if [[ -t 1 ]] && tput colors &>/dev/null && [[ $(tput colors) -ge 8 ]]; then
    C_RESET=$'\033[0m';  C_BOLD=$'\033[1m'
    C_CYAN=$'\033[96m';  C_GREEN=$'\033[92m'; C_YELLOW=$'\033[93m'
    C_RED=$'\033[91m';   C_DIM=$'\033[2m';    C_BLUE=$'\033[94m'
else
    C_RESET=''; C_BOLD=''; C_CYAN=''; C_GREEN=''; C_YELLOW=''
    C_RED=''; C_DIM=''; C_BLUE=''
fi

# ── Load config ───────────────────────────────────────────────────────────────
CONFIG_FILE="${SCRIPT_DIR}/config.conf"
if [[ -f "$CONFIG_FILE" ]]; then
    # shellcheck source=config.conf
    source "$CONFIG_FILE"
else
    echo "${C_YELLOW}[WARN] config.conf not found — using defaults${C_RESET}" >&2
fi

readonly LOG_FILE="${LOG_FILE:-${LOG_DEFAULT}}"
DRY_RUN="${DRY_RUN:-false}"
NON_INTERACTIVE=false

# ── Logging ───────────────────────────────────────────────────────────────────
_log() {
    local level="$1"; shift
    local ts; ts=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$ts] [$level] [MANAGER] $*" >> "$LOG_FILE" 2>/dev/null || true
}

# ── Pre-flight checks ─────────────────────────────────────────────────────────
_preflight() {
    # Root check
    if [[ $EUID -ne 0 ]]; then
        echo "${C_RED}[ERROR] This script must run as root (or via sudo).${C_RESET}" >&2
        exit 1
    fi

    # Module directory check
    if [[ ! -d "$MODULES_DIR" ]]; then
        echo "${C_RED}[ERROR] modules/ directory not found at $MODULES_DIR${C_RESET}" >&2
        exit 1
    fi

    # Create log file
    touch "$LOG_FILE" 2>/dev/null && chmod 640 "$LOG_FILE" || true
}

# ── Banner ────────────────────────────────────────────────────────────────────
_banner() {
    clear 2>/dev/null || true
    echo "${C_CYAN}${C_BOLD}"
    cat <<'BANNER'
  ╔══════════════════════════════════════════════════════════════╗
  ║                                                              ║
  ║   Linux User & Access Management Automation  v1.0.0         ║
  ║   Target: RHEL 9 / CentOS Stream / Rocky Linux              ║
  ║                                                              ║
  ╚══════════════════════════════════════════════════════════════╝
BANNER
    echo "${C_RESET}"

    if [[ "$DRY_RUN" == "true" ]]; then
        echo "${C_YELLOW}  ⚠  DRY-RUN MODE — no system changes will be made${C_RESET}"
        echo ""
    fi

    local host; host=$(hostname -f 2>/dev/null || hostname)
    echo "${C_DIM}  Server : $host${C_RESET}"
    echo "${C_DIM}  User   : ${SUDO_USER:-root}${C_RESET}"
    echo "${C_DIM}  Log    : $LOG_FILE${C_RESET}"
    echo ""
}

# ── Main menu ─────────────────────────────────────────────────────────────────
_main_menu() {
    echo "${C_BOLD}  ─── Main Menu ─────────────────────────────────────────────${C_RESET}"
    echo ""
    echo "  ${C_CYAN}1)${C_RESET}  Create users from CSV"
    echo "  ${C_CYAN}2)${C_RESET}  Create single user (interactive)"
    echo "  ${C_CYAN}3)${C_RESET}  Disable user(s)"
    echo "  ${C_CYAN}4)${C_RESET}  Delete user (permanent)"
    echo "  ${C_CYAN}5)${C_RESET}  Generate audit report (HTML)"
    echo "  ${C_CYAN}6)${C_RESET}  Manage SSH keys"
    echo "  ${C_CYAN}7)${C_RESET}  Check / manage account expiry"
    echo "  ${C_CYAN}8)${C_RESET}  Set permissions / ACLs"
    echo "  ${C_CYAN}9)${C_RESET}  Apply password policy"
    echo "  ${C_CYAN}d)${C_RESET}  Toggle dry-run mode (current: ${DRY_RUN})"
    echo "  ${C_CYAN}q)${C_RESET}  Exit"
    echo ""
    echo "${C_BOLD}  ────────────────────────────────────────────────────────────${C_RESET}"
}

# ── Source a module ───────────────────────────────────────────────────────────
_load_module() {
    local module="${MODULES_DIR}/${1}"
    if [[ ! -f "$module" ]]; then
        echo "${C_RED}[ERROR] Module not found: $module${C_RESET}" >&2
        return 1
    fi
    export DRY_RUN
    # shellcheck disable=SC1090
    source "$module"
}

# ── Option 1: Create users from CSV ──────────────────────────────────────────
_opt_create_from_csv() {
    echo ""
    echo "${C_BOLD}  Create Users from CSV${C_RESET}"
    echo "  Template: ${TEMPLATES_DIR}/users_template.csv"
    echo ""

    local csv_file
    read -r -p "  Enter path to CSV file [${TEMPLATES_DIR}/users_template.csv]: " csv_file
    csv_file="${csv_file:-${TEMPLATES_DIR}/users_template.csv}"

    if [[ ! -f "$csv_file" ]]; then
        echo "${C_RED}  [ERROR] File not found: $csv_file${C_RESET}"
        return
    fi

    echo ""
    echo "  Preview (first 5 data rows):"
    awk -F',' 'NR<=6{print "  "$0}' "$csv_file"
    echo ""
    read -r -p "  Proceed with user creation? [y/N]: " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { echo "  Aborted."; return; }

    echo ""
    _load_module "create_users.sh"
    run_create_users "$csv_file"
    _log "INFO" "Option 1: create from CSV — file=$csv_file"
}

# ── Option 2: Create single user ─────────────────────────────────────────────
_opt_create_single() {
    echo ""
    echo "${C_BOLD}  Create Single User${C_RESET}"
    echo ""

    local username full_name email department groups shell expiry ssh_key

    read -r -p "  Username (lowercase, 1-32 chars): " username
    [[ -z "$username" ]] && { echo "  Aborted."; return; }

    read -r -p "  Full name: " full_name
    read -r -p "  Email: " email
    read -r -p "  Department: " department
    read -r -p "  Groups (colon-separated, e.g. developers:docker): " groups
    read -r -p "  Shell [/bin/bash]: " shell; shell="${shell:-/bin/bash}"
    read -r -p "  Account expiry (YYYY-MM-DD, leave blank for never): " expiry
    read -r -p "  SSH public key file (leave blank to skip): " ssh_key

    echo ""
    echo "  Summary:"
    echo "    Username   : $username"
    echo "    Full name  : $full_name"
    echo "    Email      : $email"
    echo "    Department : $department"
    echo "    Groups     : ${groups:-none}"
    echo "    Shell      : $shell"
    echo "    Expiry     : ${expiry:-never}"
    echo "    SSH key    : ${ssh_key:-none}"
    echo ""

    read -r -p "  Create this user? [y/N]: " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { echo "  Aborted."; return; }

    # Write to temp CSV and call create_users
    local tmp_csv; tmp_csv=$(mktemp /tmp/usermgmt_single_XXXXXX.csv)
    echo "username,full_name,email,department,groups,shell,expiry_date,ssh_key_file" > "$tmp_csv"
    echo "${username},${full_name},${email},${department},${groups},${shell},${expiry},${ssh_key}" >> "$tmp_csv"

    _load_module "create_users.sh"
    run_create_users "$tmp_csv"
    rm -f "$tmp_csv"
    _log "INFO" "Option 2: single user created — $username"
}

# ── Option 3: Disable user(s) ─────────────────────────────────────────────────
_opt_disable_users() {
    echo ""
    echo "${C_BOLD}  Disable User Account(s)${C_RESET}"
    echo ""
    echo "  Enter a username to disable a single account,"
    echo "  or path to a CSV file (username in first column)."
    echo ""

    local target reason
    read -r -p "  Username or CSV file: " target
    [[ -z "$target" ]] && { echo "  Aborted."; return; }
    read -r -p "  Reason [Offboarding]: " reason
    reason="${reason:-Offboarding}"

    echo ""
    read -r -p "  Disable '$target'? This locks the account. [y/N]: " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { echo "  Aborted."; return; }

    _load_module "disable_users.sh"
    run_disable_users "$target" "$reason"
    _log "INFO" "Option 3: disable — target=$target reason=$reason"
}

# ── Option 4: Delete user ─────────────────────────────────────────────────────
_opt_delete_user() {
    echo ""
    echo "${C_BOLD}  Delete User Account${C_RESET}"
    echo "${C_RED}  ⚠  This operation is PERMANENT.${C_RESET}"
    echo ""

    local username
    read -r -p "  Username to delete: " username
    [[ -z "$username" ]] && { echo "  Aborted."; return; }

    local remove_home_ans
    read -r -p "  Also delete home directory? [y/N]: " remove_home_ans
    local remove_home=false
    [[ "$remove_home_ans" =~ ^[Yy]$ ]] && remove_home=true

    export REMOVE_HOME="$remove_home"
    export BACKUP_HOME="true"

    _load_module "delete_users.sh"
    run_delete_user "$username"
    _log "INFO" "Option 4: delete — $username remove_home=$remove_home"
}

# ── Option 5: Audit report ────────────────────────────────────────────────────
_opt_audit_report() {
    echo ""
    echo "${C_BOLD}  Generate Access Audit Report${C_RESET}"
    echo ""

    local report_dir="${REPORT_OUTPUT_DIR:-/var/reports/usermgmt}"
    local out_file="${report_dir}/audit_$(date +%Y%m%d_%H%M%S).html"
    read -r -p "  Report output path [$out_file]: " custom_path
    [[ -n "$custom_path" ]] && out_file="$custom_path"

    echo ""
    echo "  Generating report…"
    _load_module "audit_report.sh"
    run_audit_report "$out_file"
    _log "INFO" "Option 5: audit report — $out_file"
}

# ── Option 6: SSH key management ─────────────────────────────────────────────
_opt_ssh_keys() {
    echo ""
    echo "${C_BOLD}  SSH Key Management${C_RESET}"
    echo ""
    echo "  ${C_CYAN}1)${C_RESET} Deploy key to user"
    echo "  ${C_CYAN}2)${C_RESET} List keys for user"
    echo "  ${C_CYAN}3)${C_RESET} Revoke all keys for user"
    echo "  ${C_CYAN}4)${C_RESET} Rotate key for user"
    echo "  ${C_CYAN}5)${C_RESET} Audit all users' SSH keys"
    echo "  ${C_CYAN}b)${C_RESET} Back"
    echo ""

    _load_module "ssh_key_manager.sh"
    local ssh_choice username key_file
    read -r -p "  Choice: " ssh_choice

    case "$ssh_choice" in
        1) read -r -p "  Username: " username
           read -r -p "  Key file: " key_file
           run_ssh_deploy "$username" "$key_file" ;;
        2) read -r -p "  Username: " username
           run_ssh_list "$username" ;;
        3) read -r -p "  Username: " username
           run_ssh_revoke_all "$username" ;;
        4) read -r -p "  Username: " username
           read -r -p "  New key file: " key_file
           run_ssh_rotate "$username" "$key_file" ;;
        5) run_ssh_audit ;;
        b|B) return ;;
        *) echo "  Invalid choice." ;;
    esac
    _log "INFO" "Option 6: SSH keys — action=$ssh_choice"
}

# ── Option 7: Account expiry ──────────────────────────────────────────────────
_opt_expiry() {
    echo ""
    echo "${C_BOLD}  Account Expiry Management${C_RESET}"
    echo ""
    echo "  ${C_CYAN}1)${C_RESET} Check all accounts for expiry"
    echo "  ${C_CYAN}2)${C_RESET} Set expiry date for a user"
    echo "  ${C_CYAN}3)${C_RESET} Extend expiry for a user"
    echo "  ${C_CYAN}4)${C_RESET} Check expiry for specific user"
    echo "  ${C_CYAN}b)${C_RESET} Back"
    echo ""

    _load_module "expire_accounts.sh"
    local exp_choice username exp_date days
    read -r -p "  Choice: " exp_choice

    case "$exp_choice" in
        1) run_expire_accounts ;;
        2) read -r -p "  Username: " username
           read -r -p "  Expiry date (YYYY-MM-DD or 'never'): " exp_date
           run_set_expiry "$username" "$exp_date" ;;
        3) read -r -p "  Username: " username
           read -r -p "  Extend by (days): " days
           run_extend_expiry "$username" "$days" ;;
        4) read -r -p "  Username: " username
           chage -l "$username" 2>/dev/null | sed 's/^/  /' || echo "[ERROR] Not found" ;;
        b|B) return ;;
        *) echo "  Invalid choice." ;;
    esac
    _log "INFO" "Option 7: expiry — action=$exp_choice"
}

# ── Option 8: Set permissions ─────────────────────────────────────────────────
_opt_permissions() {
    echo ""
    echo "${C_BOLD}  Permissions & ACL Management${C_RESET}"
    echo ""
    echo "  ${C_CYAN}1)${C_RESET} Add user to group"
    echo "  ${C_CYAN}2)${C_RESET} Remove user from group"
    echo "  ${C_CYAN}3)${C_RESET} Set POSIX ACL on directory"
    echo "  ${C_CYAN}4)${C_RESET} Setup shared directory (SGID)"
    echo "  ${C_CYAN}b)${C_RESET} Back"
    echo ""

    _load_module "set_permissions.sh"
    local perm_choice username group dir acl_spec
    read -r -p "  Choice: " perm_choice

    case "$perm_choice" in
        1) read -r -p "  Username: " username
           read -r -p "  Group: " group
           run_add_user_to_group "$username" "$group" ;;
        2) read -r -p "  Username: " username
           read -r -p "  Group: " group
           run_remove_user_from_group "$username" "$group" ;;
        3) read -r -p "  Directory path: " dir
           read -r -p "  ACL spec (e.g. u:jsmith:rwx): " acl_spec
           local rec_ans def_ans
           read -r -p "  Recursive? [y/N]: " rec_ans
           read -r -p "  Set as default ACL too? [y/N]: " def_ans
           run_set_acl "$dir" "$acl_spec" \
               "$([[ $rec_ans =~ ^[Yy]$ ]] && echo true || echo false)" \
               "$([[ $def_ans =~ ^[Yy]$ ]] && echo true || echo false)" ;;
        4) read -r -p "  Directory path: " dir
           read -r -p "  Owner group: " group
           read -r -p "  Permissions [2775]: " perm; perm="${perm:-2775}"
           run_setup_shared_dir "$dir" "$group" "$perm" ;;
        b|B) return ;;
        *) echo "  Invalid choice." ;;
    esac
    _log "INFO" "Option 8: permissions — action=$perm_choice"
}

# ── Option 9: Password policy ─────────────────────────────────────────────────
_opt_password_policy() {
    echo ""
    echo "${C_BOLD}  Password Policy${C_RESET}"
    echo ""
    echo "  ${C_CYAN}1)${C_RESET} Configure PAM pwquality (system-wide)"
    echo "  ${C_CYAN}2)${C_RESET} Apply aging policy to ALL regular users"
    echo "  ${C_CYAN}3)${C_RESET} Apply aging policy to specific user"
    echo "  ${C_CYAN}4)${C_RESET} Show current aging for user"
    echo "  ${C_CYAN}b)${C_RESET} Back"
    echo ""

    _load_module "password_policy.sh"
    local pp_choice username
    read -r -p "  Choice: " pp_choice

    case "$pp_choice" in
        1) run_configure_pwquality ;;
        2) run_apply_aging_all ;;
        3) read -r -p "  Username: " username; _pp_apply_aging "$username" ;;
        4) read -r -p "  Username: " username; run_show_aging "$username" ;;
        b|B) return ;;
        *) echo "  Invalid choice." ;;
    esac
    _log "INFO" "Option 9: password policy — action=$pp_choice"
}

# ── Parse CLI arguments ───────────────────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --dry-run)        DRY_RUN=true ;;
        --non-interactive) NON_INTERACTIVE=true ;;
        --version)        echo "linux-user-access-mgmt v${VERSION}"; exit 0 ;;
        --help|-h)
            cat <<EOF
Usage: sudo $0 [OPTIONS]

Options:
  --dry-run           Run in simulation mode (no system changes)
  --non-interactive   Exit after first run (for scripted use)
  --version           Show version
  --help              Show this help

Modules:
  modules/create_users.sh    modules/disable_users.sh
  modules/delete_users.sh    modules/set_permissions.sh
  modules/password_policy.sh modules/audit_report.sh
  modules/ssh_key_manager.sh modules/expire_accounts.sh

Config: $CONFIG_FILE
Log:    ${LOG_FILE:-$LOG_DEFAULT}
EOF
            exit 0 ;;
        *) echo "[WARN] Unknown argument: $arg" >&2 ;;
    esac
done

# ── Main loop ─────────────────────────────────────────────────────────────────
_preflight
export DRY_RUN

while true; do
    _banner
    _main_menu
    read -r -p "  ${C_BOLD}Choice: ${C_RESET}" choice

    echo ""
    case "$choice" in
        1) _opt_create_from_csv ;;
        2) _opt_create_single ;;
        3) _opt_disable_users ;;
        4) _opt_delete_user ;;
        5) _opt_audit_report ;;
        6) _opt_ssh_keys ;;
        7) _opt_expiry ;;
        8) _opt_permissions ;;
        9) _opt_password_policy ;;
        d|D)
            if [[ "$DRY_RUN" == "true" ]]; then
                DRY_RUN=false
                echo "  ${C_GREEN}Dry-run DISABLED — system changes WILL be made${C_RESET}"
            else
                DRY_RUN=true
                echo "  ${C_YELLOW}Dry-run ENABLED — simulation only${C_RESET}"
            fi
            export DRY_RUN ;;
        q|Q|exit|quit)
            echo ""
            echo "  ${C_DIM}Goodbye.${C_RESET}"
            echo ""
            _log "INFO" "Session ended by ${SUDO_USER:-root}"
            exit 0 ;;
        '')
            ;; # Enter key — redraw menu
        *)
            echo "  ${C_YELLOW}Invalid choice: '$choice'${C_RESET}" ;;
    esac

    if [[ "$NON_INTERACTIVE" == "true" ]]; then
        break
    fi

    echo ""
    read -r -p "  Press Enter to return to menu…" _
done
