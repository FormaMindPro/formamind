#!/usr/bin/env node
'use strict';

/**
 * setup-card - the constructive start gate's setup card (the law §3): a project that has not been configured
 * does not block the session; the gate itself opens one card of the protocol epic asking the human for the
 * start decisions. One open setup card at a time: an already open one is returned as is, a closed one does
 * not count and a new one may be opened. The marker of a setup card is its five-field Task line naming the
 * thresholds check (thresholds-declared.cjs) - the card is recognized by what it asks, not by a label.
 *
 *   node .forma/board/setup-card.cjs [--root <dir>]            read-only: prints `card-NNN open` (the open setup card) or nothing
 *   node .forma/board/setup-card.cjs --ensure [--root <dir>]   opens one when the board holds none; prints `card-NNN created|open`
 *   node .forma/board/setup-card.cjs --selftest                probes in a temp directory
 *
 * Exit codes: 0 always, except a failed --selftest (1: a broken core must be named, not muted) - the gate
 * never blocks a session on an unconfigured project.
 * Module: require('./setup-card.cjs') → { ensureSetupCard } ; ensureSetupCard(root) → { code, created }:
 * `code` is the card's code (`card-NNN`, null when no card could be opened - no PROJECT.md to read the
 * lanes from, or the creation failed; the caller keeps speaking to the human either way).
 * The card is created by new-card.cjs (--root): kind protocol, goal goal-protocol, type tooling, budget 3,
 * next human, route 0 (why ready, stage card); the title and the deliverable come from the i18n keys
 * board.setup_card.title and board.setup_card.delivers (the project's language), the criterion names the
 * thresholds check. Part of the core: carries no project traces (prohibition 16; probe card codes are
 * assembled at runtime - no card-NNN-like literals in the body, no dates).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const i18n = require('../i18n/index.cjs');

const msg = (key, params) => i18n.message(key, params, 'ru');

// The marker of a setup card: an open status and the five-field Task line (kind · fields) naming the
// thresholds check. Duplicated in i18n/demo.cjs (boardEmpty must not count the gate's own card as the
// human's work); a marker change - edit both files.
const OPEN_RE = /^status:\s*"?(backlog|todo|in-progress|review)"?/m;
const SETUP_LINE_RE = /^\d+ · (?:work|tooling|decision) \|.*thresholds-declared\.cjs/m;
const CRITERION = 'check: node .forma/board/checks/thresholds-declared.cjs --project';

/** Is this text a setup card opened by the gate (open status, the Task line names the thresholds check)? */
const isSetupCard = (text) => OPEN_RE.test(text) && SETUP_LINE_RE.test(text);

/** The board's open setup card: { code, file } or null. Closed cards and foreign cards do not count. */
function findOpen(root) {
  const dir = path.join(root, '.devtool', 'features');
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; /* no board yet */ }
  for (const e of names) {
    if (!e.isFile() || !/^card-\d+.*\.md$/.test(e.name)) continue;
    const file = path.join(dir, e.name);
    if (isSetupCard(fs.readFileSync(file, 'utf8'))) return { code: 'card-' + e.name.match(/^card-(\d+)/)[1], file };
  }
  return null;
}

/**
 * The board's setup card: the open one, or a new one opened by new-card.cjs in `root`'s board. Never throws:
 * a project the card cannot be opened in (no PROJECT.md, no epic table, a failed board check) reads as
 * { code: null, created: false } - the gate keeps speaking, it does not block.
 * Under the environment marker FORMA_SUPPRESS_SETUP_CARD=1 the gate stays read-only: no card is opened,
 * { code: null, created: false } - the installer's verify runs the same gate, and a card belongs to a real
 * session start, where the human is present.
 */
