#!/usr/bin/env node
'use strict';

/**
 * card-subagent-spend.cjs — строка расхода §3 субагентского вызова в карточку, одной командой
 * после возврата (фоновой вызов — можно и раньше, пока он жив: у части движков стенограмма
 * существует только пока вызов жив).
 *
 * Механизм — команда вызывающего, не хук: у движков без доказанного пакета хуков пишущего нет;
 * рука вызывающего выходит из контура набора чисел, но не из контура команды. Суммы — канонические,
 * из стенограммы вызова через `subagent-spend.cjs` (spendOf: адаптеры движков, дедуп по requestId);
 * N = Σ in+write+read+out. Стенограммы нет — маркеры unknown с причиной, никогда ноль: файл мог
 * быть удалён по завершении вызова, это норма, не сбой чтения.
 *
 *   node .claude/scripts/card-subagent-spend.cjs <NNN|путь к карточке> <agent_id> [--node Run] [--engine <tag>] [--write] [--desc "..."]
 *
 * Печатает строку формата §3; без --write — только печать, с --write — дописывает в конец зоны
 * ## History карточки (CLAUDE_SPEND_ROOT — корень проекта, по умолчанию — где лежит скрипт).
 * Повторный запуск с тем же id вызова — «уже записано», выход 0 (идемпотентность).
 * Стенограмма не найдена — нужен --engine <тег движка вызвавшего>: тег строки, найденная
 * стенограмма несёт тег своего владельца сама, а у отсутствующей взять его неоткуда.
 *
 * Выход: 0 — строка есть или уже была; 1 — у карточки нет зоны History; 2 — карточка или аргументы.
 */

const fs = require('fs');
const path = require('path');
const { spendOf } = require('./subagent-spend.cjs');
const { formatSpendLine, CLAIM_LINE_RE } = require('../../.forma/dashboard/spend-line.cjs');
const { NO_TRANSCRIPT } = require('../../.forma/dashboard/subagent-transcript.cjs');
const { cardFiles, HISTORY_HEADING_RE } = require('../../.forma/dashboard/lib/card.cjs');

const root = process.env.CLAUDE_SPEND_ROOT || path.resolve(__dirname, '..', '..');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? String(argv[i + 1] || '') : null;
};
// Позиционные: всё, что не флаг и не значение именованного флага.
const named = ['node', 'engine', 'desc'];
const positional = argv.filter((a, i) => {
  if (a.startsWith('--')) return false;
  const prev = argv[i - 1];
  return !(prev && prev.startsWith('--') && named.includes(prev.slice(2)));
});

const ref = positional[0];
const agentId = positional[1];
const NODE = flag('node') || 'Run';
const ENGINE = flag('engine');
const DESC = flag('desc');
const WRITE = argv.includes('--write');

if (!ref || !agentId || !/^[A-Za-z0-9_-]+$/.test(agentId)) {
  console.error('usage: node .claude/scripts/card-subagent-spend.cjs <NNN|путь к карточке> <agent_id> [--node Run] [--engine <tag>] [--write] [--desc "..."]');
  process.exit(2);
}

/** Карточка по номеру (префикс card-NNN-) или прямым путём; нет — null. */
function resolveCard(r) {
  if (/^\d{1,4}$/.test(r)) {
    const num = r.padStart(3, '0');
    return cardFiles(root, (name) => name.startsWith(`card-${num}-`))[0] || null;
  }
  const abs = path.resolve(r);
  return fs.existsSync(abs) ? abs : null;
}

/** Дописывает строку в конец зоны History (перед следующей зоной), сохраняя перевод строк. */
function appendToHistory(card, text, line) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const rows = text.split(/\r?\n/);
  const h = rows.findIndex((row) => HISTORY_HEADING_RE.test(row));
  if (h < 0) { console.error('card-subagent-spend: нет зоны History'); process.exit(1); }
  let end = rows.findIndex((row, i) => i > h && /^## /.test(row));
  if (end < 0) end = rows.length;
  while (end > h + 1 && !rows[end - 1].trim()) end--;
  rows.splice(end, 0, line);
  fs.writeFileSync(card, rows.join(nl));
  console.log(`записано в ${path.relative(root, card)}`);
}

(async () => {
  const card = resolveCard(ref);
  if (!card) { console.error(`card-subagent-spend: карточка не найдена: ${ref}`); process.exit(2); }
  const text = fs.readFileSync(card, 'utf8');

  // Идемпотентность: строка расхода с этим id вызова уже в карточке — второй не пишется.
  const seen = text.split(/\r?\n/).some((l) => CLAIM_LINE_RE.test(l) && l.includes('`' + agentId + '`'));
  if (seen) { console.log('уже записано: ' + agentId); return; }

  const s = await spendOf(agentId);
  const date = new Date().toISOString().slice(0, 10);
  let rec;
  if (s) {
    rec = {
      node: NODE, date,
      tokens: s.tokens_n, cache_read: s.cache_read, tokens_out: s.tokens_out, duration_s: s.duration_s,
      call_id: String(agentId), engine: s.engine,
      desc: `расход субагента по живой стенограмме (card-subagent-spend): шагов ${s.steps}` + (DESC ? `, ${DESC}` : ''),
    };
  } else {
    if (!ENGINE) {
      console.error(`card-subagent-spend: ${NO_TRANSCRIPT} — задайте --engine <тег движка вызвавшего>: тег строки взять неоткуда`);
      process.exit(2);
    }
    rec = {
      node: NODE, date,
      tokens: null, cache_read: null, tokens_out: null, duration_s: null,
      call_id: String(agentId), engine: ENGINE,
      desc: `${NO_TRANSCRIPT} — суммы снимают, пока вызов жив; после завершения файл мог быть удалён; неизвестно, не ноль (card-subagent-spend)` + (DESC ? `, ${DESC}` : ''),
    };
  }

  const line = '- ' + formatSpendLine(rec);
  console.log(line);
  if (WRITE) appendToHistory(card, text, line);
})();
