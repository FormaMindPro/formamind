#!/usr/bin/env node
'use strict';

/**
 * core-trend.cjs - the cycle's trend numbers read mechanically from the cards' ## History zones.
 * The numbers Core once counted by hand over the histories are a command now (the plan of the
 * compression package): it reads recorded facts, evaluates nothing and invents nothing.
 *
 * Usage:
 *   node .forma/dashboard/core-trend.cjs <card-or-folder> [more card-or-folder ...] [--json]
 *     A folder is walked recursively; only *.md files with a card frontmatter are taken;
 *     demo cards (the `demo` label) are skipped in a walk, an explicitly named card is counted.
 *     A card reference "NNN" / "card-NNN" resolves against the live board, then done/.
 *
 * Numbers (the balance table's numbering, one reading rule per number):
 *   No.1 first-pass acceptance - a card is first-pass when its History holds exactly ONE
 *          Run attempt line (a line "- `Run`, YYYY-MM-DD: attempt, ..."); the share of such
 *          cards over the cards with at least one Run attempt line.
 *   No.2 attempts over budget - the Run attempt lines of a card against its budget field
 *          (field 4 of the Task line, the integer between " | "); cards over it, and the
 *          excess attempts summed over those cards.
 *   No.3 spend total - tally.cjs spawned on the same targets; the tokens/usd of its JSON total.
 *   No.6 organization over work - the mechanical part: the share of cards NOT on first entry
 *          (2+ Run attempt lines) over the cards with 1+; the overhead spend share is not
 *          recorded anywhere a history holds - null with its note, never invented.
 *   No.8 Plumb agreement - the `Plumb` lines classified by the outcome of the description
 *          (fits / below threshold / returned); the share of fits among the first-pass cards
 *          with a classified Plumb line (a card counts by its last classified line).
 *
 * --json      the same numbers machine-readable.
 * --help      this reference.
 * --selftest  a built-in fixture card set (the dates are built at runtime, no calendar
 *             literals) with a known answer for No.1, No.2 and No.8; exit 0 on PASS, 1 on FAIL.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const execFileP = promisify(execFile);

const { walk } = require('./lib/fs.cjs');
const { frontmatterBlock, zone } = require('./lib/card.cjs');
const { toEnglish } = require('./spend-line.cjs');

const FEATURES_DIR = path.resolve(__dirname, '..', '..', '.devtool', 'features');
const TALLY = path.join(__dirname, 'tally.cjs');
const NOT_RECORDED = 'not recorded';

// An attempt line of the histories (AGENTS.md section 3): "- `Node`, YYYY-MM-DD: attempt, ...".
// The legacy Russian form of the key part is brought to the canon by toEnglish() first
// (spend-line.cjs); old lines are read, never rewritten.
const ATTEMPT_RE = /^-\s*`([^`]+)`,\s*\d{4}-\d{2}-\d{2}:\s*attempt,/;

// A Plumb line of either form - an attempt line or the driver's jev line.
const PLUMB_RE = /^-\s*`Plumb`,\s*\d{4}-\d{2}-\d{2}:/;

// The outcome of a Plumb line sits in its description - the text after the dash. The project
// writes descriptions in its own language, so the Russian outcome markers are matched through
// \u escapes: this source stays ASCII (the English-only gate scans the code zones).
const RU_BELOW = '\u043d\u0438\u0436\u0435 \u043f\u043e\u0440\u043e\u0433';            // "below the threshold"
const RU_FITS = '\u043f\u043e\u0440\u043e\u0433\u0438 \u043f\u0440\u043e\u0439\u0434\u0435\u043d';  // "thresholds passed"
const RU_RETURN_1 = '\u0432\u043e\u0437\u0432\u0440\u0430\u0442';                        // "return, returned" (noun)
const RU_RETURN_2 = '\u0432\u0435\u0440\u043d\u0443\u043b';                             // "returned" (verb)

/** The line's description - after the first dash; no dash - the whole line. */
const descOf = (line) => { const i = line.indexOf('\u2014'); return i === -1 ? line : line.slice(i + 1); };