function ensureSetupCard(root) {
  if (process.env.FORMA_SUPPRESS_SETUP_CARD === '1') return { code: null, created: false };
  const open = findOpen(root);
  if (open) return { code: open.code, created: false };
  if (!i18n.projectMdPath(root)) return { code: null, created: false }; // no PROJECT.md: no lanes to name the epic
  const lang = i18n.projectLang(root);
  const r = spawnSync(process.execPath, [
    path.join(__dirname, 'new-card.cjs'),
    '--root', root,
    '--kind', 'protocol', '--goal', 'goal-protocol', '--type', 'tooling',
    '--title', i18n.message('board.setup_card.title', {}, lang),
    '--delivers', i18n.message('board.setup_card.delivers', {}, lang),
    '--criterion', CRITERION, '--budget', '3', '--next', 'human',
    '--route', '0', '--why', 'ready', '--stage', 'card',
    '--no-dup-check', '--no-graph', // a system card of the gate: no graph rebuild from a session hook
  ], { encoding: 'utf8' });
  if (r.status !== 0) return { code: null, created: false };
  const created = /card-(\d+)-[a-z0-9-]*\.md/.exec(String(r.stdout)); // new-card's first stdout line: the file's path
  return created ? { code: 'card-' + created[1], created: true } : { code: null, created: false };
}

// ---- --selftest: probes in a temp directory -------------------------------------------------------

