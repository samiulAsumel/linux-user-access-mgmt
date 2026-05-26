#!/usr/bin/env bash
# tests/test_user_mgmt.sh — Basic smoke tests for all modules
# Usage: sudo bash tests/test_user_mgmt.sh
# Runs all operations in --dry-run mode to validate logic without changes.
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly TEST_CSV="/tmp/usermgmt_test_$$.csv"

PASS=0
FAIL=0

_test() {
    local desc="$1"; shift
    if "$@" &>/dev/null; then
        echo "  ✔ PASS: $desc"
        PASS=$((PASS+1))
    else
        echo "  ✘ FAIL: $desc"
        FAIL=$((FAIL+1))
    fi
}

_test_fail() {
    local desc="$1"; shift
    if ! "$@" &>/dev/null; then
        echo "  ✔ PASS (expected failure): $desc"
        PASS=$((PASS+1))
    else
        echo "  ✘ FAIL (should have failed): $desc"
        FAIL=$((FAIL+1))
    fi
}

echo ""
echo "  ━━━ User Management Smoke Tests ━━━"
echo "  Mode: DRY-RUN (no system changes)"
echo "  Target: RHEL 9 / Rocky Linux"
echo ""

# Setup test CSV
cat > "$TEST_CSV" <<'TESTCSV'
username,full_name,email,department,groups,shell,expiry_date,ssh_key_file
testuser1,Test User One,test1@test.com,IT,developers,/bin/bash,2026-12-31,
testuser2,Test User Two,test2@test.com,Finance,finance,/bin/bash,,
TESTCSV

export DRY_RUN=true

# ── Test: create_users.sh ─────────────────────────────────────────────────────
echo "  [create_users.sh]"
_test "Dry-run create from valid CSV" \
    bash "${SCRIPT_DIR}/modules/create_users.sh" --dry-run "$TEST_CSV"

_test_fail "Rejects missing CSV file" \
    bash "${SCRIPT_DIR}/modules/create_users.sh" --dry-run "/nonexistent.csv"

_test "Shows help" \
    bash "${SCRIPT_DIR}/modules/create_users.sh" --help

# ── Test: disable_users.sh ────────────────────────────────────────────────────
echo ""
echo "  [disable_users.sh]"
_test "Shows help" \
    bash "${SCRIPT_DIR}/modules/disable_users.sh" --help

# ── Test: delete_users.sh ─────────────────────────────────────────────────────
echo ""
echo "  [delete_users.sh]"
_test "Shows help" \
    bash "${SCRIPT_DIR}/modules/delete_users.sh" --help

# ── Test: ssh_key_manager.sh ──────────────────────────────────────────────────
echo ""
echo "  [ssh_key_manager.sh]"
_test "Shows help" \
    bash "${SCRIPT_DIR}/modules/ssh_key_manager.sh" --help

# ── Test: expire_accounts.sh ──────────────────────────────────────────────────
echo ""
echo "  [expire_accounts.sh]"
_test "Shows help" \
    bash "${SCRIPT_DIR}/modules/expire_accounts.sh" --help

# ── Test: password_policy.sh ──────────────────────────────────────────────────
echo ""
echo "  [password_policy.sh]"
_test "Shows help" \
    bash "${SCRIPT_DIR}/modules/password_policy.sh" --help

# ── Test: set_permissions.sh ──────────────────────────────────────────────────
echo ""
echo "  [set_permissions.sh]"
_test "Shows help" \
    bash "${SCRIPT_DIR}/modules/set_permissions.sh" --help

# ── Test: audit_report.sh ─────────────────────────────────────────────────────
echo ""
echo "  [audit_report.sh]"
_test "Shows help" \
    bash "${SCRIPT_DIR}/modules/audit_report.sh" --help

# ── Test: config.conf ─────────────────────────────────────────────────────────
echo ""
echo "  [config.conf]"
_test "config.conf exists and is readable" \
    test -r "${SCRIPT_DIR}/config.conf"

_test "config.conf contains required keys" \
    grep -q "^LOG_FILE=" "${SCRIPT_DIR}/config.conf"

# ── Test: CSV template ────────────────────────────────────────────────────────
echo ""
echo "  [templates/users_template.csv]"
_test "CSV template exists" \
    test -f "${SCRIPT_DIR}/templates/users_template.csv"

_test "CSV template has correct header" \
    head -1 "${SCRIPT_DIR}/templates/users_template.csv" | \
    grep -q "username,full_name,email,department,groups,shell,expiry_date,ssh_key_file"

# ── Cleanup ───────────────────────────────────────────────────────────────────
rm -f "$TEST_CSV"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "  ════════════════════════════════"
echo "  Test Results"
echo "  ════════════════════════════════"
echo "  PASS : $PASS"
echo "  FAIL : $FAIL"
echo "  ════════════════════════════════"
echo ""

[[ $FAIL -eq 0 ]] && echo "  ✔ All tests passed!" || echo "  ✘ $FAIL test(s) failed."
echo ""
exit $FAIL
