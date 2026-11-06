'use strict';

// Паритет журнала вызовов и карточек задач — в обе стороны.
// Для каждого адаптера с файлом `<dir>/.ledger/calls.jsonl` (адаптеры — из loadAdapters):
//   журнал → карточка: вызов не старше `since` (conversationId без `unknown`), чьего id нет ни в одной строке
//     расхода карточек, — находка;
//   карточка → журнал: строка расхода с меткой движка этого адаптера, с id вызова (не `id unknown`, не строка
//     основной сессии `card-session-spend`), датой не раньше `since` и строго позже первого дня журнала этого адаптера
//     (строки дня установки журнала частично предшествуют хуку, а в строке только дата — сверять не с чем):
//     • id в журнале есть — сверяются числа. Расхождение сумм по карточкам против нарастающих итогов журнала
//       (N, cache-read, out) — находка; секунды не сверяются: у журнала и строки разные основания T (стенограмма
//       против duration_ms вызова), продолжения и пакеты дают допустимые расхождения;
//     • id в журнале нет — сведение в `ctx.info` («журнал не покрывает»), не нарушение: строки пишутся и рукой,
//       и движком без хука, и отсутствие записи журнала не доказывает неверных чисел. Журнал есть, но пуст, — то же
//       сведение (молчание было бы ложным «ок», а красным его быть не должно).
// Нет файла журнала — адаптер не сверяется. Движок определяется по метке `spendTag` после тире.
// `extraRows` — `[{ file, line }]`, строки расхода, которых на доске ещё нет (досрочная проверка передачи карточки
// до записи файла, card-move.cjs): разбираются наравне с прочитанными.

const fs = require('fs');
const path = require('path');
const { cardLines, bulletList } = require('./support/lines.cjs');
const { toEnglish, SPEND_SOURCE, outTokens, toInt } = require('../../dashboard/spend-line.cjs');
const { loadAdapters } = require('../../dashboard/lib/engines.cjs');

