/* Simple client-side i18n loader
   - Place translation JSON files in `assets/locales/{lang}.json`
   - Mark elements with `data-i18n="path.to.key"` to replace innerText
   - For placeholders use `data-i18n-placeholder="path.to.key"`
   - Add buttons with class `lang-switch` and `data-lang="en"|"tr"` to switch language

   This is intentionally small and dependency-free. For larger sites consider
   using a library (i18next, Polyglot, etc.).
*/

(function () {
  const STORAGE_KEY = 'site_lang';
  const DEFAULT_LANG = 'tr';
  let translations = {};

  function fetchTranslations(lang) {
    return fetch(`/assets/locales/${lang}.json`).then(res => {
      if (!res.ok) throw new Error('Failed to load locale ' + lang);
      return res.json();
    });
  }

  function getKey(path, obj) {
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined) ? o[k] : null, obj);
  }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = getKey(key, translations);
      if (val !== null && val !== undefined) el.innerText = val;
    });

    // placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const val = getKey(key, translations);
      if (val !== null && val !== undefined) el.setAttribute('placeholder', val);
    });

    // document title: prefer a <title data-i18n="..."> element, fallback to translations.site.title
    try {
      const titleEl = document.querySelector('title[data-i18n]');
      if (titleEl) {
        const key = titleEl.getAttribute('data-i18n');
        const val = getKey(key, translations);
        if (val !== null && val !== undefined) document.title = val;
      } else if (translations && translations.site && translations.site.title) {
        document.title = translations.site.title;
      }
    } catch (e) {
      // ignore in environments without document.title
    }
  }

  function setLanguage(lang) {
    fetchTranslations(lang).then(json => {
      translations = json;
      applyTranslations();
      localStorage.setItem(STORAGE_KEY, lang);
      // set lang attribute on html element for accessibility
      document.documentElement.setAttribute('lang', lang);
      // update any toggle button text: if lang === 'tr' show "TR | EN", else "EN | TR"
      document.querySelectorAll('.lang-toggle').forEach(btn => {
        btn.innerText = (lang === 'tr') ? 'TR | EN' : 'EN | TR';
        btn.setAttribute('data-current-lang', lang);
      });
    }).catch(err => console.error('i18n error:', err));
  }

  function init() {
    // wire single toggle button(s)
    document.querySelectorAll('.lang-toggle').forEach(btn => {
      btn.addEventListener('click', function () {
        // current language stored in data-current-lang OR localStorage
        const current = this.getAttribute('data-current-lang') || localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
        const next = (current === 'tr') ? 'en' : 'tr';
        // When toggling, swap the display order as requested (show the active lang first)
        this.innerText = (next === 'tr') ? 'TR | EN' : 'EN | TR';
        setLanguage(next);
      });
    });

    const stored = localStorage.getItem(STORAGE_KEY);
    const browserLang = (navigator.language || navigator.userLanguage || '').slice(0,2).toLowerCase();
    const startLang = stored || (browserLang === 'en' ? 'en' : DEFAULT_LANG);
    // set initial state of toggle buttons immediately (before translations load)
    document.querySelectorAll('.lang-toggle').forEach(btn => {
      btn.innerText = (startLang === 'tr') ? 'TR | EN' : 'EN | TR';
      btn.setAttribute('data-current-lang', startLang);
    });
    setLanguage(startLang);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // expose for debugging
  window.__i18n = {
    setLanguage,
    get t() { return translations; }
  };

})();
