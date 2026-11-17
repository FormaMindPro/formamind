#!/usr/bin/env node
'use strict';

/**
 * backlog - the local backlog's standing digest: un-carded observations of the project, collected from
 * three sources and spoken to the human at a card closing and at a session start. The scanner reads,
 * never blocks: exit 0 on every mode, silence when there is nothing to say, a missing JOURNAL.md is
 * silence - not an error. The labels and the texts are dictionary data (keys.json, messages/<lang>.json),
 * never code literals; the card's chat name rides the dictionary mask cardMask.
 *
 *   node .forma/board/backlog.cjs [--project] [--root <dir>]   the human digest (the project's language)
 *   node .forma/board/backlog.cjs --line [--root <dir>]        one summary line for the start hooks; empty - silence
 *   node .forma/board/backlog.cjs --json [--root <dir>]        the strict SessionStart schema carrying the same line
 *   node .forma/board/backlog.cjs --selftest                   probes in a temp directory
 *
 * Sources (scanBacklog):
 *   card    - the board's backlog lane: live cards (.devtool/features/*.md) with status "backlog";
 *   result  - closed cards (.devtool/features/done/): "Result" text that begins its own sentence with a
 *             follow-up label (the dictionary key labels.followup, match prefix, every language);
 *   journal - project/JOURNAL.md: the lines of the "What was missing" section (the dictionary phrases key
 *             journal_missing) that do not reference a card-NNN code - a carded line is not duplicated.
 *
 * Exit codes: 0 always, except a failed --selftest (1: a broken core must be named, not muted).
 * Module: require('./backlog.cjs') -> { scanBacklog, lineFor, digestFor, followupTail }:
 *   scanBacklog(root) -> { items: [{source, address, text}], counts: {card, result, journal, total}, lang };
 *   lineFor(root, lang)   -> '' | the one-line summary (cli.cjs backlog, the start hooks);
 *   digestFor(root, lang) -> the digest text; empty scan - the digest_empty note (the human asked directly);
 *   followupTail(line)    -> '' -> null | the observation text (card-move's close scan shares the matcher).
 * Part of the core: carries no project traces (prohibition 16; probe card codes are assembled at runtime).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const i18n = require('../i18n/index.cjs');

const rel = (root, abs) => path.relative(root, abs).replace(/\\/g, '/');

/** The card's chat name by the dictionary mask cardMask ({n}, {title}); en is the fallback. */
const maskText = (lang, n, title) => {
  const m = i18n.KEYS.cardMask || {};
  return String(m[lang] || m.en || 'Card-{n} "{title}"').replace('{n}', String(n)).replace('{title}', title);
};

/** Does `line` begin with a follow-up label of the dictionary (labels.followup, match prefix, any case)? */
const isFollowup = (line) => followupTail(line) !== null;

/** The tail of `line` from its first follow-up label that begins its own sentence - the line's start counts
 *  as one; null when the line carries no such label. The dictionary (labels.followup, match prefix) decides,
 *  never a code literal; a mid-sentence mention of a label is not an observation and stays out. */
function followupTail(line) {
  const t = String(line).trim();
  if (!t) return null;
  const low = t.toLowerCase();
  const beginsSentence = (at) => at === 0 || /[.!?]$/.test(t.slice(0, at).replace(/\s+$/, ''));
  for (const l of i18n.labelsOf('followup')) {
    const label = String(l).toLowerCase();
    let at = low.indexOf(label);
    while (at >= 0) {
      if (beginsSentence(at)) return t.slice(at).trim();
      at = low.indexOf(label, at + 1);
    }
  }
  return null;
}

