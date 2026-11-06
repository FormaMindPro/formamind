#!/usr/bin/env node
'use strict';

/**
 * subagent-spend.cjs — канонические суммы живого субагентского вызова по его стенограмме.
 *
 * Возврат Agent-вызова (`<usage>`) несёт только размер контекста на последнем шаге — не расход;
 * настоящий N, R и out даёт стенограмма захода. У части движков стенограмма субагента временна:
 * файл жив, пока жив вызов, и удалён после его завершения — суммы снимают сразу, потом их
 * взять нечем. Стенограммы нет — слова, не ноль (норма, не сбой: файл удалён по завершении).
 *
 * Разбор — через адаптеры движков (findSubagent/stepOf): имён полей хоста здесь нет.
 *   node .claude/scripts/subagent-spend.cjs <agent_id> [...] [--json]
 *
 * Печатает (или отдаёт --json): движок-владелец найденного файла, шаги (дедуп по requestId),
 * N = Σ in+write+read+out (контракт ECONOMY.md), R, out, длительность — окно между первым
 * и последним шагом стенограммы (не duration_ms хоста, у которого основание другое).
 * Чего факта нет — «не записано», никогда 0.
 */

const { readSubagentTranscript, NO_TRANSCRIPT } = require('../../.forma/dashboard/subagent-transcript.cjs');

const groups = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const NOT_RECORDED = 'не записано';

/** Окно вызова в секундах между первым и последним шагом стенограммы; времени нет — null. */
function spanSeconds(first, last) {
  if (!first || !last) return null;
  const a = Date.parse(first);
  const b = Date.parse(last);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 1000));
}

/** id вызова → канонические суммы, или null — стенограммы нет (это НЕ ноль). */
async function spendOf(agentId, root) {
  const t = await readSubagentTranscript(agentId, root, null);
  if (!t) return null;
  return {
    agent_id: String(agentId),
    engine: t.tag || null,
    file: t.file,
    steps: t.steps,
    tokens_n: t.input + t.cacheCreate + t.cacheRead + t.output, // N = Σ in+write+read+out
    cache_read: t.cacheRead,
    cache_create: t.cacheCreate,
    tokens_out: t.output,
    duration_s: spanSeconds(t.first, t.last),
    first: t.first || null,
    last: t.last || null,
  };
}

module.exports = { spendOf, spanSeconds };

// ---- CLI ----
if (require.main === module) {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const ids = argv.filter((a) => !a.startsWith('--'));
  if (!ids.length) {
    console.error('usage: node .claude/scripts/subagent-spend.cjs <agent_id> [...] [--json]');
    process.exit(2);
  }
  (async () => {
    for (const id of ids) {
      const s = await spendOf(id);
      if (!s) {
        console.log(`${id}  ${NO_TRANSCRIPT} — суммы снимают, пока вызов жив: после завершения файл у части движков удаляется.`);
        continue;
      }
      if (json) { console.log(JSON.stringify(s, null, 2)); continue; }
      const f = (x) => (x == null ? NOT_RECORDED : groups(x));
      console.log(
        `${id}  движок=${s.engine || '?'}  шагов=${s.steps}  ` +
        `N=${f(s.tokens_n)}  R=${f(s.cache_read)}  out=${f(s.tokens_out)}  T=${f(s.duration_s)} s (окно стенограммы)`
      );
      console.log(`  файл: ${s.file}`);
    }
  })();
}
