(function () {
  'use strict';

  const DEFAULT_LANG = 'sv';
  const SUPPORTED = ['sv', 'en', 'da', 'no'];

  // ---------- Storage ----------
  function getSavedLang() {
    const v = localStorage.getItem('lang');
    return SUPPORTED.includes(v) ? v : DEFAULT_LANG;
  }
  function saveLang(lang) {
    localStorage.setItem('lang', lang);
  }

  // ---------- Ladda & applicera strängar ----------
  async function loadStrings(lang) {
    // VIKTIGT: relativ sökväg (ingen inledande /)
    const url = `i18n/${lang}/strings.json`;
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load ${url}`);
    return res.json();
  }

  function applyStrings(strings) {
    // textnoder
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key && strings[key] != null) el.textContent = strings[key];
    });
    // attribut
    document.querySelectorAll('[data-i18n-attr]').forEach(el => {
      const mapping = el.getAttribute('data-i18n-attr'); // ex: "title:key.path,placeholder:key2.path"
      if (!mapping) return;
      mapping.split(',').forEach(pair => {
        const [attr, key] = pair.split(':').map(s => s.trim());
        if (attr && key && strings[key] != null) el.setAttribute(attr, strings[key]);
      });
    });
  }

  // ---------- <html lang> + språk-klasser ----------
  function markHtmlLang(lang) {
    document.documentElement.setAttribute('lang', lang);
    SUPPORTED.forEach(l => document.documentElement.classList.remove('lang-' + l));
    document.documentElement.classList.add('lang-' + lang);
  }

  // ---------- UI: markera aktiv flagga ----------
  function highlightActiveButton(lang) {
    document.querySelectorAll('.lang-switcher .lang-btn').forEach(btn => {
      const isActive = btn.getAttribute('data-lang') === lang;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
  }

  // ---------- Byt språk (enda källan till sanning) ----------
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

    // Synka fallback-select om den finns
    const sel = document.getElementById('lang-select');
    if (sel && sel.value !== lang) sel.value = lang;

    // (Valfritt) Webflow-triggers om de finns kvar
    const wfBtn = document.querySelector('[data-lang-switch="' + lang + '"]');
    if (wfBtn) { try { wfBtn.click(); } catch (_) {} }

    // Markera aktiv flagga
    highlightActiveButton(lang);

    // Eget event
    document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang } }));
  }

  // ---------- Skapa/injicera flagg-switcher ----------
  function ensureSwitcher() {
    if (document.querySelector('.lang-switcher')) return;

    // Om du vill styra exakt placering, lägg <div id="lang-mount"></div> i din nav.
    let container = document.getElementById('lang-mount')
                 || document.querySelector('.nav .button-group')
                 || document.querySelector('.nav_right')
                 || document.querySelector('.nav')
                 || document.body;

    const wrapper = document.createElement('div');
    wrapper.className = 'lang-switcher';
    wrapper.innerHTML = `
      <span class="visually-hidden" id="lang-switcher-label">Language</span>

      <button type="button" class="lang-btn" data-lang="sv" aria-label="Svenska" aria-pressed="false">
        <span class="flag" data-lang="sv" aria-hidden="true"></span>
      </button>
      <button type="button" class="lang-btn" data-lang="en" aria-label="English" aria-pressed="false">
        <span class="flag" data-lang="en" aria-hidden="true"></span>
      </button>
      <button type="button" class="lang-btn" data-lang="da" aria-label="Dansk" aria-pressed="false">
        <span class="flag" data-lang="da" aria-hidden="true"></span>
      </button>
      <button type="button" class="lang-btn" data-lang="no" aria-label="Norsk" aria-pressed="false">
        <span class="flag" data-lang="no" aria-hidden="true"></span>
      </button>

      <!-- Fallback/select för skärmläsare eller om CSS/JS inte laddar -->
      <label for="lang-select" class="visually-hidden">Language</label>
      <select id="lang-select" aria-label="Language" class="w-select">
        <option value="sv">SV</option>
        <option value="en">EN</option>
        <option value="da">DA</option>
        <option value="no">NO</option>
      </select>
    `;
    container.appendChild(wrapper);

    // Klick på flaggor
    wrapper.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => setLanguage(btn.getAttribute('data-lang')));
    });

    // Ändring i fallback-select
    const sel = wrapper.querySelector('#lang-select');
    if (sel) sel.addEventListener('change', e => setLanguage(e.target.value));
  }

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', () => {
    ensureSwitcher();

    const initialLang = getSavedLang();

    // Sätt initialt värde på fallback-select om den finns
    const sel = document.getElementById('lang-select');
    if (sel) sel.value = initialLang;

    // Applicera språk direkt
    setLanguage(initialLang);
  });

  // Valfritt: exponera globalt
  window.i18n = { setLanguage, getSavedLang };
})();