/** The lines of a zone (`key` -> zone.<key>) found by the dictionary heading, up to the next `## ` heading. */
function zoneLines(src, key) {
  const re = i18n.headingRe('zone.' + key, '');
  const ls = String(src || '').split(/\r?\n/);
  const at = ls.findIndex((l) => re.test(l.replace(/\r$/, '')));
  const out = [];
  for (let k = at + 1; at >= 0 && k < ls.length && !/^##\s/.test(ls[k]); k++) out.push(ls[k]);
  return out;
}

/** (a) The board's backlog lane: the live cards with status "backlog" - the mask name and the file address. */
function cardItems(root, lang) {
  const dir = path.join(root, '.devtool', 'features');
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; /* no board yet */ }
  const out = [];
  for (const e of names) {
    if (!e.isFile() || !/^card-\d+.*\.md$/.test(e.name)) continue;
    let src = '';
    try { src = fs.readFileSync(path.join(dir, e.name), 'utf8'); } catch { continue; }
    if (!/^status:\s*"?backlog"?\s*$/m.test(src)) continue;
    const head = (src.match(/^#\s+(.+)$/m) || [null, e.name.replace(/\.md$/, '')])[1];
    const m = /^card-(\d+)\s*·\s*/.exec(head);
    const n = m ? m[1] : ((e.name.match(/^card-(\d+)/) || [null, ''])[1]);
    const title = m ? head.slice(m[0].length) : head;
    out.push({ source: 'card', address: rel(root, path.join(dir, e.name)), text: maskText(lang, n, title) });
  }
  return out;
}

/** (b) The closed cards: the "Result" text that begins a sentence with a follow-up label of the dictionary
 *  (at a line's start or right after sentence punctuation - the live Results carry the observation mid-line). */
function resultItems(root) {
  const dir = path.join(root, '.devtool', 'features', 'done');
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; /* no closed cards yet */ }
  const out = [];
  for (const e of names) {
    if (!e.isFile() || !/^card-\d+.*\.md$/.test(e.name)) continue;
    let src = '';
    try { src = fs.readFileSync(path.join(dir, e.name), 'utf8'); } catch { continue; }
    for (const l of zoneLines(src, 'result')) {
      const tail = followupTail(l);
      if (tail) out.push({ source: 'result', address: rel(root, path.join(dir, e.name)), text: tail });
    }
  }
  return out;
}

/** (c) project/JOURNAL.md: the "What was missing" section's lines that do not reference a card-NNN code.
 *  No journal file - silence (the section is written by the cycle closing; a fresh project has none). */
function journalItems(root) {
  let raw = '';
  try { raw = fs.readFileSync(path.join(root, 'project', 'JOURNAL.md'), 'utf8'); } catch { return []; }
  const out = [];
  let inSection = false;
  for (const l of String(raw).split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(l)) { inSection = inSection ? false : i18n.hasPhrase(l, 'journal_missing'); continue; }
    if (!inSection) continue;
    const t = l.trim();
    if (!t || /card-\d+/.test(t)) continue; // a line already carrying a card code is not duplicated
    out.push({ source: 'journal', address: 'project/JOURNAL.md', text: t });
  }
  return out;
}

/** The whole scan. Every read is guarded: an unreadable place reads as empty - the scanner never throws. */
function scanBacklog(root) {
  root = path.resolve(root);
  const lang = i18n.projectLang(root);
  const card = cardItems(root, lang);
  const result = resultItems(root);
  const journal = journalItems(root);
  const items = [...card, ...result, ...journal];
  return { items, counts: { card: card.length, result: result.length, journal: journal.length, total: items.length }, lang };
}

/** One summary line for the start hooks (cli.cjs backlog): empty scan - '', the hook stays silent. */
function lineFor(root, lang) {
  const { items } = scanBacklog(root);
  if (!items.length) return '';
  const head = i18n.message('board.backlog.digest_header', { count: items.length }, lang);
  return head + ' ' + items.map((it) => it.text + ' (' + it.address + ')').join('; ');
}

/** The human digest (--project): the header and one line per item; an empty scan - the empty note. */
function digestFor(root, lang) {
  const { items } = scanBacklog(root);
  if (!items.length) return i18n.message('board.backlog.digest_empty', {}, lang) + '\n';
  return i18n.message('board.backlog.digest_header', { count: items.length }, lang) + '\n'
    + items.map((it) => it.text + ' — ' + it.address).join('\n') + '\n';
}

// ---- --selftest: probes in a temp directory -------------------------------------------------------

