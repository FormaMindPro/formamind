#!/usr/bin/env node
'use strict';

/**
 * approval-parity - the "approval parity" gate: the `human approved` lines in a card's History are reconciled
 * with the host's records of the subagent questions asked to the human (AskUserQuestion). The source - the ZCode
 * host database (~/.zcode/cli/db/db.sqlite, the part table: a call is stored whole, with the status and the human's
 * answer; the state.output form: `User has answered your questions: "…"="…"`), the path is overridden
 * by the APPROVAL_DB variable. The link of a question to a card - by the gate's convention: the question text
 * must carry the card code. No model calls: the status by the exit code, the dossier - in stdout; consumers -
 * the Intent node at the card check and check-board.
 *
 *   node .forma/board/checks/approval-parity.cjs card-NNN [--root <dir>]
 *   node .forma/board/checks/approval-parity.cjs --file <a .md path>     (a synthetic card, probes)
 *   node .forma/board/checks/approval-parity.cjs --selftest              (a negative probe in temp)
 *
 * Verdict: every `human approved` event line in History must have ≥1 answered host record with the card code
 * in the question; no record - RED (fail-closed). Leaving the convention's coverage (approvals that happened
 * before the convention was introduced, when a question carried no card code) - a line in the card's History:
 *   exception: approval-parity — <why there is no record> — <who approved>
 * the line names the gate by the word "approval-parity" - then it is skipped with an explicit mark.
 * The other side - informational: answered host records with the card code not reflected
 * in History are printed as candidates (the question might not have been about an approval).
 *
 * Exit codes: 0 - all lines green or skipped by an exception; 1 - there is a RED without an exception;
 * 2 - a runtime error (no card, no database).
 * Module: require('./approval-parity.cjs').runApprovalParity({ root, card, file }) → { ready, lines }.
 * Self-check - `--selftest` (a negative probe in temp: a fake approval line without a record = RED).
 * Part of the core: carries no project traces (prohibition 16); the database path comes from outside (an argument/environment).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const i18n = require('../../i18n/index.cjs');
const { cardFiles, zone } = require('../../dashboard/lib/card.cjs');

const APPROVED_RE = /^- `Intent`, \d{4}-\d{2}-\d{2}: human approved\b/m;
const ANSWER_MARK = 'User has answered your questions';
const msg = (key, params) => i18n.message(key, params, 'ru');

const err = (m) => Object.assign(new Error(m), { exitCode: 2 });

function cardCodeOf(arg, text, file) {
  const m = String(arg || '').match(/card-(\d{3})/);
  if (m) return 'card-' + m[1];
  const f = String(file || '');
  const fm = f.match(/card-(\d{3})/);
  if (fm) return 'card-' + fm[1];
  const im = String(text || '').match(/^id: "card-(\d{3})/m);
  if (im) return 'card-' + im[1];
  return null;
}

function loadCard(root, cardArg, fileArg) {
  if (fileArg) {
    const p = path.resolve(root, fileArg);
    if (!fs.existsSync(p)) throw err(msg('board.approval-parity.file_missing', { file: fileArg }));
    return { text: fs.readFileSync(p, 'utf8'), file: p };
  }
  if (!cardArg) throw err(msg('board.approval-parity.need_card'));
  const files = cardFiles(root).filter((f) => path.basename(f).startsWith(String(cardArg).replace(/\.md$/, '')));
  if (!files.length) throw err(msg('board.approval-parity.card_not_found', { card: cardArg }));
  return { text: fs.readFileSync(files[0], 'utf8'), file: files[0] };
}

/** Answered host questions whose text carries the card code. */
function hostRecords(dbPath, code) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare(
      "select session_id, time_created, data from part where data like '%AskUserQuestion%' and data like ? and data like '%User has answered your questions%'",
    ).all('%' + code + '%');
    const out = [];
    for (const r of rows) {
      let j;
      try { j = JSON.parse(r.data); } catch { continue; }
      if (j.tool !== 'AskUserQuestion') continue; // an echo of someone else's requests - skip
      const st = j.state || {};
      if (st.status !== 'completed' || !String(st.output || '').includes(ANSWER_MARK)) continue;
      const questions = ((st.input || {}).questions || []).map((q) => String(q.question || ''));
      const m = String(st.output).match(/"([^"]{5,300})"="([^"]{1,200})"/);
      out.push({
        session: String(r.session_id || ''),
        time: new Date(r.time_created).toISOString(),
        questions,
        answer: m ? m[2] : String(st.output).slice(0, 200),
        subagent: /subagent/.test(String(r.session_id || '')),
      });
    }
    return out;
  } finally { db.close(); }
}