/** 'fits' | 'belowThreshold' | 'returned' | null - one outcome of one Plumb line. */
function plumbOutcome(line) {
  const d = descOf(line).toLowerCase();
  // The negative markers are read first: a line may name the reading and the route consequence
  // together ("below threshold; returned to Kit") - the reading is the outcome.
  if (/below threshold/.test(d) || d.includes(RU_BELOW)) return 'belowThreshold';
  if (/\breturned\b/.test(d) || d.includes(RU_RETURN_1) || d.includes(RU_RETURN_2)) return 'returned';
  if (/\bfits\b/.test(d) || d.includes(RU_FITS)) return 'fits';
  return null;
}

/** A card of a demonstration cycle (the `demo` label): not counted in a walk of the board. */
const isDemoCard = (text) => /^labels:\s*\[[^\]]*["']demo["']/m.test(text);

/** A card file: an .md with a frontmatter carrying an id field. The shape is the frontmatter,
 *  not a name prefix - the selftest's fixtures carry fixture ids and must be read as cards too
 *  (the source stays free of card-NNN patterns: the clean-zone rule). */
function isCardFile(file) {
  if (!file.endsWith('.md')) return false;
  const fm = frontmatterBlock(fs.readFileSync(file, 'utf8'));
  return fm !== null && /^id:/m.test(fm);
}

/** A card reference ("NNN", "card-NNN") into its file path: the live board, then done/. */
function resolveTarget(arg) {
  if (fs.existsSync(arg)) return arg;
  const m = /^(?:card-)?(\d{1,4})$/.exec(arg);
  if (!m) return null;
  const prefix = 'card-' + String(Number(m[1])).padStart(3, '0') + '-';
  for (const dir of [FEATURES_DIR, path.join(FEATURES_DIR, 'done')]) {
    let hits = [];
    try { hits = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.md')).sort(); } catch { hits = []; }
    if (hits.length === 1) return path.join(dir, hits[0]);
    if (hits.length > 1) return { ambiguous: hits.map((f) => path.join(dir, f)) };
  }
  return null;
}

function collectFiles(targets) {
  const files = [];
  for (const target of targets) {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      files.push(...walk(target, { ext: '.md', abs: true }).filter((f) => !isDemoCard(fs.readFileSync(f, 'utf8'))));
    } else if (target.endsWith('.md')) {
      files.push(target);
    }
  }
  return files;
}

/** The task line's budget field - field 4, the integer between " | "; null when absent/unreadable. */
function budgetOf(text) {
  const body = zone(text, 'task');
  const first = body.split(/\r?\n/).find((l) => l.trim());
  if (!first) return null;
  const parts = first.split(' | ');
  if (parts.length < 4) return null;
  const n = parseInt(parts[3].trim(), 10);
  return Number.isFinite(n) ? n : null;
}

/** One card's readings: the Run attempt lines' count, the budget, the Plumb outcomes in order. */
function readCard(file) {
  const text = fs.readFileSync(file, 'utf8');
  let runAttempts = 0;
  const plumbOutcomes = [];
  for (const raw of zone(text, 'history').split(/\r?\n/)) {
    const line = toEnglish(raw.trim());
    const a = ATTEMPT_RE.exec(line);
    if (a && a[1] === 'Run') runAttempts += 1;
    if (PLUMB_RE.test(line)) plumbOutcomes.push(plumbOutcome(line));
  }
  const classified = plumbOutcomes.filter((o) => o !== null);
  return {
    file: path.basename(file),
    runAttempts,
    budget: budgetOf(text),
    plumbOutcomes,
    lastOutcome: classified.length ? classified[classified.length - 1] : null,
  };
}

/** a/b rounded to 4 decimals; null when the denominator is empty - never a fake zero. */
const frac = (a, b) => (b ? Math.round((a / b) * 10000) / 10000 : null);

/**
 * The trend numbers over the targets. o.tally === false skips the No.3 spawn (the selftest
 * checks No.1, No.2, No.8 - the spend total is tally.cjs's own business, tested there).
 */
async function computeTrend(targets, o = {}) {
  const files = collectFiles(targets).filter(isCardFile);
  const cards = files.map(readCard);
  const withRun = cards.filter((c) => c.runAttempts >= 1);
  const firstPass = withRun.filter((c) => c.runAttempts === 1);
  const withBudget = withRun.filter((c) => c.budget !== null);
  const over = withBudget.filter((c) => c.runAttempts > c.budget);
  const excessAttempts = over.reduce((s, c) => s + (c.runAttempts - c.budget), 0);

  const plumbLines = { fits: 0, belowThreshold: 0, returned: 0, unclassified: 0 };
  for (const c of cards) for (const oc of c.plumbOutcomes) plumbLines[oc || 'unclassified'] += 1;
  const n8base = firstPass.filter((c) => c.lastOutcome !== null);
  const n8fits = n8base.filter((c) => c.lastOutcome === 'fits');

  let n3 = { tokens: null, usd: null, note: 'not requested' };
  if (o.tally !== false) {
    try {
      const { stdout } = await execFileP(process.execPath, [TALLY, ...targets], { maxBuffer: 32 * 1024 * 1024 });
      const j = JSON.parse(stdout);
      n3 = { tokens: j.total.tokens, usd: j.total.usd };
    } catch (err) {
      n3 = { tokens: null, usd: null, note: 'tally spawn failed: ' + String(err.message || err) };
    }
  }

  return {
    corpus: { cards: cards.length, withRunAttempt: withRun.length },
    n1: { firstPass: firstPass.length, withRun: withRun.length, share: frac(firstPass.length, withRun.length) },
    n2: { overBudget: over.length, excessAttempts, coverage: withBudget.length },
    n3,
    n6: {
      notFirstPass: withRun.length - firstPass.length,
      withRun: withRun.length,
      share: frac(withRun.length - firstPass.length, withRun.length),
      overheadSpendShare: null,
      note: 'not computable from histories',
    },
    n8: { fits: n8fits.length, base: n8base.length, share: frac(n8fits.length, n8base.length), plumbLines },
  };
}

// ─────────────────────────── the human report ───────────────────────────
// The tally report's rule holds here too: next to each quantity stands what it was computed
// over, and a quantity with an empty base prints "not recorded" - zero and "not recorded"
// must never look identical.

const groups = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const pct = (a, b) => (b ? Math.round((a / b) * 100) + `% (${a} of ${b})` : NOT_RECORDED);

function report(r) {
  const L = ['core-trend: the cycle\'s trend numbers from the cards\' histories',
    '='.repeat(72),
    `corpus: ${r.corpus.cards} card(s), ${r.corpus.withRunAttempt} with a Run attempt line`];

  L.push(`No.1 first-pass acceptance: ${pct(r.n1.firstPass, r.n1.withRun)}`,
    '    rule: exactly one Run attempt line in History; the share over cards with 1+ such lines');

  const n2cover = r.n2.coverage ? `${r.n2.coverage} of ${r.corpus.withRunAttempt} cards with a Task budget` : NOT_RECORDED;
  L.push(`No.2 attempts over budget: ${r.n2.coverage ? `${r.n2.overBudget} card(s) over, ${r.n2.excessAttempts} excess attempt(s); coverage: ${n2cover}` : NOT_RECORDED}`,
    '    rule: the Run attempt lines of a card above its budget field (field 4 of the Task line)');

  const n3val = r.n3.tokens === null
    ? `${NOT_RECORDED}${r.n3.note ? ' (' + r.n3.note + ')' : ''}`
    : `${groups(r.n3.tokens)} tokens, $${r.n3.usd}`;
  L.push(`No.3 spend total (tally.cjs): ${n3val}`,
    '    rule: the same targets through tally.cjs, the tokens/usd of its JSON total');

  L.push(`No.6 organization over work: ${pct(r.n6.notFirstPass, r.n6.withRun)} not on first entry`,
    `    overhead spend share: null (${r.n6.note})`,
    '    rule: cards with 2+ Run attempt lines over cards with 1+; the overhead share is not in the histories');

  const p = r.n8.plumbLines;
  L.push(`No.8 Plumb agreement: ${pct(r.n8.fits, r.n8.base)} fits among first-pass cards`,
    `    Plumb lines seen: fits ${p.fits}, below threshold ${p.belowThreshold}, returned ${p.returned}, unclassified ${p.unclassified}`,
    '    rule: the share of fits among first-pass cards with a classified Plumb line (a card - by its last classified line)');
  return L.join('\n');
}

// ─────────────────────────── CLI ───────────────────────────

const HELP = `
core-trend.cjs - the cycle's trend numbers read from the cards' History zones.

Usage:
  node .forma/dashboard/core-trend.cjs <card-or-folder> [more card-or-folder ...] [--json]

Arguments:
  <card-or-folder>       A card file, a card reference ("NNN", "card-NNN") or a
                         folder. A folder is walked recursively; only *.md files
                         with a card frontmatter are taken; demo cards (the
                         \`demo\` label) are skipped in a walk, an explicitly
                         named card is counted.

Flags:
  --json                 The same numbers machine-readable.
  --help                 This reference.
  --selftest             A built-in fixture card set (the dates are built at
                         runtime, no calendar literals); checks No.1, No.2 and
                         No.8 against a known answer. Exit 0 on PASS, 1 on FAIL.

Numbers (the balance table's numbering; every output line carries its rule):
  No.1 first-pass acceptance - exactly one Run attempt line in History.
  No.2 attempts over budget - Run attempt lines vs the budget field (field 4
       of the Task line).
  No.3 spend total - tally.cjs spawned on the same targets; its JSON total.
  No.6 organization over work - the share of cards not on first entry; the
       overhead spend share is not computable from histories (null, never
       invented).
  No.8 Plumb agreement - the share of fits among first-pass cards with a
       classified Plumb line (fits / below threshold / returned).

Example:
  node .forma/dashboard/core-trend.cjs .devtool/features/done
  node .forma/dashboard/core-trend.cjs <card-file> --json
`;

// ─────────────────────────── selftest ───────────────────────────
// Three fixture cards, the dates built at runtime (no calendar literals in this source).
// Card A: first pass, budget 2, Plumb fits (English marker).
// Card B: two attempts (the second in the legacy Russian attempt wording), budget 1,
//         Plumb below threshold (the Russian marker).
// Card C: first pass, budget 1, Plumb returned.
// Known answer: No.1 = 2 of 3; No.2 = 1 card over, 1 excess, coverage 3; No.8 = 1 of 2;
// Plumb lines: fits 1, below threshold 1, returned 1, unclassified 0.

const RU_WORD_ATTEMPT = '\u0437\u0430\u0445\u043e\u0434';        // the legacy Russian "attempt"
const RU_PHRASE_BELOW = RU_BELOW + '\u0430';                     // the attested "below the threshold" wording

function fixtureCards() {
  const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
  const head = (n) => `---\nid: "fixture-9${n}-core-trend-selftest"\nstatus: "done"\nlabels: ["goal-fixture", "route-2"]\n---\n# fixture 9${n}\n\n## Task\n9${n} · tooling | Delivers a fixture | check: gates green | ${n === '2' ? 1 : 2} | fixture-next\n\n## History\n`;
  return [
    head('1') +
    `- \`Plumb\`, ${day(0)}: attempt, 50 tokens (cache-read unknown), 1 s, \`fx-p1\` — role run-script fits, leader 85, gap 40, clarity 4/4.\n` +
    `- \`Run\`, ${day(0)}: attempt, 100 tokens (10 cache-read), 5 s, \`fx-a1\` — one pass, gates green.\n`,
    head('2') +
    `- \`Plumb\`, ${day(-1)}: attempt, 60 tokens (cache-read unknown), 1 s, \`fx-p2\` — leader 75, ${RU_PHRASE_BELOW} (needs 80).\n` +
    `- \`Run\`, ${day(-1)}: attempt, 100 tokens (10 cache-read), 5 s, \`fx-b1\` — first try, red check.\n` +
    `- \`Run\`, ${day(0)}: ${RU_WORD_ATTEMPT}, 120 tokens (10 cache-read), 6 s, \`fx-b2\` — second pass, green.\n`,
    head('3') +
    `- \`Plumb\`, ${day(0)}: attempt, 40 tokens (cache-read unknown), 1 s, \`fx-p3\` — clarity 2/4, returned to Spec once.\n` +
    `- \`Run\`, ${day(0)}: attempt, 90 tokens (9 cache-read), 4 s, \`fx-c1\` — one pass.\n`,
  ];
}

async function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-trend-selftest-'));
  const failures = [];
  try {
    fixtureCards().forEach((body, i) => fs.writeFileSync(path.join(dir, `fixture-9${i + 1}.md`), body, 'utf8'));
    const r = await computeTrend([dir], { tally: false });
    const expect = (cond, what) => { if (!cond) failures.push(what + ' (got: ' + JSON.stringify(r) + ')'); };
    expect(r.corpus.cards === 3 && r.corpus.withRunAttempt === 3, 'corpus: 3 cards, 3 with a Run attempt line');
    expect(r.n1.firstPass === 2 && r.n1.withRun === 3 && Math.abs(r.n1.share - 0.6667) < 0.001, 'No.1: 2 of 3 first-pass');
    expect(r.n2.overBudget === 1 && r.n2.excessAttempts === 1 && r.n2.coverage === 3, 'No.2: 1 card over, 1 excess, coverage 3');
    expect(r.n8.fits === 1 && r.n8.base === 2 && Math.abs(r.n8.share - 0.5) < 0.001, 'No.8: 1 of 2 fits among first-pass');
    expect(r.n8.plumbLines.fits === 1 && r.n8.plumbLines.belowThreshold === 1
      && r.n8.plumbLines.returned === 1 && r.n8.plumbLines.unclassified === 0, 'No.8: Plumb lines fits 1, below 1, returned 1, unclassified 0');
    expect(r.n6.notFirstPass === 1 && r.n6.overheadSpendShare === null, 'No.6: 1 not first-pass, overhead share null');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (failures.length) {
    console.error(`core-trend selftest: FAIL (${failures.length})`);
    for (const f of failures) console.error('  - ' + f);
    return 1;
  }
  console.log('core-trend selftest: PASS');
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) { console.log(HELP.trim()); return 0; }
  if (argv.includes('--selftest')) return selftest();

  const wantJson = argv.includes('--json');
  const targets = argv.filter((a) => a !== '--json');
  if (!targets.length) { console.error('usage: node .forma/dashboard/core-trend.cjs <card-or-folder> [...] [--json]'); return 1; }
  const resolved = targets.map(resolveTarget);
  const ambiguous = resolved.filter((t) => t && t.ambiguous);
  if (ambiguous.length) {
    console.error('core-trend: ambiguous card reference: ' + ambiguous.flatMap((t) => t.ambiguous).join(', '));
    return 1;
  }
  const missing = targets.filter((_, i) => !resolved[i]);
  if (missing.length) { console.error('core-trend: not found: ' + missing.join(', ')); return 1; }

  const r = await computeTrend(resolved);
  if (!r.corpus.cards) { console.error('core-trend: no cards found under: ' + targets.join(', ')); return 1; }
  process.stdout.write((wantJson ? JSON.stringify(r, null, 2) : report(r)) + '\n');
  return 0;
}

module.exports = { computeTrend, report, plumbOutcome };
if (require.main === module) main().then((code) => { process.exitCode = code; });
