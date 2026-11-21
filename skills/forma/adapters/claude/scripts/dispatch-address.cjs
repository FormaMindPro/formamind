#!/usr/bin/env node
'use strict';

/**
 * dispatch-address.cjs - one path from a card to a run on the card's model.
 *
 * Prints the CreateWorkflow spec of a node's dispatch: the model address resolved from the card's
 * `Model` kit unit (or from the node default declared in PROJECT.md), validated against a saved
 * `ListModels` snapshot, and the script carrying the node's prompt from dispatch-prompt.cjs.
 * The script prints; the session launches - the host's workflow tool is a session tool, not one a
 * subagent holds, and the human's confirmation is the session's.
 *
 * Sources of the address, in order:
 *   1. the card's `## Kit`, the `Model` unit: the first address-shaped token inside backticks,
 *      or a bare model id that is the whole unit value;
 *   2. PROJECT.md (`<root>/project/config/PROJECT.md`), the section marked `<!-- k:tooling -->`,
 *      the node's row: the first address-shaped token of the second column, or a bare model id
 *      that is that whole column;
 *   3. neither - refusal, exit 2, `(none)` and both sources named.
 * The two places are read as the project writes them: a value in a prose unit is backticked, a
 * table cell is a value. A path in a unit that is not backticked is prose, not an address.
 *
 * A bare model id resolves only within the session's provider: the snapshot marks the session's
 * row with `[current]`. No snapshot, no `[current]` row, an address absent from the snapshot -
 * refusal, never a guess: stderr names the address (or `(none)`) and its source, stdout stays empty.
 *
 * The snapshot is the saved answer of the host's `ListModels`: one model per line,
 * `providerId/modelId`, an optional `$level`, an optional `[current]` marker on the session's row;
 * blank lines and `#` comments are ignored. A JSON answer - an array, or an object with a `models`
 * array, of `{providerId, modelId}` objects or address strings - is accepted too. The comparison is
 * case-insensitive; the printed address keeps the spelling of its source.
 *
 * Usage:
 *   node .claude/scripts/dispatch-address.cjs --node <Intent|Spec|Kit|Run|Core> --card <path>
 *        --snapshot <path> --marker <marker> [--note "free text"] [--with-task] [--probe]
 *        [--root <dir>]
 *   node .claude/scripts/dispatch-address.cjs --self-test
 *
 * `--marker` has no default (dispatch-prompt.cjs refuses a build without it). `--probe` prints the
 * same spec whose task is "return the marker, do nothing" - the session's channel check.
 *
 * Exit: 0 - the spec is printed (JSON: name, subagent_model, script); 1 - arguments; 2 - a
 * fail-closed refusal (address and source on stderr, nothing on stdout).
 * Fixtures of the self-test go to the project's resolved temp base; the repository is not touched.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { build, MARKERS, NODES } = require('./dispatch-prompt.cjs');

const LEVELS = ['low', 'high', 'max'];
// providerId/modelId with an optional $level. The provider may carry the account prefix (`account:x`).
const ADDRESS_RE = /([A-Za-z0-9][A-Za-z0-9._:-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)(?:\$(low|high|max))?/g;
// A whole value that is one model id, optionally with a level - never a phrase.
const BARE_RE = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\$(low|high|max))?$/;

const PROJECT_FILE = path.join('project', 'config', 'PROJECT.md');

/** The first address-shaped token in a text; a `$word` that is not a level makes the token malformed. */
function firstAddress(text) {
  const s = String(text || '');
  ADDRESS_RE.lastIndex = 0;
  let m;
  while ((m = ADDRESS_RE.exec(s)) !== null) {
    const end = m.index + m[0].length;
    const tail = /^\$([A-Za-z]+)/.exec(s.slice(end));
    if (tail && !LEVELS.includes(tail[1])) {
      return { malformed: m[0] + '$' + tail[1], level: null };
    }
    return { address: m[0], provider: m[1], model: m[2], level: m[3] || null, end };
  }
  return null;
}

