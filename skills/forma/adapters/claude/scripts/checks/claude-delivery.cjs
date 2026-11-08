'use strict';

// The Claude adapter delivers the core interview into .claude/skills/ as a copy and calls the core board check from a hook.
// Finding labels come from the core dictionary: English key in code, ru value as data.

const fs = require('fs');
const path = require('path');
const { walk } = require('../../../.forma/dashboard/lib/fs.cjs');
const i18n = require('../../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const INTERVIEW_SKILLS = ['grilling', 'forma-grill-with-ui'];

const readLf = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

/** An interview `s`: the copy in .claude/skills/ exists and matches the core (line endings do not count). */
function skillProblems(root, s) {
  const src = path.join(root, '.forma/skills', s);
  const dst = path.join(root, '.claude', 'skills', s);
  if (!fs.existsSync(src)) return [];
  if (!fs.existsSync(dst)) return [msg('claude-delivery.not_delivered', { skill: s })];
  const a = walk(src).sort();
  const b = walk(dst).sort();
  const drift = a.join() !== b.join() || a.some((f) => readLf(path.join(src, f)) !== readLf(path.join(dst, f)));
  return drift ? [msg('claude-delivery.drift', { skill: s })] : [];
}

function run({ root }) {
  if (!fs.existsSync(path.join(root, '.claude', 'rules', 'claude-8.md'))) return [];
  const problems = INTERVIEW_SKILLS.flatMap((s) => skillProblems(root, s));
  const hook = path.join(root, '.claude', 'hooks', 'check-card.sh');
  if (fs.existsSync(hook) && !fs.readFileSync(hook, 'utf8').includes('node .forma/board/check-board.cjs')) {
    problems.push(msg('claude-delivery.no_board_check'));
  }
  return problems;
}

module.exports = { id: 'claude-delivery', since: null, run };
