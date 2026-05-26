#!/usr/bin/env bash
# install.sh — Linux User & Access Management Automation  v1.0.0
# Installs the system: creates directories, sets up log rotation,
# installs systemd timer or cron job for weekly audit report.
# Usage: sudo bash install.sh [--uninstall] [--dry-run]
# shellcheck shell=bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly VERSION="1.0.0"
readonly INSTALL_BIN="/usr/local/sbin"
readonly INSTALL_LIB="/opt/usermgmt"
readonly LOG_FILE="/var/log/usermgmt.log"
readonly LOGROTATE_CONF="/etc/logrotate.d/usermgmt"
readonly SYSTEMD_TIMER="/etc/systemd/system/usermgmt-audit.timer"
readonly SYSTEMD_SERVICE="/etc/systemd/system/usermgmt-audit.service"
readonly CRON_FILE="/etc/cron.d/usermgmt"

# ── Colours ───────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
    C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_CYAN=$'\033[96m'
    C_GREEN=$'\033[92m'; C_YELLOW=$'\033[93m'; C_RED=$'\033[91m'
    C_DIM=$'\033[2m'
else
    C_RESET=''; C_BOLD=''; C_CYAN=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_DIM=''
fi

_info()  { echo "${C_CYAN}  →${C_RESET} $*"; }
_ok()    { echo "${C_GREEN}  ✔${C_RESET} $*"; }
_warn()  { echo "${C_YELLOW}  ⚠${C_RESET} $*"; }
_err()   { echo "${C_RED}  ✘${C_RESET} $*" >&2; }
_die()   { _err "$*"; exit 1; }

DRY_RUN=false
UNINSTALL=false

for arg in "$@"; do
    case "$arg" in
        --dry-run)   DRY_RUN=true ;;
        --uninstall) UNINSTALL=true ;;
        --help|-h)
            echo "Usage: sudo bash install.sh [--uninstall] [--dry-run]"
            exit 0 ;;
    esac
done

_dry() {
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "${C_DIM}  [dry] $*${C_RESET}"
        return 0
    fi
    "$@"
}

# ─────────────────────────────────────────────────────────────────────────────
#  PRE-FLIGHT
# ─────────────────────────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || _die "Must run as root: sudo bash install.sh"

echo ""
echo "${C_BOLD}${C_CYAN}"
cat <<'BANNER'
  ╔═══════════════════════════════════════════════════════╗
  ║   Linux User & Access Management Automation           ║
  ║   Installer  v1.0.0  — RHEL 9 / Rocky Linux          ║
  ╚═══════════════════════════════════════════════════════╝
BANNER
echo "${C_RESET}"

[[ "$DRY_RUN" == "true" ]] && _warn "DRY-RUN MODE — no changes will be made"
[[ "$UNINSTALL" == "true" ]] && _warn "UNINSTALL MODE"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
#  UNINSTALL PATH
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$UNINSTALL" == "true" ]]; then
    _info "Uninstalling usermgmt…"

    _dry systemctl stop usermgmt-audit.timer 2>/dev/null || true
    _dry systemctl disable usermgmt-audit.timer 2>/dev/null || true
    _dry rm -f "$SYSTEMD_TIMER" "$SYSTEMD_SERVICE"
    _dry systemctl daemon-reload 2>/dev/null || true

    _dry rm -f "$CRON_FILE"
    _dry rm -f "$LOGROTATE_CONF"
    _dry rm -f "${INSTALL_BIN}/user_manager"
    _dry rm -rf "$INSTALL_LIB"

    _ok "Uninstalled. Log file retained: $LOG_FILE"
    echo ""
    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
#  INSTALL PATH
# ─────────────────────────────────────────────────────────────────────────────

# 1. Validate config.conf exists
_info "Checking configuration…"
[[ -f "${SCRIPT_DIR}/config.conf" ]] || _die "config.conf not found in $SCRIPT_DIR — edit it first"
source "${SCRIPT_DIR}/config.conf"
_ok "config.conf loaded"

# 2. Check required commands
_info "Checking dependencies…"
MISSING_CMDS=()
for cmd in useradd usermod userdel groupadd chpasswd chage openssl; do
    command -v "$cmd" &>/dev/null || MISSING_CMDS+=("$cmd")