/** The `Model` unit of the card's `## Kit` zone: its value, or null when the zone or the unit is absent. */
function modelUnit(md) {
  const rows = String(md || '').split(/\r?\n/);
  const kit = rows.findIndex((r) => /^##\s+Kit\s*$/.test(r));
  if (kit < 0) return null;
  let end = rows.findIndex((r, i) => i > kit && /^##\s/.test(r));
  if (end < 0) end = rows.length;
  for (let i = kit + 1; i < end; i++) {
    const m = /^[\s-]*Model\s*:\s*(.*)$/i.exec(rows[i]);
    if (m) return m[1].trim();
  }
  return null;
}

/** The `$level` of a whole value, or null; a word after `$` that is not a level makes the value malformed. */
function levelOf(whole) {
  const m = /\$([A-Za-z]+)$/.exec(whole);
  if (!m) return { level: null };
  return LEVELS.includes(m[1]) ? { level: m[1] } : { malformed: whole };
}

/** A whole value that is one model id - bare or in backticks - with an optional level. */
function wholeAddress(value) {
  const whole = String(value || '').replace(/`/g, '').trim();
  if (!whole) return null;
  const lv = levelOf(whole);
  if (lv.malformed) return { malformed: whole };
  const bare = BARE_RE.exec(whole);
  if (bare) return { address: whole, provider: null, model: bare[1], level: lv.level };
  return null;
}

/** The address inside the backticked spans of a card's unit, or a bare model id that is the whole unit. */
function unitAddress(unit) {
  if (unit == null) return null;
  for (const span of unit.match(/`[^`]*`/g) || []) {
    const a = firstAddress(span);
    if (a) return a;
  }
  return wholeAddress(unit);
}

/** The address of a table cell: the first address-shaped token, or a bare model id that is the whole cell. */
function cellAddress(cell) {
  if (cell == null) return null;
  const a = firstAddress(cell);
  if (a) return a;
  return wholeAddress(cell);
}

/** The node's row value in the `<!-- k:tooling -->` section of PROJECT.md: the second column, or null. */
function projectDefault(md, node) {
  const rows = String(md || '').split(/\r?\n/);
  const at = rows.findIndex((r) => r.includes('<!--') && /k:\s*tooling\b/.test(r));
  if (at < 0) return null;
  // The section ends at the next keyed heading (`**...** <!-- k:... -->`) or a markdown heading.
  let end = rows.findIndex((r, i) => i > at && (/^#{1,6}\s/.test(r) || (/^\*\*/.test(r) && /<!--/.test(r))));
  if (end < 0) end = rows.length;
  for (let i = at + 1; i < end; i++) {
    const row = rows[i].trim();
    if (!row.startsWith('|')) continue;
    const cells = row.split('|').map((c) => c.trim());
    const name = (cells[1] || '').replace(/[`*]/g, '').trim();
    if (name !== node) continue;
    return (cells[2] || '').replace(/`/g, '').trim();
  }
  return null;
}

/** The snapshot -> `[{ provider, model, current }]`, or null when the file is absent or unreadable. */
function readSnapshot(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data;
    try { data = JSON.parse(trimmed); } catch { return []; }
    const list = Array.isArray(data) ? data
      : (data && Array.isArray(data.models) ? data.models
        : (data && Array.isArray(data.modelList) ? data.modelList : []));
    const rows = [];
    for (const item of list) {
      if (typeof item === 'string') {
        const a = firstAddress(item);
        if (a && a.address) rows.push({ provider: a.provider, model: a.model, current: /\[current\]/i.test(item) });
        continue;
      }
      if (item && typeof item === 'object') {
        const provider = item.providerId || item.provider || null;
        const model = item.modelId || item.model || null;
        if (provider && model) rows.push({ provider: String(provider), model: String(model), current: item.current === true || /\[current\]/i.test(String(item.marker || '')) });
        else {
          const a = firstAddress(String(item.id || item.address || ''));
          if (a && a.address) rows.push({ provider: a.provider, model: a.model, current: item.current === true });
        }
      }
    }
    return rows;
  }
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const a = firstAddress(line);
    if (!a || !a.address) continue;
    rows.push({ provider: a.provider, model: a.model, current: /\[current\]/i.test(line) });
  }
  return rows;
}

/** The address resolved from a card and PROJECT.md, with its source; a refusal carries the reason. */
function resolveAddress({ cardAbs, root, node }) {
  let cardText;
  try { cardText = fs.readFileSync(cardAbs, 'utf8'); }
  catch { return { refused: { reason: 'the card is unreadable', address: '(none)', source: 'card ' + cardAbs } }; }

  const unit = modelUnit(cardText);
  const fromCard = unitAddress(unit);
  if (fromCard && fromCard.malformed) {
    return { refused: { reason: 'the reasoning level is unknown (low|high|max)', address: fromCard.malformed, source: 'card ' + cardAbs } };
  }
  if (fromCard) return { address: fromCard, source: 'card ' + cardAbs };

  const projectFile = path.join(root, PROJECT_FILE);
  let projectText = null;
  try { projectText = fs.readFileSync(projectFile, 'utf8'); } catch { /* no PROJECT.md - no default */ }
  const cell = projectText == null ? null : projectDefault(projectText, node);
  const fromProject = cellAddress(cell);
  if (fromProject && fromProject.malformed) {
    return { refused: { reason: 'the reasoning level is unknown (low|high|max)', address: fromProject.malformed, source: 'PROJECT.md ' + projectFile + ' (' + node + ')' } };
  }
  if (fromProject) return { address: fromProject, source: 'PROJECT.md ' + projectFile + ' (' + node + ')' };

  return { refused: {
    reason: 'no address in the card\'s Model unit and no default declared for this node in PROJECT.md',
    address: '(none)',
    source: 'none (card ' + cardAbs + '; PROJECT.md ' + projectFile + ')',
  } };
}

/** The address validated against the snapshot: the printed address and the snapshot's row, or a refusal. */
function validateAddress({ resolved, snapshotFile }) {
  if (!snapshotFile) {
    return { refused: { reason: 'no --snapshot: the address cannot be validated', address: resolved.address.address, source: resolved.source } };
  }
  const abs = path.resolve(snapshotFile);
  const rows = readSnapshot(abs);
  if (rows == null) {
    return { refused: { reason: 'the ListModels snapshot is absent or unreadable', address: resolved.address.address, source: resolved.source + '; snapshot ' + abs } };
  }
  if (!rows.length) {
    return { refused: { reason: 'the ListModels snapshot holds no model address', address: resolved.address.address, source: resolved.source + '; snapshot ' + abs } };
  }

  const given = resolved.address;
  let provider = given.provider;
  let bareNote = '';
  if (!provider) {
    const current = rows.find((r) => r.current);
    if (!current) {
      return { refused: { reason: 'a bare model id resolves only within the session\'s provider, and the snapshot marks no [current] row', address: given.address, source: resolved.source + '; snapshot ' + abs } };
    }
    provider = current.provider;
    bareNote = ' (bare model id, resolved within the session provider ' + provider + ')';
  }
  const hit = rows.find((r) => String(r.provider).toLowerCase() === String(provider).toLowerCase()
    && String(r.model).toLowerCase() === String(given.model).toLowerCase());
  if (!hit) {
    return { refused: { reason: 'the address is absent from the ListModels snapshot', address: given.address, source: resolved.source + '; snapshot ' + abs } };
  }
  const printed = given.provider ? given.address : provider + '/' + given.model + (given.level ? '$' + given.level : '');
  return { address: printed, level: given.level, row: hit, source: resolved.source + bareNote };
}

/** The CreateWorkflow spec: a short run name, the pinned model, and the script carrying the node's prompt. */
function spec({ node, card, prompt, address }) {
  const base = path.basename(String(card)).replace(/\.md$/i, '');
  const code = (/^[A-Za-z]+-\d+/.exec(base) || [base])[0];
  const script = [
    'const TASK = ' + JSON.stringify(prompt) + ';',
    'const answer = await agent(' + JSON.stringify(node) + ').ask(TASK);',
    'report(answer);',
  ].join('\n');
  return { name: 'dispatch ' + node + ' ' + code, subagent_model: address, script };
}

/** The whole path: arguments -> the printed spec, or a named refusal. */
function run(argv) {
  const a = { node: null, card: null, snapshot: null, marker: null, note: null, withTask: false, probe: false, root: process.cwd() };
  const problems = [];
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--node') a.node = argv[++i];
    else if (v === '--card') a.card = argv[++i];
    else if (v === '--snapshot') a.snapshot = argv[++i];
    else if (v === '--marker') a.marker = argv[++i];
    else if (v === '--note') a.note = argv[++i];
    else if (v === '--with-task') a.withTask = true;
    else if (v === '--probe') a.probe = true;
    else if (v === '--root') a.root = path.resolve(argv[++i]);
    else problems.push('unknown argument: ' + v);
  }
  if (!NODES.includes(a.node)) problems.push('node "' + a.node + '" is not one of ' + NODES.join('|'));
  if (!a.card) problems.push('--card is required');
  if (!MARKERS.includes(a.marker)) problems.push('marker "' + a.marker + '" is not one of ' + MARKERS.join('|'));
  if (problems.length) return { problems };

  const cardAbs = path.resolve(a.card);
  const resolved = resolveAddress({ cardAbs, root: a.root, node: a.node });
  if (resolved.refused) return { refused: resolved.refused };
  const checked = validateAddress({ resolved, snapshotFile: a.snapshot });
  if (checked.refused) return { refused: checked.refused };

  let prompt;
  if (a.probe) {
    prompt = 'Return exactly the marker "' + a.marker + '" and do nothing else.';
  } else {
    const built = build({ node: a.node, card: a.card, marker: a.marker, note: a.note, withTask: a.withTask, root: a.root });
    if (built.problems) return { problems: built.problems };
    if (built.refused) return { refused: { reason: 'the dispatch note was refused by the scrub: ' + built.refused.join('; '), address: checked.address, source: resolved.source } };
    prompt = built.prompt;
  }
  return { spec: spec({ node: a.node, card: a.card, prompt, address: checked.address }), address: checked.address, source: checked.source };
}

// ---- self-test: fixtures in the resolved temp base, the same command the session runs ----

function tempBase() {
  const base = process.env.FORMA_TEST_TMP && fs.existsSync(process.env.FORMA_TEST_TMP) ? process.env.FORMA_TEST_TMP : os.tmpdir();
  return fs.mkdtempSync(path.join(base, 'dispatch-address-'));
}

function selfTest() {
  const { spawnSync } = require('child_process');
  let failed = 0;
  let passed = 0;
  const ok = (name, cond, detail) => {
    if (cond) passed += 1; else failed += 1;
    console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (cond || !detail ? '' : ' -- ' + detail));
  };
  const dir = tempBase();
  const card = path.join(dir, 'fixture-card.md');
  const snap = path.join(dir, 'listmodels.txt');
  const project = path.join(dir, 'project', 'config', 'PROJECT.md');
  const cli = (...args) => spawnSync(process.execPath, [__filename, ...args], { encoding: 'utf8' });

  const CARD = [
    '---', 'id: "fixture-card"', '---', '# fixture card', '',
    '## Task', 'A fixture: the Model unit carries the address.', '',
    '## Kit', '',
    'Role: fixture.',
    'Model: `account:zai-start-plan/GLM-5.3-Flash$high` - the address of the fixture card.',
    '',
  ].join('\n');
  const EMPTY = [
    '---', 'id: "fixture-empty"', '---', '# fixture card with an empty Model unit', '',
    '## Task', 'A fixture: the Model unit carries no address.', '',
    '## Kit', '',
    'Role: fixture.', 'Model: kind text; tier standard; no address here.', '',
  ].join('\n');
  const BARE = [
    '---', 'id: "fixture-bare"', '---', '# fixture card with a bare model id', '',
    '## Task', 'A fixture: the Model unit carries a bare model id.', '',
    '## Kit', '', 'Model: `deepseek-v4.1-flash`', '',
  ].join('\n');
  const SNAPSHOT = [
    '# ListModels snapshot (fixture form)',
    'opencode-go-chat/deepseek-v4.1-flash [current]',
    'account:zai-individual-coding-plan/GLM-5.3',
    'account:zai-individual-coding-plan/GLM-5.3-Flash',
    'account:zai-start-plan/GLM-5.3-Flash',
    'account:zai-offpeak-idle-plan/GLM-5.3-Flash',
    'account:zai-highspeed-card/GLM-5.3-Flash',
    '',
  ].join('\n');
  const PROJECT_HEAD = ['# Fixture project', '', '**Node gear** <!-- k:tooling -->:', '', '| Node | Works with | In the arsenal |', '|---|---|---|'];
  const PROJECT = [...PROJECT_HEAD, '| `Intent` | | before the close |', '| `Run` | `account:zai-start-plan/GLM-5.3-Flash$high` | |', ''].join('\n');
  const PROJECT_BARE = [...PROJECT_HEAD, '| `Run` | `deepseek-v4.1-flash` | |', ''].join('\n');
  const PROJECT_NONE = [...PROJECT_HEAD, '| `Run` | | |', ''].join('\n');

  const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  try {
    write(card, CARD);
    write(path.join(dir, 'empty.md'), EMPTY);
    write(path.join(dir, 'bare.md'), BARE);
    write(snap, SNAPSHOT);
    write(path.join(dir, 'snapshot.json'), JSON.stringify({ models: [{ providerId: 'account:zai-start-plan', modelId: 'GLM-5.3-Flash' }] }));
    write(path.join(dir, 'absent.txt'), 'account:zai-start-plan/GLM-5.3\naccount:zai-individual-coding-plan/GLM-5.3\n');
    write(project, PROJECT);

    const base = ['--node', 'Run', '--marker', 'assembling', '--root', dir];
    const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

    // 1. The card path: the unit's address, validated, the spec printed.
    let r = cli(...base, '--card', card, '--snapshot', snap);
    let out = null;
    try { out = JSON.parse(r.stdout); } catch { out = null; }
    ok('card path: exit 0 and a JSON spec', r.status === 0 && out !== null, r.stderr || r.stdout);
    ok('card path: subagent_model is the unit\'s address', out && out.subagent_model === 'account:zai-start-plan/GLM-5.3-Flash$high', out && out.subagent_model);
    const taskOf = (s) => { const m = /^const TASK = (.*);$/m.exec(String(s || '')); try { return m ? JSON.parse(m[1]) : null; } catch { return null; } };
    const task = out && taskOf(out.script);
    ok('card path: the script carries the node prompt from dispatch-prompt.cjs',
      task === build({ node: 'Run', card, marker: 'assembling', root: dir }).prompt && task.includes('Card address: ' + card), task);
    ok('card path: the name names the node', out && /^dispatch Run ./i.test(out.name), out && out.name);

    // 2. The PROJECT.md default path: an empty unit falls back to the node's declared row.
    r = cli(...base, '--card', path.join(dir, 'empty.md'), '--snapshot', snap);
    ok('PROJECT.md default path: exit 0 and the declared address', r.status === 0 && JSON.parse(r.stdout).subagent_model === 'account:zai-start-plan/GLM-5.3-Flash$high', r.stderr);
    ok('PROJECT.md default path: no address token outside the node row', r.status === 0 && !JSON.parse(r.stdout).subagent_model.includes('Intent'), r.stdout);

    // 3. An unknown address: absent from the snapshot -> refusal, code 2, nothing on stdout.
    r = cli(...base, '--card', card, '--snapshot', path.join(dir, 'absent.txt'));
    ok('unknown address: exit 2, no spec on stdout', r.status === 2 && r.stdout === '', 'status ' + r.status + ' stdout ' + r.stdout);
    ok('unknown address: stderr names the address and its source', r.stderr.includes('account:zai-start-plan/GLM-5.3-Flash$high') && r.stderr.includes('card '), r.stderr);

    // 4. No address at all: an empty unit and no declared default.
    write(project, PROJECT_NONE);
    r = cli(...base, '--card', path.join(dir, 'empty.md'), '--snapshot', snap);
    ok('absent address: exit 2, no spec on stdout', r.status === 2 && r.stdout === '', 'status ' + r.status);
    ok('absent address: stderr names (none) and both sources', r.stderr.includes('(none)') && r.stderr.includes('PROJECT.md'), r.stderr);

    // 5. No snapshot: the address cannot be validated.
    write(project, PROJECT);
    r = cli(...base, '--card', card, '--snapshot', path.join(dir, 'missing.txt'));
    ok('absent snapshot: exit 2, no spec on stdout', r.status === 2 && r.stdout === '', 'status ' + r.status);
    ok('absent snapshot: stderr names the snapshot', r.stderr.includes('missing.txt'), r.stderr);

    // 6. A bare model id: the provider comes from the snapshot's [current] row, never from a guess.
    write(project, PROJECT_BARE);
    r = cli(...base, '--card', path.join(dir, 'empty.md'), '--snapshot', snap);
    ok('bare name: resolved within the session provider', r.status === 0 && parse(r.stdout) && parse(r.stdout).subagent_model === 'opencode-go-chat/deepseek-v4.1-flash', r.stderr || (r.stdout && r.stdout.slice(0, 200)));
    write(path.join(dir, 'noc.txt'), 'account:zai-start-plan/GLM-5.3-Flash\n');
    r = cli(...base, '--card', path.join(dir, 'empty.md'), '--snapshot', path.join(dir, 'noc.txt'));
    ok('bare name without [current]: refused, exit 2', r.status === 2 && r.stdout === '' && /current/.test(r.stderr), 'status ' + r.status + ' ' + r.stderr);
    r = cli(...base, '--card', path.join(dir, 'bare.md'), '--snapshot', snap);
    ok('bare name in the card unit: resolved the same way', r.status === 0 && parse(r.stdout) && parse(r.stdout).subagent_model === 'opencode-go-chat/deepseek-v4.1-flash', r.stderr);

    // 7. --probe: the same spec whose task is the marker only.
    const real = cli(...base, '--card', card, '--snapshot', snap);
    const probe = cli(...base, '--card', card, '--snapshot', snap, '--probe');
    const realSpec = parse(real.stdout), probeSpec = parse(probe.stdout);
    ok('--probe: same name and model, the marker-only task', probe.status === 0 && realSpec && probeSpec
      && probeSpec.name === realSpec.name && probeSpec.subagent_model === realSpec.subagent_model
      && probeSpec.script.includes('Return exactly the marker') && probeSpec.script.includes('assembling')
      && !probeSpec.script.includes('Card address:'), probe.stderr || probe.stdout);

    // 8. The marker has no default; unknown arguments are named.
    r = cli('--node', 'Run', '--card', card, '--snapshot', snap, '--root', dir);
    ok('missing --marker: exit 1 with a named problem', r.status === 1 && /marker/.test(r.stderr), r.stderr);
    r = cli(...base, '--card', card, '--snapshot', snap, '--bogus');
    ok('unknown argument: exit 1 with the argument named', r.status === 1 && r.stderr.includes('--bogus'), r.stderr);

    // 9. The JSON snapshot form is read too.
    r = cli(...base, '--card', card, '--snapshot', path.join(dir, 'snapshot.json'));
    ok('JSON snapshot: the address is found', r.status === 0 && JSON.parse(r.stdout).subagent_model === 'account:zai-start-plan/GLM-5.3-Flash$high', r.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (failed) console.log('\nfailed: ' + failed);
  console.log('passed: ' + passed);
  process.exit(failed ? 1 : 0);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();
  const r = run(argv);
  if (r.problems) { for (const p of r.problems) console.error(p); process.exit(1); }
  if (r.refused) {
    console.error('refused: ' + r.refused.reason + ' - address ' + JSON.stringify(r.refused.address) + ', source: ' + r.refused.source);
    process.exit(2);
  }
  console.log(JSON.stringify(r.spec, null, 2));
}

if (require.main === module) main();
module.exports = { firstAddress, modelUnit, unitAddress, cellAddress, projectDefault, readSnapshot, resolveAddress, validateAddress, spec, run };
