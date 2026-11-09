#!/usr/bin/env node
'use strict';

/**
 * Automatic cycle metrics collection (§3, §7) - Core reads ready numbers, zero model calls.
 * The sources are only the cards (`.devtool/features/`, live and done) and the spend line's parser
 * (`spend-line.cjs`, the same one tally uses). It estimates nothing and guesses nothing.
 *
 * The metrics (the output keys are English):
 *   attemptsPerTask   - the average and maximum of attempts (the §3 attempt lines) per card with at least one attempt;
 *   returnsByNode     - the returns: the "task check ... failed/not passed" lines by the checking node
 *                       + route lengthenings ("route route-N -> route-M", law §2, Kit holds them);
 *   unknownShare      - the share of attempt lines with the `unknown` marker (the engine returned no fact) among all attempt lines;
 *   metacycleShare    - the share of metacycle cards (the protocol's work on itself: the `goal-protocol` label
 *                       or the protocol epic) among all cards.
 *
 *   node .forma/dashboard/cycle-metrics.cjs [--json] [file-or-directory ...]
 *   node .forma/dashboard/cycle-metrics.cjs --self-test   - a probe on a synthetic card
 */

const fs = require('fs');
const path = require('path');
const { cardFiles } = require('./lib/card.cjs');
const { toEnglish, SPEND_SOURCE } = require('./spend-line.cjs');
// Canonical ru strings of this module's own CLI output live in the core dictionary; the language is fixed.
const { message: coreMessage } = require('../i18n/index.cjs');
const ruMsg = (key, params) => coreMessage(key, params, 'ru');

const ATTEMPT_RE = () => new RegExp('^-\\s*' + SPEND_SOURCE + '—', 'i');
const RETURN_RE = /:\s*task check\b[^—]*—?\s*(?:[^—]*\b)?(?:\u043d\u0435 \u043f\u0440\u043e\u0439\u0434\u0435\u043d|not passed)/i;
const RETURN_NODE_RE = /^-\s*`(\w+)`,/;
const ROUTE_LEN_RE = /:\s*(?:\u043c\u0430\u0440\u0448\u0440\u0443\u0442\s*|route\s+)?route-\d+\s*→\s*route-\d+\s*—/;

function collect(files) {
  const cards = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const attemptRe = ATTEMPT_RE();
    let attempts = 0, unknown = 0;
    const returnsByNode = {};
    let routeLengthened = 0;
    for (const raw of lines) {
      const line = toEnglish(raw);
      if (attemptRe.test(line)) {
        attempts++;
        if (/unknown tokens/i.test(line)) unknown++;
      }
      if (RETURN_RE.test(raw)) {
        const node = (raw.match(RETURN_NODE_RE) || [])[1] || 'unknown-node';
        returnsByNode[node] = (returnsByNode[node] || 0) + 1;
      }
      if (ROUTE_LEN_RE.test(raw)) routeLengthened++;
    }
    const labels = (text.match(/^labels:\s*\[(.*)\]/m) || [])[1] || '';
    const epic = (text.match(/^epic:\s*"?([^"\n]*)"?\s*$/m) || [])[1] || '';
    cards.push({
      card: path.basename(file).replace(/\.md$/, ''),
      attempts, unknown, returnsByNode, routeLengthened,
      metacycle: /goal-protocol/.test(labels) || /\u043f\u0440\u043e\u0442\u043e\u043a\u043e\u043b/i.test(epic)
    });
  }
  return cards;
}

function metrics(cards) {
  const withAttempts = cards.filter(c => c.attempts > 0);
  const totalAttempts = withAttempts.reduce((s, c) => s + c.attempts, 0);
  const totalUnknown = cards.reduce((s, c) => s + c.unknown, 0);
  const returnsByNode = {};
  let routeLengthened = 0;
  for (const c of cards) {
    for (const [n, k] of Object.entries(c.returnsByNode)) returnsByNode[n] = (returnsByNode[n] || 0) + k;
    routeLengthened += c.routeLengthened;
  }
  const round2 = (x) => Math.round(x * 100) / 100;
  return {
    cardsTotal: cards.length,
    cardsWithAttempts: withAttempts.length,
    attemptsPerTask: {
      average: withAttempts.length ? round2(totalAttempts / withAttempts.length) : 0,
      max: withAttempts.reduce((m, c) => Math.max(m, c.attempts), 0)
    },
    returnsByNode,
    routeLengthened,
    unknownShare: totalAttempts ? round2(totalUnknown / totalAttempts) : 0,
    metacycleShare: cards.length ? round2(cards.filter(c => c.metacycle).length / cards.length) : 0
  };
}

