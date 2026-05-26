// playground.js — User Management Simulation Engine  v1.0.0
// Generates realistic terminal output for user management operations.
'use strict';

(function () {

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const TS = () => {
    const now = new Date();
    const p = n => String(n).padStart(2, '0');
    return `[${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}]`;
  };
  const RAND  = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const PICK  = arr => arr[RAND(0, arr.length - 1)];

  const USERS = [
    { u: 'jsmith',      n: 'John Smith',      d: 'IT',          g: 'sudo:developers',  uid: 1101, exp: '2026-12-31' },
    { u: 'mrahman',     n: 'Mehedi Rahman',   d: 'Finance',     g: 'finance:reports',  uid: 1102, exp: ''           },
    { u: 'acontractor', n: 'Alex Contractor', d: 'Vendor',      g: 'vendor-read',      uid: 1103, exp: '2026-06-30' },
    { u: 'lwilson',     n: 'Laura Wilson',    d: 'HR',          g: 'hr-staff:reports', uid: 1104, exp: ''           },
    { u: 'dkumar',      n: 'Dev Kumar',       d: 'Engineering', g: 'developers:docker',uid: 1105, exp: ''           },
    { u: 'scarroll',    n: 'Sarah Carroll',   d: 'DevOps',      g: 'developers:sudo',  uid: 1106, exp: '2027-01-01' },
    { u: 'tchen',       n: 'Tony Chen',       d: 'Security',    g: 'infosec:audit',    uid: 1107, exp: ''           },
    { u: 'rmorris',     n: 'Rachel Morris',   d: 'Finance',     g: 'finance',          uid: 1108, exp: '2026-09-30' },
    { u: 'akowalski',   n: 'Anna Kowalski',   d: 'Marketing',   g: 'marketing',        uid: 1109, exp: ''           },
    { u: 'bpatel',      n: 'Bhavesh Patel',   d: 'Engineering', g: 'developers',       uid: 1110, exp: ''           },
    { u: 'cfoster',     n: 'Chris Foster',    d: 'IT',          g: 'sudo:sysadmins',   uid: 1111, exp: '2026-12-31' },
    { u: 'dlee',        n: 'Diana Lee',       d: 'Legal',       g: 'legal:compliance', uid: 1112, exp: ''           },
    { u: 'ejohnson',    n: 'Ethan Johnson',   d: 'DevOps',      g: 'developers:docker',uid: 1113, exp: ''           },
    { u: 'fprice',      n: 'Fiona Price',     d: 'HR',          g: 'hr-staff',         uid: 1114, exp: ''           },
    { u: 'gthompson',   n: 'George Thompson', d: 'Sales',       g: 'sales:crm-users',  uid: 1115, exp: '2026-11-30' },
    { u: 'hmartinez',   n: 'Helena Martinez', d: 'Finance',     g: 'finance:reports',  uid: 1116, exp: ''           },
    { u: 'iwilliams',   n: 'Ian Williams',    d: 'Engineering', g: 'developers',       uid: 1117, exp: ''           },
    { u: 'jnguyen',     n: 'Julia Nguyen',    d: 'Security',    g: 'infosec',          uid: 1118, exp: ''           },
    { u: 'krobinson',   n: 'Kyle Robinson',   d: 'IT',          g: 'sysadmins',        uid: 1119, exp: '2026-12-31' },
    { u: 'lwang',       n: 'Lily Wang',       d: 'Marketing',   g: 'marketing',        uid: 1120, exp: ''           },
  ];

  const GEN_PASS = () => {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#';
    let p = '';
    for (let i = 0; i < 12; i++) p += chars[RAND(0, chars.length-1)];
    return p;
  };

  // ── Scenario builders ────────────────────────────────────────────────────────

  const createScenario = (opts) => {
    const { count, scenario, sshKeys, expiry: setExpiry } = opts;
    const selectedUsers = USERS.slice(0, Math.min(count, USERS.length));
    const isDry = scenario === 'dryrun';
    const lines = [];

    const add = (cls, text) => lines.push({ c: cls, t: text });

    add('tline-dim',  '╔════════════════════════════════════════════════════╗');
    add('tline-dim',  '║  Linux User & Access Management Automation v1.0.0  ║');
    add('tline-dim',  '╚════════════════════════════════════════════════════╝');
    if (isDry) {
      add('tline-warn', '');
      add('tline-warn', `${TS()} [WARN] [MANAGER] ⚠  DRY-RUN MODE — no system changes`);
      add('tline-warn', '');
    }
    add('tline-cmd',  `$ sudo ./modules/create_users.sh${isDry ? ' --dry-run' : ''} templates/users_template.csv`);
    add('tline-info', `${TS()} [INFO] [CREATE_USERS] ━━━ Bulk user creation started`);
    add('tline-info', `${TS()} [INFO] [CREATE_USERS] CSV validated — ${selectedUsers.length} data rows`);
    add('tline-plain', '');

    let created = 0, failed = 0, skipped = 0;

    selectedUsers.forEach((user, i) => {
      const fail = scenario === 'mixed' && (i === 1 || i === 4);
      const dup  = scenario === 'mixed' && i === 2;

      if (dup) {
        add('tline-warn', `${TS()} [WARN] [CREATE_USERS] User '${user.u}' already exists — skipping`);
        skipped++;
        return;
      }

      if (fail) {
        add('tline-err', `${TS()} [ERROR] [CREATE_USERS] useradd failed for '${user.u}': name too long`);
        failed++;
        return;
      }

      const groups = user.g.split(':');
      if (!isDry) {
        groups.forEach(g => {
          add('tline-plain', `${TS()} [INFO] [CREATE_USERS] Group '${g}' does not exist — creating`);
          add('tline-ok',   `${TS()} [OK]   [CREATE_USERS]   ✔ groupadd ${g} (gid=${2000+i})`);
        });
        add('tline-ok', `${TS()} [OK]   [CREATE_USERS] useradd -m -c '${user.n}' -s /bin/bash -G ${user.g} ${user.u}`);
        add('tline-ok', `${TS()} [OK]   [CREATE_USERS]   ✔ ${user.u} created (uid=${user.uid} home=/home/${user.u})`);
        add('tline-ok', `${TS()} [OK]   [CREATE_USERS]   ✔ password set (12-char, force change on login)`);
      } else {
        add('tline-plain', `${TS()} [DRY]  [CREATE_USERS] Would create: ${user.u} (${user.n}) dept=${user.d}`);
        add('tline-plain', `${TS()} [DRY]  [CREATE_USERS] Would run: useradd -m -c '${user.n}' -G ${user.g} ${user.u}`);
        add('tline-plain', `${TS()} [DRY]  [CREATE_USERS] Would set password and force change`);
      }

      if (setExpiry && user.exp) {
        isDry
          ? add('tline-plain', `${TS()} [DRY]  [CREATE_USERS] Would set expiry: chage -E ${user.exp} ${user.u}`)
          : add('tline-ok',   `${TS()} [OK]   [CREATE_USERS]   ✔ account expiry: ${user.exp}`);
      }

      const prefix = isDry ? '[DRY]  ' : '[OK]   ';
      const cls    = isDry ? 'tline-plain' : 'tline-ok';
      add(cls, `${TS()} ${prefix}[CREATE_USERS]   ✔ chage: min=1 max=90 warn=14 inactive=30`);
      add(cls, `${TS()} ${prefix}[CREATE_USERS]   ✔ chmod 700 /home/${user.u}`);

      if (sshKeys) {
        isDry
          ? add('tline-plain', `${TS()} [DRY]  [CREATE_USERS] Would deploy SSH key: ${user.u}.pub → /home/${user.u}/.ssh/authorized_keys`)
          : add('tline-ok', `${TS()} [OK]   [CREATE_USERS]   ✔ SSH key deployed: ${user.u}.pub (RSA 4096)`);
      }

      add('tline-ok', `${TS()} [OK]   [CREATE_USERS] CREATED: ${user.u} by ${isDry ? '[DRY]' : 'root'} groups=${user.g}`);
      add('tline-plain', '');
      created++;
    });

    add('tline-dim',  '╔══════════════════════════════════════════════╗');
    add('tline-dim',  '║           User Creation Summary              ║');
    add('tline-dim',  '╠══════════════════════════════════════════════╣');
    add('tline-dim',  `║  Rows processed     : ${String(selectedUsers.length).padEnd(25)}║`);
    add(created > 0 ? 'tline-ok' : 'tline-dim',
                     `║  Successfully created: ${String(created).padEnd(25)}║`);
    add(failed > 0  ? 'tline-err' : 'tline-dim',
                     `║  Failed              : ${String(failed).padEnd(25)}║`);
    add(skipped > 0 ? 'tline-warn' : 'tline-dim',
                     `║  Skipped (dup/blank) : ${String(skipped).padEnd(25)}║`);
    add('tline-dim',  '╚══════════════════════════════════════════════╝');

    if (created > 0 && !isDry) {
      add('tline-plain', '');
      add('tline-warn',  '  ⚠  Generated credentials (distribute securely):');
      add('tline-dim',   '  ┌────────────────────────────────────────────┐');
      selectedUsers.slice(0, created).forEach(u => {
        add('tline-plain', `  │  ${u.u.padEnd(16)} ${GEN_PASS()}`);
      });
      add('tline-dim',   '  └────────────────────────────────────────────┘');
      add('tline-warn',  '  All users must change password on first login.');
    }

    return lines;
  };

  const disableScenario = (opts) => {
    const { count, scenario } = opts;
    const selectedUsers = USERS.slice(0, Math.min(count, 5));
    const isDry = scenario === 'dryrun';
    const lines = [];
    const add = (cls, text) => lines.push({ c: cls, t: text });

    add('tline-dim',  '╔════════════════════════════════════════════════════╗');
    add('tline-dim',  '║  Linux User & Access Management Automation v1.0.0  ║');
    add('tline-dim',  '╚════════════════════════════════════════════════════╝');
    if (isDry) add('tline-warn', `${TS()} [WARN] DRY-RUN MODE — no changes`);
    add('tline-cmd',  `$ sudo ./modules/disable_users.sh${isDry ? ' --dry-run' : ''} --reason Offboarding offboarding.csv`);
    add('tline-info', `${TS()} [INFO] [DISABLE_USERS] ━━━ Bulk disable from CSV`);
    add('tline-plain', '');

    let disabled = 0;
    selectedUsers.forEach(user => {
      if (isDry) {
        add('tline-plain', `${TS()} [DRY]  [DISABLE_USERS] Would lock: ${user.u}`);
        add('tline-plain', `${TS()} [DRY]  [DISABLE_USERS] Would run: usermod -L -e 1 ${user.u}`);
        add('tline-plain', `${TS()} [DRY]  [DISABLE_USERS] Would kill sessions for ${user.u}`);
      } else {
        add('tline-info', `${TS()} [INFO] [DISABLE_USERS] Disabling: ${user.u} | reason='Offboarding'`);
        add('tline-ok',   `${TS()} [OK]   [DISABLE_USERS]   ✔ usermod -L ${user.u} (password locked)`);
        add('tline-ok',   `${TS()} [OK]   [DISABLE_USERS]   ✔ usermod -e 1 ${user.u} (account expired)`);
        add('tline-ok',   `${TS()} [OK]   [DISABLE_USERS]   ✔ pkill -SIGTERM -u ${user.u} (sessions terminated)`);
        add('tline-ok',   `${TS()} [OK]   [DISABLE_USERS]   ✔ GECOS updated with: [DISABLED:${new Date().toISOString().split('T')[0]}:root:Offboarding]`);
        add('tline-ok',   `${TS()} [OK]   [DISABLE_USERS] DISABLED: ${user.u}`);
      }
      add('tline-plain', '');
      disabled++;
    });

    add('tline-dim',  `  Disabled: ${disabled}  Failed: 0`);
    if (!isDry) add('tline-info', `${TS()} [INFO] Admin notification sent to admin@company.com`);

    return lines;
  };

  const auditScenario = () => {
    const lines = [];
    const add = (cls, text) => lines.push({ c: cls, t: text });
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);

    add('tline-dim',  '╔════════════════════════════════════════════════════╗');
    add('tline-dim',  '║  Linux User & Access Management Automation v1.0.0  ║');
    add('tline-dim',  '╚════════════════════════════════════════════════════╝');
    add('tline-cmd',  '$ sudo ./modules/audit_report.sh');
    add('tline-info', `${TS()} [INFO] [AUDIT_REPORT] ━━━ Generating audit report`);
    add('tline-info', `${TS()} [INFO] [AUDIT_REPORT] Scanning /etc/passwd for regular users`);
    add('tline-ok',   `${TS()} [OK]   [AUDIT_REPORT] Found ${USERS.length} regular user accounts`);
    add('tline-plain', '');
    add('tline-info', `${TS()} [INFO] [AUDIT_REPORT] § 1 Building All Users table`);
    add('tline-info', `${TS()} [INFO] [AUDIT_REPORT] § 2 Building Sudo Users list`);
    add('tline-ok',   `${TS()} [OK]   [AUDIT_REPORT]   sudo/wheel members: jsmith, scarroll, cfoster`);
    add('tline-info', `${TS()} [INFO] [AUDIT_REPORT] § 3 Checking accounts expiring within 30 days`);
    add('tline-warn', `${TS()} [WARN] [AUDIT_REPORT]   EXPIRING SOON: acontractor → 2026-06-30 (12d)`);
    add('tline-info', `${TS()} [INFO] [AUDIT_REPORT] § 4 Checking accounts inactive for 90+ days`);
    add('tline-warn', `${TS()} [WARN] [AUDIT_REPORT]   INACTIVE 90d+: lwang, fprice`);
    add('tline-info', `${TS()} [INFO] [AUDIT_REPORT] § 5 Checking never-logged-in accounts`);
    add('tline-info', `${TS()} [INFO] [AUDIT_REPORT] § 6 Querying journalctl for SSH failures (7d)`);
    add('tline-warn', `${TS()} [WARN] [AUDIT_REPORT]   Failed attempts: admin@192.168.1.44 (47), root@10.0.0.12 (31)`);
    add('tline-info', `${TS()} [INFO] [AUDIT_REPORT] § 7 Querying sudo usage log (last 50)`);
    add('tline-plain', '');
    add('tline-ok',   `${TS()} [OK]   [AUDIT_REPORT] HTML report written:`);
    add('tline-ok',   `                  /var/reports/usermgmt/audit_${ts.replace(/[: ]/g,'-')}.html`);
    add('tline-ok',   `${TS()} [OK]   [AUDIT_REPORT] Permissions: chmod 640`);

    return lines;
  };

  const sshScenario = (opts) => {
    const { count } = opts;
    const selectedUsers = USERS.slice(0, Math.min(count, 6));
    const lines = [];
    const add = (cls, text) => lines.push({ c: cls, t: text });

    add('tline-dim',  '╔════════════════════════════════════════════════════╗');
    add('tline-dim',  '║  Linux User & Access Management Automation v1.0.0  ║');
    add('tline-dim',  '╚════════════════════════════════════════════════════╝');
    add('tline-cmd',  '$ sudo ./modules/ssh_key_manager.sh audit');
    add('tline-info', `${TS()} [INFO] [SSH_KEY_MGR] SSH Key Audit — ${new Date().toISOString().split('T')[0]}`);
    add('tline-plain', '  ──────────────────────────────────────────────────────');
    add('tline-plain', `  ${'Username'.padEnd(22)}${'Keys'.padEnd(10)}Fingerprints`);
    add('tline-plain', '  ──────────────────────────────────────────────────────');

    selectedUsers.forEach((user, i) => {
      const hasKey = i % 3 !== 2;
      const keyCount = hasKey ? (i % 2 === 0 ? 1 : 2) : 0;
      if (keyCount === 0) {
        add('tline-warn', `  ${user.u.padEnd(22)}${'0'.padEnd(10)}(no keys)`);
      } else {
        add('tline-ok', `  ${user.u.padEnd(22)}${String(keyCount).padEnd(10)}SHA256:${Math.random().toString(36).substr(2,43)} (RSA)`);
      }
    });
    add('tline-plain', '');

    return lines;
  };

  const expireScenario = () => {
    const lines = [];
    const add = (cls, text) => lines.push({ c: cls, t: text });

    add('tline-dim',  '╔════════════════════════════════════════════════════╗');
    add('tline-dim',  '║  Linux User & Access Management Automation v1.0.0  ║');
    add('tline-dim',  '╚════════════════════════════════════════════════════╝');
    add('tline-cmd',  '$ sudo ./modules/expire_accounts.sh check');
    add('tline-info', `${TS()} [INFO] [EXPIRE_ACCTS] ━━━ Checking account expiry (warn_days=30)`);
    add('tline-plain', '');

    const expiringUsers = USERS.filter(u => u.exp);
    expiringUsers.forEach(user => {
      const daysLeft = RAND(-5, 45);
      if (daysLeft < 0) {
        add('tline-err',  `${TS()} [WARN] [EXPIRE_ACCTS] EXPIRED: ${user.u} (expiry: ${user.exp}, ${Math.abs(daysLeft)}d ago)`);
        add('tline-ok',   `${TS()} [OK]   [EXPIRE_ACCTS] DISABLED: ${user.u} (auto-disable triggered)`);
      } else if (daysLeft <= 30) {
        add('tline-warn', `${TS()} [INFO] [EXPIRE_ACCTS] EXPIRING SOON: ${user.u} in ${daysLeft} days (expiry: ${user.exp})`);
      }
    });

    add('tline-plain', '');
    add('tline-dim',  '╔══════════════════════════════════════════════════╗');
    add('tline-dim',  '║       Account Expiry Check Summary               ║');
    add('tline-dim',  '╠══════════════════════════════════════════════════╣');
    add('tline-dim',  '║  Expired accounts         : 1                   ║');
    add('tline-dim',  '║  Expiring within 30d      : 2                   ║');
    add('tline-dim',  '║  Auto-disabled            : 1                   ║');
    add('tline-dim',  '╚══════════════════════════════════════════════════╝');

    return lines;
  };

  // ── Render output ────────────────────────────────────────────────────────────
  const renderLines = (lines, outputEl, statusEl, titleEl, scenarioLabel) => {
    outputEl.innerHTML = '';
    statusEl.className = 'pg-term-status status-running';
    statusEl.textContent = 'RUNNING';
    titleEl.textContent = scenarioLabel;

    let i = 0;
    const interval = setInterval(() => {
      if (i >= lines.length) {
        clearInterval(interval);
        const allOk = !lines.some(l => l.c === 'tline-err');
        statusEl.className = `pg-term-status ${allOk ? 'status-ok' : 'status-err'}`;
        statusEl.textContent = allOk ? 'DONE' : 'ERRORS';
        // Add final prompt
        const promptDiv = document.createElement('div');
        promptDiv.innerHTML = `<span class="tline-prompt">root@prod-server-01 # </span><span class="cursor-blink"></span>`;
        outputEl.appendChild(promptDiv);
        outputEl.scrollTop = outputEl.scrollHeight;
        return;
      }

      const line = lines[i];
      const div = document.createElement('div');
      const span = document.createElement('span');
      span.className = line.c;
      span.textContent = line.t;
      div.appendChild(span);
      outputEl.appendChild(div);
      outputEl.scrollTop = outputEl.scrollHeight;
      i++;
    }, 40);
  };

  // ── Wire up controls ────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const runBtn     = document.getElementById('pg-run-btn');
    const clearBtn   = document.getElementById('pg-clear-btn');
    const outputEl   = document.getElementById('pg-output');
    const statusEl   = document.getElementById('pg-status');
    const titleEl    = document.getElementById('pg-term-title');
    const opSel      = document.getElementById('pg-operation');
    const countSel   = document.getElementById('pg-user-count');
    const scenarioSel= document.getElementById('pg-scenario');
    const sshCheck   = document.getElementById('pg-ssh-keys');
    const expiryCheck= document.getElementById('pg-expiry');

    if (!runBtn) return;

    runBtn.addEventListener('click', () => {
      const op       = opSel?.value || 'create';
      const count    = parseInt(countSel?.value || '5', 10);
      const scenario = scenarioSel?.value || 'success';
      const sshKeys  = sshCheck?.checked ?? true;
      const expiry   = expiryCheck?.checked ?? false;

      const opts = { count, scenario, sshKeys, expiry };
      let lines;
      let label;

      switch (op) {
        case 'create':
          lines = createScenario(opts);
          label = `create_users.sh${scenario === 'dryrun' ? ' --dry-run' : ''}`;
          break;
        case 'disable':
          lines = disableScenario(opts);
          label = `disable_users.sh --reason Offboarding`;
          break;
        case 'audit':
          lines = auditScenario();
          label = 'audit_report.sh';
          break;
        case 'ssh':
          lines = sshScenario(opts);
          label = 'ssh_key_manager.sh audit';
          break;
        case 'expire':
          lines = expireScenario();
          label = 'expire_accounts.sh check';
          break;
        default:
          lines = createScenario(opts);
          label = 'user_manager.sh';
      }

      renderLines(lines, outputEl, statusEl, titleEl, label);
    });

    clearBtn?.addEventListener('click', () => {
      outputEl.innerHTML = '<span class="tline-dim">  Output cleared. Run a simulation to see output.</span>';
      statusEl.className = 'pg-term-status status-idle';
      statusEl.textContent = 'IDLE';
      titleEl.textContent = 'user_manager.sh — ready';
    });
  });

})();
