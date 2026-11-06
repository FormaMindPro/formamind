#!/usr/bin/env node
'use strict';

/**
 * Адаптер экономики Claude Code: транскрипт / результат вызова Claude → каноническая запись
 * (.forma/manual/en/03-protocol/ECONOMY.md). Таблица «переменная → источник» — `.claude/agents/on-demand/spend-line.md`.
 *
 * Единственное место, где имена полей Claude (`input_tokens`, `subagent_tokens`, `duration_ms`…)
 * переводятся в канонические. Пользователи: subagent-transcript.cjs, card-session-spend.cjs,
 * session-economy.cjs; строку собирает .forma/dashboard/spend-line.cjs (`formatSpendLine`).
 *
 * Чего источник не дал — `null` (маркер `unknown`), никогда 0.
 *
 * CLI — строка расхода вызова субагента по его `<usage>`:
 *   node .claude/scripts/claude-economy.cjs line --node Run --agent-id <agent_id> \
 *     --tokens <subagent_tokens> --duration-ms <duration_ms> [--tool-uses <tool_uses>] \
 *     [--date YYYY-MM-DD] [--desc "<что сделано>"] [--split K --share I] [--write card-NNN]
 *   --write card-NNN — дописать строку с префиксом «- » в конец `## History` карточки (как хук SubagentStop);
 *   повтор с тем же agent_id по той же карточке строку не дублирует (печатается пометка, файл не меняется).
 *   N и R читаются из стенограммы захода (N = Σ in+write+read+out; `--tokens` — запасное значение);
 *   нет стенограммы — `(cache-read unknown)`, N из `--tokens` с пометкой «размер контекста» в описании.
 *
 *   --split K --share I (1..K) — один вызов `Spec`/`Kit` снаряжает или режет K карточек разом
 *   (пакет, AGENTS.md §3, «Любой заход к субагенту привязан к карточке»): расход вызова делится
 *   на K карточек, не приписывается каждой целиком и не считается по ней в полном объёме (это и
 *   было бы двойным счётом при сложении по доске). Доля — целочисленная, без остатка: N (и R, и T)
 *   делятся на K, первые (N mod K) карточек получают на 1 больше — сумма долей по всем K карточкам
 *   равна исходному N/R/T без приближения. agent_id у всех K строк один и тот же (это один вызов,
 *   не K); `tally.cjs` не схлопывает их в дубль, потому что числа каждой строки свои — дедуп по
 *   [id, tokens, cache, seconds] расходится. Описание получает пометку `batch I/K`.
 */

const { formatSpendLine } = require('../../.forma/dashboard/spend-line.cjs');
const { makeCli } = require('../../.forma/dashboard/lib/cli.cjs');

const has = (o, k) => o != null && o[k] != null && Number.isFinite(Number(o[k]));
const pick = (o, k) => (has(o, k) ? Number(o[k]) : null);

/** Один шаг транскрипта: `message.usage` Claude → tokens_in, tokens_out, cache_read, cache_write. */
function claudeUsage(u) {
  return {
    tokens_in: pick(u, 'input_tokens'),
    tokens_out: pick(u, 'output_tokens'),
    cache_read: pick(u, 'cache_read_input_tokens'),
    cache_write: pick(u, 'cache_creation_input_tokens'),
  };
}

/**
 * Результат Agent-вызова (+ стенограмма, если есть) → каноническая запись строки карточки.
 * @param usage { agent_id, subagent_tokens|tokens, tool_uses, duration_ms }
 * @param transcript результат readSubagentTranscript или null
 */
