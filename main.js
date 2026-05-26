// main.js — Linux User & Access Management Automation — Web UI  v1.1.0
// Enterprise upgrade: toast notifications, counter animation, bash syntax
// highlighting, scripts search/keyboard-nav, active nav, back-to-top.
'use strict';

document.addEventListener('DOMContentLoaded', () => {

  // ── Toast notification system ────────────────────────────────────────────
  const toastContainer = document.getElementById('toast-container');

  function showToast(message, type = 'ok', durationMs = 2200) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'ok' ? '✔' : '✘';
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-exit');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, durationMs);
  }

  // ── Clipboard copy helper ────────────────────────────────────────────────
  function copyText(text, label = 'Copied') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => showToast(`${label} to clipboard`, 'ok'))
        .catch(() => fallbackCopy(text, label));
    } else {
      fallbackCopy(text, label);
    }
  }

  function fallbackCopy(text, label) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast(`${label} to clipboard`, 'ok');
    } catch {
      showToast('Copy failed — select manually', 'err');
    }
    document.body.removeChild(ta);
  }

  // Quick-install copy buttons
  document.addEventListener('click', e => {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    const targetId = btn.dataset.copy;
    const el = targetId && document.getElementById(targetId);
    if (el) {
      copyText(el.textContent.trim(), targetId.startsWith('csv') ? 'CSV' : 'Command');
      const orig = btn.textContent;
      btn.textContent = 'COPIED!';
      setTimeout(() => { btn.textContent = orig; }, 1800);
    }
  });

  // ── Scroll progress bar ──────────────────────────────────────────────────
  const progressBar = document.getElementById('progress-bar');
  if (progressBar) {
    window.addEventListener('scroll', () => {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      progressBar.style.width = total > 0 ? (window.scrollY / total * 100) + '%' : '0%';
    }, { passive: true });
  }

  // ── Header scroll state ──────────────────────────────────────────────────
  const header = document.getElementById('site-header');
  if (header) {
    window.addEventListener('scroll', () => {
      header.classList.toggle('scrolled', window.scrollY > 20);
    }, { passive: true });
  }

  // ── Back to top ──────────────────────────────────────────────────────────
  const backToTop = document.getElementById('back-to-top');
  if (backToTop) {
    window.addEventListener('scroll', () => {
      backToTop.classList.toggle('visible', window.scrollY > 400);
    }, { passive: true });
    backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ── Mobile hamburger ─────────────────────────────────────────────────────
  const hamburger    = document.getElementById('hamburger');
  const mobileNav    = document.getElementById('mobile-nav-overlay');
  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', () => {
      const open = mobileNav.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', String(open));
      mobileNav.setAttribute('aria-hidden', String(!open));
    });
    mobileNav.querySelectorAll('.mnav-link').forEach(l => {
      l.addEventListener('click', () => {
        mobileNav.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
        mobileNav.setAttribute('aria-hidden', 'true');
      });
    });
  }

  // ── Number counter animation ─────────────────────────────────────────────
  function animateCounter(el, target, suffix = '') {
    const duration = 1400;
    const start = performance.now();
    const from = 0;

    function step(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(from + (target - from) * eased) + suffix;
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // Observe stats bar
  const statsBar = document.getElementById('stats-bar');
  if (statsBar && 'IntersectionObserver' in window) {
    const statsObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.querySelectorAll('[data-count]').forEach(el => {
            const target = parseInt(el.dataset.count, 10);
            const suffix = el.textContent.includes('%') ? '%' : '';
            animateCounter(el, target, suffix);
          });
          statsObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    statsObserver.observe(statsBar);
  }

  // ── Bash syntax highlighter ──────────────────────────────────────────────
  function highlightBash(raw) {
    // Escape HTML first
    let s = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Order matters: comments first (preserve content)
    s = s.replace(/(#[^\n]*)/g, '<span class="sh-comment">$1</span>');

    // Heredoc markers
    s = s.replace(/&lt;&lt;['"]?(\w+)['"]?/g,
      (m) => `<span class="sh-heredoc">${m}</span>`);

    // Keywords
    const kws = ['if','then','else','elif','fi','for','while','do','done',
                 'case','esac','in','function','return','local','readonly',
                 'export','source','set','shift','break','continue','exit',
                 'true','false','declare','unset','trap','eval','exec'];
    const kwRe = new RegExp(`\\b(${kws.join('|')})\\b`, 'g');
    s = s.replace(kwRe, (m, p1) => {
      // Don't touch things inside comments (already wrapped in span)
      return `<span class="sh-kw">${p1}</span>`;
    });

    // Built-in commands
    const builtins = ['echo','printf','read','test','cd','pwd','mkdir','rm',
                      'cp','mv','chmod','chown','chage','usermod','useradd',
                      'userdel','groupadd','gpasswd','passwd','chpasswd',
                      'getent','grep','awk','sed','cut','sort','wc','date',
                      'openssl','ssh-keygen','setfacl','getfacl','pkill',
                      'systemctl','mail','mktemp','touch','cat','find'];
    const biRe = new RegExp(`(?<![\\w-])(${builtins.join('|')})(?![\\w-])`, 'g');
    s = s.replace(biRe, '<span class="sh-builtin">$1</span>');

    // Strings (double and single quoted)
    s = s.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g,
      '<span class="sh-str">"$1"</span>');
    s = s.replace(/'([^']*)'/g,
      '<span class="sh-str">\'$1\'</span>');

    // Variables $VAR and ${VAR}
    s = s.replace(/(\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*)/g,
      '<span class="sh-var">$1</span>');

    // Flags --option -x
    s = s.replace(/(?<=\s)(--?[a-zA-Z][\w-]*)/g,
      '<span class="sh-flag">$1</span>');

    return s;
  }

  // ── Hero terminal animation ──────────────────────────────────────────────
  const HERO_LINES = [
    { cls: 'tline-dim',    text: '╔════════════════════════════════════════════════════════╗' },
    { cls: 'tline-dim',    text: '║  Linux User & Access Management Automation  v1.0.0     ║' },
    { cls: 'tline-dim',    text: '║  Target: RHEL 9 / CentOS Stream / Rocky Linux          ║' },
    { cls: 'tline-dim',    text: '╚════════════════════════════════════════════════════════╝' },
    { cls: 'tline-plain',  text: '' },
    { cls: 'tline-warn',   text: '  ⚠  DRY-RUN MODE — no system changes will be made' },
    { cls: 'tline-plain',  text: '' },
    { cls: 'tline-cmd',    text: '  $ sudo ./modules/create_users.sh --dry-run users.csv' },
    { cls: 'tline-plain',  text: '' },
    { cls: 'tline-info',   text: '  [09:01:14] [INFO] [CREATE_USERS] ━━━ Processing 6 rows' },
    { cls: 'tline-plain',  text: '  [09:01:14] [DRY]  Would run: groupadd developers' },
    { cls: 'tline-plain',  text: '  [09:01:14] [DRY]  Would run: groupadd docker' },
    { cls: 'tline-plain',  text: '  [09:01:14] [DRY]  Would create: jsmith (John Smith) Engineering' },
    { cls: 'tline-plain',  text: '  [09:01:14] [DRY]  Would run: useradd -m -s /bin/bash -G developers:docker jsmith' },
    { cls: 'tline-plain',  text: '  [09:01:15] [DRY]  Would set password: chpasswd (12-char secure)' },
    { cls: 'tline-plain',  text: '  [09:01:15] [DRY]  Would run: chage -m 1 -M 90 -W 14 -I 30 jsmith' },
    { cls: 'tline-plain',  text: '  [09:01:15] [DRY]  Would run: chage -E 2026-12-31 jsmith' },
    { cls: 'tline-plain',  text: '  [09:01:15] [DRY]  Would deploy SSH key: jsmith.pub (ED25519)' },
    { cls: 'tline-plain',  text: '  [09:01:16] [DRY]  Would create: mrahman (Mehedi Rahman) Finance' },
    { cls: 'tline-plain',  text: '  [09:01:16] [DRY]  Would create: acontractor (Alex Contractor)' },
    { cls: 'tline-plain',  text: '  [09:01:17] [DRY]  Would create: lwilson (Laura Wilson) HR' },
    { cls: 'tline-plain',  text: '  [09:01:17] [DRY]  Would create: dkumar (Dev Kumar) DevOps' },
    { cls: 'tline-plain',  text: '  [09:01:17] [DRY]  Would create: scarroll (Sarah Carroll) IT' },
    { cls: 'tline-plain',  text: '' },
    { cls: 'tline-dim',    text: '  ╔════════════════════════════════════╗' },
    { cls: 'tline-dim',    text: '  ║   User Creation Summary (DRY-RUN)  ║' },
    { cls: 'tline-dim',    text: '  ╠════════════════════════════════════╣' },
    { cls: 'tline-plain',  text: '  ║  Rows processed   :  6             ║' },
    { cls: 'tline-ok',     text: '  ║  Would create     :  6    ✔        ║' },
    { cls: 'tline-plain',  text: '  ║  Failed           :  0             ║' },
    { cls: 'tline-plain',  text: '  ║  Skipped (exists) :  0             ║' },
    { cls: 'tline-dim',    text: '  ╚════════════════════════════════════╝' },
    { cls: 'tline-plain',  text: '' },
    { cls: 'tline-prompt', text: '  root@prod-server-01 # ' },
  ];

  const heroTerm = document.getElementById('hero-term');
  if (heroTerm) {
    let lineIdx = 0;
    let heroTimer = null;
    let paused = false;

    const printNextLine = () => {
      if (lineIdx >= HERO_LINES.length || paused) return;
      const { cls, text } = HERO_LINES[lineIdx++];
      const div = document.createElement('div');

      if (cls === 'tline-prompt') {
        div.innerHTML = `<span class="${cls}">${text}</span><span class="cursor-blink"></span>`;
      } else {
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = text;
        div.appendChild(span);
      }

      heroTerm.appendChild(div);
      heroTerm.scrollTop = heroTerm.scrollHeight;

      if (lineIdx < HERO_LINES.length) {
        const delay = text.includes('[DRY]')   ? 130 :
                      text.includes('[INFO]')  ? 70  :
                      text.includes('╔') || text.includes('╝') ? 35 :
                      text.length === 0 ? 25 :
                      cls === 'tline-cmd' ? 350 : 90;
        heroTimer = setTimeout(printNextLine, delay);
      }
    };

    // Pause animation when tab is hidden
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        paused = true;
        clearTimeout(heroTimer);
      } else {
        paused = false;
        printNextLine();
      }
    });

    setTimeout(printNextLine, 700);
  }

  // ── Scripts Explorer ─────────────────────────────────────────────────────
  const scriptList   = document.getElementById('script-list');
  const codeDisplay  = document.getElementById('code-display');
  const codeTitle    = document.getElementById('code-title');
  const codePath     = document.getElementById('code-path');
  const codeCopyBtn  = document.getElementById('code-copy-btn');
  const scriptsSearch= document.getElementById('scripts-search');

  if (scriptList && codeDisplay && typeof SCRIPTS_DATA !== 'undefined') {
    let activeBtn = null;
    let allBtns   = [];

    const showScript = (script) => {
      codeTitle.textContent = script.name;
      const lineCount = (script.code.match(/\n/g) || []).length + 1;
      codePath.textContent  = `${script.path}  ·  ${lineCount} lines`;
      // Apply syntax highlighting for bash scripts
      if (script.path.endsWith('.sh')) {
        codeDisplay.innerHTML = highlightBash(script.code);
      } else {
        codeDisplay.textContent = script.code;
      }
      // Scroll code panel back to top on each switch
      const panel = codeDisplay.closest('.script-code-body');
      if (panel) panel.scrollTop = 0;
    };

    const activateBtn = (btn, script) => {
      if (activeBtn) {
        activeBtn.classList.remove('active');
        activeBtn.setAttribute('aria-selected', 'false');
      }
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      activeBtn = btn;
      showScript(script);
    };

    SCRIPTS_DATA.forEach((script, idx) => {
      const btn = document.createElement('button');
      btn.className = 'script-btn';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', 'false');
      btn.setAttribute('aria-controls', 'code-display');
      btn.dataset.name = script.name.toLowerCase();

      const badgeHTML = script.badges.map(b =>
        `<span class="script-badge badge-${b}">${b}</span>`
      ).join('');
      const lineCount = (script.code.match(/\n/g) || []).length + 1;

      btn.innerHTML = `
        <div class="script-btn-info">
          <div class="script-btn-name">${script.name}</div>
          <div class="script-btn-desc">${script.description}</div>
          <div class="script-btn-badges">
            ${badgeHTML}
            <span class="script-badge badge-lines">${lineCount}L</span>
          </div>
        </div>`;

      btn.addEventListener('click', () => activateBtn(btn, script));

      // Keyboard navigation
      btn.addEventListener('keydown', e => {
        const visible = allBtns.filter(b => b.style.display !== 'none');
        const ci = visible.indexOf(btn);
        if (e.key === 'ArrowDown' && ci < visible.length - 1) {
          e.preventDefault(); visible[ci + 1].focus();
        } else if (e.key === 'ArrowUp' && ci > 0) {
          e.preventDefault(); visible[ci - 1].focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); activateBtn(btn, script);
        }
      });

      scriptList.appendChild(btn);
      allBtns.push(btn);

      if (idx === 0) {
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        activeBtn = btn;
        showScript(script);
      }
    });

    // Search / filter
    if (scriptsSearch) {
      scriptsSearch.addEventListener('input', () => {
        const q = scriptsSearch.value.toLowerCase().trim();
        allBtns.forEach(btn => {
          const match = !q || btn.dataset.name.includes(q);
          btn.style.display = match ? '' : 'none';
        });
        // If active is hidden, activate first visible
        if (activeBtn && activeBtn.style.display === 'none') {
          const first = allBtns.find(b => b.style.display !== 'none');
          if (first) first.click();
        }
      });
    }

    // Copy button for code panel
    if (codeCopyBtn) {
      codeCopyBtn.addEventListener('click', () => {
        const text = codeDisplay.innerText || codeDisplay.textContent || '';
        copyText(text, codeTitle.textContent || 'Script');
        const orig = codeCopyBtn.textContent;
        codeCopyBtn.textContent = 'COPIED!';
        setTimeout(() => { codeCopyBtn.textContent = orig; }, 1800);
      });
    }
  }

  // ── Intersection Observer: scroll reveals + stagger ──────────────────────
  const reveals = document.querySelectorAll('.pre-reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const siblings = entry.target.parentElement
            ?.querySelectorAll('.pre-reveal:not(.revealed)');
          let delay = 0;
          siblings?.forEach(el => {
            setTimeout(() => el.classList.add('revealed'), delay);
            delay += 55;
          });
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
    reveals.forEach(el => io.observe(el));
  } else {
    reveals.forEach(el => el.classList.add('revealed'));
  }

  // ── Active nav link on scroll ────────────────────────────────────────────
  const navLinks = document.querySelectorAll('.nav-link[href^="#"]');
  const sectionsForNav = Array.from(
    document.querySelectorAll('section[id], div[id="stats-bar"]')
  );

  if (navLinks.length && sectionsForNav.length && 'IntersectionObserver' in window) {
    let current = '';
    const navObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) current = entry.target.id;
      });
      navLinks.forEach(link => {
        link.classList.toggle(
          'nav-active',
          link.getAttribute('href') === `#${current}`
        );
      });
    }, { threshold: 0.25, rootMargin: `-${62}px 0px -40% 0px` });
    sectionsForNav.forEach(s => navObserver.observe(s));
  }

  // ── Smooth scroll (supplement CSS scroll-behavior) ───────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        const headerH = parseInt(
          getComputedStyle(document.documentElement).getPropertyValue('--header-h')
        ) || 62;
        const top = target.getBoundingClientRect().top + window.scrollY - headerH - 16;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

});
