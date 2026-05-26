// main.js — Linux User & Access Management Automation — Web UI  v1.0.0
'use strict';

document.addEventListener('DOMContentLoaded', () => {

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

  // ── Mobile hamburger ─────────────────────────────────────────────────────
  const hamburger = document.getElementById('hamburger');
  const mobileNav = document.getElementById('mobile-nav-overlay');
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

  // ── Copy buttons ─────────────────────────────────────────────────────────
  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = 'COPIED';
      setTimeout(() => { btn.textContent = orig; }, 1600);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    const targetId = btn.dataset.copy;
    const el = targetId && document.getElementById(targetId);
    if (el) copyText(el.textContent.trim(), btn);
  });

  // ── Hero terminal animation ──────────────────────────────────────────────
  const HERO_LINES = [
    { cls: 'tline-dim',   text: '╔════════════════════════════════════════════════════╗' },
    { cls: 'tline-dim',   text: '║  Linux User & Access Management Automation v1.0.0  ║' },
    { cls: 'tline-dim',   text: '╚════════════════════════════════════════════════════╝' },
    { cls: 'tline-plain', text: '' },
    { cls: 'tline-warn',  text: '⚠  DRY-RUN MODE — simulation only' },
    { cls: 'tline-plain', text: '' },
    { cls: 'tline-cmd',   text: '$ sudo ./modules/create_users.sh --dry-run users.csv' },
    { cls: 'tline-info',  text: '[09:01:14] [INFO] CSV validated — 6 data rows' },
    { cls: 'tline-plain', text: '[09:01:14] [DRY]  Would create: jsmith (John Smith) IT' },
    { cls: 'tline-plain', text: '[09:01:14] [DRY]  Would run: groupadd developers' },
    { cls: 'tline-plain', text: '[09:01:14] [DRY]  Would run: groupadd sudo' },
    { cls: 'tline-plain', text: '[09:01:14] [DRY]  Would: useradd -m -G sudo:developers jsmith' },
    { cls: 'tline-plain', text: '[09:01:15] [DRY]  Would deploy SSH key: jsmith.pub' },
    { cls: 'tline-plain', text: '[09:01:15] [DRY]  Would set expiry: chage -E 2026-12-31 jsmith' },
    { cls: 'tline-plain', text: '[09:01:15] [DRY]  Would create: mrahman (Mehedi Rahman) Finance' },
    { cls: 'tline-plain', text: '[09:01:15] [DRY]  Would create: acontractor (Alex Contractor)' },
    { cls: 'tline-plain', text: '[09:01:16] [DRY]  Would create: lwilson (Laura Wilson) HR' },
    { cls: 'tline-plain', text: '[09:01:16] [DRY]  Would create: dkumar (Dev Kumar) Engineering' },
    { cls: 'tline-plain', text: '[09:01:16] [DRY]  Would create: scarroll (Sarah Carroll) DevOps' },
    { cls: 'tline-plain', text: '' },
    { cls: 'tline-dim',   text: '  Rows processed    : 6' },
    { cls: 'tline-ok',    text: '  Would create      : 6' },
    { cls: 'tline-dim',   text: '  Failed            : 0' },
    { cls: 'tline-dim',   text: '  Skipped           : 0' },
    { cls: 'tline-plain', text: '' },
    { cls: 'tline-prompt', text: 'root@prod-server-01 # ' },
  ];

  const heroTerm = document.getElementById('hero-term');
  if (heroTerm) {
    let lineIdx = 0;
    const printNextLine = () => {
      if (lineIdx >= HERO_LINES.length) return;
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
        const delay = text.includes('[DRY]') ? 140 :
                      text.includes('[INFO]') ? 80 :
                      text.includes('╔') || text.includes('║') || text.includes('╚') ? 40 :
                      text.length === 0 ? 30 :
                      cls === 'tline-cmd' ? 300 : 100;
        setTimeout(printNextLine, delay);
      }
    };

    // Start animation after a short delay
    setTimeout(printNextLine, 800);
  }

  // ── Scripts Explorer ─────────────────────────────────────────────────────
  const scriptList   = document.getElementById('script-list');
  const codeDisplay  = document.getElementById('code-display');
  const codeTitle    = document.getElementById('code-title');
  const codePath     = document.getElementById('code-path');
  const codeCopyBtn  = document.getElementById('code-copy-btn');

  if (scriptList && codeDisplay && typeof SCRIPTS_DATA !== 'undefined') {
    let activeBtn = null;

    const showScript = (script) => {
      codeTitle.textContent = script.name;
      codePath.textContent  = script.path;
      codeDisplay.textContent = script.code;
    };

    SCRIPTS_DATA.forEach((script, idx) => {
      const btn = document.createElement('button');
      btn.className = 'script-btn';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', 'false');
      btn.setAttribute('aria-controls', 'code-display');

      const badgeHTML = script.badges.map(b =>
        `<span class="script-badge badge-${b}">${b}</span>`
      ).join('');

      btn.innerHTML = `
        <div class="script-btn-info">
          <div class="script-btn-name">${script.name}</div>
          <div class="script-btn-desc">${script.description}</div>
          ${badgeHTML}
        </div>`;

      btn.addEventListener('click', () => {
        if (activeBtn) {
          activeBtn.classList.remove('active');
          activeBtn.setAttribute('aria-selected', 'false');
        }
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        activeBtn = btn;
        showScript(script);
      });

      scriptList.appendChild(btn);

      // Show first script by default
      if (idx === 0) {
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        activeBtn = btn;
        showScript(script);
      }
    });

    // Copy button for code panel
    codeCopyBtn?.addEventListener('click', () => {
      const text = codeDisplay.textContent || '';
      copyText(text, codeCopyBtn);
    });
  }

  // ── Intersection Observer: scroll reveals ────────────────────────────────
  const reveals = document.querySelectorAll('.pre-reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          // Stagger sibling elements
          const siblings = entry.target.parentElement?.querySelectorAll('.pre-reveal:not(.revealed)');
          let delay = 0;
          siblings?.forEach(el => {
            if (!el.classList.contains('revealed')) {
              setTimeout(() => el.classList.add('revealed'), delay);
              delay += 60;
            }
          });
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    reveals.forEach(el => io.observe(el));
  } else {
    reveals.forEach(el => el.classList.add('revealed'));
  }

  // ── Active nav link highlight on scroll ──────────────────────────────────
  const sections = document.querySelectorAll('section[id], div[id]');
  const navLinks  = document.querySelectorAll('.nav-link');

  if (navLinks.length && sections.length) {
    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          navLinks.forEach(link => {
            link.style.color = '';
            if (link.getAttribute('href') === `#${entry.target.id}`) {
              link.style.color = 'var(--cyan)';
            }
          });
        }
      });
    }, { threshold: 0.3 });
    sections.forEach(s => sectionObserver.observe(s));
  }

  // ── Smooth scroll for nav links (supplement CSS scroll-behavior) ─────────
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        const headerH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 62;
        const top = target.getBoundingClientRect().top + window.scrollY - headerH - 12;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

});