function fromAgentResult(usage, transcript) {
  const u = usage || {};
  const ms = pick(u, 'duration_ms');
  const t = transcript || null;
  // `subagent_tokens` из `<usage>` — размер контекста на последнем шаге, не расход (замер по
  // стенограммам: совпадает с ним, расходится с Σ в 10–40 раз). N по контракту — Σ in+write+read+out
  // по шагам, её даёт только стенограмма; без стенограммы остаётся контекст из `<usage>`.
  const sum = t ? [t.input, t.cacheCreate, t.cacheRead, t.output] : null;
  const fromTranscript = sum && sum.every((x) => x != null && Number.isFinite(Number(x)));
  const tokens = fromTranscript ? sum.reduce((a, x) => a + Number(x), 0)
    : (pick(u, 'subagent_tokens') ?? pick(u, 'tokens'));
  return {
    tokens,
    tokens_basis: fromTranscript ? 'sum' : (tokens == null ? null : 'context'),
    cache_read: t ? t.cacheRead : null,
    // В `<usage>` нет — только из стенограммы.
    cache_write: t ? t.cacheCreate : null,
    tokens_in: t ? t.input : null,
    tokens_out: t ? t.output : null,
    duration_s: ms == null ? null : Math.round(ms / 1000),
    call_id: u.agent_id ? String(u.agent_id) : null,
    tool_uses: pick(u, 'tool_uses'),
    // Свидетельство источника сумм: шаги стенограммы и её движок-владелец (null — стенограммы не было).
    steps: t ? (t.steps == null ? null : t.steps) : null,
    transcript_tag: t ? (t.tag || null) : null,
  };
}

/**
 * Доля карточки I (1..K) от общего количества `total`, целым числом, без остатка:
 * первые (total mod K) долей на 1 больше остальных — сумма всех K долей равна `total`.
 * `null`/`undefined` (unknown) остаётся как есть — делить нечего, доля тоже unknown.
 */
function batchShare(total, k, i) {
  if (total == null) return total;
  const base = Math.floor(total / k);
  const extra = total % k;
  return base + (i <= extra ? 1 : 0);
}

/** Запись вызова → запись одной из K карточек пакета (поля экономики делятся, call_id общий). */
function splitForBatch(rec, k, i) {
  return {
    ...rec,
    tokens: batchShare(rec.tokens, k, i),
    cache_read: batchShare(rec.cache_read, k, i),
    cache_write: batchShare(rec.cache_write, k, i),
    tokens_in: batchShare(rec.tokens_in, k, i),
    tokens_out: batchShare(rec.tokens_out, k, i),
    duration_s: batchShare(rec.duration_s, k, i),
  };
}

// ───────── журнал основной сессии (`Intent`) — раскладку и формат знает адаптер ─────────

const fs = require('fs');
const path = require('path');
const { transcriptsDir } = require('./dashboard-view.cjs');

/**
 * Журналы основной сессии этого проекта: `~/.claude/projects/<slug>/*.jsonl` — по записи на файл,
 * `{ id, file }` (id — имя файла без .jsonl). Правило раскладки — `dashboard-view.transcriptsDir`
 * (кодировка slug и отход по регистру); `CLAUDE_SPEND_PROJECTS` перекрывает каталог (проба на
 * синтетике). Каталога нет — пустой список: журналов нет, это не ноль.
 */
function mainSessions(root = process.cwd()) {
  const dir = process.env.CLAUDE_SPEND_PROJECTS || transcriptsDir(root);
  if (!dir || !fs.existsSync(dir)) return [];
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return []; }
  return files.filter((f) => f.endsWith('.jsonl')).map((f) => ({ id: f.slice(0, -6), file: path.join(dir, f) }));
}

/**
 * Одна запись журнала основной сессии Claude → нормализованный шаг
 * `{ ts, key, usage, toolCalls, human, model }`:
 *   ts — время записи; key — message.id (один ответ API пишется несколькими записями, расход — по
 *   первой); usage — `message.usage` (разбор — claudeUsage); toolCalls — блоки tool_use;
 *   human — реплика человека (user, не isMeta, с текстом); model — модель ответа.
 *   isSidechain (ветки субагентов — их расход пишет вызывающий по `<usage>`) и записи без
 *   времени — null: не запись. `prev` — предыдущая строка журнала; формату claude не нужна,
 *   сигнатура общая с адаптерами других движков.
 */
function mainStepOf(line) {
  if (!line || line.isSidechain || !line.timestamp) return null;
  const message = line.message || {};
  const assistant = line.type === 'assistant';
  const content = assistant && Array.isArray(message.content) ? message.content : [];
  const human = line.type === 'user' && !line.isMeta &&
    (typeof message.content === 'string' || (Array.isArray(message.content) && message.content.some((c) => c.type === 'text')));
  return {
    ts: line.timestamp,
    key: assistant && message.id ? message.id : null,
    usage: assistant && message.usage ? message.usage : null,
    toolCalls: content.filter((c) => c && c.type === 'tool_use'),
    human,
    model: (assistant && message.model) || null,
  };
}

