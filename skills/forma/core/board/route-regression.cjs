#!/usr/bin/env node
'use strict';

/**
 * The route regression (the law §2) - machine-made, without model calls.
 * A sandbox in a temp directory: a canned card passes the imitation of Spec→Kit→Run
 * (the stage lines, the status/assignee change by §7, the spend line by §3), and at every step the live
 * board checks (.forma/board/checks/) must be clean. Then the tamper probes: a broken
 * position marker, a missing field of the five, a broken spend line, "a closing without a result" -
 * each caught by a finding with an address (the file name) and a non-zero exit code.
 *
 * It is run by the check-board / sync-engines --check pass itself (the wrapper check
 * checks/route-regression.cjs) - after edits of AGENTS.md and the role files the housekeeping runs
 * exactly this pass; there is no separate command to remember.
 *
 *   node .forma/board/route-regression.cjs          - a run; code 0 clean, 1 caught/failed
 *   node .forma/board/route-regression.cjs --quiet  - one summary line
 * Module: runRegression() → { problems: [...] } - findings with addresses.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const i18n = require('../i18n/index.cjs');
const msg = (key, params) => i18n.message(key, params, 'ru');

const MARKERS = ['holding course', 'counting cost', 'assembling', 'preserving'];
const FIVE_KEYS = ['kind', 'delivers', 'criterion', 'budget', 'next'];
const D = () => new Date().toISOString().slice(0, 10);  // the sandbox date - in runtime, not a literal (prohibition 16)
const NNN = String(Date.now()).slice(-3);  // the sandbox card number - in runtime, not a literal (prohibition 16)

// Live board checks, working from the sandbox root without an engine journal.
const CHECK_IDS = ['route-labels', 'route-stage', 'status-values', 'key-language', 'spend-language', 'attempt-parses', 'attempt-format', 'agent-id', 'engine-tag'];
const checks = {};
for (const id of CHECK_IDS) checks[id] = require('./checks/' + id + '.cjs');

function cardName() { return 'card-' + '900-route-regression-sandbox.md'; }  // the sandbox code assembled: a clean zone, prohibition 16

function cannedCard() {
  return [
    '---',
    'id: "card-' + NNN + '-route-regression-sandbox",',
    'status: "backlog"',
    'priority: "medium"',
    'assignee: "Spec"',
    'epic: "0. Sandbox"',
    'labels: ["route-7"]',
    '---',
    '# card-' + NNN + ' · sandbox',
    '',
    '## Task',
    NNN + ' · tooling | Deliver a sandbox artifact | The sandbox file exists and is empty | 2 | Spec → Kit → Run → Intent',
    '',
    '## Kit',
    '',
    '## History',
    '- `Intent`, ' + D() + ': route route-7 (why: tooling).',
    '- `Intent`, ' + D() + ': stage card — the card created.',
    '',
    '## Result',
    ''
  ].join('\n');
}

function writeCard(dir, text) {
  const board = path.join(dir, '.devtool', 'features');
  fs.mkdirSync(board, { recursive: true });
  fs.writeFileSync(path.join(board, cardName()), text);
}

function setPair(text, status, assignee) {
  return text.replace(/^status:.*$/m, 'status: "' + status + '"').replace(/^assignee:.*$/m, 'assignee: "' + assignee + '"');
}

function addLine(text, line) { return text.replace(/\n\n## Result/, '\n' + line + '\n\n## Result'); }

/** The findings of the live checks over the sandbox card. */
function boardFindings(dir) {
  const out = [];
  for (const id of CHECK_IDS) {
    const found = checks[id].run({ root: dir, since: null });
    for (const p of found) out.push('[' + id + '] ' + p);
  }
  return out;
}

/** The position marker - the first line of any handoff (the law §4). */
function markerProblem(handoff) {
  const first = String(handoff).split('\n')[0].trim();
  return MARKERS.includes(first) ? [] : [msg('board.route-regression.bad_marker', { marker: first, markers: MARKERS.join('|') })];
}

