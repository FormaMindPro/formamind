'use strict';

/**
 * How the MiniMax engine is seen in the dashboard's spend: what the dashboard counts from my lines.
 *
 * The dashboard takes the spend from the cards (the spend lines in `## History`) and slices it by the
 * engine tag - with a common expression, without a white list. So the `minimax:` tag lands in its own
 * column by itself. The script shows what exactly it sees, and where the "blind spots" are.
 *
 * Run: node .minimax/scripts/spend-view.cjs
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
// Printed labels come from the core dictionary: English key in code, ru value as data.
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

function build() {
  // The dashboard is the core: we read its builder, not repeating its parsing.
  const { buildData } = require(path.join(ROOT, '.forma', 'dashboard', 'generate.js'));
  const data = buildData(ROOT);
  return data;
}

function main() {
  const data = build();
  console.log(msg('spend.minimax-view.build_keys', { keys: Object.keys(data || {}).join(', ') }));
  const spend = (data && (data.spend || data.dash)) || {};
  const economy = spend.economy || (data && data.economy) || {};
  const byEngine = economy.byEngine || { keys: [], columns: {}, common: {} };

  console.log(msg('spend.minimax-view.table_header'));
  for (const k of byEngine.keys || []) {
    const c = byEngine.columns[k] || {};
    console.log(
      `${k.padEnd(13)} ${String(c.attempts || 0).padStart(7)} ${String(c.seconds || 0).padStart(7)} ` +
      `${String(c.lines || 0).padStart(6)} ${String(c.tokens == null ? '—' : c.tokens).padStart(8)} ` +
      `${String(c.cacheRead == null ? '—' : c.cacheRead).padStart(12)} ${String(c.cards || 0).padStart(8)}`
    );
  }
  if (!(byEngine.keys || []).includes('minimax')) {
    console.log('\n' + msg('spend.minimax-view.no_column'));
  }

  const engines = economy.engines || {};
  for (const k of Object.keys(engines)) {
    const v = engines[k] || {};
    const t = (v.totals) || {};
    console.log('\n' + msg('spend.minimax-view.engine_totals', {
      engine: k,
      attempts: t.attemptCount == null ? '—' : t.attemptCount,
      tokens: t.tokens == null ? '—' : t.tokens,
      cache: t.cacheRead == null ? '—' : t.cacheRead,
    }));
  }

  const ledger = path.join(ROOT, '.minimax', '.ledger', 'calls.jsonl');
  const lines = fs.existsSync(ledger)
    ? fs.readFileSync(ledger, 'utf8').split(/\r?\n/).filter((l) => l.trim())
    : [];
  const unknown = lines.filter((l) => {
    try { return JSON.parse(l).input_tokens == null; } catch { return true; }
  });
  console.log('\n' + msg('spend.minimax-view.ledger_summary', { records: lines.length, unknown: unknown.length }));

  // The raw `tally` parsing - to see what exactly it took and what it named unparsed.
  const { tally } = require(path.join(ROOT, '.forma', 'dashboard', 'tally.cjs'));
  const t = tally([path.join(ROOT, '.devtool', 'features')]);
  console.log(msg('spend.minimax-view.tally_summary', {
    files: t.filesProcessed, cards: t.cardsWithAttempt, unparsed: t.unparsed.length,
  }));
  for (const k of Object.keys(t.byEngine)) {
    const c = t.byEngine[k];
    console.log('  ' + msg('spend.minimax-view.engine_row', {
      engine: k, attempts: c.attempts, seconds: c.seconds, tokens: c.tokens,
      cache: c.cacheRead, unknown: c.unknown ? c.unknown.tokens : 0,
    }));
  }
  for (const u of t.unparsed.slice(0, 6)) {
    console.log('  ' + msg('spend.minimax-view.unparsed', { line: String(u.line || u).slice(0, 120) }));
  }
}

if (require.main === module) main();

module.exports = { build };
