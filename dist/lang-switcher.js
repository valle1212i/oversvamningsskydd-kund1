(function () {
    const DEFAULT_LANG = 'sv';
    const SUPPORTED = ['sv', 'en', 'da', 'no'];
  
    // Hämta/sätt språk i localStorage
    function getSavedLang() {
      const v = localStorage.getItem('lang');
      return SUPPORTED.includes(v) ? v : DEFAULT_LANG;
    }
    function saveLang(lang) {
      localStorage.setItem('lang', lang);
    }
  
    // Ladda strängar
    async function loadStrings(lang) {
      const url = `/i18n/${lang}/strings.json`;
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Could not load ${url}`);
      return res.json();
    }
  
    // Applicera strängar till alla element med data-i18n och data-i18n-attr
    function applyStrings(strings) {
      // textnoder
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key && strings[key] != null) {
          el.textContent = strings[key];
        }
      });
      // attribut
      document.querySelectorAll('[data-i18n-attr]').forEach(el => {
        // data-i18n-attr kan innehålla "title,aria-label,placeholder" osv
        const mapping = el.getAttribute('data-i18n-attr'); // ex: title:key.path,placeholder:key2.path
        if (!mapping) return;
        mapping.split(',').forEach(pair => {
          const [attr, key] = pair.split(':').map(s => s.trim());
          if (attr && key && strings[key] != null) {
            el.setAttribute(attr, strings[key]);
          }
        });
      });
    }
  
    // Uppdatera html-lang + klass
    function markHtmlLang(lang) {
      document.documentElement.setAttribute('lang', lang);
      SUPPORTED.forEach(l => document.documentElement.classList.remove('lang-' + l));
      document.documentElement.classList.add('lang-' + lang);
    }
  
    // Huvud: sätt språk
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
      // Synka dropdown-värde om den finns
      const sel = document.getElementById('lang-select');
      if (sel && sel.value !== lang) sel.value = lang;
      // Om du fortfarande använder Webflow-triggerknapparna:
      const btn = document.querySelector('[data-lang-switch="' + lang + '"]');
      if (btn) try { btn.click(); } catch(_) {}
      // Egen event om något annat vill lyssna
      document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang } }));
    }
  
    // Skapa/injicera dropdown i nav om den saknas
    function ensureDropdown() {
      if (document.getElementById('lang-select')) return;
  
      // Försök hitta rätt plats bredvid "Få en offert"
      let container = document.querySelector('.nav .button-group') 
                   || document.querySelector('.nav_right') 
                   || document.querySelector('.nav'); // fallback
  
      const wrapper = document.createElement('div');
      wrapper.className = 'lang-switcher';
      wrapper.style.display = 'inline-block';
      wrapper.style.marginLeft = '8px';
  
      wrapper.innerHTML = `
        <label for="lang-select" class="visually-hidden">Language</label>
        <select id="lang-select" aria-label="Language" class="w-select">
          <option value="sv">SV</option>
          <option value="en">EN</option>
          <option value="da">DA</option>
          <option value="no">NO</option>
        </select>
  
        <!-- valfria Webflow-knappar – gör inget om du inte använder dem -->
        <button type="button" hidden data-lang-switch="sv"></button>
        <button type="button" hidden data-lang-switch="en"></button>
        <button type="button" hidden data-lang-switch="da"></button>
        <button type="button" hidden data-lang-switch="no"></button>
      `;
      container && container.appendChild(wrapper);
    }
  
    // Init
    document.addEventListener('DOMContentLoaded', async () => {
      ensureDropdown();
  
      const sel = document.getElementById('lang-select');
      const initialLang = getSavedLang();
  
      // Sätt dropdowns värde innan laddning
      if (sel) {
        sel.value = initialLang;
        sel.addEventListener('change', (e) => {
          const v = e.target.value;
          setLanguage(v);
        });
      }
  
      // Applicera språk direkt vid pageload
      setLanguage(initialLang);
    });
  
    // Exponera globalt om du vill kunna byta från andra scripts
    window.i18n = { setLanguage, getSavedLang };
  })();
  