// dist/js/lang-switcher.js
(function () {
  'use strict';

  const DEFAULT_LANG = 'sv';
  const SUPPORTED = ['sv', 'en', 'da', 'no'];

  // ---------- storage ----------
  function getSavedLang() {
    const v = localStorage.getItem('lang');
    return SUPPORTED.includes(v) ? v : DEFAULT_LANG;
  }
  function saveLang(lang) {
    localStorage.setItem('lang', lang);
  }

  // ---------- strings load/apply ----------
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

  // ---------- <html lang> ----------
  function markHtmlLang(lang) {
    document.documentElement.setAttribute('lang', lang);
    SUPPORTED.forEach(l => document.documentElement.classList.remove('lang-' + l));
    document.documentElement.classList.add('lang-' + lang);
  }

  // ---------- UI helpers ----------
  function highlightActiveButton(lang) {
    document.querySelectorAll('.lang-switcher .lang-btn').forEach(btn => {
      const isActive = btn.getAttribute('data-lang') === lang;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
      // simple inline visual (no external CSS needed)
      btn.style.outline = isActive ? '2px solid rgba(0,0,0,0.25)' : 'none';
      btn.style.borderRadius = '8px';
    });
  }

  // ---------- main setter ----------
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

    const sel = document.getElementById('lang-select');
    if (sel && sel.value !== lang) sel.value = lang;

    const wfBtn = document.querySelector('[data-lang-switch="' + lang + '"]');
    if (wfBtn) { try { wfBtn.click(); } catch (_) {} }

    highlightActiveButton(lang);

    document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang } }));
  }

  // ---------- switcher mount ----------
  function ensureSwitcher() {
    if (document.querySelector('.lang-switcher')) return;

    let container =
      document.getElementById('lang-mount') ||
      document.querySelector('.nav .button-group') ||
      document.querySelector('.nav_right') ||
      document.querySelector('.nav') ||
      null;

    const wrapper = document.createElement('div');
    wrapper.className = 'lang-switcher';
    // Minimal inline styles so it shows even utan CSS
    Object.assign(wrapper.style, {
      display: 'flex',
      gap: '8px',
      alignItems: 'center',
      zIndex: '9999'
    });

    // If no container found, pin it fixed top-right
    if (!container) {
      container = document.body;
      Object.assign(wrapper.style, {
        position: 'fixed',
        top: '12px',
        right: '12px',
        background: 'rgba(255,255,255,0.9)',
        padding: '6px 8px',
        borderRadius: '10px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
        backdropFilter: 'saturate(180%) blur(8px)'
      });
      console.warn('[i18n] No nav container found; mounted switcher fixed top-right.');
    }

    wrapper.innerHTML = `
      <span class="visually-hidden" id="lang-switcher-label">Language</span>

      ${renderBtn('sv', 'Svenska')}
      ${renderBtn('en', 'English')}
      ${renderBtn('da', 'Dansk')}
      ${renderBtn('no', 'Norsk')}

      <label for="lang-select" class="visually-hidden">Language</label>
      <select id="lang-select" aria-label="Language" style="display:none">
        <option value="sv">SV</option>
        <option value="en">EN</option>
        <option value="da">DA</option>
        <option value="no">NO</option>
      </select>
    `;

    container.appendChild(wrapper);

    // Hook up events
    wrapper.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => setLanguage(btn.getAttribute('data-lang')));
      // basic hover/active affordances (inline)
      btn.addEventListener('mouseenter', () => btn.style.transform = 'translateY(-1px)');
      btn.addEventListener('mouseleave', () => btn.style.transform = 'none');
    });

    const sel = wrapper.querySelector('#lang-select');
    sel && sel.addEventListener('change', e => setLanguage(e.target.value));
  }

  function renderBtn(code, label) {
    // Uses real <img>, so no CSS background is required.
    // Make sure you have: /flags/sv.svg, /flags/en.svg, /flags/da.svg, /flags/no.svg
    return `
      <button type="button" class="lang-btn" data-lang="${code}"
              aria-label="${label}" aria-pressed="false"
              style="background:transparent;border:0;padding:4px;cursor:pointer;display:flex;align-items:center">
        <img src="/flags/${code}.svg" width="24" height="16" alt="" style="display:block;border-radius:3px"/>
      </button>
    `;
  }

  // ---------- init ----------
  document.addEventListener('DOMContentLoaded', () => {
    ensureSwitcher();

    const initialLang = getSavedLang();
    const sel = document.getElementById('lang-select');
    if (sel) sel.value = initialLang;

    setLanguage(initialLang);
  });

  // optional global
  window.i18n = { setLanguage, getSavedLang };
})();