const LINE_DATE_RE = /(\d{4}-\d{2}-\d{2}):\s*attempt,/;
const LINE_ID_RE = /,\s*`([^`\s]+)`\s*—/;
const LINE_TAG_RE = /—\s*([a-z][a-z0-9-]*):/;
const SPEND_ROW_RE = new RegExp(SPEND_SOURCE); // SPEND_SOURCE — строка-шаблон сегментов строки расхода

/** Вызовы журнала адаптера; `null` — файла нет, `[]` — файл есть, но пуст. */
function readLedger(root, adapter) {
  const ledgerPath = path.join(root, adapter.dir, '.ledger', 'calls.jsonl');
  if (!fs.existsSync(ledgerPath)) return null;
  const calls = [];
  let text = '';
  try { text = fs.readFileSync(ledgerPath, 'utf8'); } catch { return null; }
  for (const rl of text.split(/\r?\n/).filter(Boolean)) {
    try {
      const item = JSON.parse(rl);
      if (item.conversationId && !String(item.conversationId).includes('unknown')) calls.push(item);
    } catch {}
  }
  return calls;
}

/** Строка расхода → `{ file, date, id, tag, session, tokens, cache, out }`; чисел нет — `null` (не ноль). */
function spendRow(file, line) {
  const t = toEnglish(line.trim());
  const d = LINE_DATE_RE.exec(t);
  if (!d || !/^-\s/.test(t)) return null;
  const idm = LINE_ID_RE.exec(t);
  const id = idm && !idm[1].includes('unknown') ? idm[1].trim() : null;
  const tag = LINE_TAG_RE.exec(t);
  const m = SPEND_ROW_RE.exec(t);
  return {
    file, date: d[1], id, tag: tag ? tag[1] : null,
    session: /card-session-spend/.test(t),
    tokens: m && m[3] && m[3] !== 'unknown' ? toInt(m[3]) : null,
    cache: m && m[4] != null ? toInt(m[4]) : null,
    out: outTokens(t),
  };
}

/** Строки расхода карточек: `{ file, date, id, tag, session, tokens, cache, out }`. */
function spendRows(root, extraRows) {
  const rows = [];
  for (const { file, line } of cardLines(root)) {
    const r = spendRow(file, line);
    if (r) rows.push(r);
  }
  for (const { file, line } of Array.isArray(extraRows) ? extraRows : []) {
    const r = spendRow(file, line);
    if (r) rows.push(r);
  }
  return rows;
}

function run({ root, since, info, extraRows }) {
  const problems = [];
  const notes = Array.isArray(info) ? info : null; // сведение «журнал не покрывает» — не нарушение; без sink — молчание
  const rows = spendRows(root, extraRows);
  const cardCallIds = new Set(rows.filter((r) => r.id).map((r) => r.id));

  const ledgers = [];
  for (const a of loadAdapters(root)) {
    const calls = readLedger(root, a);
    if (calls) ledgers.push({ adapter: a, calls });
  }

  // журнал → карточка
  const orphanCalls = [];
  for (const { calls } of ledgers) {
    for (const call of calls) {
      const callDate = (call.timestamp || '').slice(0, 10);
      if (since && callDate < since) continue;
      if (!cardCallIds.has(call.conversationId)) {
        orphanCalls.push(`вызов ${call.conversationId} (${callDate}) не привязан ни к одной карточке`);
      }
    }
  }
  if (orphanCalls.length > 0) {
    problems.push(`нарушен паритет журнала вызовов и доски (${orphanCalls.length} вызовов без карточки):\n      ` + bulletList(orphanCalls));
  }

  // карточка → журнал
  const uncovered = []; // «журнал не покрывает» — сведение
  const mismatch = [];  // числовое расхождение — нарушение
  for (const { adapter, calls } of ledgers) {
    const tag = adapter.spendTag || adapter.tag || adapter.engine;
    const first = calls.map((c) => (c.timestamp || '').slice(0, 10)).filter(Boolean).sort()[0];
    const inWindow = rows.filter((r) => r.tag === tag && !r.session && r.id && (!since || r.date >= since));
    if (!calls.length) {
      if (inWindow.length && notes) notes.push(`журнал не покрывает вызовы: ${adapter.dir}/.ledger/calls.jsonl пуст, а в карточках ${inWindow.length} строк расхода «${tag}» с id вызова — сверять не с чем`);
      continue;
    }
    // Нарастающие итоги журнала: последняя запись по id (продолжения повторяют итоги с нарастанием).
    const totals = new Map();
    for (const c of calls) {
      const known = [c.input_tokens, c.output_tokens, c.cache_read_tokens, c.cache_write_tokens].every((x) => x == null || Number.isFinite(Number(x)));
      if (!known) continue;
      totals.set(c.conversationId, {
        tokens: [c.input_tokens, c.output_tokens, c.cache_read_tokens, c.cache_write_tokens].every((x) => x == null) ? null
          : [c.input_tokens, c.output_tokens, c.cache_read_tokens, c.cache_write_tokens].reduce((a, x) => a + (Number(x) || 0), 0),
        cache: c.cache_read_tokens, out: c.output_tokens,
      });
    }
    // Суммы по карточкам: пакеты (доли) и продолжения (дельты) в сумме по всем строкам id дают итог журнала.
    const sums = new Map();
    for (const r of inWindow) {
      if (first && r.date <= first) continue;
      if (!totals.has(r.id)) {
        uncovered.push(`${r.file}: строка расхода (${r.date}) с id ${r.id} — вызова нет в журнале ${adapter.dir}/.ledger`);
        continue;
      }
      if (r.tokens == null) continue; // «unknown tokens» — сверять нечего, это не ноль
      const s = sums.get(r.id) || { tokens: 0, cache: 0, out: 0, cacheKnown: true, outKnown: true, files: new Set() };
      s.tokens += r.tokens;
      if (r.cache != null) s.cache += r.cache; else s.cacheKnown = false;
      if (r.out != null) s.out += r.out; else s.outKnown = false;
      s.files.add(r.file);
      sums.set(r.id, s);
    }
    for (const [id, s] of sums) {
      const t = totals.get(id);
      const parts = [];
      if (t.tokens != null && t.tokens !== s.tokens) parts.push(`Σ по карточкам ${s.tokens} tokens, в журнале ${t.tokens}`);
      if (t.cache != null && s.cacheKnown && t.cache !== s.cache) parts.push(`Σ cache-read ${s.cache}, в журнале ${t.cache}`);
      if (t.out != null && s.outKnown && t.out !== s.out) parts.push(`Σ out ${s.out}, в журнале ${t.out}`);
      if (parts.length) mismatch.push({ id, parts, files: [...s.files] });
    }
  }
  if (uncovered.length && notes) notes.push(`журнал не покрывает вызов${uncovered.length === 1 ? '' : 'ы'} (${uncovered.length} строк расхода без вызова в журнале):\n      ` + bulletList(uncovered));
  if (mismatch.length > 0) {
    problems.push(`нарушен паритет доски и журнала вызовов (${mismatch.length} вызовов с расхождением чисел):\n      `
      + bulletList(mismatch.map(({ id, parts, files }) => `вызов ${id}: ${parts.join('; ')} (строки: ${files.join(', ')})`)));
  }

  return problems;
}

module.exports = { id: 'ledger-parity', since: 'ledger-parity', run };
