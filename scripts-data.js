// scripts-data.js — Actual full source for the Scripts Explorer
// Auto-generated from production files — linux-user-access-mgmt v1.1.0
// All 10 modules + config + CSV template — zero placeholder snippets

const SCRIPTS_DATA = [
  {
    id: 'user-manager',
    name: 'user_manager.sh',
    path: 'user_manager.sh',
    description: 'Main interactive menu — orchestrates all 8 modules. Supports --dry-run and --non-interactive. Sources each module into the same shell process.',
    badges: ['bash'],
    code: `#!/usr/bin/env bash
# user_manager.sh — Linux User & Access Management Automation  v1.0.0
# Interactive menu-driven orchestrator for all user management modules.
# Target: RHEL 9 / CentOS Stream 9 / Rocky Linux 9
# Usage:  sudo ./user_manager.sh [--dry-run] [--non-interactive]
# shellcheck shell=bash
# shellcheck source=config.conf
set -euo pipefail

readonly VERSION="1.0.0"
# SC2155 fix: separate declare and assign
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly MODULES_DIR="\${SCRIPT_DIR}/modules"
readonly TEMPLATES_DIR="\${SCRIPT_DIR}/templates"
readonly LOG_DEFAULT="/var/log/usermgmt.log"

# ── Colours ───────────────────────────────────────────────────────────────────
if [[ -t 1 ]] && tput colors &>/dev/null && [[ $(tput colors) -ge 8 ]]; then
    C_RESET=$'\\033[0m';  C_BOLD=$'\\033[1m'
    C_CYAN=$'\\033[96m';  C_GREEN=$'\\033[92m'; C_YELLOW=$'\\033[93m'
    C_RED=$'\\033[91m';   C_DIM=$'\\033[2m'
else
    C_RESET=''; C_BOLD=''; C_CYAN=''; C_GREEN=''; C_YELLOW=''
    C_RED=''; C_DIM=''
fi

# ── Load config ───────────────────────────────────────────────────────────────
CONFIG_FILE="\${SCRIPT_DIR}/config.conf"
if [[ -f "$CONFIG_FILE" ]]; then
    # shellcheck disable=SC1091
    source "$CONFIG_FILE"
else
    printf '%s\\n' "\${C_YELLOW}[WARN] config.conf not found — using defaults\${C_RESET}" >&2
fi

readonly LOG_FILE="\${LOG_FILE:-\${LOG_DEFAULT}}"
DRY_RUN="\${DRY_RUN:-false}"
NON_INTERACTIVE=false

# ── Logging ───────────────────────────────────────────────────────────────────
_log() {
    local level="$1"; shift
    local ts
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    printf '%s\\n' "[$ts] [$level] [MANAGER] $*" >> "$LOG_FILE" 2>/dev/null || true
}

# ── Pre-flight checks ─────────────────────────────────────────────────────────
_preflight() {
    # Root check
    if [[ $EUID -ne 0 ]]; then
        printf '%s\\n' "\${C_RED}[ERROR] This script must run as root (or via sudo).\${C_RESET}" >&2
        exit 1
    fi

    # Module directory check
    if [[ ! -d "$MODULES_DIR" ]]; then
        printf '%s\\n' "\${C_RED}[ERROR] modules/ directory not found at $MODULES_DIR\${C_RESET}" >&2
        exit 1
    fi

    # SC2015 fix: use if-then instead of && ... || true
    if touch "$LOG_FILE" 2>/dev/null; then
        chmod 640 "$LOG_FILE" 2>/dev/null || true
    fi
}

# ── Banner ────────────────────────────────────────────────────────────────────
_banner() {
    clear 2>/dev/null || true
    printf '%s%s\\n' "\${C_CYAN}" "\${C_BOLD}"
    cat <<'BANNER'
  ╔══════════════════════════════════════════════════════════════╗
  ║                                                              ║
  ║   Linux User & Access Management Automation  v1.0.0         ║
  ║   Target: RHEL 9 / CentOS Stream / Rocky Linux              ║
  ║                                                              ║
  ╚══════════════════════════════════════════════════════════════╝
BANNER
    printf '%s\\n' "\${C_RESET}"

    if [[ "$DRY_RUN" == "true" ]]; then
        printf '%s\\n' "\${C_YELLOW}  ⚠  DRY-RUN MODE — no system changes will be made\${C_RESET}"
        printf '\\n'
    fi

    local host
    host=$(hostname -f 2>/dev/null || hostname)
    printf '%s\\n' "\${C_DIM}  Server : $host\${C_RESET}"
    printf '%s\\n' "\${C_DIM}  User   : \${SUDO_USER:-root}\${C_RESET}"
    printf '%s\\n' "\${C_DIM}  Log    : $LOG_FILE\${C_RESET}"
    printf '\\n'
}

# ── Main menu ─────────────────────────────────────────────────────────────────
_main_menu() {
    printf '%s\\n' "\${C_BOLD}  ─── Main Menu ─────────────────────────────────────────────\${C_RESET}"
    printf '\\n'
    printf '  %s1)%s  Create users from CSV\\n'                "\${C_CYAN}" "\${C_RESET}"
    printf '  %s2)%s  Create single user (interactive)\\n'     "\${C_CYAN}" "\${C_RESET}"
    printf '  %s3)%s  Disable user(s)\\n'                      "\${C_CYAN}" "\${C_RESET}"
    printf '  %s4)%s  Delete user (permanent)\\n'              "\${C_CYAN}" "\${C_RESET}"
    printf '  %s5)%s  Generate audit report (HTML)\\n'         "\${C_CYAN}" "\${C_RESET}"
    printf '  %s6)%s  Manage SSH keys\\n'                      "\${C_CYAN}" "\${C_RESET}"
    printf '  %s7)%s  Check / manage account expiry\\n'        "\${C_CYAN}" "\${C_RESET}"
    printf '  %s8)%s  Set permissions / ACLs\\n'               "\${C_CYAN}" "\${C_RESET}"
    printf '  %s9)%s  Apply password policy\\n'                "\${C_CYAN}" "\${C_RESET}"
    printf '  %sd)%s  Toggle dry-run mode (current: %s)\\n'   "\${C_CYAN}" "\${C_RESET}" "$DRY_RUN"
    printf '  %sq)%s  Exit\\n'                                 "\${C_CYAN}" "\${C_RESET}"
    printf '\\n'
    printf '%s\\n' "\${C_BOLD}  ────────────────────────────────────────────────────────────\${C_RESET}"
}

# ── Source a module ───────────────────────────────────────────────────────────
_load_module() {
    local module="\${MODULES_DIR}/\${1}"
    if [[ ! -f "$module" ]]; then
        printf '%s\\n' "\${C_RED}[ERROR] Module not found: $module\${C_RESET}" >&2
        return 1
    fi
    export DRY_RUN
    # shellcheck disable=SC1090,SC1091
    source "$module"
}

# ── Option 1: Create users from CSV ──────────────────────────────────────────
_opt_create_from_csv() {
    printf '\\n'
    printf '%s\\n' "\${C_BOLD}  Create Users from CSV\${C_RESET}"
    printf '  Template: %s/users_template.csv\\n' "\${TEMPLATES_DIR}"
    printf '\\n'

    local csv_file
    read -r -p "  Enter path to CSV file [\${TEMPLATES_DIR}/users_template.csv]: " csv_file
    csv_file="\${csv_file:-\${TEMPLATES_DIR}/users_template.csv}"

    if [[ ! -f "$csv_file" ]]; then
        printf '%s\\n' "\${C_RED}  [ERROR] File not found: $csv_file\${C_RESET}"
        return
    fi

    printf '\\n'
    printf '  Preview (first 5 data rows):\\n'
    awk -F',' 'NR<=6{print "  "$0}' "$csv_file"
    printf '\\n'
    read -r -p "  Proceed with user creation? [y/N]: " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { printf '  Aborted.\\n'; return; }

    printf '\\n'
    _load_module "create_users.sh"
    run_create_users "$csv_file"
    _log "INFO" "Option 1: create from CSV — file=$csv_file"
}

# ── Option 2: Create single user ─────────────────────────────────────────────
_opt_create_single() {
    printf '\\n'
    printf '%s\\n' "\${C_BOLD}  Create Single User\${C_RESET}"
    printf '\\n'

    local username full_name email department groups shell_bin expiry ssh_key

    read -r -p "  Username (lowercase, 1-32 chars): " username
    [[ -z "$username" ]] && { printf '  Aborted.\\n'; return; }

    read -r -p "  Full name: "                                                           full_name
    read -r -p "  Email: "                                                               email
    read -r -p "  Department: "                                                          department
    read -r -p "  Groups (colon-separated, e.g. developers:docker): "                   groups
    read -r -p "  Shell [/bin/bash]: "                                                  shell_bin
    shell_bin="\${shell_bin:-/bin/bash}"
    read -r -p "  Account expiry (YYYY-MM-DD, leave blank for never): "                 expiry
    read -r -p "  SSH public key file (leave blank to skip): "                          ssh_key

    printf '\\n'
    printf '  Summary:\\n'
    printf '    Username   : %s\\n' "$username"
    printf '    Full name  : %s\\n' "$full_name"
    printf '    Email      : %s\\n' "$email"
    printf '    Department : %s\\n' "$department"
    printf '    Groups     : %s\\n' "\${groups:-none}"
    printf '    Shell      : %s\\n' "$shell_bin"
    printf '    Expiry     : %s\\n' "\${expiry:-never}"
    printf '    SSH key    : %s\\n' "\${ssh_key:-none}"
    printf '\\n'

    read -r -p "  Create this user? [y/N]: " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { printf '  Aborted.\\n'; return; }

    # Write to temp CSV and call create_users
    local tmp_csv
    tmp_csv=$(mktemp /tmp/usermgmt_single_XXXXXX.csv)
    printf '%s\\n' "username,full_name,email,department,groups,shell,expiry_date,ssh_key_file" > "$tmp_csv"
    printf '%s\\n' "\${username},\${full_name},\${email},\${department},\${groups},\${shell_bin},\${expiry},\${ssh_key}" >> "$tmp_csv"

    _load_module "create_users.sh"
    run_create_users "$tmp_csv"
    rm -f "$tmp_csv"
    _log "INFO" "Option 2: single user created — $username"
}

# ── Option 3: Disable user(s) ─────────────────────────────────────────────────
_opt_disable_users() {
    printf '\\n'
    printf '%s\\n' "\${C_BOLD}  Disable User Account(s)\${C_RESET}"
    printf '\\n'
    printf '  Enter a username to disable a single account,\\n'
    printf '  or path to a CSV file (username in first column).\\n'
    printf '\\n'

    local target reason
    read -r -p "  Username or CSV file: " target
    [[ -z "$target" ]] && { printf '  Aborted.\\n'; return; }
    read -r -p "  Reason [Offboarding]: " reason
    reason="\${reason:-Offboarding}"

    printf '\\n'
    read -r -p "  Disable '$target'? This locks the account. [y/N]: " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { printf '  Aborted.\\n'; return; }

    _load_module "disable_users.sh"
    run_disable_users "$target" "$reason"
    _log "INFO" "Option 3: disable — target=$target reason=$reason"
}

# ── Option 4: Delete user ─────────────────────────────────────────────────────
_opt_delete_user() {
    printf '\\n'
    printf '%s\\n' "\${C_BOLD}  Delete User Account\${C_RESET}"
    printf '%s\\n' "\${C_RED}  ⚠  This operation is PERMANENT.\${C_RESET}"
    printf '\\n'

    local username
    read -r -p "  Username to delete: " username
    [[ -z "$username" ]] && { printf '  Aborted.\\n'; return; }

    local remove_home_ans remove_home
    read -r -p "  Also delete home directory? [y/N]: " remove_home_ans
    remove_home=false
    [[ "$remove_home_ans" =~ ^[Yy]$ ]] && remove_home=true

    export REMOVE_HOME="$remove_home"
    export BACKUP_HOME="true"

    _load_module "delete_users.sh"
    run_delete_user "$username"
    _log "INFO" "Option 4: delete — $username remove_home=$remove_home"
}

# ── Option 5: Audit report ────────────────────────────────────────────────────
_opt_audit_report() {
    printf '\\n'
    printf '%s\\n' "\${C_BOLD}  Generate Access Audit Report\${C_RESET}"
    printf '\\n'

    local report_dir="\${REPORT_OUTPUT_DIR:-/var/reports/usermgmt}"
    # SC2155 fix: separate declare and assign
    local out_file
    out_file="\${report_dir}/audit_$(date +%Y%m%d_%H%M%S).html"
    read -r -p "  Report output path [$out_file]: " custom_path
    [[ -n "$custom_path" ]] && out_file="$custom_path"

    printf '\\n'
    printf '  Generating report…\\n'
    _load_module "audit_report.sh"
    run_audit_report "$out_file"
    _log "INFO" "Option 5: audit report — $out_file"
}

# ── Option 6: SSH key management ─────────────────────────────────────────────
_opt_ssh_keys() {
    printf '\\n'
    printf '%s\\n' "\${C_BOLD}  SSH Key Management\${C_RESET}"
    printf '\\n'
    printf '  %s1)%s Deploy key to user\\n'            "\${C_CYAN}" "\${C_RESET}"
    printf '  %s2)%s List keys for user\\n'            "\${C_CYAN}" "\${C_RESET}"
    printf '  %s3)%s Revoke all keys for user\\n'      "\${C_CYAN}" "\${C_RESET}"
    printf '  %s4)%s Rotate key for user\\n'           "\${C_CYAN}" "\${C_RESET}"
    printf '  %s5)%s Audit all users'\\'' SSH keys\\n'  "\${C_CYAN}" "\${C_RESET}"
    printf '  %sb)%s Back\\n'                          "\${C_CYAN}" "\${C_RESET}"
    printf '\\n'

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
        *) printf '  Invalid choice.\\n' ;;
    esac
    _log "INFO" "Option 6: SSH keys — action=$ssh_choice"
}

# ── Option 7: Account expiry ──────────────────────────────────────────────────
_opt_expiry() {
    printf '\\n'
    printf '%s\\n' "\${C_BOLD}  Account Expiry Management\${C_RESET}"
    printf '\\n'
    printf '  %s1)%s Check all accounts for expiry\\n'    "\${C_CYAN}" "\${C_RESET}"
    printf '  %s2)%s Set expiry date for a user\\n'       "\${C_CYAN}" "\${C_RESET}"
    printf '  %s3)%s Extend expiry for a user\\n'         "\${C_CYAN}" "\${C_RESET}"
    printf '  %s4)%s Check expiry for specific user\\n'   "\${C_CYAN}" "\${C_RESET}"
    printf '  %sb)%s Back\\n'                             "\${C_CYAN}" "\${C_RESET}"
    printf '\\n'

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
           chage -l "$username" 2>/dev/null | sed 's/^/  /' || printf '[ERROR] User not found\\n' ;;
        b|B) return ;;
        *) printf '  Invalid choice.\\n' ;;
    esac
    _log "INFO" "Option 7: expiry — action=$exp_choice"
}

# ── Option 8: Set permissions ─────────────────────────────────────────────────
_opt_permissions() {
    printf '\\n'
    printf '%s\\n' "\${C_BOLD}  Permissions & ACL Management\${C_RESET}"
    printf '\\n'
    printf '  %s1)%s Add user to group\\n'              "\${C_CYAN}" "\${C_RESET}"
    printf '  %s2)%s Remove user from group\\n'         "\${C_CYAN}" "\${C_RESET}"
    printf '  %s3)%s Set POSIX ACL on directory\\n'     "\${C_CYAN}" "\${C_RESET}"
    printf '  %s4)%s Setup shared directory (SGID)\\n'  "\${C_CYAN}" "\${C_RESET}"
    printf '  %sb)%s Back\\n'                           "\${C_CYAN}" "\${C_RESET}"
    printf '\\n'

    _load_module "set_permissions.sh"
    local perm_choice username group dir acl_spec perm
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
           local rec_ans def_ans rec_flag def_flag
           read -r -p "  Recursive? [y/N]: " rec_ans
           read -r -p "  Set as default ACL too? [y/N]: " def_ans
           # SC2015 fix: use if-then for boolean conversion
           if [[ $rec_ans =~ ^[Yy]$ ]]; then rec_flag=true; else rec_flag=false; fi
           if [[ $def_ans =~ ^[Yy]$ ]]; then def_flag=true; else def_flag=false; fi
           run_set_acl "$dir" "$acl_spec" "$rec_flag" "$def_flag" ;;
        4) read -r -p "  Directory path: " dir
           read -r -p "  Owner group: " group
           read -r -p "  Permissions [2775]: " perm
           perm="\${perm:-2775}"
           run_setup_shared_dir "$dir" "$group" "$perm" ;;
        b|B) return ;;
        *) printf '  Invalid choice.\\n' ;;
    esac
    _log "INFO" "Option 8: permissions — action=$perm_choice"
}

# ── Option 9: Password policy ─────────────────────────────────────────────────
_opt_password_policy() {
    printf '\\n'
    printf '%s\\n' "\${C_BOLD}  Password Policy\${C_RESET}"
    printf '\\n'
    printf '  %s1)%s Configure PAM pwquality (system-wide)\\n'   "\${C_CYAN}" "\${C_RESET}"
    printf '  %s2)%s Apply aging policy to ALL regular users\\n'  "\${C_CYAN}" "\${C_RESET}"
    printf '  %s3)%s Apply aging policy to specific user\\n'      "\${C_CYAN}" "\${C_RESET}"
    printf '  %s4)%s Show current aging for user\\n'              "\${C_CYAN}" "\${C_RESET}"
    printf '  %sb)%s Back\\n'                                     "\${C_CYAN}" "\${C_RESET}"
    printf '\\n'

    _load_module "password_policy.sh"
    local pp_choice username
    read -r -p "  Choice: " pp_choice

    case "$pp_choice" in
        1) run_configure_pwquality ;;
        2) run_apply_aging_all ;;
        3) read -r -p "  Username: " username; _pp_apply_aging "$username" ;;
        4) read -r -p "  Username: " username; run_show_aging "$username" ;;
        b|B) return ;;
        *) printf '  Invalid choice.\\n' ;;
    esac
    _log "INFO" "Option 9: password policy — action=$pp_choice"
}

# ── Parse CLI arguments ───────────────────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --dry-run)         DRY_RUN=true ;;
        --non-interactive) NON_INTERACTIVE=true ;;
        --version)         printf '%s\\n' "linux-user-access-mgmt v\${VERSION}"; exit 0 ;;
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
Log:    \${LOG_FILE:-$LOG_DEFAULT}
EOF
            exit 0 ;;
        *) printf '[WARN] Unknown argument: %s\\n' "$arg" >&2 ;;
    esac
done

# ── Main loop ─────────────────────────────────────────────────────────────────
_preflight
export DRY_RUN

while true; do
    _banner
    _main_menu
    read -r -p "  \${C_BOLD}Choice: \${C_RESET}" choice

    printf '\\n'
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
                printf '%s\\n' "  \${C_GREEN}Dry-run DISABLED — system changes WILL be made\${C_RESET}"
            else
                DRY_RUN=true
                printf '%s\\n' "  \${C_YELLOW}Dry-run ENABLED — simulation only\${C_RESET}"
            fi
            export DRY_RUN ;;
        q|Q|exit|quit)
            printf '\\n'
            printf '%s\\n' "  \${C_DIM}Goodbye.\${C_RESET}"
            printf '\\n'
            _log "INFO" "Session ended by \${SUDO_USER:-root}"
            exit 0 ;;
        '')
            ;; # Enter key — redraw menu
        *)
            printf '%s\\n' "  \${C_YELLOW}Invalid choice: '$choice'\${C_RESET}" ;;
    esac

    if [[ "$NON_INTERACTIVE" == "true" ]]; then
        break
    fi

    printf '\\n'
    read -r -p "  Press Enter to return to menu…" _
done
`,
  },

  {
    id: 'config',
    name: 'config.conf',
    path: 'config.conf',
    description: 'Central configuration — password policy, paths, notifications, scheduling. Edit before running install.sh. Sourced by every module.',
    badges: ['config'],
    code: `# ═══════════════════════════════════════════════════════════════════════
# Linux User & Access Management Automation — Configuration  v1.0.0
# Target: RHEL 9 / CentOS Stream 9 / Rocky Linux 9
# Edit this file before running install.sh
# ═══════════════════════════════════════════════════════════════════════

# ── General Settings ──────────────────────────────────────────────────────────
ADMIN_EMAIL="admin@company.com"
ADMIN_NAME="IT Administrator"
ORG_NAME="Acme Corporation"
SERVER_HOSTNAME="$(hostname -f 2>/dev/null || hostname)"

# ── Logging ───────────────────────────────────────────────────────────────────
LOG_FILE="/var/log/usermgmt.log"
LOG_LEVEL="INFO"               # DEBUG | INFO | WARN | ERROR
LOG_ROTATE_DAYS=90

# ── Password Policy ───────────────────────────────────────────────────────────
PASS_MIN_DAYS=1                # Minimum days between password changes
PASS_MAX_DAYS=90               # Maximum days before forced change
PASS_WARN_DAYS=14              # Days before expiry to warn user
PASS_INACTIVE_DAYS=30          # Days after expiry before account locks
PASS_MIN_LEN=12                # Minimum password length
PASS_COMPLEXITY=true           # Enforce upper/lower/digit/special
PASS_FORCE_CHANGE=true         # Force change on first login (chage -d 0)

# ── Default User Settings ─────────────────────────────────────────────────────
DEFAULT_SHELL="/bin/bash"
DEFAULT_HOME_BASE="/home"
DEFAULT_UMASK="077"            # New home directories: chmod 700
DEFAULT_GROUPS=""              # Additional groups for ALL users (colon-sep)
SYSTEM_UID_MIN=1000            # UID minimum — refuse to touch UIDs below this

# ── Account Expiry Settings ───────────────────────────────────────────────────
EXPIRY_WARN_DAYS=30            # Warn IT when accounts expire within X days
AUTO_DISABLE_EXPIRED=true      # Disable accounts past their expiry date

# ── SSH Key Management ────────────────────────────────────────────────────────
SSH_KEYS_DIR="/etc/usermgmt/ssh-keys"  # Default public key storage
SSH_KEYS_PERM=600
SSH_DIR_PERM=700

# ── Audit Report Settings ─────────────────────────────────────────────────────
REPORT_OUTPUT_DIR="/var/reports/usermgmt"
REPORT_INACTIVE_DAYS=90        # Flag accounts with no login for this many days
REPORT_EXPIRY_WARN_DAYS=30     # Flag accounts expiring within this many days
SEND_REPORT_EMAIL=false        # Email HTML report to ADMIN_EMAIL
REPORT_CRON="0 7 * * 1"       # Weekly Monday 07:00 (used by install.sh)

# ── Notification Settings ─────────────────────────────────────────────────────
NOTIFY_ON_CREATE=false         # Send welcome email to new users
NOTIFY_ON_DISABLE=true         # Notify admin when account is disabled
NOTIFY_CHANNEL="email"         # email | slack | both
SLACK_WEBHOOK=""               # Slack incoming webhook URL
SMTP_SERVER="localhost"
SMTP_PORT=25

# ── Dry Run Default ───────────────────────────────────────────────────────────
DRY_RUN=false                  # Override with --dry-run flag at runtime
`,
  },

  {
    id: 'create-users',
    name: 'create_users.sh',
    path: 'modules/create_users.sh',
    description: 'Bulk user creation from CSV. Validates fields, creates groups, runs useradd, generates secure passwords, applies aging, sets expiry, deploys SSH keys.',
    badges: ['bash'],
    code: `#!/usr/bin/env bash
# ============================================================
# modules/create_users.sh — Bulk user creation from CSV
# Linux User & Access Management Automation  v1.0.0
# Target : RHEL 9 / CentOS Stream 9 / Rocky Linux 9
# Usage  : ./modules/create_users.sh [--dry-run] <csv_file>
#          Sourced by user_manager.sh or executed standalone.
# Requires: root, openssl, useradd, chpasswd, chage, groupadd
# ============================================================
# shellcheck shell=bash
# shellcheck source=../config.conf
set -euo pipefail

# ── Load configuration ────────────────────────────────────────────────────────
_cu_load_config() {
    local cfg
    cfg="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    if [[ -f "$cfg" ]]; then
        # shellcheck disable=SC1091
        source "$cfg"
    else
        printf '%s\\n' "[WARN] config.conf not found — using built-in defaults" >&2
    fi
}
[[ -z "\${LOG_FILE:-}" ]] && _cu_load_config

# ── Logging ───────────────────────────────────────────────────────────────────
_cu_log() {
    local level="$1"; shift
    local ts msg
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    msg="[$ts] [$level] [CREATE_USERS] $*"
    printf '%s\\n' "$msg"
    printf '%s\\n' "$msg" >> "\${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_cu_dry() {
    if [[ "\${DRY_RUN:-false}" == "true" ]]; then
        _cu_log "DRY" "Would run: $*"
        return 0
    fi
    "$@"
}

# ── Generate a cryptographically secure password ──────────────────────────────
_cu_gen_password() {
    local length="\${PASS_MIN_LEN:-12}"
    local pass
    # Ensure character-class diversity: letters, digits, special
    pass=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9!@#$%' | head -c "$length")
    # Guarantee at least one of each required class (last 4 chars)
    local pad="Aa1!"
    pass="\${pass:0:$(( length - 4 ))}\${pad}"
    printf '%s' "$pass"
}

# ── Deploy SSH public key ─────────────────────────────────────────────────────
_cu_deploy_ssh_key() {
    local username="$1"
    local key_file="$2"
    local home_dir="$3"

    # Resolve key path — try absolute, then SSH_KEYS_DIR, then project ssh-keys/
    local key_path proj_root
    key_path="\${SSH_KEYS_DIR:-/etc/usermgmt/ssh-keys}/\${key_file}"
    if [[ ! -f "$key_path" ]]; then
        proj_root="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
        key_path="\${proj_root}/ssh-keys/\${key_file}"
    fi

    if [[ ! -f "$key_path" ]]; then
        _cu_log "WARN" "SSH key file not found: $key_file — skipping SSH for $username"
        return 0
    fi

    # Validate it is a real public key
    if ! ssh-keygen -l -f "$key_path" &>/dev/null; then
        _cu_log "WARN" "Invalid SSH public key: $key_file — skipping for $username"
        return 0
    fi

    local ssh_dir auth_keys key_fp key_type
    ssh_dir="\${home_dir}/.ssh"
    auth_keys="\${ssh_dir}/authorized_keys"
    key_fp=$(ssh-keygen -l -f "$key_path" 2>/dev/null | awk '{print $2}')
    key_type=$(ssh-keygen -l -f "$key_path" 2>/dev/null | awk '{print $4}')

    _cu_dry mkdir -p "$ssh_dir"
    _cu_dry chmod "\${SSH_DIR_PERM:-700}" "$ssh_dir"

    if [[ "\${DRY_RUN:-false}" != "true" ]]; then
        # Prevent duplicate key
        if [[ -f "$auth_keys" ]] && grep -qF "$(cat "$key_path")" "$auth_keys" 2>/dev/null; then
            _cu_log "WARN" "SSH key already present for $username — skipping"
            return 0
        fi
        cat "$key_path" >> "$auth_keys"
    else
        _cu_log "DRY" "Would append $key_file → \${auth_keys}"
    fi

    _cu_dry chmod "\${SSH_KEYS_PERM:-600}" "$auth_keys"
    _cu_dry chown -R "\${username}:\${username}" "$ssh_dir"
    _cu_log "OK" "SSH key deployed for $username — \${key_type} \${key_fp}"
}

# ── Create a single user from CSV fields ──────────────────────────────────────
_cu_create_user() {
    local username="$1"
    local full_name="$2"
    local email="$3"
    local department="$4"
    local groups="$5"
    local shell="$6"
    local expiry_date="$7"
    local ssh_key_file="$8"

    # ── Validate username ──────────────────────────────────────────────────────
    if ! [[ "$username" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
        _cu_log "ERROR" "Invalid username: '$username' — must match ^[a-z_][a-z0-9_-]{0,31}$"
        return 1
    fi

    # ── Check for existing user ────────────────────────────────────────────────
    if id "$username" &>/dev/null; then
        _cu_log "WARN" "User '$username' already exists — skipping (use usermod to modify)"
        return 2
    fi

    # ── Validate shell ─────────────────────────────────────────────────────────
    local user_shell="\${shell:-\${DEFAULT_SHELL:-/bin/bash}}"
    if [[ -n "$user_shell" ]] && ! grep -qx "$user_shell" /etc/shells 2>/dev/null; then
        _cu_log "WARN" "Shell '$user_shell' not in /etc/shells — falling back to /bin/bash"
        user_shell="/bin/bash"
    fi

    # ── Build secondary groups list ────────────────────────────────────────────
    local secondary_groups="" grp
    if [[ -n "$groups" ]]; then
        local IFS_SAVED="$IFS"
        IFS=':'; read -ra grp_arr <<< "$groups"; IFS="$IFS_SAVED"
        for grp in "\${grp_arr[@]}"; do
            grp="\${grp// /}"
            [[ -z "$grp" ]] && continue
            if ! getent group "$grp" &>/dev/null; then
                _cu_log "INFO" "Group '$grp' does not exist — creating"
                _cu_dry groupadd "$grp" || _cu_log "WARN" "Failed to create group '$grp'"
            fi
            secondary_groups="\${secondary_groups:+\${secondary_groups},}\${grp}"
        done
    fi

    # Append DEFAULT_GROUPS if configured
    if [[ -n "\${DEFAULT_GROUPS:-}" ]]; then
        secondary_groups="\${secondary_groups:+\${secondary_groups},}\${DEFAULT_GROUPS}"
    fi

    # ── Create user account ────────────────────────────────────────────────────
    local useradd_args=("-m" "-c" "$full_name" "-s" "$user_shell")
    [[ -n "$secondary_groups" ]] && useradd_args+=("-G" "$secondary_groups")

    _cu_log "INFO" "Creating: $username | '$full_name' | dept=$department | groups=\${secondary_groups:-none}"
    if ! _cu_dry useradd "\${useradd_args[@]}" "$username"; then
        _cu_log "ERROR" "useradd failed for '$username'"
        return 1
    fi

    # ── Set password ───────────────────────────────────────────────────────────
    local password
    password=$(_cu_gen_password)
    if [[ "\${DRY_RUN:-false}" != "true" ]]; then
        echo "\${username}:\${password}" | chpasswd
        if [[ "\${PASS_FORCE_CHANGE:-true}" == "true" ]]; then
            chage -d 0 "$username"
        fi
    else
        _cu_log "DRY" "Would set password (force change on first login) for $username"
    fi

    # ── Apply password aging policy ────────────────────────────────────────────
    _cu_dry chage \\
        -m "\${PASS_MIN_DAYS:-1}" \\
        -M "\${PASS_MAX_DAYS:-90}" \\
        -W "\${PASS_WARN_DAYS:-14}" \\
        -I "\${PASS_INACTIVE_DAYS:-30}" \\
        "$username"

    # ── Set account expiry ─────────────────────────────────────────────────────
    if [[ -n "$expiry_date" ]]; then
        if date -d "$expiry_date" &>/dev/null 2>&1; then
            _cu_dry chage -E "$expiry_date" "$username"
            _cu_log "INFO" "Account expiry set: $username → $expiry_date"
        else
            _cu_log "WARN" "Invalid expiry date '$expiry_date' for $username — skipping"
        fi
    fi

    # ── Set home directory permissions (700) ───────────────────────────────────
    local home_dir
    home_dir=$(getent passwd "$username" 2>/dev/null | cut -d: -f6)
    if [[ -d "\${home_dir:-}" ]]; then
        _cu_dry chmod 700 "$home_dir"
    fi

    # ── Deploy SSH public key ──────────────────────────────────────────────────
    if [[ -n "$ssh_key_file" && -n "\${home_dir:-}" ]]; then
        _cu_deploy_ssh_key "$username" "$ssh_key_file" "$home_dir"
    fi

    # ── Audit log ─────────────────────────────────────────────────────────────
    local created_by="\${SUDO_USER:-root}"
    _cu_log "OK" "CREATED: $username by $created_by | dept=$department | groups=\${secondary_groups:-none} | expiry=\${expiry_date:-never} | ssh=\${ssh_key_file:-none}"

    # Emit credential line to be captured by caller
    printf 'CRED:%s:%s\\n' "$username" "$password"
    return 0
}

# ── Validate CSV header ───────────────────────────────────────────────────────
_cu_validate_header() {
    local header="$1"
    local expected="username,full_name,email,department,groups,shell,expiry_date,ssh_key_file"
    # Normalise: strip CR, trailing spaces
    header="\${header//$'\\r'/}"
    header="\${header%"\${header##*[![:space:]]}"}"
    if [[ "$header" != "$expected" ]]; then
        printf '[ERROR] Invalid CSV header.\\n' >&2
        printf '[ERROR] Expected: %s\\n' "$expected" >&2
        printf '[ERROR] Got:      %s\\n' "$header"  >&2
        return 1
    fi
    return 0
}

# ── Main entry point ──────────────────────────────────────────────────────────
run_create_users() {
    local csv_file="\${1:?CSV file path is required}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }
    [[ -f "$csv_file" ]] || { printf '[ERROR] CSV not found: %s\\n' "$csv_file" >&2; exit 1; }

    _cu_log "INFO" "━━━ Bulk user creation started — source: $csv_file"
    [[ "\${DRY_RUN:-false}" == "true" ]] && _cu_log "WARN" "=== DRY-RUN MODE — zero system changes will be made ==="

    local line_num=0 created=0 failed=0 skipped=0
    local creds_file
    creds_file=$(mktemp /tmp/usermgmt_creds_XXXXXX)
    chmod 600 "$creds_file"

    while IFS=',' read -r username full_name email department groups shell expiry_date ssh_key_file; do
        line_num=$(( line_num + 1 ))

        # Validate and skip header
        if [[ $line_num -eq 1 ]]; then
            _cu_validate_header \\
                "\${username},\${full_name},\${email},\${department},\${groups},\${shell},\${expiry_date},\${ssh_key_file}" \\
                || exit 1
            continue
        fi

        # Strip carriage returns and leading/trailing spaces from all fields
        username="\${username//$'\\r'/}";         username="\${username#"\${username%%[! ]*}"}"
        shell="\${shell//$'\\r'/}";               shell="\${shell#"\${shell%%[! ]*}"}"
        expiry_date="\${expiry_date//$'\\r'/}";   expiry_date="\${expiry_date#"\${expiry_date%%[! ]*}"}"
        ssh_key_file="\${ssh_key_file//$'\\r'/}"; ssh_key_file="\${ssh_key_file#"\${ssh_key_file%%[! ]*}"}"

        # Skip blank lines and comment lines
        [[ -z "$username" || "$username" =~ ^[[:space:]]*# ]] && { skipped=$(( skipped + 1 )); continue; }

        local result exit_code
        result=$(_cu_create_user \\
            "$username" "$full_name" "$email" "$department" \\
            "$groups" "$shell" "$expiry_date" "$ssh_key_file" 2>&1)
        exit_code=$?

        printf '%s\\n' "$result"

        if [[ $exit_code -eq 0 ]]; then
            created=$(( created + 1 ))
            # Capture CRED: lines
            printf '%s\\n' "$result" | grep '^CRED:' >> "$creds_file" 2>/dev/null || true
        elif [[ $exit_code -eq 2 ]]; then
            skipped=$(( skipped + 1 ))
        else
            failed=$(( failed + 1 ))
            _cu_log "ERROR" "Failed to process CSV line $line_num: $username"
        fi

    done < "$csv_file"

    # ── Summary ────────────────────────────────────────────────────────────────
    printf '\\n'
    printf '╔═════════════════════════════════════════════════════╗\\n'
    printf '║           User Creation Summary                     ║\\n'
    printf '╠═════════════════════════════════════════════════════╣\\n'
    printf '║  %-24s : %-24s ║\\n' "Total rows processed" "$(( line_num - 1 ))"
    printf '║  %-24s : %-24s ║\\n' "Successfully created" "$created"
    printf '║  %-24s : %-24s ║\\n' "Failed" "$failed"
    printf '║  %-24s : %-24s ║\\n' "Skipped (dup/blank)" "$skipped"
    printf '╚═════════════════════════════════════════════════════╝\\n'

    if [[ $created -gt 0 && "\${DRY_RUN:-false}" != "true" ]]; then
        printf '\\n  ⚠  Generated credentials (distribute securely and DELETE file):\\n'
        printf '  ┌──────────────────────────────────────────────────┐\\n'
        while IFS=':' read -r _ user pass; do
            printf '  │  %-18s  %-28s │\\n' "$user" "$pass"
        done < "$creds_file"
        printf '  └──────────────────────────────────────────────────┘\\n'
        printf '  Saved to: %s\\n' "$creds_file"
        printf '  All passwords must be changed on first login (chage -d 0).\\n'
    fi
    printf '\\n'

    _cu_log "INFO" "━━━ Bulk creation complete — created=$created failed=$failed skipped=$skipped"
    [[ $failed -eq 0 ]]
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "\${BASH_SOURCE[0]}" == "\${0}" ]]; then
    DRY_RUN=false
    CSV_FILE=""

    for _arg in "$@"; do
        case "$_arg" in
            --dry-run) DRY_RUN=true ;;
            --help|-h)
                printf 'Usage: %s [--dry-run] <users.csv>\\n\\n' "$0"
                printf 'CSV format (header required):\\n'
                printf '  username,full_name,email,department,groups,shell,expiry_date,ssh_key_file\\n\\n'
                printf 'Options:\\n'
                printf '  --dry-run   Simulate without making any system changes\\n'
                printf '  --help      Show this help\\n\\n'
                printf 'Example:\\n'
                printf '  sudo %s --dry-run templates/users_template.csv\\n' "$0"
                exit 0 ;;
            -*)
                printf '[ERROR] Unknown flag: %s\\n' "$_arg" >&2; exit 1 ;;
            *)
                CSV_FILE="$_arg" ;;
        esac
    done

    [[ -n "$CSV_FILE" ]] || {
        printf 'Usage: %s [--dry-run] <users.csv>\\n' "$0" >&2; exit 1
    }

    export DRY_RUN
    run_create_users "$CSV_FILE"
fi
`,
  },

  {
    id: 'disable-users',
    name: 'disable_users.sh',
    path: 'modules/disable_users.sh',
    description: 'Lock and expire user accounts. Kills active sessions with SIGTERM/SIGKILL, stamps GECOS audit trail, emails admin. Supports single username or CSV bulk input.',
    badges: ['bash'],
    code: `#!/usr/bin/env bash
# ============================================================
# modules/disable_users.sh — Lock and expire user accounts
# Linux User & Access Management Automation  v1.0.0
# Usage : ./modules/disable_users.sh [--dry-run] \\
#             [--reason "TEXT"] <username|csv_file>
# ============================================================
# shellcheck shell=bash
# shellcheck source=../config.conf
set -euo pipefail

_du_load_config() {
    local cfg
    cfg="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    # shellcheck disable=SC1091
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "\${LOG_FILE:-}" ]] && _du_load_config

_du_log() {
    local level="$1"; shift
    local ts msg
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    msg="[$ts] [$level] [DISABLE_USERS] $*"
    printf '%s\\n' "$msg"
    printf '%s\\n' "$msg" >> "\${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_du_dry() {
    if [[ "\${DRY_RUN:-false}" == "true" ]]; then
        _du_log "DRY" "Would run: $*"
        return 0
    fi
    "$@"
}

# ── Notify admin ──────────────────────────────────────────────────────────────
_du_notify_admin() {
    local username="$1"
    local reason="$2"
    [[ "\${NOTIFY_ON_DISABLE:-true}" != "true" ]] && return 0
    [[ -z "\${ADMIN_EMAIL:-}" ]] && return 0
    local ts
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    local body
    body="$(printf '[UserMgmt] Account Disabled: %s\\n\\nUsername : %s\\nReason   : %s\\nTime     : %s\\nAction by: %s\\nServer   : %s\\n\\nThis is an automated notification.' \\
        "$username" "$username" "$reason" "$ts" "\${SUDO_USER:-root}" "$(hostname -f 2>/dev/null || hostname)")"
    if command -v mail &>/dev/null; then
        printf '%s\\n' "$body" \\
            | mail -s "[UserMgmt] Account Disabled: $username" "\${ADMIN_EMAIL}" 2>/dev/null || true
    fi
}

# ── Disable a single user account ────────────────────────────────────────────
_du_disable_user() {
    local username="\${1:?username required}"
    local reason="\${2:-Offboarding}"

    if ! id "$username" &>/dev/null; then
        _du_log "ERROR" "User '$username' does not exist — skipping"
        return 1
    fi

    # Safety: refuse to disable system users
    local uid
    uid=$(id -u "$username")
    if [[ $uid -lt \${SYSTEM_UID_MIN:-1000} ]]; then
        _du_log "ERROR" "Refusing to disable system user '$username' (UID=$uid < \${SYSTEM_UID_MIN:-1000})"
        return 1
    fi

    # Report current lock state
    local pw_status
    pw_status=$(passwd -S "$username" 2>/dev/null | awk '{print $2}')
    if [[ "$pw_status" == "L" || "$pw_status" == "LK" ]]; then
        _du_log "WARN" "User '$username' already appears locked (passwd status: $pw_status)"
    fi

    _du_log "INFO" "Disabling: $username | reason='$reason'"

    # 1. Lock the account (prepends ! to password hash in /etc/shadow)
    _du_dry usermod -L "$username"

    # 2. Set hard expiry to the epoch beginning (effectively expired)
    _du_dry usermod -e 1 "$username"

    # 3. Terminate all active sessions
    if [[ "\${DRY_RUN:-false}" != "true" ]]; then
        pkill -SIGTERM -u "$username" 2>/dev/null || true
        sleep 2
        pkill -SIGKILL -u "$username" 2>/dev/null || true
        _du_log "INFO" "Sessions terminated for $username"
    else
        _du_log "DRY" "Would terminate all sessions for $username"
    fi

    # 4. Stamp GECOS field with an auditable disable record
    local current_comment suffix new_comment
    current_comment=$(getent passwd "$username" | cut -d: -f5)
    suffix="[DISABLED:$(date +%Y-%m-%d):\${SUDO_USER:-root}:\${reason}]"
    new_comment="\${current_comment} \${suffix}"
    # GECOS is capped at 255 chars
    _du_dry usermod -c "\${new_comment:0:255}" "$username"

    _du_log "OK" "DISABLED: $username — by=\${SUDO_USER:-root} reason=$reason uid=$uid"

    # 5. Admin notification
    [[ "\${DRY_RUN:-false}" != "true" ]] && _du_notify_admin "$username" "$reason"
    return 0
}

# ── Main entry point ──────────────────────────────────────────────────────────
run_disable_users() {
    local target="\${1:?username or CSV file required}"
    local reason="\${2:-Offboarding}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }
    [[ "\${DRY_RUN:-false}" == "true" ]] && _du_log "WARN" "=== DRY-RUN MODE — no system changes ==="

    local disabled=0 failed=0

    if [[ -f "$target" ]]; then
        _du_log "INFO" "━━━ Bulk disable from CSV: $target"
        while IFS=',' read -r username _rest; do
            username="\${username//$'\\r'/}"
            username="\${username// /}"
            [[ -z "$username" || "$username" == "username" || "$username" =~ ^# ]] && continue
            if _du_disable_user "$username" "$reason"; then
                disabled=$(( disabled + 1 ))
            else
                failed=$(( failed + 1 ))
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

    printf '\\n'
    printf '╔═══════════════════════════════════════════╗\\n'
    printf '║       Disable Users Summary               ║\\n'
    printf '╠═══════════════════════════════════════════╣\\n'
    printf '║  %-18s : %-20s ║\\n' "Disabled" "$disabled"
    printf '║  %-18s : %-20s ║\\n' "Failed" "$failed"
    printf '╚═══════════════════════════════════════════╝\\n'
    printf '\\n'

    _du_log "INFO" "━━━ Disable complete — disabled=$disabled failed=$failed"
    [[ $failed -eq 0 ]]
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "\${BASH_SOURCE[0]}" == "\${0}" ]]; then
    DRY_RUN=false
    REASON="Offboarding"
    TARGET=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run) DRY_RUN=true ;;
            --reason)
                shift
                REASON="\${1:?Reason text required after --reason}"
                ;;
            --help|-h)
                printf 'Usage: %s [OPTIONS] <username|csv_file>\\n\\n' "$0"
                printf 'Options:\\n'
                printf '  --dry-run          Show what would happen (no changes)\\n'
                printf '  --reason TEXT      Reason for disabling (recorded in GECOS)\\n'
                printf '  --help             Show this help\\n\\n'
                printf 'Arguments:\\n'
                printf '  username           Single username to disable\\n'
                printf '  csv_file           CSV file with usernames in first column\\n\\n'
                printf 'Example:\\n'
                printf '  sudo %s --reason "Resigned 2026-05-27" jsmith\\n' "$0"
                exit 0 ;;
            -*)
                printf '[ERROR] Unknown flag: %s\\n' "$1" >&2; exit 1 ;;
            *)
                TARGET="$1" ;;
        esac
        shift
    done

    [[ -n "$TARGET" ]] || {
        printf 'Usage: %s [--dry-run] [--reason TEXT] <username|csv_file>\\n' "$0" >&2; exit 1
    }

    export DRY_RUN
    run_disable_users "$TARGET" "$REASON"
fi
`,
  },

  {
    id: 'delete-users',
    name: 'delete_users.sh',
    path: 'modules/delete_users.sh',
    description: 'Permanently remove accounts. Refuses system UIDs and current sudo user. Archives home to /var/backup/usermgmt/homes/ before deletion. Interactive confirmation.',
    badges: ['bash'],
    code: `#!/usr/bin/env bash
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
    cfg="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    # shellcheck disable=SC1091
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "\${LOG_FILE:-}" ]] && _delu_load_config

_delu_log() {
    local level="$1"; shift
    local ts msg
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    msg="[$ts] [$level] [DELETE_USERS] $*"
    printf '%s\\n' "$msg"
    printf '%s\\n' "$msg" >> "\${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_delu_dry() {
    if [[ "\${DRY_RUN:-false}" == "true" ]]; then
        _delu_log "DRY" "Would run: $*"
        return 0
    fi
    "$@"
}

# ── Delete a single user ──────────────────────────────────────────────────────
_delu_delete_user() {
    local username="\${1:?username required}"
    local remove_home="\${2:-false}"
    local backup_home="\${3:-true}"

    # Validate user exists
    if ! id "$username" &>/dev/null; then
        _delu_log "ERROR" "User '$username' does not exist"
        return 1
    fi

    # Safety: refuse to delete system accounts (UID below threshold)
    local uid
    uid=$(id -u "$username")
    if [[ $uid -lt \${SYSTEM_UID_MIN:-1000} ]]; then
        _delu_log "ERROR" "Refusing to delete system user '$username' (UID=$uid < \${SYSTEM_UID_MIN:-1000})"
        return 1
    fi

    # Safety: refuse to delete the user running the script
    local running_user="\${SUDO_USER:-$(logname 2>/dev/null || true)}"
    if [[ -n "$running_user" && "$username" == "$running_user" ]]; then
        _delu_log "ERROR" "Refusing to delete the currently logged-in user '$username'"
        return 1
    fi

    local home_dir
    home_dir=$(getent passwd "$username" | cut -d: -f6)
    _delu_log "INFO" "Preparing to delete: $username | UID=$uid | home=$home_dir"

    # ── Backup home directory ──────────────────────────────────────────────────
    if [[ "$backup_home" == "true" && -d "\${home_dir:-}" ]]; then
        if [[ "\${DRY_RUN:-false}" != "true" ]]; then
            local backup_dir="/var/backup/usermgmt/homes"
            local backup_file
            backup_file="\${backup_dir}/\${username}_$(date +%Y%m%d_%H%M%S).tar.gz"
            mkdir -p "$backup_dir"
            chmod 700 "$backup_dir"
            if tar -czf "$backup_file" \\
                    -C "$(dirname "$home_dir")" \\
                    "$(basename "$home_dir")" 2>/dev/null; then
                chmod 600 "$backup_file"
                _delu_log "INFO" "Home directory archived → $backup_file"
            else
                _delu_log "WARN" "Home directory backup failed — continuing with deletion"
            fi
        else
            _delu_log "DRY" "Would archive $home_dir → /var/backup/usermgmt/homes/\${username}_<ts>.tar.gz"
        fi
    fi

    # ── Terminate active sessions ──────────────────────────────────────────────
    if [[ "\${DRY_RUN:-false}" != "true" ]]; then
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

    _delu_log "OK" "DELETED: $username (UID=$uid) by=\${SUDO_USER:-root} remove_home=$remove_home backup=$backup_home"
    return 0
}

# ── Main entry point ──────────────────────────────────────────────────────────
run_delete_user() {
    local username="\${1:?username required}"
    local remove_home="\${REMOVE_HOME:-false}"
    local backup_home="\${BACKUP_HOME:-true}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }
    [[ "\${DRY_RUN:-false}" == "true" ]] && _delu_log "WARN" "=== DRY-RUN MODE — no system changes ==="

    # Interactive confirmation when not in dry-run
    if [[ "\${DRY_RUN:-false}" != "true" ]]; then
        printf '\\n'
        printf '  ⚠  WARNING: Deleting user '\\''%s'\\'' is PERMANENT.\\n' "$username"
        [[ "$backup_home" == "true" ]] \\
            && printf '  Home directory will be archived before deletion.\\n'
        [[ "$remove_home" == "true" ]] \\
            && printf '  Home directory WILL BE REMOVED after archiving.\\n'
        printf '\\n'
        local confirm
        read -r -p "  Type the username to confirm: " confirm
        if [[ "$confirm" != "$username" ]]; then
            printf '  Confirmation mismatch — aborting.\\n'
            exit 1
        fi
    fi

    _delu_delete_user "$username" "$remove_home" "$backup_home"
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "\${BASH_SOURCE[0]}" == "\${0}" ]]; then
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
                printf 'Usage: %s [OPTIONS] <username>\\n\\n' "$0"
                printf 'Options:\\n'
                printf '  --dry-run       Simulate (no changes)\\n'
                printf '  --remove-home   Also delete home directory (backup first by default)\\n'
                printf '  --no-backup     Skip home directory backup (dangerous!)\\n'
                printf '  --help          Show this help\\n\\n'
                printf 'Default backup path: /var/backup/usermgmt/homes/\\n\\n'
                printf 'Example:\\n'
                printf '  sudo %s --remove-home jsmith\\n' "$0"
                exit 0 ;;
            -*)
                printf '[ERROR] Unknown flag: %s\\n' "$1" >&2; exit 1 ;;
            *)
                USERNAME="$1" ;;
        esac
        shift
    done

    [[ -n "$USERNAME" ]] || {
        printf 'Usage: %s [--dry-run] [--remove-home] [--no-backup] <username>\\n' "$0" >&2
        exit 1
    }

    export DRY_RUN REMOVE_HOME BACKUP_HOME
    run_delete_user "$USERNAME"
fi
`,
  },

  {
    id: 'audit-report',
    name: 'audit_report.sh',
    path: 'modules/audit_report.sh',
    description: '7-section dark-themed HTML audit report: all users, sudo users, expiring accounts, inactive accounts, never-logged-in, failed SSH logins, sudo usage log.',
    badges: ['bash'],
    code: `#!/usr/bin/env bash
# ============================================================
# modules/audit_report.sh — HTML access audit report generator
# Linux User & Access Management Automation  v1.0.0
# Usage : ./modules/audit_report.sh [--dry-run] [--output FILE]
# Sections: All Users · Sudo · Expiring · Inactive · Never-Login
#           · Failed Logins · sudo Usage Log
# ============================================================
# shellcheck shell=bash
# shellcheck source=../config.conf
set -euo pipefail

_ar_load_config() {
    local cfg
    cfg="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    # shellcheck disable=SC1091
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "\${LOG_FILE:-}" ]] && _ar_load_config

_ar_log() {
    local level="$1"; shift
    local ts msg
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    msg="[$ts] [$level] [AUDIT_REPORT] $*"
    printf '%s\\n' "$msg"
    printf '%s\\n' "$msg" >> "\${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

# ── HTML page header ──────────────────────────────────────────────────────────
_ar_html_header() {
    local ts="$1"
    local hostname
    hostname=$(hostname -f 2>/dev/null || hostname)
    cat <<EOF
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>User Access Audit — \${hostname} — \${ts}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,system-ui,sans-serif;background:#0a0b0e;color:#cdd6f4;line-height:1.5;padding:24px 32px;max-width:1400px;margin:0 auto}
h1{font-size:22px;color:#89b4fa;margin-bottom:4px}
.meta{font-size:12px;color:#6c7086;margin-bottom:32px}
h2{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#89dceb;margin:32px 0 10px;padding-bottom:6px;border-bottom:1px solid #1e1e2e}
table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:13px}
th{background:#1e1e2e;color:#89b4fa;text-align:left;padding:8px 12px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
td{padding:7px 12px;border-bottom:1px solid #181825;color:#cdd6f4;vertical-align:top}
tr:hover td{background:#1e1e2e}
code{font-family:'JetBrains Mono',monospace;font-size:12px;background:#1e1e2e;padding:1px 5px;border-radius:3px}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}
.ok{background:rgba(166,227,161,.12);color:#a6e3a1;border:1px solid rgba(166,227,161,.25)}
.warn{background:rgba(249,226,175,.12);color:#f9e2af;border:1px solid rgba(249,226,175,.25)}
.err{background:rgba(243,139,168,.12);color:#f38ba8;border:1px solid rgba(243,139,168,.25)}
.grey{background:rgba(108,112,134,.12);color:#6c7086;border:1px solid rgba(108,112,134,.25)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:32px}
.card{background:#1e1e2e;border:1px solid #313244;border-radius:8px;padding:16px;text-align:center}
.card-num{font-size:30px;font-weight:800;color:#89b4fa;line-height:1}
.card-lbl{font-size:11px;color:#6c7086;margin-top:6px;text-transform:uppercase;letter-spacing:.06em}
.card.c-warn .card-num{color:#f9e2af}
.card.c-err  .card-num{color:#f38ba8}
.card.c-ok   .card-num{color:#a6e3a1}
.empty{text-align:center;color:#45475a;padding:20px;font-style:italic}
footer{margin-top:48px;font-size:11px;color:#45475a;text-align:center;border-top:1px solid #1e1e2e;padding-top:16px}
</style>
</head>
<body>
<h1>&#x1F6E1; Linux User &amp; Access Management — Audit Report</h1>
<div class="meta">
  Generated: \${ts}&nbsp;&nbsp;·&nbsp;&nbsp;Host: \${hostname}&nbsp;&nbsp;·&nbsp;&nbsp;By: \${SUDO_USER:-root}&nbsp;&nbsp;·&nbsp;&nbsp;linux-user-access-mgmt v1.0.0
</div>
EOF
}

_ar_html_footer() {
    cat <<'EOF'
<footer>
  Report generated by linux-user-access-mgmt v1.0.0 &nbsp;·&nbsp; Retain per compliance policy &nbsp;·&nbsp; Distribute to authorised personnel only
</footer>
</body>
</html>
EOF
}

# ── Data helpers ──────────────────────────────────────────────────────────────
_ar_last_login() {
    local username="$1"
    local ll
    ll=$(lastlog -u "$username" 2>/dev/null | tail -1)
    if printf '%s' "$ll" | grep -q "Never logged in"; then
        printf 'Never'
    else
        printf '%s' "$ll" | awk '{print $4,$5,$6,$9}' | sed 's/^ *//'
    fi
}

_ar_days_since_login() {
    local username="$1"
    local ll last_field
    ll=$(lastlog -u "$username" 2>/dev/null | tail -1)
    if printf '%s' "$ll" | grep -q "Never logged in"; then
        printf '9999'; return
    fi
    # Extract the year (last field) to detect "Never"
    last_field=$(printf '%s' "$ll" | awk '{print $NF}')
    if ! printf '%s' "$last_field" | grep -qE '^[0-9]{4}$'; then
        printf '9999'; return
    fi
    local date_str ll_ts now_ts
    date_str=$(printf '%s' "$ll" | awk '{print $5,$6,$7,$9}')
    ll_ts=$(date -d "$date_str" +%s 2>/dev/null || printf '0')
    now_ts=$(date +%s)
    printf '%d' "$(( (now_ts - ll_ts) / 86400 ))"
}

_ar_expiry_days_remaining() {
    local username="$1"
    local expiry
    expiry=$(chage -l "$username" 2>/dev/null | grep "Account expires" | awk -F': ' '{print $2}')
    if [[ -z "$expiry" || "$expiry" == "never" ]]; then
        printf ''; return
    fi
    local exp_epoch now
    exp_epoch=$(date -d "$expiry" +%s 2>/dev/null || printf '')
    [[ -z "$exp_epoch" ]] && { printf ''; return; }
    now=$(date +%s)
    printf '%d' "$(( ( exp_epoch - now ) / 86400 ))"
}

# ── Build the HTML report ─────────────────────────────────────────────────────
run_audit_report() {
    local output_file="\${1:-}"
    local report_dir="\${REPORT_OUTPUT_DIR:-/var/reports/usermgmt}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }

    if [[ -z "$output_file" ]]; then
        mkdir -p "$report_dir"
        chmod 750 "$report_dir"
        local ts_file
        ts_file=$(date '+%Y-%m-%d_%H-%M-%S')
        output_file="\${report_dir}/audit_\${ts_file}.html"
    fi

    if [[ "\${DRY_RUN:-false}" == "true" ]]; then
        _ar_log "DRY" "Would generate audit report → $output_file"
        printf '[DRY-RUN] Report would be written to: %s\\n' "$output_file"
        return 0
    fi

    _ar_log "INFO" "━━━ Generating audit report → $output_file"

    # ── Collect regular users ──────────────────────────────────────────────────
    local -a all_users=()
    while IFS=: read -r username _ uid _ _ _home shell; do
        [[ $uid -lt \${SYSTEM_UID_MIN:-1000} ]] && continue
        all_users+=("$username")
    done < /etc/passwd

    local total_users=\${#all_users[@]}
    local sudo_count=0 expiring_soon=0 inactive_count=0
    local never_logged=0 locked_count=0

    for u in "\${all_users[@]}"; do
        id -nG "$u" 2>/dev/null | tr ' ' '\\n' | grep -qxE "wheel|sudo" \\
            && sudo_count=$(( sudo_count + 1 ))

        local days_left
        days_left=$(_ar_expiry_days_remaining "$u")
        if [[ -n "$days_left" && "$days_left" -le \${REPORT_EXPIRY_WARN_DAYS:-30} && "$days_left" -ge 0 ]]; then
            expiring_soon=$(( expiring_soon + 1 ))
        fi

        local days_since
        days_since=$(_ar_days_since_login "$u")
        [[ "$days_since" -ge \${REPORT_INACTIVE_DAYS:-90} ]] \\
            && inactive_count=$(( inactive_count + 1 ))

        local ll
        ll=$(_ar_last_login "$u")
        [[ "$ll" == "Never" ]] && never_logged=$(( never_logged + 1 ))

        local pw_st
        pw_st=$(passwd -S "$u" 2>/dev/null | awk '{print $2}')
        [[ "$pw_st" == "L" || "$pw_st" == "LK" ]] \\
            && locked_count=$(( locked_count + 1 ))
    done

    # ── Write HTML report ──────────────────────────────────────────────────────
    {
        _ar_html_header "$(date '+%Y-%m-%d %H:%M:%S')"

        # Summary cards
        local ec_class wc_class ic_class nc_class lc_class
        ec_class="";       [[ $expiring_soon -gt 0 ]] && ec_class=" c-warn"
        wc_class="";       [[ $sudo_count    -gt 0 ]] && wc_class=" c-warn"
        ic_class="";       [[ $inactive_count -gt 0 ]] && ic_class=" c-warn"
        nc_class="";       [[ $never_logged  -gt 0 ]] && nc_class=" c-warn"
        lc_class="";       [[ $locked_count  -gt 0 ]] && lc_class=" c-err"

        cat <<EOF
<div class="grid">
  <div class="card"><div class="card-num">$total_users</div><div class="card-lbl">Total Users</div></div>
  <div class="card\${wc_class}"><div class="card-num">$sudo_count</div><div class="card-lbl">Sudo Users</div></div>
  <div class="card\${ec_class}"><div class="card-num">$expiring_soon</div><div class="card-lbl">Expiring ≤\${REPORT_EXPIRY_WARN_DAYS:-30}d</div></div>
  <div class="card\${ic_class}"><div class="card-num">$inactive_count</div><div class="card-lbl">Inactive \${REPORT_INACTIVE_DAYS:-90}d+</div></div>
  <div class="card\${nc_class}"><div class="card-num">$never_logged</div><div class="card-lbl">Never Logged In</div></div>
  <div class="card\${lc_class}"><div class="card-num">$locked_count</div><div class="card-lbl">Locked</div></div>
</div>
EOF

        # §1 All Users
        printf '<h2>1. All User Accounts</h2>\\n'
        printf '<table><tr><th>Username</th><th>Full Name</th><th>UID</th><th>Shell</th><th>Groups</th><th>Last Login</th><th>Status</th></tr>\\n'
        for u in "\${all_users[@]}"; do
            local uid gecos shell grps ll pw_st badge
            uid=$(id -u "$u")
            gecos=$(getent passwd "$u" | cut -d: -f5 | cut -d, -f1)
            shell=$(getent passwd "$u" | cut -d: -f7)
            grps=$(id -nG "$u" 2>/dev/null | tr ' ' ',' || printf '')
            ll=$(_ar_last_login "$u")
            pw_st=$(passwd -S "$u" 2>/dev/null | awk '{print $2}')
            case "$pw_st" in
                P|PS) badge='<span class="badge ok">Active</span>' ;;
                L|LK) badge='<span class="badge err">Locked</span>' ;;
                NP)   badge='<span class="badge warn">No Password</span>' ;;
                *)    badge='<span class="badge grey">Unknown</span>' ;;
            esac
            printf '<tr><td><code>%s</code></td><td>%s</td><td>%s</td><td><code>%s</code></td><td><small>%s</small></td><td>%s</td><td>%s</td></tr>\\n' \\
                "$u" "\${gecos:-(none)}" "$uid" "$shell" "$grps" "$ll" "$badge"
        done
        printf '</table>\\n'

        # §2 Sudo Users
        printf '<h2>2. Privileged (sudo / wheel) Users</h2>\\n'
        printf '<table><tr><th>Username</th><th>Full Name</th><th>UID</th><th>Privileged Groups</th><th>Last Login</th></tr>\\n'
        local found_sudo=0
        for u in "\${all_users[@]}"; do
            local grps
            grps=$(id -nG "$u" 2>/dev/null)
            if printf '%s' "$grps" | tr ' ' '\\n' | grep -qxE "wheel|sudo"; then
                local uid gecos ll sudo_grps
                uid=$(id -u "$u")
                gecos=$(getent passwd "$u" | cut -d: -f5 | cut -d, -f1)
                ll=$(_ar_last_login "$u")
                sudo_grps=$(printf '%s' "$grps" | tr ' ' '\\n' | grep -E "^(wheel|sudo)" | tr '\\n' ',' | sed 's/,$//')
                printf '<tr><td><code>%s</code></td><td>%s</td><td>%s</td><td><span class="badge warn">%s</span></td><td>%s</td></tr>\\n' \\
                    "$u" "\${gecos:-(none)}" "$uid" "$sudo_grps" "$ll"
                found_sudo=$(( found_sudo + 1 ))
            fi
        done
        [[ $found_sudo -eq 0 ]] && printf '<tr><td colspan="5" class="empty">No privileged accounts found</td></tr>\\n'
        printf '</table>\\n'

        # §3 Accounts expiring within REPORT_EXPIRY_WARN_DAYS
        printf '<h2>3. Accounts Expiring Within %d Days</h2>\\n' "\${REPORT_EXPIRY_WARN_DAYS:-30}"
        printf '<table><tr><th>Username</th><th>Expiry Date</th><th>Days Remaining</th><th>Recommendation</th></tr>\\n'
        local found_exp=0
        for u in "\${all_users[@]}"; do
            local days_left expiry_date_str
            days_left=$(_ar_expiry_days_remaining "$u")
            [[ -z "$days_left" ]] && continue
            if [[ "$days_left" -le \${REPORT_EXPIRY_WARN_DAYS:-30} ]]; then
                expiry_date_str=$(chage -l "$u" 2>/dev/null | grep "Account expires" | awk -F': ' '{print $2}')
                local badge_class="badge warn"
                [[ "$days_left" -le 7 ]] && badge_class="badge err"
                [[ "$days_left" -lt 0 ]] && badge_class="badge err"
                printf '<tr><td><code>%s</code></td><td>%s</td><td><span class="%s">%dd</span></td><td>Review &amp; extend or offboard</td></tr>\\n' \\
                    "$u" "$expiry_date_str" "$badge_class" "$days_left"
                found_exp=$(( found_exp + 1 ))
            fi
        done
        [[ $found_exp -eq 0 ]] && printf '<tr><td colspan="4" class="empty">No accounts expiring soon</td></tr>\\n'
        printf '</table>\\n'

        # §4 Inactive accounts
        printf '<h2>4. Accounts Inactive for %d+ Days</h2>\\n' "\${REPORT_INACTIVE_DAYS:-90}"
        printf '<table><tr><th>Username</th><th>Last Login</th><th>Days Inactive</th><th>Recommendation</th></tr>\\n'
        local found_inactive=0
        for u in "\${all_users[@]}"; do
            local ds ll
            ds=$(_ar_days_since_login "$u")
            ll=$(_ar_last_login "$u")
            if [[ "$ds" -ge \${REPORT_INACTIVE_DAYS:-90} ]]; then
                printf '<tr><td><code>%s</code></td><td>%s</td><td><span class="badge warn">%dd</span></td><td>Consider disabling or deleting</td></tr>\\n' \\
                    "$u" "$ll" "$ds"
                found_inactive=$(( found_inactive + 1 ))
            fi
        done
        [[ $found_inactive -eq 0 ]] && printf '<tr><td colspan="4" class="empty">No inactive accounts beyond threshold</td></tr>\\n'
        printf '</table>\\n'

        # §5 Never logged in
        printf '<h2>5. Accounts That Have Never Logged In</h2>\\n'
        printf '<table><tr><th>Username</th><th>Home Created (approx)</th><th>Shell</th><th>Status</th></tr>\\n'
        local found_never=0
        for u in "\${all_users[@]}"; do
            local ll
            ll=$(_ar_last_login "$u")
            if [[ "$ll" == "Never" ]]; then
                local home shell created_date
                home=$(getent passwd "$u" | cut -d: -f6)
                shell=$(getent passwd "$u" | cut -d: -f7)
                created_date=$(stat -c %y "\${home}" 2>/dev/null | cut -d' ' -f1 || printf 'unknown')
                printf '<tr><td><code>%s</code></td><td>%s</td><td><code>%s</code></td><td><span class="badge grey">Never logged in</span></td></tr>\\n' \\
                    "$u" "$created_date" "$shell"
                found_never=$(( found_never + 1 ))
            fi
        done
        [[ $found_never -eq 0 ]] && printf '<tr><td colspan="4" class="empty">All provisioned accounts have been used</td></tr>\\n'
        printf '</table>\\n'

        # §6 Failed SSH logins (last 7 days)
        printf '<h2>6. Failed SSH Login Attempts — Last 7 Days</h2>\\n'
        printf '<table><tr><th>Target (user @ source IP)</th><th>Failure Count</th><th>Last Attempt</th></tr>\\n'
        local fail_count=0
        if command -v journalctl &>/dev/null; then
            journalctl --since "7 days ago" _SYSTEMD_UNIT=sshd.service 2>/dev/null \\
            | grep -iE "Failed password|Invalid user" \\
            | awk '
                {
                    user=""; ip=""
                    for(i=1;i<=NF;i++){
                        if($i=="for"||$i=="user") user=$(i+1)
                        if($i=="from") ip=$(i+1)
                    }
                    if(user!="") {
                        key=user" @ "ip
                        count[key]++
                        last[key]=$1" "$2" "$3
                    }
                }
                END {
                    for(k in count)
                        print count[k]"\\t"k"\\t"last[k]
                }' \\
            | sort -rn \\
            | head -25 \\
            | while IFS=$'\\t' read -r cnt key last; do
                local bclass="badge warn"
                [[ "$cnt" -gt 20 ]] && bclass="badge err"
                printf '<tr><td><code>%s</code></td><td><span class="%s">%s</span></td><td>%s</td></tr>\\n' \\
                    "$key" "$bclass" "$cnt" "$last"
                fail_count=$(( fail_count + 1 ))
            done || true
        fi
        if [[ $fail_count -eq 0 ]]; then
            printf '<tr><td colspan="3" class="empty">No failed SSH logins found (or journalctl not available)</td></tr>\\n'
        fi
        printf '</table>\\n'

        # §7 Recent sudo usage
        printf '<h2>7. sudo Usage Log — Last 50 Entries</h2>\\n'
        printf '<table><tr><th>Timestamp</th><th>User</th><th>Command</th></tr>\\n'
        local sudo_count_log=0
        if command -v journalctl &>/dev/null; then
            journalctl --since "30 days ago" 2>/dev/null \\
            | grep 'sudo\\[' \\
            | grep 'COMMAND=' \\
            | tail -50 \\
            | while IFS= read -r sline; do
                local ts_part user_part cmd_part
                ts_part=$(printf '%s' "$sline" | awk '{print $1,$2,$3}')
                user_part=$(printf '%s' "$sline" | grep -oP 'USER=\\K\\S+' 2>/dev/null || printf 'root')
                cmd_part="\${sline##*COMMAND=}"
                printf '<tr><td>%s</td><td><code>%s</code></td><td><code>%s</code></td></tr>\\n' \\
                    "$ts_part" "$user_part" "\${cmd_part:0:200}"
                sudo_count_log=$(( sudo_count_log + 1 ))
            done || true
        elif [[ -f /var/log/secure ]]; then
            grep 'sudo' /var/log/secure 2>/dev/null \\
            | grep 'COMMAND=' \\
            | tail -50 \\
            | while IFS= read -r sline; do
                local ts_part user_part cmd_part
                ts_part=$(printf '%s' "$sline" | awk '{print $1,$2,$3}')
                user_part=$(printf '%s' "$sline" | grep -oP 'USER=\\K\\S+' 2>/dev/null || printf 'root')
                cmd_part="\${sline##*COMMAND=}"
                printf '<tr><td>%s</td><td><code>%s</code></td><td><code>%s</code></td></tr>\\n' \\
                    "$ts_part" "$user_part" "\${cmd_part:0:200}"
            done || true
        fi
        printf '<tr><td colspan="3" class="empty">End of sudo log</td></tr>\\n'
        printf '</table>\\n'

        _ar_html_footer

    } > "$output_file"

    chmod 640 "$output_file"
    _ar_log "OK" "Report written → $output_file ($(wc -c < "$output_file") bytes)"

    # Email report if configured
    if [[ "\${SEND_REPORT_EMAIL:-false}" == "true" ]] \\
    && [[ -n "\${ADMIN_EMAIL:-}" ]] \\
    && command -v mail &>/dev/null; then
        mail -s "[UserMgmt Audit] Access Report — $(date +%Y-%m-%d)" \\
             -a "Content-Type: text/html" \\
             "\${ADMIN_EMAIL}" < "$output_file" 2>/dev/null || true
        _ar_log "INFO" "Report emailed to $ADMIN_EMAIL"
    fi

    printf '\\n  ✔ Audit report: %s\\n\\n' "$output_file"
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "\${BASH_SOURCE[0]}" == "\${0}" ]]; then
    DRY_RUN=false
    OUTPUT_FILE=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run) DRY_RUN=true ;;
            --output)
                shift
                OUTPUT_FILE="\${1:?output path required after --output}"
                ;;
            --help|-h)
                printf 'Usage: %s [--dry-run] [--output /path/report.html]\\n\\n' "$0"
                printf 'Generates a 7-section HTML audit report:\\n'
                printf '  §1 All users (status, last login, groups)\\n'
                printf '  §2 Sudo / wheel members\\n'
                printf '  §3 Accounts expiring within %d days\\n' "\${REPORT_EXPIRY_WARN_DAYS:-30}"
                printf '  §4 Accounts inactive for %d+ days\\n' "\${REPORT_INACTIVE_DAYS:-90}"
                printf '  §5 Never-logged-in accounts\\n'
                printf '  §6 SSH failure attempts (7 days)\\n'
                printf '  §7 sudo usage log (last 50 entries)\\n\\n'
                printf 'Default output: %s/audit_<timestamp>.html\\n' "\${REPORT_OUTPUT_DIR:-/var/reports/usermgmt}"
                exit 0 ;;
            *)
                printf '[ERROR] Unknown argument: %s\\n' "$1" >&2; exit 1 ;;
        esac
        shift
    done

    export DRY_RUN
    run_audit_report "$OUTPUT_FILE"
fi
`,
  },

  {
    id: 'ssh-key-manager',
    name: 'ssh_key_manager.sh',
    path: 'modules/ssh_key_manager.sh',
    description: 'Full SSH key lifecycle: deploy (validate → deduplicate → append), list fingerprints, revoke all keys, rotate (revoke + redeploy). System-wide audit.',
    badges: ['bash'],
    code: `#!/usr/bin/env bash
# ============================================================
# modules/ssh_key_manager.sh — SSH public key lifecycle
# Linux User & Access Management Automation  v1.0.0
# Actions: deploy | list | revoke | rotate | audit
# Usage  : ./modules/ssh_key_manager.sh [--dry-run] <action> [args]
# ============================================================
# shellcheck shell=bash
# shellcheck source=../config.conf
set -euo pipefail

_skm_load_config() {
    local cfg
    cfg="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    # shellcheck disable=SC1091
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "\${LOG_FILE:-}" ]] && _skm_load_config

_skm_log() {
    local level="$1"; shift
    local ts msg
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    msg="[$ts] [$level] [SSH_KEY_MGR] $*"
    printf '%s\\n' "$msg"
    printf '%s\\n' "$msg" >> "\${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_skm_dry() {
    if [[ "\${DRY_RUN:-false}" == "true" ]]; then
        _skm_log "DRY" "Would run: $*"
        return 0
    fi
    "$@"
}

# ── Resolve home directory ────────────────────────────────────────────────────
_skm_home() {
    local username="$1"
    id "$username" &>/dev/null || {
        _skm_log "ERROR" "User '$username' not found"
        return 1
    }
    getent passwd "$username" | cut -d: -f6
}

# ── Resolve public key file path ──────────────────────────────────────────────
_skm_resolve_key() {
    local key_file="$1"
    local key_path

    # Try: exact path, SSH_KEYS_DIR, project ssh-keys/
    if [[ -f "$key_file" ]]; then
        printf '%s' "$key_file"
        return 0
    fi

    key_path="\${SSH_KEYS_DIR:-/etc/usermgmt/ssh-keys}/\${key_file}"
    if [[ -f "$key_path" ]]; then
        printf '%s' "$key_path"
        return 0
    fi

    local proj_root
    proj_root="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
    key_path="\${proj_root}/ssh-keys/\${key_file}"
    if [[ -f "$key_path" ]]; then
        printf '%s' "$key_path"
        return 0
    fi

    return 1
}

# ── Deploy a public key ───────────────────────────────────────────────────────
run_ssh_deploy() {
    local username="\${1:?username required}"
    local key_file="\${2:?key file required}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }

    local home_dir ssh_dir auth_keys key_path key_type key_fp
    home_dir=$(_skm_home "$username")
    ssh_dir="\${home_dir}/.ssh"
    auth_keys="\${ssh_dir}/authorized_keys"

    if ! key_path=$(_skm_resolve_key "$key_file"); then
        _skm_log "ERROR" "Key file not found: $key_file"
        _skm_log "ERROR" "Searched: $key_file, \${SSH_KEYS_DIR:-/etc/usermgmt/ssh-keys}/$key_file, project ssh-keys/$key_file"
        return 1
    fi

    # Validate key format
    if ! ssh-keygen -l -f "$key_path" &>/dev/null; then
        _skm_log "ERROR" "Invalid SSH public key: $key_path"
        return 1
    fi

    key_type=$(ssh-keygen -l -f "$key_path" 2>/dev/null | awk '{print $4}')
    key_fp=$(ssh-keygen -l -f "$key_path"   2>/dev/null | awk '{print $2}')
    _skm_log "INFO" "Deploying $key_type key ($key_fp) for $username"

    # Prevent duplicates
    if [[ "\${DRY_RUN:-false}" != "true" && -f "$auth_keys" ]]; then
        if grep -qF "$(cat "$key_path")" "$auth_keys" 2>/dev/null; then
            _skm_log "WARN" "Key already present in authorized_keys for $username — skipping"
            return 0
        fi
    fi

    _skm_dry mkdir -p "$ssh_dir"
    _skm_dry chmod "\${SSH_DIR_PERM:-700}" "$ssh_dir"

    if [[ "\${DRY_RUN:-false}" != "true" ]]; then
        cat "$key_path" >> "$auth_keys"
    else
        _skm_log "DRY" "Would append $key_file → $auth_keys"
    fi

    _skm_dry chmod "\${SSH_KEYS_PERM:-600}" "$auth_keys"
    _skm_dry chown -R "\${username}:\${username}" "$ssh_dir"
    _skm_log "OK" "SSH key deployed for $username ← $key_file ($key_type $key_fp)"
}

# ── List keys for a user ──────────────────────────────────────────────────────
run_ssh_list() {
    local username="\${1:?username required}"
    local home_dir auth_keys
    home_dir=$(_skm_home "$username")
    auth_keys="\${home_dir}/.ssh/authorized_keys"

    if [[ ! -f "$auth_keys" ]]; then
        printf '\\n  No authorized_keys found for %s\\n\\n' "$username"
        return 0
    fi

    printf '\\n  SSH authorized keys for %s:\\n' "$username"
    printf '  ──────────────────────────────────────────────────────\\n'
    local i=0
    while IFS= read -r line; do
        [[ -z "$line" || "$line" =~ ^# ]] && continue
        i=$(( i + 1 ))
        local tmp fp ktype comment
        tmp=$(mktemp)
        printf '%s\\n' "$line" > "$tmp"
        fp=$(ssh-keygen -l -f "$tmp" 2>/dev/null | awk '{print $2}' || printf 'invalid')
        ktype=$(ssh-keygen -l -f "$tmp" 2>/dev/null | awk '{print $4}' || printf '')
        comment=$(printf '%s' "$line" | awk '{print $NF}')
        rm -f "$tmp"
        printf '  [%2d] %s %-10s %s\\n' "$i" "$fp" "$ktype" "$comment"
    done < "$auth_keys"
    printf '\\n'
}

# ── Revoke all keys for a user ────────────────────────────────────────────────
run_ssh_revoke_all() {
    local username="\${1:?username required}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }

    local home_dir auth_keys
    home_dir=$(_skm_home "$username")
    auth_keys="\${home_dir}/.ssh/authorized_keys"

    if [[ ! -f "$auth_keys" ]]; then
        _skm_log "WARN" "No authorized_keys file for $username — nothing to revoke"
        return 0
    fi

    _skm_log "INFO" "Revoking all SSH keys for $username"

    if [[ "\${DRY_RUN:-false}" != "true" ]]; then
        local key_count
        key_count=$(grep -c '^[^#]' "$auth_keys" 2>/dev/null || printf '0')
        # Truncate file preserving ownership/permissions
        : > "$auth_keys"
        chmod 600 "$auth_keys"
        _skm_log "OK" "Revoked $key_count SSH key(s) for $username"
    else
        _skm_log "DRY" "Would empty $auth_keys for $username"
    fi
}

# ── Rotate key: revoke all then deploy new ───────────────────────────────────
run_ssh_rotate() {
    local username="\${1:?username required}"
    local new_key_file="\${2:?new key file required}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }

    _skm_log "INFO" "Rotating SSH key for $username"
    run_ssh_revoke_all "$username"
    run_ssh_deploy "$username" "$new_key_file"
    _skm_log "OK" "SSH key rotated for $username"
}

# ── Audit all users' SSH key status ──────────────────────────────────────────
run_ssh_audit() {
    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }

    printf '\\n  SSH Key Audit — %s\\n' "$(date '+%Y-%m-%d %H:%M:%S')"
    printf '  ──────────────────────────────────────────────────────────\\n'
    printf '  %-22s %-8s %s\\n' "Username" "Keys" "Fingerprints"
    printf '  ──────────────────────────────────────────────────────────\\n'

    while IFS=: read -r username _ uid _ _ home shell; do
        [[ $uid -lt \${SYSTEM_UID_MIN:-1000} ]] && continue
        [[ "$shell" == "/sbin/nologin" || "$shell" == "/bin/false" ]] && continue

        local auth_keys="\${home}/.ssh/authorized_keys"
        if [[ ! -f "$auth_keys" ]]; then
            printf '  %-22s %-8s %s\\n' "$username" "0" "(no keys)"
            continue
        fi

        local key_count
        key_count=$(grep -c '^[^#]' "$auth_keys" 2>/dev/null || printf '0')

        if [[ "$key_count" -eq 0 ]]; then
            printf '  %-22s %-8s %s\\n' "$username" "0" "(empty file)"
            continue
        fi

        local first=true
        while IFS= read -r keyline; do
            [[ -z "$keyline" || "$keyline" =~ ^# ]] && continue
            local tmp fp
            tmp=$(mktemp)
            printf '%s\\n' "$keyline" > "$tmp"
            fp=$(ssh-keygen -l -f "$tmp" 2>/dev/null | awk '{print $2}' || printf 'invalid')
            rm -f "$tmp"
            if [[ "$first" == "true" ]]; then
                printf '  %-22s %-8s %s\\n' "$username" "$key_count" "$fp"
                first=false
            else
                printf '  %-22s %-8s %s\\n' "" "" "$fp"
            fi
        done < "$auth_keys"
    done < /etc/passwd
    printf '\\n'
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "\${BASH_SOURCE[0]}" == "\${0}" ]]; then
    DRY_RUN=false
    ACTION=""
    ARGS=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)
                DRY_RUN=true ;;
            deploy|list|revoke|rotate|audit)
                ACTION="$1" ;;
            --help|-h)
                cat <<'HELP'
Usage: ssh_key_manager.sh [--dry-run] <action> [args...]

Actions:
  deploy <username> <keyfile>    Deploy public key to user's authorized_keys
  list   <username>              List all authorized keys with fingerprints
  revoke <username>              Remove ALL keys for user (offboarding)
  rotate <username> <keyfile>    Revoke all keys, then deploy the new key
  audit                          Show key summary for all regular users

Key file resolution order:
  1. Absolute path (if provided)
  2. SSH_KEYS_DIR (from config.conf, default /etc/usermgmt/ssh-keys/)
  3. Project ssh-keys/ directory

Examples:
  sudo ./ssh_key_manager.sh deploy jsmith jsmith.pub
  sudo ./ssh_key_manager.sh rotate acontractor acontractor_new.pub
  sudo ./ssh_key_manager.sh audit
HELP
                exit 0 ;;
            *)
                ARGS+=("$1") ;;
        esac
        shift
    done

    [[ -n "$ACTION" ]] || {
        printf 'Usage: %s [--dry-run] <deploy|list|revoke|rotate|audit> [args]\\n' "$0" >&2
        exit 1
    }

    export DRY_RUN

    case "$ACTION" in
        deploy) run_ssh_deploy "\${ARGS[@]}" ;;
        list)   run_ssh_list   "\${ARGS[@]}" ;;
        revoke) run_ssh_revoke_all "\${ARGS[@]}" ;;
        rotate) run_ssh_rotate "\${ARGS[@]}" ;;
        audit)  run_ssh_audit ;;
    esac
fi
`,
  },

  {
    id: 'expire-accounts',
    name: 'expire_accounts.sh',
    path: 'modules/expire_accounts.sh',
    description: 'Scan for expired and soon-to-expire accounts. Auto-disables expired accounts via usermod -L, kills sessions. Supports set-expiry and extend actions.',
    badges: ['bash'],
    code: `#!/usr/bin/env bash
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
    cfg="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    # shellcheck disable=SC1091
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "\${LOG_FILE:-}" ]] && _ea_load_config

_ea_log() {
    local level="$1"; shift
    local ts msg
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    msg="[$ts] [$level] [EXPIRE_ACCTS] $*"
    printf '%s\\n' "$msg"
    printf '%s\\n' "$msg" >> "\${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_ea_dry() {
    if [[ "\${DRY_RUN:-false}" == "true" ]]; then
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
    local warn_only="\${WARN_ONLY:-false}"
    local now warn_epoch
    now=$(date +%s)
    warn_epoch=$(( now + ( \${EXPIRY_WARN_DAYS:-30} * 86400 ) ))

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }

    _ea_log "INFO" "━━━ Account expiry scan (warn_days=\${EXPIRY_WARN_DAYS:-30} auto_disable=\${AUTO_DISABLE_EXPIRED:-true})"
    [[ "\${DRY_RUN:-false}" == "true" ]] && _ea_log "WARN" "=== DRY-RUN MODE ==="

    local expired_count=0 warning_count=0 disabled_count=0
    local -a expiry_report=()

    while IFS=: read -r username _ uid _ _ _home shell; do
        [[ $uid -lt \${SYSTEM_UID_MIN:-1000} ]] && continue
        [[ "$shell" == "/sbin/nologin" || "$shell" == "/bin/false" ]] && continue

        local exp_epoch
        exp_epoch=$(_ea_expiry_epoch "$username")
        [[ "$exp_epoch" == "-1" ]] && continue    # No expiry configured

        local exp_date days_until
        exp_date=$(chage -l "$username" 2>/dev/null | grep "Account expires" | awk -F': ' '{print $2}')
        days_until=$(( ( exp_epoch - now ) / 86400 ))

        if [[ $exp_epoch -le $now ]]; then
            expired_count=$(( expired_count + 1 ))
            _ea_log "WARN" "EXPIRED: $username (expiry: $exp_date, \${days_until}d ago)"
            expiry_report+=( "EXPIRED|\${username}|\${exp_date}|\${days_until}" )

            if [[ "\${AUTO_DISABLE_EXPIRED:-true}" == "true" && "$warn_only" != "true" ]]; then
                local pw_status
                pw_status=$(passwd -S "$username" 2>/dev/null | awk '{print $2}')
                if [[ "$pw_status" != "L" && "$pw_status" != "LK" ]]; then
                    _ea_log "INFO" "Auto-disabling expired account: $username"
                    _ea_dry usermod -L "$username"
                    if [[ "\${DRY_RUN:-false}" != "true" ]]; then
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
            _ea_log "INFO" "EXPIRING SOON: $username in \${days_until}d (expiry: $exp_date)"
            expiry_report+=( "WARNING|\${username}|\${exp_date}|\${days_until}" )
        fi

    done < /etc/passwd

    # ── Summary ────────────────────────────────────────────────────────────────
    printf '\\n'
    printf '╔════════════════════════════════════════════════════╗\\n'
    printf '║         Account Expiry Check Summary               ║\\n'
    printf '╠════════════════════════════════════════════════════╣\\n'
    printf '║  %-28s : %-18s ║\\n' "Expired accounts" "$expired_count"
    printf '║  %-28s : %-18s ║\\n' "Expiring within \${EXPIRY_WARN_DAYS:-30}d" "$warning_count"
    printf '║  %-28s : %-18s ║\\n' "Auto-disabled" "$disabled_count"
    printf '╚════════════════════════════════════════════════════╝\\n'

    if [[ \${#expiry_report[@]} -gt 0 ]]; then
        printf '\\n  Account Expiry Details:\\n'
        printf '  ─────────────────────────────────────────────────────\\n'
        printf '  %-10s %-20s %-15s %s\\n' "STATUS" "Username" "Expiry" "Days"
        printf '  ─────────────────────────────────────────────────────\\n'
        local entry status uname exp_d days
        for entry in "\${expiry_report[@]}"; do
            IFS='|' read -r status uname exp_d days <<< "$entry"
            printf '  %-10s %-20s %-15s %s\\n' "$status" "$uname" "$exp_d" "\${days}d"
        done
    fi
    printf '\\n'

    # Email summary if configured and something noteworthy occurred
    local total_notable=$(( expired_count + warning_count ))
    if [[ "\${SEND_REPORT_EMAIL:-false}" == "true" ]] \\
    && [[ -n "\${ADMIN_EMAIL:-}" ]] \\
    && [[ $total_notable -gt 0 ]] \\
    && command -v mail &>/dev/null; then
        {
            printf 'Account Expiry Report — %s\\n' "$(date '+%Y-%m-%d')"
            printf 'Expired: %d  |  Expiring Soon: %d  |  Auto-disabled: %d\\n\\n' \\
                "$expired_count" "$warning_count" "$disabled_count"
            local e s u d di
            for e in "\${expiry_report[@]}"; do
                IFS='|' read -r s u d di <<< "$e"
                printf '%-10s  %-20s  expiry=%-15s  days=%s\\n' "$s" "$u" "$d" "$di"
            done
        } | mail -s "[UserMgmt] Account Expiry Report — $(date +%Y-%m-%d)" "\${ADMIN_EMAIL}" 2>/dev/null || true
        _ea_log "INFO" "Expiry report emailed to $ADMIN_EMAIL"
    fi

    _ea_log "INFO" "━━━ Scan done — expired=$expired_count warning=$warning_count disabled=$disabled_count"
}

# ── Set a specific expiry date ────────────────────────────────────────────────
run_set_expiry() {
    local username="\${1:?username required}"
    local expiry_date="\${2:?expiry date required (YYYY-MM-DD or 'never')}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }
    id "$username" &>/dev/null || { printf '[ERROR] User '\\''%s'\\'' not found\\n' "$username"; exit 1; }

    if [[ "$expiry_date" == "never" ]]; then
        _ea_dry chage -E -1 "$username"
        _ea_log "OK" "Expiry cleared (never expires) for $username"
    else
        date -d "$expiry_date" &>/dev/null 2>&1 \\
            || { printf '[ERROR] Invalid date: %s\\n' "$expiry_date"; exit 1; }
        _ea_dry chage -E "$expiry_date" "$username"
        _ea_log "OK" "Expiry set → $expiry_date for $username"
    fi
}

# ── Extend account expiry by N days ──────────────────────────────────────────
run_extend_expiry() {
    local username="\${1:?username required}"
    local extend_days="\${2:?number of days required}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }
    id "$username" &>/dev/null || { printf '[ERROR] User '\\''%s'\\'' not found\\n' "$username"; exit 1; }

    local current_expiry new_expiry
    current_expiry=$(chage -l "$username" 2>/dev/null | grep "Account expires" | awk -F': ' '{print $2}')

    if [[ -z "$current_expiry" || "$current_expiry" == "never" ]]; then
        new_expiry=$(date -d "+\${extend_days} days" +%Y-%m-%d)
    else
        new_expiry=$(date -d "\${current_expiry} +\${extend_days} days" +%Y-%m-%d)
    fi

    _ea_dry chage -E "$new_expiry" "$username"
    _ea_log "OK" "Expiry extended by \${extend_days}d for $username → $new_expiry"
    printf '  New expiry: %s\\n' "$new_expiry"
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "\${BASH_SOURCE[0]}" == "\${0}" ]]; then
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
        set-expiry) run_set_expiry "\${ARGS[@]}" ;;
        extend)     run_extend_expiry "\${ARGS[@]}" ;;
        *)
            printf 'Usage: %s [--dry-run] [--warn-only] check|set-expiry|extend [args]\\n' "$0" >&2
            exit 1 ;;
    esac
fi
`,
  },

  {
    id: 'password-policy',
    name: 'password_policy.sh',
    path: 'modules/password_policy.sh',
    description: 'Configure /etc/security/pwquality.conf (minlen, dcredit, dictcheck) and apply chage aging policy (min/max/warn/inactive days) to all or specific users.',
    badges: ['bash'],
    code: `#!/usr/bin/env bash
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
    cfg="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    # shellcheck disable=SC1091
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "\${LOG_FILE:-}" ]] && _pp_load_config

_pp_log() {
    local level="$1"; shift
    local ts msg
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    msg="[$ts] [$level] [PASS_POLICY] $*"
    printf '%s\\n' "$msg"
    printf '%s\\n' "$msg" >> "\${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_pp_dry() {
    if [[ "\${DRY_RUN:-false}" == "true" ]]; then
        _pp_log "DRY" "Would run: $*"
        return 0
    fi
    "$@"
}

# ── Write /etc/security/pwquality.conf ───────────────────────────────────────
run_configure_pwquality() {
    local pwq_conf="/etc/security/pwquality.conf"
    local min_len="\${PASS_MIN_LEN:-12}"

    _pp_log "INFO" "Configuring PAM pwquality: $pwq_conf (minlen=$min_len)"

    if [[ "\${DRY_RUN:-false}" != "true" ]]; then
        # Back up existing config
        if [[ -f "$pwq_conf" ]]; then
            # SC2155 fix: separate declare and assign
            local bak
            bak="\${pwq_conf}.bak.$(date +%Y%m%d%H%M%S)"
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
minlen = \${min_len}

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

    if [[ "\${DRY_RUN:-false}" == "true" ]]; then
        _pp_log "DRY" "Would write pwquality.conf:"
        printf '%s\\n' "$pwq_content" | while IFS= read -r line; do
            _pp_log "DRY" "  $line"
        done
    else
        printf '%s\\n' "$pwq_content" > "$pwq_conf"
        chmod 644 "$pwq_conf"
        _pp_log "OK" "pwquality.conf written: minlen=$min_len dcredit=-1 ucredit=-1 lcredit=-1 ocredit=-1"
    fi
}

# ── Apply chage aging policy to one user ─────────────────────────────────────
_pp_apply_aging() {
    local username="\${1:?username required}"

    if ! id "$username" &>/dev/null; then
        _pp_log "ERROR" "User '$username' does not exist"
        return 1
    fi

    # Skip system users silently
    local uid
    uid=$(id -u "$username")
    [[ $uid -lt \${SYSTEM_UID_MIN:-1000} ]] && return 0

    _pp_log "INFO" "Aging policy → $username (min=\${PASS_MIN_DAYS:-1} max=\${PASS_MAX_DAYS:-90} warn=\${PASS_WARN_DAYS:-14} inactive=\${PASS_INACTIVE_DAYS:-30})"

    _pp_dry chage \\
        -m "\${PASS_MIN_DAYS:-1}" \\
        -M "\${PASS_MAX_DAYS:-90}" \\
        -W "\${PASS_WARN_DAYS:-14}" \\
        -I "\${PASS_INACTIVE_DAYS:-30}" \\
        "$username"

    _pp_log "OK" "Aging applied: $username"
}

# ── Apply aging to ALL regular users ─────────────────────────────────────────
run_apply_aging_all() {
    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }
    _pp_log "INFO" "━━━ Applying aging policy to all regular users"
    [[ "\${DRY_RUN:-false}" == "true" ]] && _pp_log "WARN" "=== DRY-RUN MODE ==="

    local applied=0 skipped=0

    while IFS=: read -r username _ uid _ _ _home shell; do
        [[ $uid -lt \${SYSTEM_UID_MIN:-1000} ]] && continue
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

    printf '\\n'
    printf '╔══════════════════════════════════════════════════╗\\n'
    printf '║       Password Aging Policy Applied              ║\\n'
    printf '╠══════════════════════════════════════════════════╣\\n'
    printf '║  %-24s : %-20s ║\\n' "Users updated" "$applied"
    printf '║  %-24s : %-20s ║\\n' "Skipped" "$skipped"
    printf '║  %-24s : %-20s ║\\n' "Max age (days)" "\${PASS_MAX_DAYS:-90}"
    printf '║  %-24s : %-20s ║\\n' "Warn period (days)" "\${PASS_WARN_DAYS:-14}"
    printf '║  %-24s : %-20s ║\\n' "Inactive lockout" "\${PASS_INACTIVE_DAYS:-30}"
    printf '╚══════════════════════════════════════════════════╝\\n'
    printf '\\n'
    _pp_log "INFO" "━━━ Policy applied — updated=$applied skipped=$skipped"
}

# ── Show current chage info ───────────────────────────────────────────────────
run_show_aging() {
    local username="\${1:?username required}"
    id "$username" &>/dev/null || { printf '[ERROR] User '\\''%s'\\'' not found\\n' "$username"; exit 1; }
    printf '\\n  Password aging for: %s\\n' "$username"
    printf '  ──────────────────────────────────────────\\n'
    chage -l "$username" | while IFS= read -r line; do
        printf '  %s\\n' "$line"
    done
    printf '\\n'
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "\${BASH_SOURCE[0]}" == "\${0}" ]]; then
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
                TARGET="\${1:?username required after --user}"
                ACTION="user"
                ;;
            --show)
                shift
                run_show_aging "\${1:?username required after --show}"
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
                printf '[ERROR] Unknown argument: %s\\n' "$1" >&2; exit 1 ;;
        esac
        shift
    done

    export DRY_RUN

    case "$ACTION" in
        pwquality) run_configure_pwquality ;;
        all)       run_apply_aging_all ;;
        user)
            [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }
            _pp_apply_aging "$TARGET"
            ;;
        *)
            printf 'Usage: %s [--dry-run] --all | --pwquality | --user <name> | --show <name>\\n' "$0" >&2
            exit 1 ;;
    esac
fi
`,
  },

  {
    id: 'set-permissions',
    name: 'set_permissions.sh',
    path: 'modules/set_permissions.sh',
    description: 'POSIX ACL and group management: add/remove group membership, set/remove ACLs with setfacl, create SGID shared directories with default ACL inheritance.',
    badges: ['bash'],
    code: `#!/usr/bin/env bash
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
    cfg="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)/config.conf"
    # shellcheck disable=SC1091
    [[ -f "$cfg" ]] && source "$cfg"
}
[[ -z "\${LOG_FILE:-}" ]] && _sp_load_config

_sp_log() {
    local level="$1"; shift
    local ts msg
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    msg="[$ts] [$level] [SET_PERMS] $*"
    printf '%s\\n' "$msg"
    printf '%s\\n' "$msg" >> "\${LOG_FILE:-/var/log/usermgmt.log}" 2>/dev/null || true
}

_sp_dry() {
    if [[ "\${DRY_RUN:-false}" == "true" ]]; then
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
    local username="\${1:?username required}"
    local group="\${2:?group name required}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }

    if ! id "$username" &>/dev/null; then
        _sp_log "ERROR" "User '$username' does not exist"
        return 1
    fi

    if ! getent group "$group" &>/dev/null; then
        _sp_log "INFO" "Group '$group' not found — creating it"
        _sp_dry groupadd "$group"
    fi

    if id -nG "$username" 2>/dev/null | tr ' ' '\\n' | grep -qx "$group"; then
        _sp_log "WARN" "User '$username' is already a member of '$group' — skipping"
        return 0
    fi

    _sp_dry usermod -aG "$group" "$username"
    _sp_log "OK" "Added $username → group $group"
}

# ── Remove user from group ────────────────────────────────────────────────────
run_remove_user_from_group() {
    local username="\${1:?username required}"
    local group="\${2:?group name required}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }

    if ! id "$username" &>/dev/null; then
        _sp_log "ERROR" "User '$username' does not exist"
        return 1
    fi

    _sp_dry gpasswd -d "$username" "$group"
    _sp_log "OK" "Removed $username from group $group"
}

# ── Set POSIX ACL on a directory ──────────────────────────────────────────────
run_set_acl() {
    local target_dir="\${1:?directory required}"
    local acl_spec="\${2:?ACL spec required}"    # e.g. "u:jsmith:rwx"
    local recursive="\${3:-false}"
    local set_default="\${4:-false}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }
    _sp_need_acl || return 1

    if [[ ! -d "$target_dir" ]]; then
        _sp_log "ERROR" "Directory not found: $target_dir"
        return 1
    fi

    local setfacl_args=("-m" "$acl_spec")
    [[ "$recursive" == "true" ]] && setfacl_args+=("-R")

    _sp_log "INFO" "Setting ACL: $acl_spec on $target_dir (recursive=$recursive default=$set_default)"
    _sp_dry setfacl "\${setfacl_args[@]}" "$target_dir"

    # Set as default ACL so newly created files inherit it
    if [[ "$set_default" == "true" ]]; then
        local default_spec="d:\${acl_spec}"
        _sp_dry setfacl -m "$default_spec" "$target_dir"
        _sp_log "INFO" "Default ACL set: $default_spec on $target_dir"
    fi

    _sp_log "OK" "ACL applied: $acl_spec → $target_dir"

    if [[ "\${DRY_RUN:-false}" != "true" ]]; then
        _sp_log "INFO" "Current ACLs for $target_dir:"
        getfacl "$target_dir" 2>/dev/null | grep -v '^#' | while IFS= read -r acl_line; do
            _sp_log "INFO" "  $acl_line"
        done || true
    fi
}

# ── Remove ACL entries from a directory ───────────────────────────────────────
run_remove_acl() {
    local target_dir="\${1:?directory required}"
    local username="\${2:-}"
    local group="\${3:-}"

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }
    _sp_need_acl || return 1

    if [[ -n "$username" ]]; then
        _sp_dry setfacl -x "u:\${username}" "$target_dir"
        _sp_dry setfacl -x "d:u:\${username}" "$target_dir" 2>/dev/null || true
        _sp_log "OK" "Removed ACL for user $username on $target_dir"
    fi

    if [[ -n "$group" ]]; then
        _sp_dry setfacl -x "g:\${group}" "$target_dir"
        _sp_dry setfacl -x "d:g:\${group}" "$target_dir" 2>/dev/null || true
        _sp_log "OK" "Removed ACL for group $group on $target_dir"
    fi
}

# ── Create a shared directory with SGID bit ───────────────────────────────────
run_setup_shared_dir() {
    local dir="\${1:?directory path required}"
    local owner_group="\${2:?owner group required}"
    local permissions="\${3:-2775}"    # SGID + rwxrwxr-x

    [[ $EUID -eq 0 ]] || { printf '[ERROR] Must run as root\\n' >&2; exit 1; }

    if [[ ! -d "$dir" ]]; then
        _sp_log "INFO" "Creating shared directory: $dir"
        _sp_dry mkdir -p "$dir"
    fi

    if ! getent group "$owner_group" &>/dev/null; then
        _sp_log "INFO" "Group '$owner_group' not found — creating it"
        _sp_dry groupadd "$owner_group"
    fi

    _sp_dry chown "root:\${owner_group}" "$dir"
    _sp_dry chmod "$permissions" "$dir"

    # Default ACL so all new files inherit group ownership
    if command -v setfacl &>/dev/null; then
        _sp_dry setfacl -d -m "g:\${owner_group}:rwx" "$dir"
        _sp_log "INFO" "Default ACL set for group '$owner_group' on $dir"
    fi

    _sp_log "OK" "Shared directory ready: $dir (group=$owner_group mode=$permissions SGID)"
}

# ── Standalone execution ──────────────────────────────────────────────────────
if [[ "\${BASH_SOURCE[0]}" == "\${0}" ]]; then
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
        add-group)    run_add_user_to_group "\${ARGS[@]}" ;;
        remove-group) run_remove_user_from_group "\${ARGS[@]}" ;;
        set-acl)      run_set_acl "\${ARGS[@]}" ;;
        remove-acl)   run_remove_acl "\${ARGS[@]}" ;;
        shared-dir)   run_setup_shared_dir "\${ARGS[@]}" ;;
        *)
            printf 'Usage: %s [--dry-run] <add-group|remove-group|set-acl|remove-acl|shared-dir> [args]\\n' "$0" >&2
            exit 1 ;;
    esac
fi
`,
  },

  {
    id: 'csv-template',
    name: 'users_template.csv',
    path: 'templates/users_template.csv',
    description: 'CSV template for bulk user import. Copy, fill in your users, pass to create_users.sh. All 8 columns documented with examples.',
    badges: ['csv'],
    code: `username,full_name,email,department,groups,shell,expiry_date,ssh_key_file
jsmith,John Smith,j.smith@company.com,IT,sudo:developers,/bin/bash,2026-12-31,jsmith.pub
mrahman,Mehedi Rahman,m.rahman@company.com,Finance,finance:reports,/bin/bash,,
acontractor,Alex Contractor,alex@vendor.com,Vendor,vendor-read,/bin/bash,2026-06-30,alex.pub
lwilson,Laura Wilson,l.wilson@company.com,HR,hr-staff:reports,/bin/bash,,
dkumar,Dev Kumar,d.kumar@company.com,Engineering,developers:docker,/bin/bash,,dkumar.pub
scarroll,Sarah Carroll,s.carroll@company.com,DevOps,developers:sudo:docker,/bin/bash,2027-01-01,scarroll.pub
`,
  }

];
