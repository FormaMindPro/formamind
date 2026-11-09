// Shared by all tabs: the status dictionaries, the number and date formatting.
// Loaded first; the other files are classic scripts in one global scope.

const STATUS_LABEL = new Proxy({}, { get: (_, s) => (typeof s === 'string' ? t('board.col.' + s) : undefined) });
const STATUS_VAR = {backlog:"--st-backlog", todo:"--st-todo", "in-progress":"--st-progress", review:"--st-review", done:"--st-done"};
const STATUS_ORDER = ["backlog","todo","in-progress","review","done"];
const EPIC_COLORS = ["#2D7D8C","#5B6FD6","#B0562E","#A23B54","#6E8F3E","#8A5FBF","#2E8B7A","#4E6E8E"];

// A label with a number: the dictionary picks the form (one/few/many/other) via Intl.PluralRules, the number is formatted per language.
const cnt = (key, n) => t(key, {n, num: fmt(n)});
const curLang = () => (typeof i18nLang === 'function' ? i18nLang() : 'en');
function fmt(n){ return new Intl.NumberFormat(curLang()).format(n); }
// Relative time ("5 minutes ago"): Intl provides the forms and the word order per language.
function relTime(minutes){
  const rtf = new Intl.RelativeTimeFormat(curLang(), {numeric:'auto'});
  if (minutes < 60) return rtf.format(-Math.max(1, Math.round(minutes)), 'minute');
  if (minutes < 48 * 60) return rtf.format(-Math.round(minutes / 60), 'hour');
  return rtf.format(-Math.round(minutes / 1440), 'day');
}
// Card titles come from markdown and may carry angle brackets -
// they are substituted into template strings as markup, so we escape them.
function esc(s){ return String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function timeAgo(isoLike){
  // lastRunAt is stored as "YYYY-MM-DD HH:MM" (the local time of whoever wrote the line) - not ISO;
  // we parse it manually, without a time zone, only for a rough "how long ago" estimate.
  const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/.exec(isoLike);
  if (!m) return isoLike;
  const then = new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5]);
  const diffMs = Date.now() - then.getTime();
  return relTime(diffMs / 60000);
}

const hhmm = (s) => {
  if (!s) return '—';
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? t('time.hm', {h, m}) : t('time.m', {m});
};
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
