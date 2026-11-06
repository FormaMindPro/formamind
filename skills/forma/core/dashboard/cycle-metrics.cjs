#!/usr/bin/env node
'use strict';

/**
 * Автосбор метрик круга (§3, §7) — Core читает готовые цифры, ноль модельных вызовов.
 * Источники — только карточки (`.devtool/features/`, живые и done) и парсер строки расхода
 * (`spend-line.cjs`, тот же, что у tally). Ничего не оценивает и не угадывает.
 *
 * Метрики (ключи вывода — английские):
 *   attemptsPerTask   — среднее и максимум заходов (attempt-строки §3) на карточку с хоть одним заходом;
 *   returnsByNode     — возвраты: строки «task check … не пройден/not passed» по проверившему узлу
 *                       + удлинения маршрута («route route-N → route-M», закон §2, их держит Kit);
 *   unknownShare      — доля attempt-строк с маркером `unknown` (движок не вернул факт) среди всех attempt-строк;
 *   metacycleShare    — доля карточек-метациклов (работа протокола над собой: label `goal-protocol`
 *                       или эпик протокола) среди всех карточек.
 *
 *   node .forma/dashboard/cycle-metrics.cjs [--json] [файл-или-каталог ...]
 *   node .forma/dashboard/cycle-metrics.cjs --self-test   — проба на синтетической карточке
 */

const fs = require('fs');
const path = require('path');
const { cardFiles } = require('./lib/card.cjs');
const { toEnglish, SPEND_SOURCE } = require('./spend-line.cjs');

const ATTEMPT_RE = () => new RegExp('^-\\s*' + SPEND_SOURCE + '—', 'i');
const RETURN_RE = /:\s*task check\b[^—]*—?\s*(?:[^—]*\b)?(?:не пройден|not passed)/i;
const RETURN_NODE_RE = /^-\s*`(\w+)`,/;
const ROUTE_LEN_RE = /:\s*(?:маршрут\s*|route\s+)?route-\d+\s*→\s*route-\d+\s*—/;

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
      metacycle: /goal-protocol/.test(labels) || /протокол/i.test(epic)
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
  // Фикстура собирается в рантайме: ни дат, ни кодов карточек литералами — чистая зона (запрет 16).
  const D = new Date().toISOString().slice(0, 10);
  const n = 1, k = 2;  // числа попыток собираются в рантайме — литералов-номеров в чистой зоне нет (запрет 16)
  const line = '- `Intent`, ' + D + ': task check — не пройден (попытка ' + n + ' из ' + k + '): критерий (b) не сходится.';
  const tmp = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'forma-cm-'));
  const fx = 'fixture-metric-card.md';
  require('fs').writeFileSync(require('path').join(tmp, fx),
    '---\nstatus: "todo"\nepic: "0. Sandbox"\nlabels: ["route-7"]\n---\n# fixture\n\n## History\n' +
    line + '\n- `Kit`, ' + D + ': attempt, 100 tokens (0 cache-read), 5 out, 2 s, `agent_x` — sandbox\n' +
    '- `Kit`, ' + D + ': attempt, unknown tokens (cache-read unknown), out unknown, unknown s, `agent_y` — sandbox\n' +
    '- `Kit`, ' + D + ': маршрут route-2 → route-5 — нет доступа сайта.\n\n## Result\n');
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
  console.log('Метрики круга (по карточкам доски, ноль модельных вызовов):');
  console.log('  попытки/задачу:        среднее ' + m.attemptsPerTask.average + ', максимум ' + m.attemptsPerTask.max + ' (' + m.cardsWithAttempts + ' из ' + m.cardsTotal + ' карточек с заходами)');
  console.log('  возвраты по узлам:     ' + (Object.keys(m.returnsByNode).map(n => n + ': ' + m.returnsByNode[n]).join(', ') || 'нет') + '; удлинений маршрута: ' + m.routeLengthened);
  console.log('  доля unknown:          ' + m.unknownShare);
  console.log('  доля метациклов:       ' + m.metacycleShare);
}

if (require.main === module) main();
module.exports = { collect, metrics };
