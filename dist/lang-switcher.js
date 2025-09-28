(function () {
  'use strict';

  const DEFAULT_LANG = 'sv';
  const SUPPORTED = ['sv', 'en', 'da', 'no'];

  // ---- storage ----
  const getSavedLang = () => (SUPPORTED.includes(localStorage.getItem('lang')) ? localStorage.getItem('lang') : DEFAULT_LANG);
  const saveLang = (lang) => localStorage.setItem('lang', lang);

  // ---- load & apply strings ----
  async function loadStrings(lang) {
    // OBS: relativ sökväg från din /dist/
    const url = `i18n/${lang}/strings.json`;
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

  // ---- html lang + classes ----
  function markHtmlLang(lang) {
    document.documentElement.setAttribute('lang', lang);
    SUPPORTED.forEach(l => document.documentElement.classList.remove('lang-' + l));
    document.documentElement.classList.add('lang-' + lang);
  }

  // ---- ui helpers ----
  function highlightActiveButton(lang) {
    document.querySelectorAll('.lang-switcher .lang-btn').forEach(btn => {
      const active = btn.getAttribute('data-lang') === lang;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  // ---- main: setLanguage ----
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

  // ---- mount switcher ----
  function ensureSwitcher() {
    if (document.querySelector('.lang-switcher')) return;

    // 1) försök montera där du vill ha den (lägg gärna <div id="lang-mount"></div> i navbaren)
    const container =
      document.getElementById('lang-mount') ||
      document.querySelector('.nav .button-group') ||
      document.querySelector('.nav_right') ||
      document.querySelector('.nav') ||
      document.body;

    // 2) skapa wrapper + enkel “guard CSS” så UI alltid syns
    if (!document.getElementById('lang-switcher-guard')) {
      const guard = document.createElement('style');
      guard.id = 'lang-switcher-guard';
      guard.textContent = `
        .lang-switcher{display:flex;gap:8px;align-items:center}
        .lang-switcher .lang-btn{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid rgba(0,0,0,.15);border-radius:8px;background:#fff;cursor:pointer}
        .lang-switcher .lang-btn.is-active{outline:2px solid #3b82f6; outline-offset:2px}
        .lang-switcher .flag{width:20px;height:14px;display:inline-block;background-size:cover;background-position:center;border:1px solid rgba(0,0,0,.1)}
        .lang-switcher .abbr{font:500 12px/1.1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif}
        /* fallback-select göms men finns kvar för skärmläsare */
        #lang-select{position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden}
        .visually-hidden{position:absolute!important;height:1px;width:1px;overflow:hidden;clip:rect(1px, 1px, 1px, 1px);white-space:nowrap}
      `;
      document.head.appendChild(guard);
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'lang-switcher';
    wrapper.innerHTML = `
      <span class="visually-hidden" id="lang-switcher-label">Language</span>

      <button type="button" class="lang-btn" data-lang="sv" aria-label="Svenska" aria-pressed="false">
        <span class="flag" data-lang="sv" aria-hidden="true"></span><span class="abbr">SV</span>
      </button>
      <button type="button" class="lang-btn" data-lang="en" aria-label="English" aria-pressed="false">
        <span class="flag" data-lang="en" aria-hidden="true"></span><span class="abbr">EN</span>
      </button>
      <button type="button" class="lang-btn" data-lang="da" aria-label="Dansk" aria-pressed="false">
        <span class="flag" data-lang="da" aria-hidden="true"></span><span class="abbr">DA</span>
      </button>
      <button type="button" class="lang-btn" data-lang="no" aria-label="Norsk" aria-pressed="false">
        <span class="flag" data-lang="no" aria-hidden="true"></span><span class="abbr">NO</span>
      </button>

      <label for="lang-select" class="visually-hidden">Language</label>
      <select id="lang-select" aria-label="Language">
        <option value="sv">SV</option>
        <option value="en">EN</option>
        <option value="da">DA</option>
        <option value="no">NO</option>
      </select>
    `;
    container.appendChild(wrapper);

    // 3) sätt flaggbakgrunder inline (så du slipper vänta på extern CSS)
    wrapper.querySelectorAll('.flag').forEach(span => {
      const code = span.getAttribute('data-lang');
      span.style.backgroundImage = `url("flags/${code}.svg")`;
    });

    // 4) koppla events
    wrapper.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => setLanguage(btn.getAttribute('data-lang')));
    });
    const sel = wrapper.querySelector('#lang-select');
    if (sel) sel.addEventListener('change', (e) => setLanguage(e.target.value));
  }

  // ---- init ----
  document.addEventListener('DOMContentLoaded', () => {
    ensureSwitcher();
    const initial = getSavedLang();
    const sel = document.getElementById('lang-select');
    if (sel) sel.value = initial;
    setLanguage(initial);
  });

  window.i18n = { setLanguage, getSavedLang };
})();
