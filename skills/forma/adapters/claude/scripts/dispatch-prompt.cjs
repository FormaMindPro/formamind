#!/usr/bin/env node
'use strict';

// Dispatch prompt templates for the protocol's five nodes (AGENTS.md §4, §6) — the single
// auditable place where the dispatcher's call prompts are built. Each template carries: the
// position marker (first line of every handoff), the card address (the card is the whole
// instruction — the dispatch message never retells it), and the return format.
//
// Input scrubbing is done by a script, not a model (prohibition 17, applied to the *input*
// of our own nodes): free-text passed with --note (and the card's Task zone, when embedded)
// goes through the same scrub as the Plumb's external executor (plumb-scrub.cjs). Fail-closed:
// if a secret-like residue remains, no prompt is printed — exit 2.
//
// Usage:
//   node .claude/scripts/dispatch-prompt.cjs --node Kit --card .devtool/features/card-NNN-....md \
//        --marker <holding course|counting cost|assembling|preserving> [--note "free text"] [--with-task]
//   node .claude/scripts/dispatch-prompt.cjs --self-test
//
// The marker is the sender's explicit position decision (law §4) — there is no default: a build
// without an explicit --marker is rejected with a named problem, same as a marker outside the four.
// Exit: 0 prompt printed, 1 usage/validation error, 2 scrub refused (secret-like residue).

const fs = require('fs');
const path = require('path');
const { extractTask, loadSecrets, scrub, residue } = require('./plumb-scrub.cjs');

const MARKERS = ['holding course', 'counting cost', 'assembling', 'preserving'];
const NODES = ['Intent', 'Spec', 'Kit', 'Run', 'Core'];

// One template per node. The marker opens the prompt; the card path is the assignment;
// the return format closes it. Templates are neutral — no project traces (prohibition 16).
const TEMPLATES = {
  Intent: [
    '{marker}',
    'Goal address: {card}',
    'Read the card in full before acting. You speak with the human; the card is the whole instruction.',
    'Return: one line — marker, card address, what you decided and who you handed it to.'
  ].join('\n'),
  Spec: [
    '{marker}',
    'Card address: {card}',
    'Read the card in full. Slice by the card\'s criterion; name the attempt budget per card.',
    'Return: one line — marker, card address, the route label and the leading role you chose.'
  ].join('\n'),
  Kit: [
    '{marker}',
    'Card address: {card}',
    'Read the card in full. Fill the six kit units; check paths exist before handoff.',
    'Return: one line — marker, card address, the kit summary and the board move you made.'
  ].join('\n'),
  Run: [
    '{marker}',
    'Card address: {card}',
    'Read ## Task and ## Kit of the card; execute only what they name. A missing kit unit is a stop, not improvisation.',
    'Return: one line — marker, card address, what was done against the readiness criterion.'
  ].join('\n'),
  Core: [
    '{marker}',
    'Card address: {card}',
    'Read the cycle\'s cards together before the verdict; the criterion is the card\'s, not yours.',
    'Return: one line — marker, card address, verdict (reached / not reached) and the reason.'
  ].join('\n')
};

function build({ node, card, marker, note, withTask, root }) {
  const problems = [];
  if (!NODES.includes(node)) problems.push('node "' + node + '" is not one of ' + NODES.join('|'));
  if (!MARKERS.includes(marker)) problems.push('marker "' + marker + '" is not one of ' + MARKERS.join('|'));
  if (!card) problems.push('card path is required');
  if (problems.length) return { problems };

  const siteHosts = new Set();
  const secrets = loadSecrets(root, siteHosts);
  let pieces = [];
  if (note) {
    const s = scrub(note, secrets, siteHosts);
    pieces.push({ text: s.text, counts: s.counts, kind: 'note' });
  }
  if (withTask) {
    const md = fs.readFileSync(card, 'utf8');
    const task = extractTask(md);
    if (!task) return { problems: ['card has no ## Task zone (required with --with-task)'] };
    const s = scrub(task, secrets, siteHosts);
    pieces.push({ text: s.text, counts: s.counts, kind: 'task' });
  }

  let prompt = (TEMPLATES[node] || '')
    .replace('{marker}', marker)
    .replace('{card}', card);
  for (const p of pieces) {
    const why = residue(p.text, secrets);
    if (why.length) return { refused: why, kind: p.kind };
    prompt += '\n\n' + (p.kind === 'note' ? 'Dispatch note (scrubbed): ' + p.text : 'Task zone (scrubbed):\n' + p.text);
  }
  return { prompt };
}

function selfTest() {
  let failed = 0;
  const ok = (name, cond) => { console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name); if (!cond) failed = 1; };

  const good = build({ node: 'Kit', card: '.devtool/features/x.md', marker: 'assembling', note: 'see file C:/Users/me/secret.txt', root: process.cwd() });
  ok('valid build produces a prompt', !!good.prompt);
  ok('prompt opens with the marker', good.prompt && good.prompt.startsWith('assembling'));
  ok('prompt carries the card address', good.prompt && good.prompt.includes('.devtool/features/x.md'));
  ok('path in note is scrubbed', good.prompt && !/C:\/Users/.test(good.prompt));

  const badMarker = build({ node: 'Kit', card: 'x.md', marker: 'just do it', root: process.cwd() });
  ok('unknown marker is rejected with a named problem', (badMarker.problems || []).some(p => p.includes('marker')));

  const noMarker = build({ node: 'Kit', card: 'x.md', root: process.cwd() });
  ok('missing --marker is rejected with a named problem', (noMarker.problems || []).some(p => p.includes('marker')));

  const badNode = build({ node: 'Writer', card: 'x.md', marker: 'assembling', root: process.cwd() });
  ok('unknown node is rejected with a named problem', (badNode.problems || []).some(p => p.includes('node')));

  const secret = build({ node: 'Run', card: 'x.md', marker: 'preserving', note: 'password = hunter2secret', root: process.cwd() });
  ok('credential assignment is refused fail-closed', Array.isArray(secret.refused) && secret.refused.length > 0);

  process.exit(failed);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();
  const a = { node: null, card: null, marker: null, note: null, withTask: false, root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--node') a.node = argv[++i];
    else if (v === '--card') a.card = argv[++i];
    else if (v === '--marker') a.marker = argv[++i];
    else if (v === '--note') a.note = argv[++i];
    else if (v === '--with-task') a.withTask = true;
    else if (v === '--root') a.root = path.resolve(argv[++i]);
    else { console.error('unknown argument: ' + v); process.exit(1); }
  }
  const r = build(a);
  if (r.problems) { for (const p of r.problems) console.error(p); process.exit(1); }
  if (r.refused) { console.error('refused: ' + r.kind + ' not included — ' + r.refused.join('; ')); process.exit(2); }
  console.log(r.prompt);
}

if (require.main === module) main();
module.exports = { MARKERS, NODES, TEMPLATES, build };
