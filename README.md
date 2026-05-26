# Linux User & Access Management Automation

> **Production-grade Bash automation for Linux user lifecycle management on RHEL 9 / CentOS Stream / Rocky Linux.**
> CSV-driven bulk user creation, account disabling, SSH key deployment, POSIX ACLs, and weekly HTML audit reports.

---

## The Problem It Solves

| Before | After |
|--------|-------|
| 30 min per new employee (manual) | **30 seconds** per user (automated) |
| 10 new hires = 5 hours IT time | 10 new hires = 5 minutes |
| Forgotten account disabling = security breach | One command disables + kills sessions |
| "Who has access to what?" — nobody knows | Weekly HTML audit report, always current |

---

## Project Structure

```
linux-user-access-mgmt/
├── user_manager.sh              ← Main interactive menu (run this)
├── config.conf                  ← All settings (edit before install)
├── install.sh                   ← Installer (sets up cron, logrotate)
├── modules/
│   ├── create_users.sh          ← Bulk creation from CSV
│   ├── disable_users.sh         ← Lock + expire + kill sessions
│   ├── delete_users.sh          ← Permanent removal + home backup
│   ├── set_permissions.sh       ← ACL + group management
│   ├── password_policy.sh       ← PAM pwquality + chage aging
│   ├── audit_report.sh          ← 7-section HTML audit report
│   ├── ssh_key_manager.sh       ← Deploy / rotate / revoke SSH keys
│   └── expire_accounts.sh       ← Auto-disable expired accounts
├── templates/
│   └── users_template.csv       ← CSV template for bulk import
├── tests/
│   └── test_user_mgmt.sh        ← Smoke tests (dry-run mode)
└── ssh-keys/                    ← Drop SSH public keys here
```

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/samiulAsumel/linux-user-access-mgmt.git
cd linux-user-access-mgmt

# 2. Configure
nano config.conf

# 3. Install
sudo bash install.sh

