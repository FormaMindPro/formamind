'use strict';

/**
 * A card for the board and the "Law": the fields whole - kit by units, launch readiness, spend from history
 * lines, links by labels. A separate parse from the spend count (`cards.cjs`): the board needs the whole card,
 * the count - only the spend lines.
 */

const { parseFrontmatterJson, zone } = require('../lib/card.cjs');
const i18n = require('../../i18n/index.cjs');
const APPROVAL_RE = new RegExp(i18n.alt('hist.approved'), 'i');

// Kit units are English keys (kit.role ...); per-language labels live in i18n/keys.json.
const KIT_UNITS = ['role', 'skill', 'tool', 'access', 'data', 'model'];

// The kit is written both as a list "- **Role:** ..." and as a line "Role: ... · Skill: ..." - the text is cut at unit labels
// starting with a capital (up to three letters of ending after the label are allowed - e.g. "Skills" in Russian, or "Tools").
const KIT_KEY = new RegExp('(?:^|[\\s.·(;])((?:' + i18n.alt(...KIT_UNITS.map((u) => 'kit.' + u)) + ')\\p{L}{0,3})(?![\\p{L}])\\s*[:—–·-]?\\s*', 'gu');

const ATTEMPT_LINE = /: attempt,/;
const TOKENS_RE = /attempt,\s*([\d\s\u00a0\u202f]+)\s*tokens/;
const CACHE_RE = /\(([\d\s\u00a0\u202f]+)\s*cache-read\)/;

const spaceless = (s) => Number(String(s).replace(/[\s\u00a0\u202f]/g, ''));

/** Kit by units: `{ role: '…', skill: '…' }`; several entries of one unit are glued with " · ". */
function kitPartsOf(kit) {
  const parts = {};
  const flat = kit.replace(/\*\*/g, '');
  const hits = [...flat.matchAll(KIT_KEY)];
  hits.forEach((m, i) => {
    const u = KIT_UNITS.find((id) => i18n.isKey(m[1], 'kit.' + id));
    if (!u) return;
    const end = hits[i + 1] ? hits[i + 1].index : undefined;
    const val = flat.slice(m.index + m[0].length, end).replace(/^[\s·.:;-]+|[\s·.;-]+$/g, '').replace(/\s*\n\s*-?\s*/g, ' ');
    if (val) parts[u] = (parts[u] ? parts[u] + ' · ' : '') + val;
  });
  return parts;
}

/** Spend from one history line (§3): `N tokens (R cache-read), T s`; tokens and cache go by the engine tag. */
function addSpendLine(spend, l) {
  spend.lines++;
  const tg = /—\s*([a-z][a-z0-9-]*):/.exec(l);
  const E = spend.byEngine[tg ? tg[1] : 'untagged'] || (spend.byEngine[tg ? tg[1] : 'untagged'] = { tokens: 0, cache: 0, lines: 0, unknown: 0 });
  E.lines++;
  const sm = l.match(/,\s*(\d+)\s*s,/);
  if (sm) spend.sec += +sm[1];
  const t = l.match(TOKENS_RE);
  if (!t || spaceless(t[1]) === 0) { spend.unknown++; E.unknown++; return; } // "0 tokens" per §3 is not a number but an omission
  E.tokens += spaceless(t[1]);
  const r = l.match(CACHE_RE);
  if (!r) return;
  E.cache += spaceless(r[1]);
  if (spaceless(r[1]) > spaceless(t[1])) E.mixed = true; // cache greater than the total - N was written without cache
}

/** Tokens and cache go by the engine tag (`spend.byEngine`): different engines do not go into one sum. */
function spendOf(history) {
  const spend = { sec: 0, lines: 0, unknown: 0, byEngine: {} };
  for (const l of history) {
    if (ATTEMPT_LINE.test(l)) addSpendLine(spend, l);
  }
  return spend;
}

/**
 * Access: an "Access" line in the kit with status "confirmed"/confirmed. We take the segment after the access label
 * up to the next unit. `null` - no line; `'unknown'` - named, but the status (prohibition 15) is not recorded.
 */
