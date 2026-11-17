#!/usr/bin/env node
'use strict';
// Entry for shell hooks: `node .forma/i18n/cli.cjs <command> [--root <dir>]`
//   ready                 notes about unchecked places (empty output when everything is in place)
//   gate [--json]         start stop (AGENTS.md §3); empty when the cycle may open. Constructive: with the
//                         stop text it names the setup card (opened by the gate itself, setup-card.cjs),
//                         proposes the standard parameters and asks the human for a decision - never blocks.
//                         --json wraps the same text into the strict schema of a config hook
//                         ({hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:"…"}}).
//   backlog|--line alias  the local backlog's summary line (board/backlog.cjs, scanBacklog): un-carded
//   backlog-line [--json] observations in the project's language; an empty scan - silence. --json wraps the
//                         same line into the strict SessionStart schema (the ZCode config hook's shape).
//   demo [value]          the demo-cycle marker: print it, or set none|declined|done|later:<n>
//   demo-tick             one session start passed: `later:<n>` counts down
//   lang                  language code of the project documents (FORMA_LANG overrides)
//   msg <code> [k=v ...]  message in the project language, English as the fallback
//   hook-output <event> <user-code> <agent-code>   hook JSON: the details come from stdin, shown to the human and given to the agent
// The language of the text is the project's; the logic never depends on it.

const fs = require('node:fs');
const path = require('node:path');
const i18n = require('./index.cjs');
const checks = require('./project-checks.cjs');
const demo = require('./demo.cjs');

const argv = process.argv.slice(2);
const at = argv.indexOf('--root');
const root = path.resolve(at >= 0 ? argv.splice(at, 2)[1] : (process.env.CLAUDE_PROJECT_DIR || process.cwd()));
const [cmd, ...rest] = argv;

/** The stop text plus the constructive tail (the setup card, the standard parameters, the decision request);
 *  `''` when the cycle may open. Nothing inside may fail the session: every step is guarded, the exit stays 0. */
function gateOutput(root) {
  let text = '';
  try { text = checks.gateText(root); } catch { /* an unreadable project reads as a green gate */ }
  if (!text) return '';
  let card = null;
  try { card = require('../board/setup-card.cjs').ensureSetupCard(root); } catch { /* an older install without the module */ }
  const lang = i18n.projectLang(root);
  const lines = [];
  if (card && card.code) lines.push(i18n.message(card.created ? 'gate.setup_card.created' : 'gate.setup_card.open', { code: card.code }, lang));
  lines.push(i18n.message('gate.setup_card.proposal', {}, lang), i18n.message('gate.setup_card.request', {}, lang));
  return text + lines.join('\n') + '\n';
}

if (cmd === 'ready') process.stdout.write(checks.readyText(root));
else if (cmd === 'gate') {
  const text = gateOutput(root);
  process.stdout.write(rest.includes('--json') && text
    ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } })
    : text);
}
else if (cmd === 'backlog' || cmd === 'backlog-line') {
  let text = '';
  try { text = require('../board/backlog.cjs').lineFor(root, i18n.projectLang(root)); } catch { /* an older install without the scanner */ }
  process.stdout.write(rest.includes('--json') && text
    ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } })
    : text);
}
else if (cmd === 'demo') {
  try {
    if (rest[0] !== undefined) demo.writeDemo(root, rest[0]);
  } catch (e) { process.stderr.write(e.message + '\n'); process.exit(2); }
  const d = demo.readDemo(root);
  process.stdout.write((d.state === 'later' ? `later:${d.n}` : d.state) + '\n');
} else if (cmd === 'demo-tick') demo.tickDemo(root);
else if (cmd === 'lang') process.stdout.write(i18n.projectLang(root) + '\n');
else if (cmd === 'msg' && rest[0]) {
  const params = Object.fromEntries(rest.slice(1).map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
  process.stdout.write(i18n.message(rest[0], params, i18n.projectLang(root)) + '\n');
} else if (cmd === 'hook-output' && rest.length === 3) {
  const lang = i18n.projectLang(root);
  const details = fs.readFileSync(0, 'utf8').replace(/\s+$/, '');
  process.stdout.write(JSON.stringify({
    systemMessage: i18n.message(rest[1], {}, lang) + '\n' + details,
    hookSpecificOutput: { hookEventName: rest[0], additionalContext: i18n.message(rest[2], {}, lang) + '\n' + details },
  }));
} else {
  process.stderr.write('usage: cli.cjs ready|gate|backlog|backlog-line|demo [value]|demo-tick|lang|msg <code> [k=v ...]|hook-output <event> <user-code> <agent-code> [--root <dir>]\n');
  process.exit(2);
}
