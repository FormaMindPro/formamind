#!/usr/bin/env node
'use strict';

/**
 * dispatch-address.cjs - one path from a card to a run on the card's model.
 *
 * Prints the CreateWorkflow spec of a node's dispatch: the model address resolved from the card's
 * `Model` kit unit (or from the node default in PROJECT.md's `Node defaults` table, in the column of
 * the engine named by `--engine`), validated against a saved `ListModels` snapshot, and the script
 * carrying the node's prompt from dispatch-prompt.cjs.
 * The script prints; the session launches - the host's workflow tool is a session tool, not one a
 * subagent holds, and the human's confirmation is the session's.
 *
 * Sources of the address, in order:
 *   1. the card's `## Kit`, the `Model` unit: the first address-shaped token inside backticks,
 *      or a bare model id that is the whole unit value;
 *   2. PROJECT.md (`<root>/project/config/PROJECT.md`), the section marked
 *      `<!-- k:routes.node_defaults -->`: the node's row, the cell under the column whose header
 *      is the engine named by `--engine` - the cell's first whole model value (a
 *      `providerId/modelId` or a bare id, backticked or the whole cell), and the cell's
 *      `effort X`, which sets `$low|$high|$max`; the rest of the cell is prose and is read as
 *      nothing;
 *   3. neither - refusal, exit 2, `(none)` and both sources named.
 * The two places are read as the project writes them: a value in a prose unit is backticked, a
 * table cell is a value. A path in a unit that is not backticked is prose, not an address.
 *
 * A default is never guessed: no `--engine`, an engine with no column in that table, no row for
 * the node, an empty cell - each is a refusal whose reason names the missing piece, never a
 * column borrowed from a neighbour, another engine's cell or a neighbour row's prose.
 *
 * A bare model id is engine-relative: it resolves only against the snapshot of the engine that will
 * execute the model, the engine named by `--engine`. The snapshot's owner is read from the model
 * registry (`<root>/project/config/models.json`, the `engines` rows), never guessed: the engine whose
 * `adapter_output` is that one file owns it; an engine that names the file beside other outputs (a
 * `;`-separated list) consumes it without owning it; several single owners - a refusal naming them.
 * `--engine` must be the owner: a mismatch is a fail-closed refusal (exit 2) naming the bare id, the
 * engine named by `--engine`, the snapshot's owner and the expected value. A bare id with no
 * `--engine` is refused entirely - without the engine the snapshot cannot be known to belong to it.
 * A registry that is absent or unreadable is a refusal naming its file. A full address never reads
 * the registry: the path is unchanged.
 *
 * Inside the owner's snapshot the bare id resolves within the session's provider: the snapshot marks
 * the session's row with `[current]`. No snapshot, no `[current]` row, an address absent from the
 * snapshot - refusal, never a guess: stderr names the address (or `(none)`) and its source, stdout
 * stays empty.
 *
 * The snapshot is re-saved by a session when the session's model or provider changes; `[current]`
 * marks the session's row as it stood at the moment of saving. A saved file may therefore hold a
 * session row of another engine than the one reading it - which is why the owner is read from the
 * registry and not assumed from the model.
 *
 * The snapshot is the saved answer of the host's `ListModels`: one model per line,
 * `providerId/modelId`, an optional `$level`, an optional `[current]` marker on the session's row;
 * blank lines and `#` comments are ignored. A JSON answer - an array, or an object with a `models`
 * array, of `{providerId, modelId}` objects or address strings - is accepted too. The comparison is
 * case-insensitive; the printed address keeps the spelling of its source.
 *
 * Usage:
 *   node .claude/scripts/dispatch-address.cjs --node <Intent|Spec|Kit|Run|Core> --card <path>
 *        --snapshot <path> --marker <marker> [--engine <id>] [--note "free text"] [--with-task]
 *        [--probe] [--root <dir>]
 *   node .claude/scripts/dispatch-address.cjs --self-test
 *
 * `--marker` has no default (dispatch-prompt.cjs refuses a build without it). `--engine` names the
 * engine column of the node defaults and the engine that executes a bare model id - the snapshot must
 * belong to it; an empty `Model` unit without it is a refusal, not a guess, and a bare model id
 * without it is refused entirely. `--probe` prints the same spec whose task is "return the marker,
 * do nothing" - the session's channel check.
 *
 * Exit: 0 - the spec is printed (JSON: name, subagent_model, script); 1 - arguments; 2 - a
 * fail-closed refusal (address and source on stderr, nothing on stdout).
 * Fixtures of the self-test go to the project's resolved temp base; the repository is not touched.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { build, MARKERS, NODES } = require('./dispatch-prompt.cjs');

// The level a printed address may carry - the host's own effort scale.
const LEVELS = ['low', 'high', 'max'];
// providerId/modelId with an optional $level. The provider may carry the account prefix (`account:x`).
const ADDRESS_RE = /([A-Za-z0-9][A-Za-z0-9._:-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)(?:\$(low|high|max))?/g;
// A whole value that is one model id, optionally with a level - never a phrase.
const BARE_RE = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\$(low|high|max))?$/;
// A whole value that is one full address, optionally with a level - never a phrase or a path in prose.
const FULL_RE = /^([A-Za-z0-9][A-Za-z0-9._:-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)(?:\$(low|high|max))?$/;

const PROJECT_FILE = path.join('project', 'config', 'PROJECT.md');
const REGISTRY_FILE = path.join('project', 'config', 'models.json');

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

/** A whole value that is exactly one model value - a full address or a bare id - with an optional level. */
function exactAddress(value) {
  const whole = String(value || '').replace(/`/g, '').trim();
  if (!whole) return null;
  const lv = levelOf(whole);
  if (lv.malformed) return { malformed: whole };
  const full = FULL_RE.exec(whole);
  if (full) return { address: whole, provider: full[1], model: full[2], level: lv.level };
  const bare = BARE_RE.exec(whole);
  if (bare) return { address: whole, provider: null, model: bare[1], level: lv.level };
  return null;
}

/** The model value of a node-defaults cell: its first backticked whole value, or the whole cell; the
 *  cell's `effort X` sets the level. Prose around the value is read as nothing, never as an address. */
function defaultCellAddress(cell) {
  if (cell == null) return null;
  const text = String(cell);
  let found = null;
  for (const span of text.match(/`[^`]*`/g) || []) {
    const a = exactAddress(span);
    if (a) { found = a; break; }
  }
  if (!found) found = exactAddress(text);
  if (!found || found.malformed) return found;
  const effort = /\beffort\s+([A-Za-z]+)/i.exec(text);
  if (effort) {
    const word = effort[1].toLowerCase();
    if (!LEVELS.includes(word)) return { malformed: found.address + ' (effort ' + effort[1] + ')' };
    if (!found.level) found.level = word;
  }
  return found;
}

