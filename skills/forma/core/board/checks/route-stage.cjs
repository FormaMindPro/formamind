'use strict';

// Reason and stage of the route (AGENTS.md §6). From the rule's day of entry: a "route route-N (why: <code>)" line is required,
// the code and the stage key come from closed lists, the last "stage <key>" line does not contradict the status.
// No stage line - no violation (stage from the status).

const fs = require('fs');
const path = require('path');
const i18n = require('../../i18n/index.cjs');
const { cardFiles, createdDay } = require('../../dashboard/lib/card.cjs');

const WHY_CODES = ['human', 'ready', 'scale', 'risk', 'decision', 'tooling', 'plumb'];
const STAGE_KEYS = ['card', 'approve', 'kit', 'exec', 'check', 'accept', 'close'];
const STAGE_BY_STATUS = { backlog: ['card', 'approve'], todo: ['kit'], 'in-progress': ['kit', 'exec'], review: ['check', 'accept'], done: ['accept', 'close'] };

function cardProblems(f, text) {
  const problems = [];
  const lines = text.split('\n').filter((l) => /^-\s*`\w+`,\s*\d{4}-\d{2}-\d{2}:/.test(l));
  const whys = lines.map((l) => l.match(/:\s*route route-\d[^(—]*\(why:\s*([^)]*)\)/)).filter(Boolean);
  if (!whys.length) problems.push(i18n.message('board.route-stage.no_reason', { f }, 'ru'));
  for (const m of whys) {
    if (!WHY_CODES.includes(m[1].trim())) problems.push(i18n.message('board.route-stage.bad_why', { f, why: m[1].trim(), codes: WHY_CODES.join('|') }, 'ru'));
  }
  const stages = lines.map((l) => l.match(/:\s*stage\s+(\S+?)(?=\s|—|\.|$)/)).filter(Boolean).map((m) => m[1]);
  for (const s of stages) if (!STAGE_KEYS.includes(s)) problems.push(i18n.message('board.route-stage.bad_stage', { f, stage: s, keys: STAGE_KEYS.join('|') }, 'ru'));
  const status = (text.match(/^status:\s*"?([\w-]+)/m) || [])[1];
  const last = stages[stages.length - 1];
  if (last && STAGE_KEYS.includes(last) && STAGE_BY_STATUS[status] && !STAGE_BY_STATUS[status].includes(last)) {
    problems.push(i18n.message('board.route-stage.stage_status', { f, stage: last, status, expected: STAGE_BY_STATUS[status].join('|') }, 'ru'));
  }
  return problems;
}

function run({ root, since }) {
  const problems = [];
  for (const file of cardFiles(root, /^card-\d+.*\.md$/)) {
    const text = fs.readFileSync(file, 'utf8');
    if (createdDay(text) >= since) problems.push(...cardProblems(path.basename(file), text));
  }
  return problems;
}

module.exports = { id: 'route-stage', since: 'route-stage', run };
