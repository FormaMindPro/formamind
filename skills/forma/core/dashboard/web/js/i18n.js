// UI localization. One file for browser and server: the core (`format`, `pick`, `translate`) is pure functions -
// lib/i18n.cjs takes the same ones via require; the browser part (state, dictionary loading, the switcher) is below.
// A dictionary is a flat JSON `locales/<code>.json`; the `_meta.name` key is the language's name in the list. A value is a string
// with `{name}` placeholders or a number-forms object `{one, few, many, other}` (chosen by `vars.n` via Intl.PluralRules).
// A key missing in the chosen language - en is taken; missing there too - the key itself is shown.
(function (root) {
  'use strict';
  const FALLBACK = 'en';

  function pick(entry, n, lang) {
    if (entry && typeof entry === 'object') {
      const form = new Intl.PluralRules(lang).select(Number(n) || 0);
      return entry[form] !== undefined ? entry[form] : (entry.other !== undefined ? entry.other : '');
    }
    return entry;
  }
  const format = (str, vars) => String(str).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));

  /** dicts: { en: {...}, <lang>: {...} }. */
  function translate(dicts, lang, key, vars) {
    const own = dicts[lang] || {}, fb = dicts[FALLBACK] || {};
    const entry = key in own ? own[key] : (key in fb ? fb[key] : undefined);
    if (entry === undefined) return key;
    return format(pick(entry, vars && vars.n, key in own ? lang : FALLBACK), vars);
  }

  const core = { FALLBACK, pick, format, translate };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }

  // ---------- browser ----------
  const STORE = 'forma.lang';
  const dicts = {};
  let lang = FALLBACK;
  let locales = [{ code: 'en', name: 'English' }, { code: 'ru', name: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439' }]; // i18n-keep: the language's native name

  const stored = () => { try { return localStorage.getItem(STORE); } catch { return null; } };
  const store = (code) => { try { localStorage.setItem(STORE, code); } catch { /* private mode - the choice is not remembered */ } };
  const loadDict = (code) => dicts[code] ? Promise.resolve() : fetch('locales/' + code + '.json')
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((d) => { dicts[code] = d; })
    .catch(() => { dicts[code] = {}; });

  /** Translates a key into the chosen language; `vars` are the substitutions, `vars.n` picks the number form. */
  root.t = (key, vars) => translate(dicts, lang, key, vars);
  root.i18nLang = () => lang;

  /** Applies translations to elements with `data-i18n` (text), `data-i18n-ph` (placeholder), `data-i18n-title` (title). */
  root.i18nApply = (scope) => {
    const el = scope || document;
    el.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = root.t(n.dataset.i18n); });
    el.querySelectorAll('[data-i18n-ph]').forEach((n) => { n.placeholder = root.t(n.dataset.i18nPh); });
    el.querySelectorAll('[data-i18n-title]').forEach((n) => { n.title = root.t(n.dataset.i18nTitle); });
    document.documentElement.lang = lang;
    document.title = root.t('app.title');
  };

  function renderSwitcher() {
    const sel = document.getElementById('lang');
    if (!sel) return;
    sel.innerHTML = locales.map((l) => `<option value="${l.code}"${l.code === lang ? ' selected' : ''}>${l.name}</option>`).join('');
    sel.title = root.t('lang.label');
    sel.onchange = () => root.i18nSet(sel.value);
  }

  /** Language choice: the dictionary loads, the choice is remembered, the page redraws on the `i18n` event. */
  root.i18nSet = (code) => loadDict(code).then(() => {
    lang = code;
    store(code);
    root.i18nApply();
    renderSwitcher();
    document.dispatchEvent(new CustomEvent('i18n', { detail: code }));
  });

  /** Start: the language list from the server (no server - en and ru), en as the fallback, the language from localStorage, else en. */
  root.i18nInit = () => fetch('locales.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((j) => { if (j && Array.isArray(j.locales) && j.locales.length) locales = j.locales; })
    .then(() => loadDict(FALLBACK))
    .then(() => { const s = stored(); return root.i18nSet(locales.some((l) => l.code === s) ? s : FALLBACK); });
})(typeof window !== 'undefined' ? window : globalThis);
