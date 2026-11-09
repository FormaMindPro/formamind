'use strict';

/**
 * The catalog of routes and overlays - all the codes from the tables of `.forma/manual/ru/03-protocol/ROUTES.md`, not hard-wired: "Engine"
 * shows everything there is, not only what is used. `DASH_ROUTES_FILE` - a source substitution for testing.
 */

const path = require('path');
const { readIfExists } = require('../lib/fs.cjs');
const i18n = require('../../i18n/index.cjs');

const ROUTES_REL = '.forma/manual/ru/03-protocol/ROUTES.md';
const RISK = ['\u041d\u0435\u043b\u044c\u0437\u044f, \u043a\u043e\u0433\u0434\u0430', '\u0420\u0438\u0441\u043a', '\u041f\u043e\u0447\u0435\u043c\u0443 \u043e\u0441\u0442\u043e\u0440\u043e\u0436\u043d\u043e', '\u0417\u0430\u0449\u0438\u0442\u0430 \u043e\u0442 \u0433\u043b\u0430\u0432\u043d\u043e\u0433\u043e \u0440\u0438\u0441\u043a\u0430', '\u0417\u0430\u0449\u0438\u0442\u0430 \u043e\u0442 \u0443\u0441\u0442\u0430\u0440\u0435\u0432\u0430\u043d\u0438\u044f'];
const WHY = ['\u0412\u044b\u0431\u0438\u0440\u0430\u0442\u044c, \u043a\u043e\u0433\u0434\u0430', '\u041f\u043e\u0447\u0435\u043c\u0443 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442', '\u041f\u043e\u0447\u0435\u043c\u0443'];
const SHORT = { '\u041d\u0435\u043b\u044c\u0437\u044f, \u043a\u043e\u0433\u0434\u0430': '\u041d\u0435\u043b\u044c\u0437\u044f', '\u0412\u044b\u0431\u0438\u0440\u0430\u0442\u044c, \u043a\u043e\u0433\u0434\u0430': '\u0412\u044b\u0431\u0438\u0440\u0430\u0442\u044c' };

const clean = (s) => s.replace(/`/g, '').replace(/\*\*/g, '').trim();

/** The detailed blocks of §4-§5: "### `route-N` - ...", lines "- **Label:** text". No line - no item. */
function parseDetails(text) {
  const details = {};
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^###\s+`((?:route|over)-\d+)`/);
    if (h) { cur = details[h[1]] = {}; continue; }
    if (/^#{1,3}\s/.test(line)) { cur = null; continue; }
    if (!cur || !/^- /.test(line)) continue;
    const b = line.match(/^- \*\*(.+?)\*\*\s*(.*)$/);
    if (b) cur[clean(b[1]).replace(/:$/, '')] = b[2].replace(/^:\s*/, '');
    else (cur._notes = cur._notes || []).push(clean(line.slice(2)));
  }
  return details;
}

function detailItems(d, keys) {
  const r = [];
  for (const k of keys) {
    if (d[k] == null) continue;
    const parts = d[k].split(new RegExp('\\*\\*(?:' + i18n.alt('project.guard') + '):\\*\\*'));
    r.push({ label: SHORT[k] || k, text: clean(parts[0]) });
    if (parts[1] != null) r.push({ label: '\u0417\u0430\u0449\u0438\u0442\u0430', text: clean(parts[1]) });
  }
  return r;
}

/** The table rows of `route-N` and `over-N` with the details from the blocks; the result is appended into `out`. */
function addCatalogRows(text, details, out) {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\|\s*`(route|over)-(\d+)`\s*\|/);
    if (!m) continue;
    const c = line.split('|').slice(1, -1).map(clean);
    const d = details[c[0]] || {};
    const risks = detailItems(d, RISK).concat((d._notes || []).map((t) => ({ label: '\u0421\u043c.', text: t })));
    const where = [{ label: '\u041a\u0440\u0430\u0442\u043a\u043e', text: c[c.length - 1] }].concat(detailItems(d, WHY));
    if (m[1] === 'route') out.routes.push({ code: c[0], name: c[1], chain: c[2], risks, where });
    else out.overlays.push({ code: c[0], name: c[1], changes: c[2], risks, where });
  }
}

function readRoutesCatalog(projectRoot) {
  const file = process.env.DASH_ROUTES_FILE || path.join(projectRoot, ROUTES_REL);
  const out = { source: process.env.DASH_ROUTES_FILE ? file : ROUTES_REL, routes: [], overlays: [] };
  const text = readIfExists(file, null);
  if (text === null) { out.missing = true; return out; }
  addCatalogRows(text, parseDetails(text), out);
  return out;
}

module.exports = { readRoutesCatalog };