function selftest() {
  const base = process.env.FORMA_TEST_TMP && fs.existsSync(process.env.FORMA_TEST_TMP) ? process.env.FORMA_TEST_TMP : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(base, 'backlog-'));
  const outerLang = process.env.FORMA_LANG;
  process.env.FORMA_LANG = ''; // the probes read the language from the fixture documents, not the environment
  const results = [];
  const check = (name, cond) => results.push({ ok: !!cond, name });
  const cli = path.join(__dirname, 'backlog.cjs');
  const run = (root, flags) => spawnSync(process.execPath, [cli, ...flags, '--root', root], { encoding: 'utf8' });
  // the fixture codes are assembled at runtime (the dynamic fixture-code convention): no card-NNN-like literals
  const probe = (n) => ['card', String(n)].join('-');
  const cardMd = (n, status, resultBody) => ['---', 'id: "' + probe(n) + '-proba"', 'status: "' + status + '"', '---', '',
    '# ' + probe(n) + ' · Probe ' + n, '', '## Task', n + ' · tooling | a probe | check: true | 3 | next', '',
    '## History', '', '## Result', resultBody, ''].join('\n');
  const put = (root, relPath, body) => {
    const f = path.join(root, relPath);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  };
  const mask = (lang, n, title) => maskText(lang, n, title);
  try {
    // a: an empty project - the hook channels are silent, the human digest answers with the empty note
    const a = path.join(dir, 'a');
    const scanA = scanBacklog(a);
    check('a: an empty project scans to zero items', scanA.items.length === 0 && scanA.counts.total === 0);
    const lineA = run(a, ['--line']);
    check('a: --line is silent and exits 0', lineA.status === 0 && lineA.stdout === '');
    const jsonA = run(a, ['--json']);
    check('a: --json is silent and exits 0', jsonA.status === 0 && jsonA.stdout === '');
    const digA = run(a, ['--project']);
    check('a: the digest answers the empty note (en) and exits 0', digA.status === 0
      && digA.stdout === i18n.message('board.backlog.digest_empty', {}, 'en') + '\n');

    // b: a backlog card reaches the scan, the digest, the line and the strict json - by the dictionary mask
    const b = path.join(dir, 'b');
    put(b, path.join('.devtool', 'features', probe(901) + '-proba.md'), cardMd(901, 'backlog', ''));
    const scanB = scanBacklog(b);
    const maskB = mask('en', 901, 'Probe 901');
    check('b: the backlog card is one card item with the file address', scanB.items.length === 1 && scanB.items[0].source === 'card'
      && scanB.items[0].address.includes('.devtool') && scanB.counts.card === 1);
    check('b: the digest renders the card by the dictionary mask', run(b, ['--project']).stdout.includes(maskB));
    const lineB = run(b, ['--line']);
    check('b: --line carries the mask as one line', lineB.status === 0 && lineB.stdout.includes(maskB)
      && lineB.stdout.trim().split('\n').length === 1);
    const jsonB = run(b, ['--json']);
    let parsed = null;
    try { parsed = JSON.parse(jsonB.stdout); } catch { /* not the strict schema */ }
    check('b: --json is the strict SessionStart schema carrying the same line', jsonB.status === 0 && parsed
      && parsed.hookSpecificOutput && parsed.hookSpecificOutput.hookEventName === 'SessionStart'
      && typeof parsed.hookSpecificOutput.additionalContext === 'string'
      && parsed.hookSpecificOutput.additionalContext.includes(maskB));

    // c: a closed card with a follow-up label line - one result item; d: without a label - silence
    const c = path.join(dir, 'c');
    put(c, path.join('.devtool', 'features', 'done', probe(902) + '-proba.md'),
      cardMd(902, 'done', 'Observation: the scaffold misses the threshold rows.'));
    const scanC = scanBacklog(c);
    check('c: a closed card with a follow-up label - one result item', scanC.items.length === 1
      && scanC.items[0].source === 'result' && scanC.items[0].text.startsWith('Observation') && scanC.counts.result === 1);
    // c2: the live shape - the observation opens its own sentence mid-line: the tail from the label is captured
    const c2 = path.join(dir, 'c2');
    put(c2, path.join('.devtool', 'features', 'done', probe(906) + '-proba.md'),
      cardMd(906, 'done', 'First sentence closes here. Observation: the scaffold misses the threshold rows.'));
    const scanC2 = scanBacklog(c2);
    check('c2: a mid-line observation that begins its own sentence is captured from the label', scanC2.counts.result === 1
      && scanC2.items[0].text.startsWith('Observation') && !scanC2.items[0].text.includes('First sentence'));
    // c3: a label mentioned mid-sentence is not an observation - silence
    const c3 = path.join(dir, 'c3');
    put(c3, path.join('.devtool', 'features', 'done', probe(907) + '-proba.md'),
      cardMd(907, 'done', 'The observation was noted mid-sentence and stays unflagged.'));
    check('c3: a label mentioned mid-sentence - silence', scanBacklog(c3).items.length === 0);
    const d = path.join(dir, 'd');
    put(d, path.join('.devtool', 'features', 'done', probe(904) + '-proba.md'), cardMd(904, 'done', 'All checks green.'));
    check('d: a closed card without a label - silence', scanBacklog(d).items.length === 0);

    // e: the journal - the plain line lands, the carded line is not duplicated; no journal - silence
    const e = path.join(dir, 'e');
    put(e, path.join('project', 'JOURNAL.md'),
      ['# Journal', '', '## What was missing', '- a gap without a card', '- already carded: ' + probe(903), ''].join('\n'));
    const scanE = scanBacklog(e);
    check('e: the journal section yields the plain line, the carded line stays out', scanE.counts.journal === 1
      && scanE.items[0].source === 'journal' && scanE.items[0].text.includes('a gap without a card')
      && !scanE.items.some((it) => it.text.includes(probe(903))));
    check('e: a project with no journal - silence', scanBacklog(path.join(dir, 'f')).counts.journal === 0);

    // g: the ru project - the mask renders from the dictionary data, in the project's language
    const g = path.join(dir, 'g');
    put(g, path.join('project', 'config', 'PROJECT.md'),
      '# configuration\n\n**Project language** <!-- k:language -->: \u0440\u0443\u0441\u0441\u043a\u0438\u0439\n');
    put(g, path.join('.devtool', 'features', probe(905) + '-proba.md'), cardMd(905, 'backlog', ''));
    const digG = run(g, ['--project']);
    check('g: the ru project renders the card by the ru mask, exit 0', digG.status === 0
      && digG.stdout.includes(mask('ru', 905, 'Probe 905')));

    const failed = results.filter((r) => !r.ok);
    return {
      ok: failed.length === 0,
      note: failed.length ? 'mismatch: ' + failed.map((r) => r.name).join('; ')
        : 'all probes green: an empty project is silent on the hook channels and answers the digest with the empty note; '
        + 'a backlog card and a closed card with a follow-up label reach the digest by the dictionary mask, '
        + 'the label captured at a line start and at its own sentence mid-line, a mid-sentence mention stays out; '
        + 'a closed card without a label, a journal line carrying a card code and a missing journal stay silent; '
        + 'exit 0 on every mode',
    };
  } finally {
    if (outerLang === undefined) delete process.env.FORMA_LANG; else process.env.FORMA_LANG = outerLang;
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
    console.log((st.ok ? 'OK ' : 'FAIL ') + st.note);
    process.exit(st.ok ? 0 : 1);
  }
  const lang = i18n.projectLang(root);
  if (argv.includes('--json')) {
    const line = lineFor(root, lang);
    if (line) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: line } }));
  } else if (argv.includes('--line')) {
    const line = lineFor(root, lang);
    if (line) process.stdout.write(line + '\n');
  } else {
    process.stdout.write(digestFor(root, lang)); // no flags or --project: the human digest
  }
  process.exit(0); // the scanner never blocks: not on a missing board, not on a missing journal
}

module.exports = { scanBacklog, lineFor, digestFor, followupTail };
