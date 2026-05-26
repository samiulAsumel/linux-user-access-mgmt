// scripts-data.js — Embedded script content for the web script explorer
// Each entry mirrors the actual file in the repo.
// linux-user-access-mgmt v1.0.0

const SCRIPTS_DATA = [
  {
    id: 'user-manager',
    name: 'user_manager.sh',
    path: 'user_manager.sh',
    description: 'Main interactive menu. Orchestrates all 8 modules. Supports --dry-run and --non-interactive flags.',
    badges: ['bash'],
    code: `#!/usr/bin/env bash
# user_manager.sh — Linux User & Access Management Automation  v1.0.0
# Interactive menu-driven orchestrator for all user management modules.
# Target: RHEL 9 / CentOS Stream 9 / Rocky Linux 9
# Usage:  sudo ./user_manager.sh [--dry-run] [--non-interactive]

readonly VERSION="1.0.0"
readonly MODULES_DIR="\\$(cd "\\$(dirname "\\${BASH_SOURCE[0]}")" && pwd)/modules"

# Main menu options:
#   1) Create users from CSV
#   2) Create single user (interactive)
#   3) Disable user(s)
#   4) Delete user (permanent)
#   5) Generate audit report (HTML)
#   6) Manage SSH keys
#   7) Check / manage account expiry
#   8) Set permissions / ACLs
#   9) Apply password policy
#   d) Toggle dry-run mode
#   q) Exit

# Loads config.conf, validates root, sources each module.
# All module functions run in the same shell process.
# Log file: /var/log/usermgmt.log

source config.conf
source modules/create_users.sh
source modules/disable_users.sh
source modules/delete_users.sh
source modules/audit_report.sh
source modules/ssh_key_manager.sh
source modules/expire_accounts.sh
source modules/set_permissions.sh
source modules/password_policy.sh`,
  },

  {
    id: 'config',
    name: 'config.conf',
    path: 'config.conf',
    description: 'Central configuration. All password policy, paths, notification, and scheduling settings. Edit before running install.sh.',
    badges: ['config'],
    code: `# ═══════════════════════════════════════════════════════════════════════
# Linux User & Access Management Automation — Configuration  v1.0.0
# Target: RHEL 9 / CentOS Stream 9 / Rocky Linux 9
# ═══════════════════════════════════════════════════════════════════════

# ── General ───────────────────────────────────────────────────────────────────
ADMIN_EMAIL="admin@company.com"
ORG_NAME="Acme Corporation"

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
PASS_FORCE_CHANGE=true         # Force change on first login (chage -d 0)

# ── Default User Settings ─────────────────────────────────────────────────────
DEFAULT_SHELL="/bin/bash"
DEFAULT_GROUPS=""              # Additional groups for ALL users (colon-sep)
SYSTEM_UID_MIN=1000            # Refuse to touch UIDs below this

# ── Account Expiry ────────────────────────────────────────────────────────────
EXPIRY_WARN_DAYS=30
AUTO_DISABLE_EXPIRED=true

# ── SSH Key Management ────────────────────────────────────────────────────────
SSH_KEYS_DIR="/etc/usermgmt/ssh-keys"
SSH_KEYS_PERM=600
SSH_DIR_PERM=700

# ── Audit Report ─────────────────────────────────────────────────────────────
REPORT_OUTPUT_DIR="/var/reports/usermgmt"
REPORT_INACTIVE_DAYS=90
REPORT_EXPIRY_WARN_DAYS=30
SEND_REPORT_EMAIL=false
REPORT_CRON="0 7 * * 1"       # Weekly Monday 07:00

# ── Dry Run ───────────────────────────────────────────────────────────────────
DRY_RUN=false                  # Override with --dry-run flag`,
  },

  {
    id: 'create-users',
    name: 'create_users.sh',
    path: 'modules/create_users.sh',
    description: 'Bulk user creation from CSV. Validates fields, creates groups, runs useradd, sets passwords, deploys SSH keys.',
    badges: ['bash'],
    code: `#!/usr/bin/env bash
# modules/create_users.sh — Bulk user creation from CSV manifest
# Usage: ./modules/create_users.sh [--dry-run] <csv_file>
set -euo pipefail

# CSV format expected:
# username,full_name,email,department,groups,shell,expiry_date,ssh_key_file

run_create_users() {
    local csv_file="\\${1:?CSV file required}"

    [[ \\$EUID -eq 0 ]] || { echo "[ERROR] Must run as root" >&2; exit 1; }
    [[ -f "\\$csv_file" ]] || { echo "[ERROR] CSV not found: \\$csv_file" >&2; exit 1; }

    _cu_log "INFO" "Bulk user creation from: \\$csv_file"
    [[ "\\${DRY_RUN:-false}" == "true" ]] && _cu_log "WARN" "=== DRY-RUN MODE ==="

    local line_num=0 created=0 failed=0 skipped=0

    while IFS=',' read -r username full_name email department \\
                        groups shell expiry_date ssh_key_file; do
        line_num=\\$((line_num + 1))
        [[ \\$line_num -eq 1 ]] && { _cu_validate_header "..."; continue; }
        [[ -z "\\$username" ]] && { skipped=\\$((skipped+1)); continue; }

        if _cu_create_user "\\$username" "\\$full_name" "\\$email" \\
                "\\$department" "\\$groups" "\\$shell" "\\$expiry_date" "\\$ssh_key_file"; then
            created=\\$((created + 1))
        else
            failed=\\$((failed + 1))
        fi
    done < "\\$csv_file"

    echo "Created: \\$created  Failed: \\$failed  Skipped: \\$skipped"
}

_cu_create_user() {
    local username="\\$1" full_name="\\$2" email="\\$3"
    local department="\\$4" groups="\\$5" shell="\\$6"
    local expiry_date="\\$7" ssh_key_file="\\$8"

    # Validate username (POSIX: ^[a-z_][a-z0-9_-]{0,31}$)
    [[ "\\$username" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || return 1

    # Skip if user already exists
    id "\\$username" &>/dev/null && return 2

    # Create missing groups, then useradd
    local secondary_groups=""
    IFS=':' read -ra grp_arr <<< "\\$groups"
    for grp in "\\${grp_arr[@]}"; do
        getent group "\\$grp" &>/dev/null || groupadd "\\$grp"
        secondary_groups="\\${secondary_groups:+\\${secondary_groups},}\\${grp}"
    done

    useradd -m -c "\\$full_name" -s "\\${shell:-/bin/bash}" \\
            -G "\\$secondary_groups" "\\$username"

    # Set secure random password, force change on first login
    local password; password=\\$(openssl rand -base64 14 | tr -dc 'a-zA-Z0-9!@#' | head -c 12)
    echo "\\${username}:\\${password}" | chpasswd
    chage -d 0 "\\$username"

    # Apply password aging
    chage -m 1 -M 90 -W 14 -I 30 "\\$username"

    # Set expiry if provided
    [[ -n "\\$expiry_date" ]] && chage -E "\\$expiry_date" "\\$username"

    # Set home directory permissions
    chmod 700 "\\$(getent passwd "\\$username" | cut -d: -f6)"

    # Deploy SSH key if provided
    [[ -n "\\$ssh_key_file" ]] && _cu_deploy_ssh_key "\\$username" "\\$ssh_key_file"

    echo "[\\$(date)] CREATED: \\$username by \\${SUDO_USER:-root}" >> /var/log/usermgmt.log
}`,
  },

  {
    id: 'disable-users',
    name: 'disable_users.sh',
    path: 'modules/disable_users.sh',
    description: 'Lock and expire user accounts. Kills active sessions, updates GECOS with audit trail, notifies admin.',
    badges: ['bash'],
    code: `#!/usr/bin/env bash
# modules/disable_users.sh — Lock and expire user accounts (offboarding)
# Usage: ./modules/disable_users.sh [--dry-run] [--reason "TEXT"] <username|csv>
set -euo pipefail

_du_disable_user() {
    local username="\\${1:?username required}"
    local reason="\\${2:-Offboarding}"

    # Safety: refuse to disable system users (UID < 1000)
    local uid; uid=\\$(id -u "\\$username")
    [[ \\$uid -lt \\${SYSTEM_UID_MIN:-1000} ]] && return 1

    _du_log "INFO" "Disabling: \\$username | reason='\\$reason'"

    # 1. Lock account (prepend ! to password hash in /etc/shadow)
    usermod -L "\\$username"

    # 2. Expire account immediately
    usermod -e 1 "\\$username"

    # 3. Terminate all active sessions
    pkill -SIGTERM -u "\\$username" 2>/dev/null || true
    sleep 2
    pkill -SIGKILL -u "\\$username" 2>/dev/null || true

    # 4. Update GECOS with audit trail
    local comment; comment=\\$(getent passwd "\\$username" | cut -d: -f5)
    local suffix="[DISABLED:\\$(date +%Y-%m-%d):\\${SUDO_USER:-root}:\\${reason}]"
    usermod -c "\\${comment} \\${suffix}" "\\$username"

    _du_log "OK" "DISABLED: \\$username"

    # 5. Notify admin via email
    [[ "\\${NOTIFY_ON_DISABLE:-true}" == "true" ]] && _du_notify_admin "\\$username" "\\$reason"
}

run_disable_users() {
    local target="\\${1:?username or CSV required}"
    local reason="\\${2:-Offboarding}"

    if [[ -f "\\$target" ]]; then
        # Bulk disable from CSV
        while IFS=',' read -r username _rest; do
            [[ -z "\\$username" || "\\$username" == "username" ]] && continue
            _du_disable_user "\\$username" "\\$reason"
        done < "\\$target"
    else
        # Single user
        _du_disable_user "\\$target" "\\$reason"
    fi
}`,
  },

  {
    id: 'delete-users',
    name: 'delete_users.sh',
    path: 'modules/delete_users.sh',
    description: 'Permanently delete user accounts. Backs up home directory first, refuses to delete system users, interactive confirmation.',
    badges: ['bash'],
    code: `#!/usr/bin/env bash
# modules/delete_users.sh — Permanently remove a user account
# Usage: ./modules/delete_users.sh [--dry-run] [--remove-home] [--no-backup] <username>
# WARNING: This operation is destructive. Home backup is performed by default.
set -euo pipefail

_delu_delete_user() {
    local username="\\${1:?username required}"
    local remove_home="\\${2:-false}"
    local backup_home="\\${3:-true}"

    # Safety: refuse to delete system accounts (UID < 1000)
    local uid; uid=\\$(id -u "\\$username")
    [[ \\$uid -lt \\${SYSTEM_UID_MIN:-1000} ]] && {
        _delu_log "ERROR" "Refusing to delete system user (UID=\\$uid)"
        return 1
    }

    # Safety: refuse to delete the currently logged-in user
    [[ "\\$username" == "\\${SUDO_USER:-}" ]] && {
        _delu_log "ERROR" "Refusing to delete the current user"
        return 1
    }

    local home_dir; home_dir=\\$(getent passwd "\\$username" | cut -d: -f6)

    # Backup home directory before deletion
    if [[ "\\$backup_home" == "true" && -d "\\${home_dir:-}" ]]; then
        local backup_file="/var/backup/usermgmt/homes/\\${username}_\\$(date +%Y%m%d_%H%M%S).tar.gz"
        mkdir -p "\\$(dirname "\\$backup_file")"
        tar -czf "\\$backup_file" -C "\\$(dirname "\\$home_dir")" "\\$(basename "\\$home_dir")"
        chmod 600 "\\$backup_file"
        _delu_log "INFO" "Home archived: \\$backup_file"
    fi

    # Terminate active sessions
    pkill -SIGTERM -u "\\$username" 2>/dev/null || true
    sleep 1
    pkill -SIGKILL -u "\\$username" 2>/dev/null || true

    # Remove the account
    if [[ "\\$remove_home" == "true" ]]; then
        userdel -r "\\$username"
    else
        userdel "\\$username"
    fi

    _delu_log "OK" "DELETED: \\$username by \\${SUDO_USER:-root}"
}`,
  },

  {
    id: 'audit-report',
    name: 'audit_report.sh',
    path: 'modules/audit_report.sh',
    description: 'Generates a 7-section HTML audit report. Active users, sudo access, expiring accounts, inactive accounts, failed logins, never-logged-in, sudo usage.',
    badges: ['bash'],
    code: `#!/usr/bin/env bash
# modules/audit_report.sh — Generate HTML access audit report
# Usage: ./modules/audit_report.sh [--dry-run] [--output /path/report.html]
# 7 sections: All Users · Sudo · Expiring · Inactive · Never Logged ·
#             Failed Logins · sudo Usage Log
set -euo pipefail

run_audit_report() {
    local output_file="\\${1:-/var/reports/usermgmt/audit_\\$(date +%Y%m%d_%H%M%S).html}"
    local all_users=()

    # Collect all regular users
    while IFS=: read -r username _ uid _ _ home shell; do
        [[ \\$uid -lt \\${SYSTEM_UID_MIN:-1000} ]] && continue
        all_users+=("\\$username")
    done < /etc/passwd

    # Generate HTML report
    {
        _ar_html_header "\\$(date '+%Y-%m-%d %H:%M:%S')"

        # Summary cards: Total · Sudo · Expiring · Inactive · Never-Login · Locked
        echo "<div class='summary-grid'>..."

        # § 1: All User Accounts — username, name, UID, shell, groups, last login, status
        echo "<h2>1. All User Accounts</h2><table>..."
        for u in "\\${all_users[@]}"; do
            local ll; ll=\\$(lastlog -u "\\$u" | tail -1)
            local pw_status; pw_status=\\$(passwd -S "\\$u" | awk '{print \\$2}')
            echo "<tr><td>\\$u</td><td>\\$ll</td><td>\\$pw_status</td></tr>"
        done
        echo "</table>"

        # § 2: Sudo Users — getent group wheel sudo
        # § 3: Expiring in 30 days — chage -l each user
        # § 4: Inactive 90+ days — lastlog comparison
        # § 5: Never logged in
        # § 6: Failed logins — journalctl _SYSTEMD_UNIT=sshd | grep Failed
        # § 7: sudo usage — journalctl | grep sudo\\[ | tail -50

        _ar_html_footer
    } > "\\$output_file"

    chmod 640 "\\$output_file"
    echo "  ✔ Report: \\$output_file"

    # Email report if SEND_REPORT_EMAIL=true
    [[ "\\${SEND_REPORT_EMAIL:-false}" == "true" ]] &&
        mail -s "[UserMgmt Audit]" -a "Content-Type: text/html" \\
             "\\$ADMIN_EMAIL" < "\\$output_file"
}`,
  },

  {
    id: 'ssh-key-manager',
    name: 'ssh_key_manager.sh',
    path: 'modules/ssh_key_manager.sh',
    description: 'Deploy, list, revoke, and rotate SSH public keys. Validates key format with ssh-keygen, prevents duplicates, audits all users.',
    badges: ['bash'],
    code: `#!/usr/bin/env bash
# modules/ssh_key_manager.sh — Deploy, rotate, revoke SSH public keys
# Usage: ./modules/ssh_key_manager.sh [--dry-run] <action> [args...]
#
# Actions:
#   deploy <username> <keyfile>    Deploy public key to authorized_keys
#   list   <username>              List all authorized keys for user
#   revoke <username>              Remove ALL keys (offboarding)
#   rotate <username> <keyfile>    Revoke all, then deploy new key
#   audit                          Audit SSH keys for all regular users
set -euo pipefail

run_ssh_deploy() {
    local username="\\${1:?username required}"
    local key_file="\\${2:?key file required}"

    local home_dir; home_dir=\\$(getent passwd "\\$username" | cut -d: -f6)
    local ssh_dir="\\${home_dir}/.ssh"
    local auth_keys="\\${ssh_dir}/authorized_keys"

    # Validate key format
    ssh-keygen -l -f "\\$key_file" &>/dev/null || {
        _skm_log "ERROR" "Invalid SSH public key: \\$key_file"
        return 1
    }

    # Check for duplicate key
    [[ -f "\\$auth_keys" ]] && grep -qF "\\$(cat "\\$key_file")" "\\$auth_keys" && {
        _skm_log "WARN" "Key already present for \\$username — skipping"
        return 0
    }

    mkdir -p "\\$ssh_dir"
    chmod 700 "\\$ssh_dir"
    cat "\\$key_file" >> "\\$auth_keys"
    chmod 600 "\\$auth_keys"
    chown -R "\\${username}:\\${username}" "\\$ssh_dir"

    _skm_log "OK" "SSH key deployed for \\$username"
}

run_ssh_revoke_all() {
    local username="\\${1:?username required}"
    local auth_keys="\\$(getent passwd "\\$username" | cut -d: -f6)/.ssh/authorized_keys"

    [[ -f "\\$auth_keys" ]] && > "\\$auth_keys"
    _skm_log "OK" "All SSH keys revoked for \\$username"
}

run_ssh_audit() {
    # Print SSH key fingerprints for all regular users
    while IFS=: read -r username _ uid _ _ home shell; do
        [[ \\$uid -lt 1000 ]] && continue
        local auth_keys="\\${home}/.ssh/authorized_keys"
        [[ -f "\\$auth_keys" ]] || { printf "%-20s %s\\n" "\\$username" "(no keys)"; continue; }
        local count; count=\\$(grep -c "^[^#]" "\\$auth_keys" 2>/dev/null || echo 0)
        printf "%-20s %d key(s)\\n" "\\$username" "\\$count"
    done < /etc/passwd
}`,
  },

  {
    id: 'expire-accounts',
    name: 'expire_accounts.sh',
    path: 'modules/expire_accounts.sh',
    description: 'Check and auto-disable expired accounts. Warn about accounts expiring within 30 days. Set or extend expiry dates.',
    badges: ['bash'],
    code: `#!/usr/bin/env bash
# modules/expire_accounts.sh — Account expiry management
# Usage: ./modules/expire_accounts.sh [--dry-run] [--warn-only] check|set-expiry|extend
set -euo pipefail

run_expire_accounts() {
    local now; now=\\$(date +%s)
    local warn_epoch=\\$((now + (EXPIRY_WARN_DAYS * 86400)))

    _ea_log "INFO" "Checking account expiry (warn_days=\\${EXPIRY_WARN_DAYS:-30})"

    while IFS=: read -r username _ uid _ _ home shell; do
        [[ \\$uid -lt \\${SYSTEM_UID_MIN:-1000} ]] && continue

        # Get expiry date from chage
        local expiry; expiry=\\$(chage -l "\\$username" | grep "Account expires" | awk -F': ' '{print \\$2}')
        [[ -z "\\$expiry" || "\\$expiry" == "never" ]] && continue

        local exp_epoch; exp_epoch=\\$(date -d "\\$expiry" +%s)
        local days_until=\\$(( (exp_epoch - now) / 86400 ))

        if [[ \\$exp_epoch -le \\$now ]]; then
            # Account has expired — auto-disable if configured
            _ea_log "WARN" "EXPIRED: \\$username (\\${days_until}d ago)"
            if [[ "\\${AUTO_DISABLE_EXPIRED:-true}" == "true" && "\\${WARN_ONLY:-false}" != "true" ]]; then
                usermod -L "\\$username"
                pkill -SIGTERM -u "\\$username" 2>/dev/null || true
                _ea_log "OK" "DISABLED: \\$username"
            fi

        elif [[ \\$exp_epoch -le \\$warn_epoch ]]; then
            # Expiring soon — warn only
            _ea_log "INFO" "EXPIRING SOON: \\$username in \\${days_until} days"
        fi
    done < /etc/passwd
}

# Set a specific expiry date (or 'never')
run_set_expiry()    { chage -E "\\${2:-never}" "\\${1:?username required}"; }

# Extend expiry by N days
run_extend_expiry() {
    local current; current=\\$(chage -l "\\$1" | grep "Account expires" | awk -F': ' '{print \\$2}')
    local new_date; new_date=\\$(date -d "\\${current} +\\${2:?days required} days" +%Y-%m-%d)
    chage -E "\\$new_date" "\\$1"
    echo "New expiry: \\$new_date"
}`,
  },

  {
    id: 'csv-template',
    name: 'users_template.csv',
    path: 'templates/users_template.csv',
    description: 'CSV template for bulk user import. Copy this file, fill in your users, and pass it to create_users.sh.',
    badges: ['csv'],
    code: `username,full_name,email,department,groups,shell,expiry_date,ssh_key_file
jsmith,John Smith,j.smith@company.com,IT,sudo:developers,/bin/bash,2026-12-31,jsmith.pub
mrahman,Mehedi Rahman,m.rahman@company.com,Finance,finance:reports,/bin/bash,,
acontractor,Alex Contractor,alex@vendor.com,Vendor,vendor-read,/bin/bash,2026-06-30,alex.pub
lwilson,Laura Wilson,l.wilson@company.com,HR,hr-staff:reports,/bin/bash,,
dkumar,Dev Kumar,d.kumar@company.com,Engineering,developers:docker,/bin/bash,,dkumar.pub
scarroll,Sarah Carroll,s.carroll@company.com,DevOps,developers:sudo:docker,/bin/bash,2027-01-01,scarroll.pub

# Column Reference:
# username     - lowercase, letters/numbers/underscore/hyphen, max 32 chars
# full_name    - Display name (GECOS field)
# email        - User's email address (for notifications)
# department   - Department name (informational, used in logs)
# groups       - Colon-separated secondary groups (created if missing)
# shell        - Login shell (must be in /etc/shells)
# expiry_date  - Account expiry YYYY-MM-DD (blank = never expires)
# ssh_key_file - Filename in SSH_KEYS_DIR (blank = no SSH key)`,
  },
];