function selftest() {
  const base = process.env.FORMA_TEST_TMP && fs.existsSync(process.env.FORMA_TEST_TMP) ? process.env.FORMA_TEST_TMP : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(base, 'setup-card-'));
  process.env.FORMA_LANG = ''; // the probes read the language from the fixture document, not the environment
  const results = [];
  const check = (name, cond) => results.push({ ok: !!cond, name });
  try {
    const { startGate } = require('../i18n/project-checks.cjs');
    const EPICS = ['analytics', 'structure', 'protocol', 'resources', 'balance', 'discussion', 'channels', 'competencies', 'results']
      .map((c) => '| `' + c + '` | goal kind ' + c + ' | purpose |').join('\n');
    // The fixture: the epic table (new-card reads the lanes from it) and empty thresholds - the gate is red.
    const projectMd = (lang) => '# configuration\n\n'
      + (lang === 'ru' ? '**\u042f\u0437\u044b\u043a \u043f\u0440\u043e\u0435\u043a\u0442\u0430** <!-- k:language -->: \u0440\u0443\u0441\u0441\u043a\u0438\u0439\n\n' : '')
      + '**Project epics** <!-- k:epics -->:\n\n' + EPICS + '\n\n'
      + '**Thresholds** <!-- k:thresholds -->:\n\n| Threshold | Value |\n|---|---|\n| Attempts <!-- k:attempts --> |  |\n| Cycle volume <!-- k:volume --> |  |\n';
    const root = (sub, lang) => {
      const p = path.join(dir, sub);
      fs.mkdirSync(path.join(p, 'project', 'config'), { recursive: true });
      fs.writeFileSync(path.join(p, 'project', 'config', 'PROJECT.md'), projectMd(lang));
      return p;
    };
    const board = (p) => { try { return fs.readdirSync(path.join(p, '.devtool', 'features')).filter((n) => /^card-/.test(n)); } catch { return []; } };
    const cardText = (p) => fs.readFileSync(path.join(p, '.devtool', 'features', board(p)[0]), 'utf8');

    // a: a red gate and an empty board - the card is created, in the project's language (en)
    const a = root('a', 'en');
    check('a: the fixture is red (no thresholds declared)', startGate(a).length > 0);
    const ca = ensureSetupCard(a);
    check('a: created on a red gate and an empty board', ca.created === true && /^card-\d+$/.test(ca.code || ''));
    const textA = ca.code ? cardText(a) : '';
    check('a: the title and the deliverable come from the i18n keys (en)', textA.includes(i18n.message('board.setup_card.title', {}, 'en')) && textA.includes(i18n.message('board.setup_card.delivers', {}, 'en')));
    check('a: the criterion names the thresholds check', textA.includes(CRITERION));

    // b: the second call finds the same open card - no duplicate
    const cb = ensureSetupCard(a);
    check('b: the second call finds the same card, created:false, no duplicate on the board', !cb.created && cb.code === ca.code && board(a).length === 1);

    // c: a closed (moved to done/) setup card - a new one is opened
    const doneDir = path.join(a, '.devtool', 'features', 'done');
    fs.mkdirSync(doneDir, { recursive: true });
    fs.renameSync(path.join(a, '.devtool', 'features', board(a)[0]), path.join(doneDir, board(a)[0]));
    const cc = ensureSetupCard(a);
    check('c: a done setup card - a new one is created on the live board', cc.created === true && cc.code !== ca.code && board(a).length === 1);

    // d: the title in the project's language (ru)
    const d = root('d', 'ru');
    const cd = ensureSetupCard(d);
    const textD = cd.code ? cardText(d) : '';
    check('d: the title comes from the i18n key (ru)', cd.created === true && textD.includes(i18n.message('board.setup_card.title', {}, 'ru')));

    // e: the gate CLI speaks the same text, wraps it for a config hook and never blocks (exit 0)
    const cli = path.join(__dirname, '..', 'i18n', 'cli.cjs');
    const plain = spawnSync(process.execPath, [cli, 'gate', '--root', a], { encoding: 'utf8' });
    check('e: cli gate exits 0, names the open setup card and asks for the decision', plain.status === 0 && plain.stdout.includes(cc.code) && plain.stdout.includes(i18n.message('gate.setup_card.request', {}, 'en')));
    const json = spawnSync(process.execPath, [cli, 'gate', '--json', '--root', a], { encoding: 'utf8' });
    let parsed = null;
    try { parsed = JSON.parse(json.stdout); } catch { /* not the strict schema */ }
    check('e: cli gate --json - the strict SessionStart schema carrying the same text', json.status === 0
      && parsed && parsed.hookSpecificOutput && parsed.hookSpecificOutput.hookEventName === 'SessionStart'
      && typeof parsed.hookSpecificOutput.additionalContext === 'string' && parsed.hookSpecificOutput.additionalContext.includes(cc.code));

    // f: the suppression marker (the installer's verify) - red gate, empty board, no card created, the gate still speaks
    const f = root('f', 'en');
    check('f: the marker fixture is red and its board is empty', startGate(f).length > 0 && board(f).length === 0);
    process.env.FORMA_SUPPRESS_SETUP_CARD = '1';
    try {
      const cf = ensureSetupCard(f);
      check('f: FORMA_SUPPRESS_SETUP_CARD=1 - no card created, created:false, the board stays empty', !cf.created && cf.code === null && board(f).length === 0);
      const spoken = spawnSync(process.execPath, [cli, 'gate', '--root', f], { encoding: 'utf8', env: { ...process.env } });
      check('f: the gate still speaks under the marker (exit 0, the stop text and the decision request, no card code named)', spoken.status === 0
        && spoken.stdout.includes('START STOP') && spoken.stdout.includes(i18n.message('gate.setup_card.request', {}, 'en'))
        && !/card-\d+/.test(spoken.stdout));
    } finally { delete process.env.FORMA_SUPPRESS_SETUP_CARD; }

    const failed = results.filter((r) => !r.ok);
    return {
      ok: failed.length === 0,
      note: failed.length ? msg('board.selftest.mismatch') + failed.map((r) => r.name).join('; ') : msg('board.setup_card.selftest_ok'),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- CLI ------------------------------------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--root');
  const root = path.resolve(at >= 0 ? argv.splice(at, 2)[1] : (process.env.CLAUDE_PROJECT_DIR || process.cwd()));
  if (argv.includes('--selftest')) {
    const st = selftest();
    console.log((st.ok ? '✓ ' : '✗ ') + st.note);
    process.exit(st.ok ? 0 : 1);
  }
  const card = argv.includes('--ensure') ? ensureSetupCard(root) : (findOpen(root) || { code: null, created: false });
  if (card.code) console.log(card.code + ' ' + (card.created ? 'created' : 'open'));
  process.exit(0); // the gate never blocks: not on a missing board, not on a failed creation
}

module.exports = { ensureSetupCard, findOpen, isSetupCard };