# 4. Launch
sudo user_manager
```

---

## CSV Format

```csv
username,full_name,email,department,groups,shell,expiry_date,ssh_key_file
jsmith,John Smith,j.smith@co.com,IT,sudo:developers,/bin/bash,2026-12-31,jsmith.pub
mrahman,Mehedi Rahman,m.rahman@co.com,Finance,finance:reports,/bin/bash,,
acontractor,Alex C,alex@vendor.com,Vendor,vendor-read,/bin/bash,2026-06-30,alex.pub
```

| Column | Description |
|--------|-------------|
| `username` | Login name — `^[a-z_][a-z0-9_-]{0,31}$` |
| `full_name` | Display name (GECOS field) |
| `email` | Email address (for notifications) |
| `department` | Department (informational, logged) |
| `groups` | Colon-separated secondary groups (created if missing) |
| `shell` | Login shell — must be in `/etc/shells` |
| `expiry_date` | `YYYY-MM-DD` or blank for never |
| `ssh_key_file` | Filename in `ssh-keys/` directory (or blank) |

---

## Module Reference

### `create_users.sh` — Bulk User Creation
```bash
sudo ./modules/create_users.sh [--dry-run] users.csv
```
1. Validate CSV header and fields
2. Create missing groups (`groupadd`)
3. `useradd -m -c -s -G`
4. Set 12-char random password → `chpasswd`
5. `chage -d 0` (force change on first login)
6. Apply aging policy (`chage -m 1 -M 90 -W 14 -I 30`)
7. Set account expiry if provided (`chage -E`)
8. `chmod 700` home directory
9. Deploy SSH public key to `authorized_keys`
10. Log to `/var/log/usermgmt.log`

### `disable_users.sh` — Account Disable (Offboarding)
```bash
sudo ./modules/disable_users.sh [--dry-run] [--reason TEXT] <username|csv>
```
- `usermod -L` — lock password
- `usermod -e 1` — expire account
- `pkill -SIGTERM/-SIGKILL -u` — kill active sessions
- Updates GECOS with `[DISABLED:DATE:user:reason]` audit trail
- Notifies `ADMIN_EMAIL` if configured

### `delete_users.sh` — Permanent Account Removal
```bash
sudo ./modules/delete_users.sh [--dry-run] [--remove-home] [--no-backup] <username>
```
- Backs up home to `/var/backup/usermgmt/homes/`
- Refuses to delete system users (UID < 1000)
- Requires interactive confirmation (types username)
- Optional: `--remove-home` deletes home directory

### `audit_report.sh` — HTML Audit Report
```bash
sudo ./modules/audit_report.sh [--output /path/report.html]
```
Generates a styled HTML report with 7 sections:
1. **All Users** — username, name, UID, shell, groups, last login, status
2. **Sudo Users** — wheel/sudo group members
3. **Expiring Soon** — accounts expiring within 30 days
4. **Inactive Accounts** — no login in 90+ days
5. **Never Logged In** — provisioned but unused accounts
6. **Failed Logins** — SSH failures from journalctl (7 days)
7. **sudo Usage** — last 50 sudo commands

### `ssh_key_manager.sh` — SSH Key Lifecycle
```bash
sudo ./modules/ssh_key_manager.sh deploy <username> <key.pub>
sudo ./modules/ssh_key_manager.sh revoke <username>
sudo ./modules/ssh_key_manager.sh rotate <username> <new-key.pub>
sudo ./modules/ssh_key_manager.sh audit
```

### `expire_accounts.sh` — Account Expiry Management
```bash
sudo ./modules/expire_accounts.sh check              # Scan all accounts
sudo ./modules/expire_accounts.sh set-expiry user 2026-12-31
sudo ./modules/expire_accounts.sh extend user 90     # Extend by 90 days
```

### `password_policy.sh` — Password Policy Enforcement
```bash
sudo ./modules/password_policy.sh --pwquality        # Configure PAM pwquality
sudo ./modules/password_policy.sh --all              # Apply aging to all users
sudo ./modules/password_policy.sh --user jsmith      # Apply to specific user
```

### `set_permissions.sh` — ACL and Group Management
```bash
sudo ./modules/set_permissions.sh add-group jsmith developers
sudo ./modules/set_permissions.sh set-acl /srv/data u:jsmith:rwx true true
sudo ./modules/set_permissions.sh shared-dir /srv/finance finance 2775
```

---

## Configuration (`config.conf`)

Key settings to edit before installation:

```bash
ADMIN_EMAIL="admin@company.com"      # Notifications destination
PASS_MAX_DAYS=90                     # Password max age
PASS_MIN_LEN=12                      # Minimum password length
DEFAULT_SHELL="/bin/bash"            # Default shell for new users
SSH_KEYS_DIR="/etc/usermgmt/ssh-keys" # SSH public key storage
REPORT_CRON="0 7 * * 1"             # Weekly audit schedule
AUTO_DISABLE_EXPIRED=true            # Auto-lock expired accounts
DRY_RUN=false                        # Global dry-run (override with --dry-run)
```

---

## Dry-Run Mode

Every module supports `--dry-run`. No system changes are made — all actions are logged as `[DRY]`.

```bash
sudo ./modules/create_users.sh --dry-run users.csv
sudo ./modules/disable_users.sh --dry-run jsmith
sudo user_manager   # Then press 'd' to toggle dry-run in the menu
```

---

## Logging

All actions append to `/var/log/usermgmt.log`:

```
[2026-05-27 09:01:14] [OK]   [CREATE_USERS] CREATED: jsmith by root groups=sudo,developers expiry=2026-12-31
[2026-05-27 09:01:45] [OK]   [DISABLE_USERS] DISABLED: acontractor by admin reason=Offboarding
[2026-05-27 07:00:12] [OK]   [AUDIT_REPORT] Report written: /var/reports/usermgmt/audit_2026-05-27_07-00-12.html
```

Log rotation is configured by `install.sh` via `/etc/logrotate.d/usermgmt`.

---

## Testing

```bash
# Run all smoke tests (dry-run mode, no system changes)
sudo bash tests/test_user_mgmt.sh
```

---

## Requirements

- RHEL 9 / CentOS Stream 9 / Rocky Linux 9 (or compatible)
- `shadow-utils` (`useradd`, `usermod`, `chpasswd`, `chage`)
- `openssl` (password generation)
- `acl` package (`setfacl`, `getfacl`) — for `set_permissions.sh`
- `openssh` (`ssh-keygen`) — for `ssh_key_manager.sh`
- `systemd` or `crond` — for scheduled audit reports

Install dependencies:
```bash
sudo dnf install -y shadow-utils openssl acl openssh
```

---

## Security Notes

- Config file `config.conf` is `chmod 640` after install (contains no passwords by default)
- Generated credential files are `chmod 600`, stored in `/tmp/` — delete after distributing
- SSH public keys only — private keys are never stored
- System users (UID < 1000) are protected from deletion/disabling
- Currently logged-in user cannot be deleted by themselves

---

## License

MIT License — free for commercial use.

---

*Built with Bash · Designed for RHEL 9 · Production-grade from day one*