function accessStatus(kit) {
  const am = kit.match(new RegExp('(?:' + i18n.alt('kit.access') + ')\\W*?:\\**\\s*([^·\\n]*)', 'i'));
  const accessText = am ? am[1].trim() : null;
  if (accessText === null) return null;
  if (i18n.hasPhrase(accessText, 'access_unconfirmed')) return false;
  if (i18n.hasPhrase(accessText, 'access_ok')) return true;
  return accessText ? 'unknown' : false;
}

// Route stage dates and route lines go by history keys (hist.approved / check / accepted / route); the browser knows no words.
const dateOfLine = (history, key) => {
  const re = new RegExp(i18n.alt(key), 'i');
  const l = history.find((x) => re.test(x));
  const m = l && l.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : '';
};
const routeDatesOf = (history) => ({
  approve: dateOfLine(history, 'hist.approved'), check: dateOfLine(history, 'hist.check'), accept: dateOfLine(history, 'hist.accepted'),
});
const routeLinesOf = (history) => history.filter((l) => /route-\d/i.test(l) || new RegExp(i18n.alt('hist.route'), 'i').test(l));

/** Launch readiness: the goal, five fields, kit, route, approval, access, budget remainder, dependencies. */
function readiness({ labels, fields, kit, history }, kitParts) {
  const route = labels.find((l) => /^route-\d$/.test(l)) || null;
  const kitUnits = KIT_UNITS.filter((n) => kitParts[n]);
  const spent = history.filter((l) => ATTEMPT_LINE.test(l)).length;
  const budgetN = parseInt(fields[3], 10);
  return {
    goal: labels.filter((l) => l.startsWith('goal-')).length === 1,
    task: fields.length >= 5 && fields.slice(0, 5).every(Boolean),
    kitUnits,
    route: !!route,
    approval: /^route-[0-5]$/.test(route || '') ? history.some((l) => APPROVAL_RE.test(l)) : null,
    kit: kitUnits.length === 6,
    access: accessStatus(kit),
    budgetLeft: Number.isFinite(budgetN) ? budgetN - spent : null,
    deps: labels.filter((l) => /^after-card-\d+$/.test(l)).map((l) => l.replace('after-', '')),
  };
}

/**
 * A board card from file `f` with text `text`; `.forma/skills` - the project's skill names (which of them are named in the kit).
 * The `text` field is temporary - for link search; `board.cjs` removes it from the data.
 */
function parseBoardCard(f, text, skills) {
  const fm = parseFrontmatterJson(text);
  const fields = zone(text, 'task').split('|').map((s) => s.trim());
  const history = zone(text, 'history').split(/\r?\n/).filter((l) => l.startsWith('- '));
  const labels = Array.isArray(fm.labels) ? fm.labels : [];
  const kit = zone(text, 'kit');
  const kitParts = kitPartsOf(kit);
  const skillText = kitParts.skill || '';
  const spendLines = history.filter((l) => ATTEMPT_LINE.test(l));
  const ready = readiness({ labels, fields, kit, history }, kitParts);
  return {
    ready,
    routeDates: routeDatesOf(history),
    routeLines: routeLinesOf(history),
    kitParts,
    kitSkills: skills.filter((n) => new RegExp('(^|[^\\w-])' + n + '([^\\w-]|$)').test(skillText)),
    spend: spendOf(history),
    historySpend: spendLines.map((l) => l.slice(2)),
    code: (f.match(/^card-\d+/) || [''])[0],
    title: (text.match(/^# (.+)$/m) || [null, f])[1].replace(/^card-\d+\s*·\s*/, ''),
    status: fm.status || 'backlog',
    assignee: fm.assignee ?? null,
    epic: fm.epic || '—',
    priority: fm.priority || 'medium',
    modified: fm.modified || fm.created || null,
    labels,
    goal: labels.find((l) => l.startsWith('goal-')) || null,
    route: labels.find((l) => /^route-\d$/.test(l)) || null,
    kind: (fields[0] || '').split('·')[1]?.trim() || '',
    delivers: fields[1] || '',
    criterion: fields[2] || '',
    budget: fields[3] || '',
    next: fields[4] || '',
    lastEvent: (history[history.length - 1] || '').slice(2),
    history: history.map((l) => l.slice(2)),
    text,
    attempts: spendLines.length,
  };
}

module.exports = { parseBoardCard };