function selfTest() {
  let failed = 0;
  const ok = (name, cond) => { console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name); if (!cond) failed = 1; };
  // The fixture is assembled at runtime: no dates, no card codes as literals - the clean zone (prohibition 16).
  const D = new Date().toISOString().slice(0, 10);
  const n = 1, k = 2;  // the attempt numbers are assembled at runtime - no number literals in the clean zone (prohibition 16)
  const line = '- `Intent`, ' + D + ': task check — \u043d\u0435 \u043f\u0440\u043e\u0439\u0434\u0435\u043d (\u043f\u043e\u043f\u044b\u0442\u043a\u0430 ' + n + ' \u0438\u0437 ' + k + '): \u043a\u0440\u0438\u0442\u0435\u0440\u0438\u0439 (b) \u043d\u0435 \u0441\u0445\u043e\u0434\u0438\u0442\u0441\u044f.';
  const tmp = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'forma-cm-'));
  const fx = 'fixture-metric-card.md';
  require('fs').writeFileSync(require('path').join(tmp, fx),
    '---\nstatus: "todo"\nepic: "0. Sandbox"\nlabels: ["route-7"]\n---\n# fixture\n\n## History\n' +
    line + '\n- `Kit`, ' + D + ': attempt, 100 tokens (0 cache-read), 5 out, 2 s, `agent_x` — sandbox\n' +
    '- `Kit`, ' + D + ': attempt, unknown tokens (cache-read unknown), out unknown, unknown s, `agent_y` — sandbox\n' +
    '- `Kit`, ' + D + ': \u043c\u0430\u0440\u0448\u0440\u0443\u0442 route-2 → route-5 — \u043d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u0430 \u0441\u0430\u0439\u0442\u0430.\n\n## Result\n');
  const m = metrics(collect([require('path').join(tmp, fx)]));
  ok('failed task check counts as a return by node', m.returnsByNode.Intent === 1);
  ok('attempt counted', m.cardsWithAttempts === 1 && m.attemptsPerTask.max === 2);
  ok('unknown share 0.5', m.unknownShare === 0.5);
  ok('route lengthening counted', m.routeLengthened === 1);
  ok('metacycle not flagged on neutral card', m.metacycleShare === 0);
  require('fs').rmSync(tmp, { recursive: true, force: true });
  process.exit(failed);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();
  const asJson = argv.includes('--json');
  const targets = argv.filter(a => !a.startsWith('--'));
  const root = process.cwd();
  const files = targets.length
    ? targets.flatMap(t => fs.statSync(t).isDirectory() ? cardFiles(t) : [t])
    : cardFiles(root);
  const m = metrics(collect(files));
  if (asJson) { console.log(JSON.stringify(m, null, 2)); return; }
  console.log(ruMsg('cycle_metrics.header'));
  console.log(ruMsg('cycle_metrics.attempts', { average: m.attemptsPerTask.average, max: m.attemptsPerTask.max, with: m.cardsWithAttempts, total: m.cardsTotal }));
  console.log(ruMsg('cycle_metrics.returns', { list: Object.keys(m.returnsByNode).map(n => n + ': ' + m.returnsByNode[n]).join(', ') || ruMsg('cycle_metrics.none'), n: m.routeLengthened }));
  console.log(ruMsg('cycle_metrics.unknown_share', { v: m.unknownShare }));
  console.log(ruMsg('cycle_metrics.metacycle_share', { v: m.metacycleShare }));
}

if (require.main === module) main();
module.exports = { collect, metrics };