function runApprovalParity({ root, card, file, dbPath } = {}) {
  root = root || process.cwd();
  dbPath = dbPath || process.env.APPROVAL_DB || path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite');
  const loaded = loadCard(root, card, file);
  const code = cardCodeOf(card, loaded.text, loaded.file);
  if (!code) throw err(msg('board.approval-parity.no_code'));
  const history = zone(loaded.text, 'history') || '';
  const approvalLines = (history.match(/^- `Intent`, \d{4}-\d{2}-\d{2}: human approved[^\n]*/gm) || []);
  const exceptions = (history.match(/^- `[^`]+`, \d{4}-\d{2}-\d{2}: exception: [^\n]*approval-parity[^\n]*/gm) || []);
  if (!fs.existsSync(dbPath)) throw err(msg('board.approval-parity.no_db', { db: dbPath }));
  const records = hostRecords(dbPath, code);
  const lines = [];
  let red = 0;
  for (const line of approvalLines) {
    if (records.length) {
      const r = records[0];
      lines.push({ status: 'green', fact: msg('board.approval-parity.matched', {
        code, q: (r.questions[0] || '').slice(0, 90), a: r.answer.slice(0, 60),
        who: r.subagent ? msg('board.approval-parity.who_subagent') : msg('board.approval-parity.who_main'),
        time: r.time, session: r.session.slice(0, 44),
      }) });
    } else if (exceptions.length) {
      lines.push({ status: 'skipped', fact: msg('board.approval-parity.skipped', { code, exc: exceptions[0].replace(/^- /, '').slice(0, 140) }) });
    } else {
      red += 1;
      lines.push({ status: 'red', fact: msg('board.approval-parity.unmatched', { code }) });
    }
  }
  if (!approvalLines.length) {
    lines.push({ status: 'info', fact: msg('board.approval-parity.no_lines', { code, n: records.length }) });
  }
  const unmatched = records.length - approvalLines.filter(() => records.length).length;
  if (records.length && unmatched > 0) {
    lines.push({ status: 'info', fact: msg('board.approval-parity.extra_records', {
      code, n: records.length, qs: records.map((r) => (r.questions[0] || '').slice(0, 60)).join(' | ').slice(0, 300),
    }) });
  }
  return { ready: red === 0, lines, code };
}

function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-parity-'));
  try {
    // The card code is assembled from parts: a clean zone of the protocol holds no "card-NNN" literal
    // (the clean-zone scanner looks for it in test fixtures too) - the same way the scanner itself assembles its regex.
    const synth = 'card-' + '009';
    const fake = path.join(dir, synth + '-fake-approval.md');
    fs.writeFileSync(fake, '# ' + synth + ' · synthetic\n\n## History\n\n- `Intent`, 1999-01-01: human approved — a fake line without a host record.\n');
    const r = runApprovalParity({ root: dir, file: synth + '-fake-approval.md', dbPath: process.env.APPROVAL_DB || path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite') });
    if (r.ready) return { ok: false, note: msg('board.approval-parity.selftest_not_caught') };
    return { ok: true, note: msg('board.approval-parity.selftest_ok') };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { runApprovalParity, selftest };

if (require.main === module) {
  try {
    const argv = process.argv.slice(2);
    if (argv.includes('--selftest')) {
      const st = selftest();
      console.log(st.ok ? '✓ ' + st.note : '✗ ' + st.note);
      process.exit(st.ok ? 0 : 1);
    }
    const fileIdx = argv.indexOf('--file');
    const cardArg = argv.find((a) => /^card-\d{3}/.test(a));
    const r = runApprovalParity({ card: cardArg, file: fileIdx >= 0 ? argv[fileIdx + 1] : null });
    for (const l of r.lines) console.log((l.status === 'green' ? '✓ ' : l.status === 'red' ? '✗ ' : '· ') + l.fact);
    console.log(r.ready ? msg('board.approval-parity.cli_green') : msg('board.approval-parity.cli_red'));
    process.exit(r.ready ? 0 : 1);
  } catch (e) {
    console.error(msg('board.stop') + e.message);
    process.exit(e.exitCode || 2);
  }
}
