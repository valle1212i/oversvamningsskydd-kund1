(function () {
  'use strict';

  const DEFAULT_LANG = 'sv';
  const SUPPORTED = ['sv', 'en', 'da', 'no'];
  const FLAGS_BASE = './flags/'; // resolves to /dist/flags locally and /flags in prod


  // ---- Storage ----
  const getSavedLang = () => {
    const v = localStorage.getItem('lang');
    return SUPPORTED.includes(v) ? v : DEFAULT_LANG;
  };
  const saveLang = (lang) => localStorage.setItem('lang', lang);

  // ---- i18n load/apply ----
  async function loadStrings(lang) {
    const url = `/i18n/${lang}/strings.json`;
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load ${url}`);
    return res.json();
  }
  function applyStrings(strings) {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key && strings[key] != null) el.textContent = strings[key];
    });
    document.querySelectorAll('[data-i18n-attr]').forEach(el => {
      const mapping = el.getAttribute('data-i18n-attr');
      if (!mapping) return;
      mapping.split(',').forEach(pair => {
        const [attr, key] = pair.split(':').map(s => s.trim());
        if (attr && key && strings[key] != null) el.setAttribute(attr, strings[key]);
      });
    });
  }
  function markHtmlLang(lang) {
    document.documentElement.setAttribute('lang', lang);
    SUPPORTED.forEach(l => document.documentElement.classList.remove('lang-' + l));
    document.documentElement.classList.add('lang-' + lang);
  }

  // ---- UI builder (SVG + vit dropdown) ----
  function renderSwitcher(mount, current) {
    mount.innerHTML = ''; // reset

    const wrap = document.createElement('div');
    wrap.className = 'lang-switcher dd';
    wrap.innerHTML = `
      <button type="button" class="lang-toggle" aria-haspopup="true" aria-expanded="false">
        <img class="flag" src="${FLAGS_BASE}${current}.svg" alt="" width="20" height="14">
        <span class="code">${current.toUpperCase()}</span>
        <svg class="chev" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5.8 7.5l4.2 4.2 4.2-4.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
        <span class="visually-hidden" id="lang-switcher-label">Language</span>
      </button>
      <div class="lang-menu" role="menu" aria-labelledby="lang-switcher-label"></div>
    `;

    const menu = wrap.querySelector('.lang-menu');
    const items = [
      { lang:'sv', label:'Svenska' },
      { lang:'en', label:'English' },
      { lang:'da', label:'Dansk' },
      { lang:'no', label:'Norsk' },
    ];
    items.forEach(({lang,label}) => {
      const btn = document.createElement('button');
      btn.className = 'lang-item';
      btn.setAttribute('role','menuitem');
      btn.setAttribute('data-lang', lang);
      btn.innerHTML = `
       <img class="flag" src="${FLAGS_BASE}${lang}.svg" alt="" width="20" height="14">
        <span class="label">${label}</span>
      `;
      btn.addEventListener('click', () => setLanguage(lang));
      menu.appendChild(btn);
    });

    // toggle open/close
    const toggle = wrap.querySelector('.lang-toggle');
    toggle.addEventListener('click', () => {
      const open = wrap.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    // close on outside/Escape
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) {
        wrap.classList.remove('open');
        toggle.setAttribute('aria-expanded','false');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        wrap.classList.remove('open');
        toggle.setAttribute('aria-expanded','false');
        toggle.focus();
      }
    });

    mount.appendChild(wrap);
  }

  // ---- main setter (single source of truth) ----
  async function setLanguage(lang) {
    if (!SUPPORTED.includes(lang)) lang = DEFAULT_LANG;

    saveLang(lang);
    markHtmlLang(lang);

    try {
      const strings = await loadStrings(lang);
      applyStrings(strings);
    } catch (e) {
      console.error('[i18n] Failed to apply', lang, e);
    }

    // uppdatera UI (flagga + kod) om switchern finns
    const wrap = document.querySelector('.lang-switcher.dd');
    if (wrap) {
      const img = wrap.querySelector('.lang-toggle .flag');
      const code = wrap.querySelector('.lang-toggle .code');
      if (img) img.src = `${FLAGS_BASE}${lang}.svg`;
      if (code) code.textContent = lang.toUpperCase();
      // stäng meny
      wrap.classList.remove('open');
      wrap.querySelector('.lang-toggle')?.setAttribute('aria-expanded','false');
    }

    // ev. webflow-knapp-kompabilitet (om ni har kvar dem)
    const wfBtn = document.querySelector('[data-lang-switch="' + lang + '"]');
    if (wfBtn) { try { wfBtn.click(); } catch(_) {} }

    document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang } }));
  }

  // ---- init ----
  document.addEventListener('DOMContentLoaded', () => {
    const initial = getSavedLang();

    // Prioritize #lang-mount in header (next to "Få en offert" button)
    // Avoid rendering in dropdown menu button-groups
    let mount = document.getElementById('lang-mount');
    
    // If no specific mount found, look for button-group in nav_right (header)
    if (!mount) {
      const navRight = document.querySelector('.nav_right .button-group');
      if (navRight) {
        mount = document.createElement('div');
        mount.id = 'lang-mount';
        // Insert before mobile menu button
        const mobileBtn = navRight.querySelector('.nav_mobile-menu-button');
        if (mobileBtn) {
          navRight.insertBefore(mount, mobileBtn);
        } else {
          navRight.appendChild(mount);
        }
      }
    }
    
    // Fallback: use body if nothing found
    if (!mount) {
      mount = document.body;
    }

    renderSwitcher(mount, initial);
    setLanguage(initial);
  });

  // global (valfritt)
  window.i18n = { setLanguage, getSavedLang };
})();

