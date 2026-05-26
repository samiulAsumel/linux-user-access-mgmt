#!/usr/bin/env bash
# tests/test_user_mgmt.sh — Smoke tests for all Linux User Access Mgmt modules
# Usage: bash tests/test_user_mgmt.sh
# Runs operations in --dry-run mode to validate logic without making changes.
# shellcheck shell=bash
set -euo pipefail

# SC2155 fix: separate declare and assign
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SCRIPT_DIR

readonly TEST_CSV="/tmp/usermgmt_test_$$.csv"

PASS=0
FAIL=0

# ── Test helpers ──────────────────────────────────────────────────────────────
_test() {
    local desc="$1"; shift
    if "$@" &>/dev/null; then
        printf '  ✔ PASS: %s\n' "$desc"
        PASS=$(( PASS + 1 ))
    else
        printf '  ✘ FAIL: %s\n' "$desc"
        FAIL=$(( FAIL + 1 ))
    fi
}

_test_fail() {
    local desc="$1"; shift
    if ! "$@" &>/dev/null; then
        printf '  ✔ PASS (expected failure): %s\n' "$desc"
        PASS=$(( PASS + 1 ))
    else
        printf '  ✘ FAIL (should have failed): %s\n' "$desc"
        FAIL=$(( FAIL + 1 ))
    fi
}

# ── Header ────────────────────────────────────────────────────────────────────
printf '\n'
printf '  ━━━ Linux User & Access Mgmt — Smoke Tests ━━━\n'
printf '  Mode   : DRY-RUN (no system changes)\n'
printf '  Target : RHEL 9 / Rocky Linux / CentOS Stream 9\n'
printf '  Date   : %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
printf '\n'

# ── Setup: test CSV ───────────────────────────────────────────────────────────
cat > "$TEST_CSV" <<'TESTCSV'
username,full_name,email,department,groups,shell,expiry_date,ssh_key_file
testuser1,Test User One,test1@test.com,IT,developers,/bin/bash,2026-12-31,
testuser2,Test User Two,test2@test.com,Finance,finance,/bin/bash,,
TESTCSV

export DRY_RUN=true

# ── create_users.sh ───────────────────────────────────────────────────────────
printf '  [create_users.sh]\n'
_test      "Dry-run create from valid CSV" \
    bash "${SCRIPT_DIR}/modules/create_users.sh" --dry-run "$TEST_CSV"

_test_fail "Rejects missing CSV file" \
    bash "${SCRIPT_DIR}/modules/create_users.sh" --dry-run "/nonexistent_file_$$.csv"

_test      "Shows help" \
    bash "${SCRIPT_DIR}/modules/create_users.sh" --help

# ── disable_users.sh ──────────────────────────────────────────────────────────
printf '\n  [disable_users.sh]\n'
_test "Shows help" \
    bash "${SCRIPT_DIR}/modules/disable_users.sh" --help

# ── delete_users.sh ───────────────────────────────────────────────────────────
printf '\n  [delete_users.sh]\n'
_test "Shows help" \
    bash "${SCRIPT_DIR}/modules/delete_users.sh" --help

# ── ssh_key_manager.sh ────────────────────────────────────────────────────────
printf '\n  [ssh_key_manager.sh]\n'
_test "Shows help" \
    bash "${SCRIPT_DIR}/modules/ssh_key_manager.sh" --help

# ── expire_accounts.sh ────────────────────────────────────────────────────────
printf '\n  [expire_accounts.sh]\n'
_test "Shows help" \
    bash "${SCRIPT_DIR}/modules/expire_accounts.sh" --help

# ── password_policy.sh ────────────────────────────────────────────────────────
printf '\n  [password_policy.sh]\n'
_test "Shows help" \
    bash "${SCRIPT_DIR}/modules/password_policy.sh" --help

# ── set_permissions.sh ────────────────────────────────────────────────────────
printf '\n  [set_permissions.sh]\n'
_test "Shows help" \
    bash "${SCRIPT_DIR}/modules/set_permissions.sh" --help

# ── audit_report.sh ───────────────────────────────────────────────────────────
printf '\n  [audit_report.sh]\n'
_test "Shows help" \
    bash "${SCRIPT_DIR}/modules/audit_report.sh" --help

# ── config.conf ───────────────────────────────────────────────────────────────
printf '\n  [config.conf]\n'
_test "config.conf exists and is readable" \
    test -r "${SCRIPT_DIR}/config.conf"

_test "config.conf contains LOG_FILE key" \
    grep -q "^LOG_FILE=" "${SCRIPT_DIR}/config.conf"

_test "config.conf contains PASS_MAX_DAYS key" \
    grep -q "^PASS_MAX_DAYS=" "${SCRIPT_DIR}/config.conf"

_test "config.conf contains ADMIN_EMAIL key" \
    grep -q "^ADMIN_EMAIL=" "${SCRIPT_DIR}/config.conf"

# ── templates/users_template.csv ─────────────────────────────────────────────
printf '\n  [templates/users_template.csv]\n'
_test "CSV template exists" \
    test -f "${SCRIPT_DIR}/templates/users_template.csv"

_test "CSV template has correct header" \
    grep -q "^username,full_name,email,department,groups,shell,expiry_date,ssh_key_file" \
    "${SCRIPT_DIR}/templates/users_template.csv"

_test "CSV template has at least 1 data row" \
    test "$(wc -l < "${SCRIPT_DIR}/templates/users_template.csv")" -ge 2

# ── user_manager.sh ───────────────────────────────────────────────────────────
printf '\n  [user_manager.sh]\n'
_test "Shows version" \
    bash "${SCRIPT_DIR}/user_manager.sh" --version

_test "Shows help" \
    bash "${SCRIPT_DIR}/user_manager.sh" --help

# ── Cleanup ───────────────────────────────────────────────────────────────────
rm -f "$TEST_CSV"

# ── Summary ───────────────────────────────────────────────────────────────────
printf '\n'
printf '  ════════════════════════════════════\n'
printf '  Test Results — %s\n' "$(date '+%Y-%m-%d')"
printf '  ════════════════════════════════════\n'
printf '  PASS : %d\n' "$PASS"
printf '  FAIL : %d\n' "$FAIL"
printf '  TOTAL: %d\n' "$(( PASS + FAIL ))"
printf '  ════════════════════════════════════\n'
printf '\n'

if [[ $FAIL -eq 0 ]]; then
    printf '  ✔ All %d tests passed!\n\n' "$PASS"
else
    printf '  ✘ %d test(s) failed. Review output above.\n\n' "$FAIL"
fi

exit "$FAIL"