module.exports = { claudeUsage, fromAgentResult, batchShare, splitForBatch, mainSessions, mainStepOf };

// ---- CLI ----
if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = makeCli(argv).value;
  if (argv[0] !== 'line' || !arg('node')) {
    console.error('usage: node .claude/scripts/claude-economy.cjs line --node <Node> --agent-id <id> --tokens <N> --duration-ms <ms> [--tool-uses <n>] [--date YYYY-MM-DD] [--desc "..."] [--split K --share I] [--write card-NNN]');
    process.exit(2);
  }
  const { readSubagentTranscript, NO_TRANSCRIPT } = require('../../.forma/dashboard/subagent-transcript.cjs');
  (async () => {
    const id = arg('agent-id');
    // Стенограмма ищется у ВСЕХ адаптеров движков: файл принадлежит движку, который исполнял вызов,
    // а у части движков он временен — жив, пока жив вызов. Тег строки ставит вызывающий, как прежде.
    const tr = id ? await readSubagentTranscript(id, undefined, null) : null;
    let rec = fromAgentResult({ agent_id: id, tokens: arg('tokens'), duration_ms: arg('duration-ms'), tool_uses: arg('tool-uses') }, tr);
    const k = arg('split'), i = arg('share');
    let batchNote = '';
    if (k != null) {
      if (i == null) { console.error('--split K требует --share I (1..K)'); process.exit(2); }
      rec = splitForBatch(rec, Number(k), Number(i));
      batchNote = ` (batch ${i}/${k})`;
    }
    const why = [];
    if (rec.cache_read == null) why.push(`R неизвестно: ${NO_TRANSCRIPT}`);
    if (rec.tokens == null) why.push('N не передан');
    else if (rec.tokens_basis === 'context') why.push('N — размер контекста из <usage>, не сумма: стенограммы нет');
    if (rec.duration_s == null) why.push('T не передано');
    if (rec.call_id == null) why.push('id не передан');
    // Пометка различимого источника: суммы сняты со стенограммы живого вызова, а не из <usage>.
    const marks = [];
    if (rec.tokens_basis === 'sum') {
      const parts = ['N'];
      if (rec.cache_read != null) parts.push('R');
      if (rec.tokens_out != null) parts.push('out');
      marks.push(`${parts.join(', ')} — суммы живой стенограммы (шагов: ${rec.steps == null ? '?' : rec.steps})`);
    }
    const desc = (arg('desc') || 'сделано.') + batchNote
      + (why.length ? ` (${why.join('; ')}.)` : '')
      + (marks.length ? ` (${marks.join('; ')}).` : '');
    const line = formatSpendLine({
      node: arg('node'),
      date: arg('date') || new Date().toISOString().slice(0, 10),
      engine: 'claude-code',
      desc,
      ...rec,
    });
    const target = arg('write');
    if (!target) { console.log(line); return; }
    const fs = require('fs');
    const path = require('path');
    const { accountedInCard, insertIntoHistory } = require('./ledger-recorder.cjs');
    const code = /card-\d{3}/.exec(String(target));
    const features = path.join(__dirname, '..', '..', '.devtool', 'features');
    const file = code && [features, path.join(features, 'done')].flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.startsWith(code[0] + '-') && f.endsWith('.md')).map((f) => path.join(d, f)) : []))[0];
    if (!file) { console.error('--write: card not found: ' + target); process.exit(2); }
    const text = fs.readFileSync(file, 'utf8');
    const bullet = '- ' + line;
    const dup = id ? accountedInCard(text, id).lines > 0 : text.split(String.fromCharCode(10)).map((l) => l.trimEnd()).includes(bullet);
    if (dup) { console.error('already recorded for ' + code[0] + (id ? ' (' + id + ')' : '') + ': not duplicated'); return; }
    const next = insertIntoHistory(text, bullet);
    if (next == null) { console.error('--write: no History zone in ' + path.basename(file)); process.exit(2); }
    fs.writeFileSync(file, next, 'utf8');
    console.log(bullet);
  })();
}