/** The node's cell under the column headed by the engine in the `k:routes.node_defaults` table of
 *  PROJECT.md; `missing` names the piece when the table, the column or the row is absent. */
function nodeDefaultCell(md, node, engine) {
  const rows = String(md || '').split(/\r?\n/);
  const at = rows.findIndex((r) => r.includes('<!--') && /k:\s*routes\.node_defaults\b/.test(r));
  if (at < 0) return { missing: 'the `k:routes.node_defaults` table' };
  // The section ends at the next keyed heading (`**...** <!-- k:... -->`) or a markdown heading.
  let end = rows.findIndex((r, i) => i > at && (/^#{1,6}\s/.test(r) || (/^\*\*/.test(r) && /<!--/.test(r))));
  if (end < 0) end = rows.length;
  let column = -1;
  let headerSeen = false;
  for (let i = at + 1; i < end; i++) {
    const row = rows[i].trim();
    if (!row.startsWith('|')) continue;
    const cells = row.split('|').map((c) => c.trim());
    if (!headerSeen) {
      headerSeen = true;
      const heads = cells.map((c) => c.replace(/[`*]/g, '').trim());
      column = heads.findIndex((c) => c.toLowerCase() === engine.toLowerCase());
      if (column < 1) return { missing: 'a column headed by the engine "' + engine + '"' };
      continue;
    }
    const name = (cells[1] || '').replace(/[`*]/g, '').trim();
    if (name !== node) continue;
    return { cell: cells[column] || '' };
  }
  return { missing: 'a row for the node "' + node + '"' };
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
function resolveAddress({ cardAbs, root, node, engine }) {
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
  const table = 'PROJECT.md "Node defaults" (k:routes.node_defaults) ' + projectFile;
  if (!engine) {
    return { refused: {
      reason: 'no --engine: a node default is read from the engine\'s own column of the `k:routes.node_defaults` table, and the card\'s Model unit carries no address',
      address: '(none)',
      source: 'card ' + cardAbs + '; ' + table,
    } };
  }

  let projectText = null;
  try { projectText = fs.readFileSync(projectFile, 'utf8'); } catch { /* no PROJECT.md - no default */ }
  if (projectText == null) {
    return { refused: { reason: 'PROJECT.md is absent or unreadable', address: '(none)', source: 'card ' + cardAbs + '; PROJECT.md ' + projectFile } };
  }
  const found = nodeDefaultCell(projectText, node, engine);
  if (found.missing) {
    return { refused: {
      reason: 'no node default: ' + found.missing + ' in the `k:routes.node_defaults` table',
      address: '(none)',
      source: 'card ' + cardAbs + '; ' + table + ' (' + node + ', ' + engine + ')',
    } };
  }
  const fromProject = defaultCellAddress(found.cell);
  if (fromProject && fromProject.malformed) {
    return { refused: { reason: 'the reasoning level is unknown (low|high|max)', address: fromProject.malformed, source: table + ' (' + node + ', ' + engine + ')' } };
  }
  if (fromProject) return { address: fromProject, source: table + ' (' + node + ', ' + engine + ')' };

  return { refused: {
    reason: 'the node default cell carries no model value',
    address: '(none)',
    source: table + ' (' + node + ', ' + engine + '): ' + JSON.stringify(found.cell),
  } };
}

/** A path of a registry `adapter_output` entry, normalized for comparison; null for prose and dashes. */
function outputPath(value, root) {
  const s = String(value == null ? '' : value).replace(/`/g, '').trim();
  if (!s || s === '-' || s === '\u2014') return null;
  const abs = path.isAbsolute(s) ? path.resolve(s) : path.resolve(root, s);
  return abs.replace(/\\/g, '/').toLowerCase();
}

/** The engine of the model registry that owns the snapshot: `{ owner }`, `{ owners }` for several,
 *  `{ owner: null }` for none, `{ refused: { file } }` when the registry is absent or unreadable. */
function snapshotOwner({ snapshotFile, root }) {
  const registryFile = path.join(root, REGISTRY_FILE);
  let text;
  try { text = fs.readFileSync(registryFile, 'utf8'); } catch { return { refused: { file: registryFile } }; }
  let data;
  try { data = JSON.parse(text); } catch { return { refused: { file: registryFile } }; }
  const engines = data && Array.isArray(data.engines) ? data.engines : [];
  if (!engines.length) return { refused: { file: registryFile } };
  const target = String(snapshotFile).replace(/\\/g, '/').toLowerCase();
  const exact = [];
  const listed = [];
  for (const e of engines) {
    if (!e || typeof e.id !== 'string') continue;
    const raw = typeof e.adapter_output === 'string' ? e.adapter_output : '';
    const paths = raw.split(';').map((t) => outputPath(t, root)).filter(Boolean);
    if (!paths.length) continue;
    if (paths.length === 1 && paths[0] === target) exact.push(e.id);
    else if (paths.includes(target)) listed.push(e.id);
  }
  // A single-file output is the engine's own snapshot; a list names the file as a consumed input.
  if (exact.length === 1) return { owner: exact[0], registryFile };
  if (exact.length > 1) return { owners: exact, registryFile };
  if (listed.length === 1) return { owner: listed[0], registryFile };
  if (listed.length > 1) return { owners: listed, registryFile };
  return { owner: null, registryFile };
}

/** The address validated against the snapshot: the printed address and the snapshot's row, or a refusal. */
function validateAddress({ resolved, snapshotFile, engine, root }) {
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
    if (!engine) {
      return { refused: {
        reason: 'the bare model id "' + given.address + '" needs --engine: a bare id is engine-relative, and the snapshot '
          + abs + ' must belong to the engine that will execute the model; expected: --engine <the snapshot owner> or a full providerId/modelId address',
        address: given.address,
        source: resolved.source + '; snapshot ' + abs,
      } };
    }
    const own = snapshotOwner({ snapshotFile: abs, root: root || process.cwd() });
    if (own.refused) {
      return { refused: {
        reason: 'the model registry ' + own.refused.file + ' is absent or unreadable, so the owner of the snapshot ' + abs
          + ' cannot be read for the bare model id "' + given.address + '"; expected: a readable registry with the engines rows',
        address: given.address,
        source: resolved.source + '; snapshot ' + abs + '; registry ' + own.refused.file,
      } };
    }
    if (own.owners) {
      return { refused: {
        reason: 'the snapshot ' + abs + ' is owned by several engines in the model registry (' + own.owners.join(', ')
          + '), so --engine ' + engine + ' cannot be checked for the bare model id "' + given.address + '"; expected: one owner in adapter_output',
        address: given.address,
        source: resolved.source + '; snapshot ' + abs + '; registry ' + own.registryFile,
      } };
    }
    if (!own.owner) {
      return { refused: {
        reason: 'the snapshot ' + abs + ' belongs to no engine in the model registry ' + own.registryFile
          + ', so the bare model id "' + given.address + '" cannot be checked against --engine ' + engine + '; expected: adapter_output of the engine naming the snapshot',
        address: given.address,
        source: resolved.source + '; snapshot ' + abs,
      } };
    }
    if (own.owner !== engine) {
      return { refused: {
        reason: 'the snapshot belongs to engine ' + own.owner + ', but --engine names ' + engine
          + ': the bare model id "' + given.address + '" is engine-relative; expected: --engine ' + own.owner
          + ' (the engine that owns the snapshot) or a full providerId/modelId address',
        address: given.address,
        source: resolved.source + '; snapshot ' + abs + '; registry ' + own.registryFile,
      } };
    }
    const current = rows.find((r) => r.current);
    if (!current) {
      return { refused: { reason: 'a bare model id resolves only within the session\'s provider, and the snapshot marks no [current] row', address: given.address, source: resolved.source + '; snapshot ' + abs } };
    }
    provider = current.provider;
    bareNote = ' (bare model id, resolved within the session provider ' + provider + ', snapshot of engine ' + own.owner + ')';
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
  const a = { node: null, card: null, snapshot: null, marker: null, engine: null, note: null, withTask: false, probe: false, root: process.cwd() };
  const problems = [];
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--node') a.node = argv[++i];
    else if (v === '--card') a.card = argv[++i];
    else if (v === '--snapshot') a.snapshot = argv[++i];
    else if (v === '--marker') a.marker = argv[++i];
    else if (v === '--engine') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) problems.push('--engine requires an engine id');
      else a.engine = value;
    }
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
  const resolved = resolveAddress({ cardAbs, root: a.root, node: a.node, engine: a.engine });
  if (resolved.refused) return { refused: resolved.refused };
  const checked = validateAddress({ resolved, snapshotFile: a.snapshot, engine: a.engine, root: a.root });
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
  const emptyCard = path.join(dir, 'empty.md');
  const bareCard = path.join(dir, 'bare.md');
  const snap = path.join(dir, 'listmodels.txt');
  const snapZ = path.join(dir, 'listmodels-zcode.txt');
  const project = path.join(dir, 'project', 'config', 'PROJECT.md');
  const registry = path.join(dir, 'project', 'config', 'models.json');
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
  // The same models, seen from a Z.AI session: a bare id in the zcode column resolves here.
  const SNAPSHOT_ZCODE = [
    '# ListModels snapshot (fixture form)',
    'account:zai-start-plan/GLM-5.3-Flash [current]',
    'account:zai-individual-coding-plan/GLM-5.3-Flash',
    'opencode-go-chat/deepseek-v4.1-flash',
    '',
  ].join('\n');
  // The node defaults table: two engine columns, an `effort X` per cell, prose around the values.
  const DEFAULTS_HEAD = [
    '# Fixture project', '',
    '**Node defaults** <!-- k:routes.node_defaults --> *(...)*:', '',
    '| Node | zcode | opencode | others |',
    '|---|---|---|---|',
  ];
  const DEFAULTS = [...DEFAULTS_HEAD,
    '| `Intent` | `GLM-5.3-Flash`, effort high | `deepseek-v4.1-flash`; level unconfirmed | unconfirmed by the registry |',
    '| `Run` | `GLM-5.3-Flash`, effort low | `deepseek-v4.1-flash` - the primary (the spare `qwen3.8-flash`); the level high is a human order | `account:zai-offpeak-idle-plan/GLM-5.3` |',
    ''].join('\n');
  const DEFAULTS_NONE = [...DEFAULTS_HEAD,
    '| `Run` | | | |',
    ''].join('\n');
  // A cell whose prose mentions a file path: prose, not an address.
  const DEFAULTS_PROSE = [...DEFAULTS_HEAD,
    '| `Run` | the visual check on-demand/intent-visual-check.md before showing | | |',
    ''].join('\n');
  const DEFAULTS_EFFORT = [...DEFAULTS_HEAD,
    '| `Run` | `GLM-5.3-Flash`, effort medium | | |',
    ''].join('\n');
  // The model registry: an engine owns the snapshot its `adapter_output` is; a list names a consumed file.
  const REGISTRY = JSON.stringify({
    engines: [
      { id: 'zcode', status: 'active', adapter_output: 'listmodels-zcode.txt' },
      { id: 'opencode', status: 'active', adapter_output: 'listmodels.txt; noc.txt' },
      { id: 'openrouter', status: 'active', adapter_output: '\u2014' },
    ],
  }, null, 2);

  const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  try {
    write(card, CARD);
    write(emptyCard, EMPTY);
    write(bareCard, BARE);
    write(snap, SNAPSHOT);
    write(snapZ, SNAPSHOT_ZCODE);
    write(path.join(dir, 'snapshot.json'), JSON.stringify({ models: [{ providerId: 'account:zai-start-plan', modelId: 'GLM-5.3-Flash' }] }));
    write(path.join(dir, 'absent.txt'), 'account:zai-start-plan/GLM-5.3\naccount:zai-individual-coding-plan/GLM-5.3\n');
    write(project, DEFAULTS);
    write(registry, REGISTRY);

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

    // 2. The node-default path: an empty unit takes the node's cell under the engine's column.
    r = cli(...base, '--engine', 'zcode', '--card', emptyCard, '--snapshot', snapZ);
    ok('node defaults: the Run row, the zcode column, effort low -> $low',
      r.status === 0 && parse(r.stdout) && parse(r.stdout).subagent_model === 'account:zai-start-plan/GLM-5.3-Flash$low', r.stderr || (r.stdout && r.stdout.slice(0, 200)));
    r = cli(...base, '--engine', 'opencode', '--card', emptyCard, '--snapshot', snap);
    ok('node defaults: the opencode column is read from its own cell, its prose is not a level',
      r.status === 0 && parse(r.stdout) && parse(r.stdout).subagent_model === 'opencode-go-chat/deepseek-v4.1-flash', r.stderr || (r.stdout && r.stdout.slice(0, 200)));
    r = cli('--node', 'Intent', '--marker', 'assembling', '--root', dir, '--engine', 'zcode', '--card', emptyCard, '--snapshot', snapZ);
    ok('node defaults: the node asked for is the row read (Intent, effort high -> $high)',
      r.status === 0 && parse(r.stdout) && parse(r.stdout).subagent_model === 'account:zai-start-plan/GLM-5.3-Flash$high', r.stderr || (r.stdout && r.stdout.slice(0, 200)));

    // 3. An unknown address: absent from the snapshot -> refusal, code 2, nothing on stdout.
    r = cli(...base, '--card', card, '--snapshot', path.join(dir, 'absent.txt'));
    ok('unknown address: exit 2, no spec on stdout', r.status === 2 && r.stdout === '', 'status ' + r.status + ' stdout ' + r.stdout);
    ok('unknown address: stderr names the address and its source', r.stderr.includes('account:zai-start-plan/GLM-5.3-Flash$high') && r.stderr.includes('card '), r.stderr);

    // 4. A default is never guessed: no --engine, no column, no value, prose, an unknown effort.
    r = cli(...base, '--card', emptyCard, '--snapshot', snapZ);
    ok('no --engine: refused, the missing engine named', r.status === 2 && r.stdout === '' && r.stderr.includes('--engine'), 'status ' + r.status + ' ' + r.stderr);
    r = cli(...base, '--engine', 'gemini', '--card', emptyCard, '--snapshot', snapZ);
    ok('engine without a column: refused, no neighbour column borrowed', r.status === 2 && r.stdout === '' && /gemini/.test(r.stderr), r.stderr);
    write(project, DEFAULTS_NONE);
    r = cli(...base, '--engine', 'zcode', '--card', emptyCard, '--snapshot', snapZ);
    ok('absent address: exit 2, (none) and PROJECT.md named', r.status === 2 && r.stdout === '' && r.stderr.includes('(none)') && r.stderr.includes('PROJECT.md'), r.stderr);
    write(project, DEFAULTS_PROSE);
    r = cli(...base, '--engine', 'zcode', '--card', emptyCard, '--snapshot', snapZ);
    ok('prose in the cell: a path inside a sentence is not an address', r.status === 2 && /carries no model value/.test(r.stderr), r.stderr);
    write(project, DEFAULTS_EFFORT);
    r = cli(...base, '--engine', 'zcode', '--card', emptyCard, '--snapshot', snapZ);
    ok('unknown effort: refused, the level named', r.status === 2 && /reasoning level/.test(r.stderr) && /medium/.test(r.stderr), r.stderr);

    // 5. No snapshot: the address cannot be validated.
    write(project, DEFAULTS);
    r = cli(...base, '--card', card, '--snapshot', path.join(dir, 'missing.txt'));
    ok('absent snapshot: exit 2, no spec on stdout', r.status === 2 && r.stdout === '', 'status ' + r.status);
    ok('absent snapshot: stderr names the snapshot', r.stderr.includes('missing.txt'), r.stderr);

    // 6. A bare model id: it resolves only against the snapshot of the engine that owns it.
    r = cli(...base, '--engine', 'opencode', '--card', emptyCard, '--snapshot', snap);
    ok('bare name: resolved within the session provider of the snapshot owner', r.status === 0 && parse(r.stdout) && parse(r.stdout).subagent_model === 'opencode-go-chat/deepseek-v4.1-flash', r.stderr || (r.stdout && r.stdout.slice(0, 200)));
    write(path.join(dir, 'noc.txt'), 'account:zai-start-plan/GLM-5.3-Flash\n');
    r = cli(...base, '--engine', 'opencode', '--card', emptyCard, '--snapshot', path.join(dir, 'noc.txt'));
    ok('bare name without [current]: refused, exit 2', r.status === 2 && r.stdout === '' && /current/.test(r.stderr), 'status ' + r.status + ' ' + r.stderr);
    r = cli(...base, '--card', bareCard, '--snapshot', snap);
    ok('bare name without --engine: refused, the missing engine named', r.status === 2 && r.stdout === '' && /--engine/.test(r.stderr) && /deepseek-v4.1-flash/.test(r.stderr), 'status ' + r.status + ' ' + r.stderr);
    r = cli(...base, '--engine', 'opencode', '--card', bareCard, '--snapshot', snap);
    ok('bare name in the card unit: resolved against the owner\'s snapshot', r.status === 0 && parse(r.stdout) && parse(r.stdout).subagent_model === 'opencode-go-chat/deepseek-v4.1-flash', r.stderr);
    r = cli(...base, '--engine', 'zcode', '--card', bareCard, '--snapshot', snap);
    ok('bare name with the wrong engine: refused, the snapshot owner named', r.status === 2 && r.stdout === '' && /the snapshot belongs to engine opencode/.test(r.stderr), 'status ' + r.status + ' ' + r.stderr);

    // 7. The registry that names the snapshot owner is required for a bare id; a full address ignores it.
    fs.renameSync(registry, registry + '.away');
    r = cli(...base, '--engine', 'opencode', '--card', bareCard, '--snapshot', snap);
    ok('absent registry: refused, the file named', r.status === 2 && r.stdout === '' && r.stderr.includes('models.json'), 'status ' + r.status + ' ' + r.stderr);
    r = cli(...base, '--card', card, '--snapshot', snap);
    ok('full address: unchanged without a registry', r.status === 0 && parse(r.stdout) && parse(r.stdout).subagent_model === 'account:zai-start-plan/GLM-5.3-Flash$high', r.stderr);
    write(registry, '{ not json');
    r = cli(...base, '--engine', 'opencode', '--card', bareCard, '--snapshot', snap);
    ok('broken registry: refused, the file named', r.status === 2 && r.stdout === '' && r.stderr.includes('models.json'), 'status ' + r.status + ' ' + r.stderr);
    write(registry, REGISTRY);

    // 8. --probe: the same spec whose task is the marker only.
    const real = cli(...base, '--card', card, '--snapshot', snap);
    const probe = cli(...base, '--card', card, '--snapshot', snap, '--probe');
    const realSpec = parse(real.stdout), probeSpec = parse(probe.stdout);
    ok('--probe: same name and model, the marker-only task', probe.status === 0 && realSpec && probeSpec
      && probeSpec.name === realSpec.name && probeSpec.subagent_model === realSpec.subagent_model
      && probeSpec.script.includes('Return exactly the marker') && probeSpec.script.includes('assembling')
      && !probeSpec.script.includes('Card address:'), probe.stderr || probe.stdout);

    // 9. The marker has no default; unknown arguments are named.
    r = cli('--node', 'Run', '--card', card, '--snapshot', snap, '--root', dir);
    ok('missing --marker: exit 1 with a named problem', r.status === 1 && /marker/.test(r.stderr), r.stderr);
    r = cli(...base, '--card', card, '--snapshot', snap, '--bogus');
    ok('unknown argument: exit 1 with the argument named', r.status === 1 && r.stderr.includes('--bogus'), r.stderr);

    // 10. The JSON snapshot form is read too.
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
module.exports = { firstAddress, modelUnit, unitAddress, wholeAddress, exactAddress, defaultCellAddress, nodeDefaultCell, readSnapshot, snapshotOwner, resolveAddress, validateAddress, spec, run };