done
if [[ ${#MISSING_CMDS[@]} -gt 0 ]]; then
    _warn "Missing commands: ${MISSING_CMDS[*]}"
    _warn "Install with: dnf install shadow-utils openssl"
fi

if ! command -v setfacl &>/dev/null; then
    _warn "setfacl not found — ACL features require: dnf install acl"
fi
_ok "Dependency check complete"

# 3. Create installation directories
_info "Creating directories…"
_dry mkdir -p "$INSTALL_LIB/modules"
_dry mkdir -p "$INSTALL_LIB/templates"
_dry mkdir -p "$INSTALL_LIB/ssh-keys"
_dry mkdir -p "${SSH_KEYS_DIR:-/etc/usermgmt/ssh-keys}"
_dry mkdir -p "${REPORT_OUTPUT_DIR:-/var/reports/usermgmt}"
_dry chmod 750 "${REPORT_OUTPUT_DIR:-/var/reports/usermgmt}"
_dry chmod 750 "${SSH_KEYS_DIR:-/etc/usermgmt/ssh-keys}"
_ok "Directories created"

# 4. Copy files
_info "Installing files…"
_dry cp -r "${SCRIPT_DIR}/modules"   "$INSTALL_LIB/"
_dry cp -r "${SCRIPT_DIR}/templates" "$INSTALL_LIB/"
_dry cp    "${SCRIPT_DIR}/config.conf"     "$INSTALL_LIB/"
_dry cp    "${SCRIPT_DIR}/user_manager.sh" "$INSTALL_LIB/"
_dry chmod 750 "${INSTALL_LIB}/modules/"*.sh
_dry chmod 640 "${INSTALL_LIB}/config.conf"
_dry chmod 750 "${INSTALL_LIB}/user_manager.sh"
_ok "Files installed to $INSTALL_LIB"

# 5. Create symlink in PATH
_info "Creating symlink…"
_dry ln -sf "${INSTALL_LIB}/user_manager.sh" "${INSTALL_BIN}/user_manager"
_ok "Symlink: user_manager → $INSTALL_BIN"

# 6. Create log file
_info "Setting up log file…"
_dry touch "$LOG_FILE"
_dry chmod 640 "$LOG_FILE"
_ok "Log file: $LOG_FILE"

# 7. Log rotation
_info "Configuring log rotation…"
if [[ "$DRY_RUN" != "true" ]]; then
    cat > "$LOGROTATE_CONF" <<EOF
${LOG_FILE} {
    weekly
    rotate ${LOG_ROTATE_DAYS:-90}
    compress
    delaycompress
    missingok
    notifempty
    create 640 root root
    dateext
    dateformat -%Y%m%d
}
EOF
    chmod 644 "$LOGROTATE_CONF"
fi
_ok "Log rotation configured: $LOGROTATE_CONF"

# 8. Schedule weekly audit report (systemd preferred, fallback to cron)
_info "Scheduling weekly audit report (${REPORT_CRON:-0 7 * * 1})…"

if command -v systemctl &>/dev/null && systemctl is-system-running &>/dev/null 2>&1; then
    if [[ "$DRY_RUN" != "true" ]]; then
        cat > "$SYSTEMD_SERVICE" <<EOF
[Unit]
Description=User Management Weekly Audit Report
After=network.target

[Service]
Type=oneshot
ExecStart=${INSTALL_LIB}/modules/audit_report.sh
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}
EOF

        cat > "$SYSTEMD_TIMER" <<EOF
[Unit]
Description=User Management Weekly Audit Timer

[Timer]
OnCalendar=Mon *-*-* 07:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
        systemctl daemon-reload
        systemctl enable --now usermgmt-audit.timer
    fi
    _ok "Systemd timer installed: usermgmt-audit.timer"
else
    if [[ "$DRY_RUN" != "true" ]]; then
        cat > "$CRON_FILE" <<EOF
# User Management — Weekly Audit Report
# Generated by install.sh  v${VERSION}
${REPORT_CRON:-0 7 * * 1} root ${INSTALL_LIB}/modules/audit_report.sh >> ${LOG_FILE} 2>&1
EOF
        chmod 644 "$CRON_FILE"
    fi
    _ok "Cron job installed: $CRON_FILE"
fi

# 9. Summary
echo ""
echo "${C_GREEN}${C_BOLD}"
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║   Installation Complete!                         ║"
echo "  ╠══════════════════════════════════════════════════╣"
printf "  ║  %-22s: %-21s ║\n" "Installed to" "$INSTALL_LIB"
printf "  ║  %-22s: %-21s ║\n" "Executable" "${INSTALL_BIN}/user_manager"
printf "  ║  %-22s: %-21s ║\n" "Config" "${INSTALL_LIB}/config.conf"
printf "  ║  %-22s: %-21s ║\n" "Log file" "$LOG_FILE"
printf "  ║  %-22s: %-21s ║\n" "Audit schedule" "${REPORT_CRON:-0 7 * * 1}"
echo "  ╚══════════════════════════════════════════════════╝"
echo "${C_RESET}"
echo ""
echo "  ${C_BOLD}Next steps:${C_RESET}"
echo "  1. Edit config: ${C_CYAN}nano ${INSTALL_LIB}/config.conf${C_RESET}"
echo "  2. Add SSH keys to: ${C_CYAN}${SSH_KEYS_DIR:-/etc/usermgmt/ssh-keys}/username.pub${C_RESET}"
echo "  3. Edit CSV template: ${C_CYAN}${INSTALL_LIB}/templates/users_template.csv${C_RESET}"
echo "  4. Launch: ${C_CYAN}sudo user_manager${C_RESET}"
echo ""