/** The five fields of a card: kind | delivers | criterion | budget | next (the law §6). */
function fiveFieldProblems(text) {
  const m = text.match(/^## Task\n(\d+ · .+)$/m);
  if (!m) return [cardName() + ': ' + msg('board.route-regression.no_five_fields')];
  const parts = m[1].split('|').map(s => s.trim());
  if (parts.length !== 5) return [cardName() + ': ' + msg('board.route-regression.field_count', { n: parts.length })];
  return [];
}

/** The spend line - the §3 canon, read by the spend-line parser (attempt-parses checks exactly this). */
function spendLine(node, tokens) {
  return '- `' + node + '`, ' + D() + ': attempt, ' + tokens + ' tokens (0 cache-read), 12 out, 3 s, `agent_sandbox-0001` — sandbox: a step imitation';
}

/** "The confirmation theater": the card went to acceptance while Result is empty - a substituted result. */
function substitutionProblems(text) {
  const status = (text.match(/^status:\s*"?([\w-]+)/m) || [])[1];
  const result = (text.split(/## Result/)[1] || '').trim();
  if ((status === 'review' || status === 'done') && !result) {
    return [cardName() + ': ' + msg('board.route-regression.empty_result', { status })];
  }
  return [];
}

/** One run: the imitation + the probes. Returns the findings (an empty list - the regression is clean). */
function runRegression() {
  const problems = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-route-reg-'));
  try {
    // --- Phase 1: the honest run of Spec → Kit → Run ---------------------------------------
    let text = cannedCard();
    const steps = [
      { status: 'todo', assignee: 'Kit', line: '- `Kit`, ' + D() + ': stage kit — the kit issued.' },
      { status: 'in-progress', assignee: 'Run', line: '- `Kit`, ' + D() + ': stage exec — execution.' },
      { status: 'review', assignee: 'Intent', line: '- `Run`, ' + D() + ': stage check — the criterion reached.' }
    ];
    writeCard(dir, text);
    problems.push(...boardFindings(dir).map(p => msg('board.route-regression.phase1_start') + p));
    for (const st of steps) {
      text = setPair(text, st.status, st.assignee);
      text = addLine(text, st.line);
      if (st.assignee === 'Run') text = addLine(text, spendLine('Kit', 1000));
      if (st.status === 'review') text = addLine(text, spendLine('Run', 2000));
      writeCard(dir, text);
      const found = boardFindings(dir);
      for (const p of found) problems.push(msg('board.route-regression.phase1_status', { status: st.status }) + p);
    }
    // The position marker and the five fields - on the honest card they must pass.
    problems.push(...markerProblem('assembling\n' + cardName()).map(p => msg('board.route-regression.phase1') + p));
    problems.push(...fiveFieldProblems(text).map(p => msg('board.route-regression.phase1') + p));

    // --- Phase 2: the tamper probes - each must be caught -----------------------------------
    const probes = [
      {
        name: msg('board.route-regression.probe_marker'),
        run() { return markerProblem('do as you know\n' + cardName()); }
      },
      {
        name: msg('board.route-regression.probe_five_fields'),
        run() {
          const bad = cannedCard().replace(NNN + ' · tooling | Deliver a sandbox artifact | The sandbox file exists and is empty | 2 | Spec → Kit → Run → Intent',
            NNN + ' · tooling | Deliver a sandbox artifact | 2 | Spec → Kit → Run → Intent');
          return fiveFieldProblems(bad);
        }
      },
      {
        name: msg('board.route-regression.probe_spend_line'),
        run() {
          const bad = addLine(cannedCard(), '- `Kit`, ' + D() + ': attempt, many tokens — something like that');
          writeCard(dir, bad);
          return boardFindings(dir);
        }
      },
      {
        name: msg('board.route-regression.probe_substitution'),
        run() {
          const bad = setPair(cannedCard(), 'review', 'Intent');
          return substitutionProblems(bad);
        }
      }
    ];
    for (const probe of probes) {
      const caught = probe.run();
      if (!caught.length) problems.push(msg('board.route-regression.probe_not_caught', { name: probe.name }));
      else if (!caught.some(c => c.includes(cardName())) && !caught.some(c => c.includes('handoff'))) {
        problems.push(msg('board.route-regression.probe_no_address', { name: probe.name, list: caught.join('; ') }));
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { problems };
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const { problems } = runRegression();
  if (quiet) { console.log(problems.length ? msg('board.route-regression.quiet_red', { n: problems.length }) : msg('board.route-regression.quiet_green')); process.exit(problems.length ? 1 : 0); }
  if (problems.length) {
    for (const p of problems) console.error(p);
    console.error(msg('board.route-regression.red', { n: problems.length }));
    process.exit(1);
  }
  console.log(msg('board.route-regression.green'));
  process.exit(0);
}

if (require.main === module) main();
module.exports = { runRegression, MARKERS, markerProblem, fiveFieldProblems, substitutionProblems };
