#!/usr/bin/env node
// Handing a card to the next node in one call: status + assignee + the stage line + the board check (AGENTS.md §6–7).
//
//   node .forma/board/card-move.cjs <card> --to kit|run|intent|accept|close --note "<what is done>" [--node <node>] [--dry]
//                                 [--duration-ms MS --agent-id <id> [--tokens N] [--cache-read R] [--turns K] [--engine <engine tag>]]
//                                 [--kit "<text>"|-] [--result "<text>"|-] [--session-spend <NNN>]
//   node .forma/board/card-move.cjs <card> --stage <key> --node <node> --note "<what>" [--dry] - the stage line only, no move
//
// <card>  - "NNN", "card-NNN" or the full code "card-NNN-slug"; the sampling is exact: a short number - only with
//           a single candidate, an ambiguity (several cards under one number) - a refusal with the list
//           of candidates, nothing is written (name the full code); in done/ - already closed, nothing to hand over.
// --to    - where we hand over; the table §7 → the frontmatter fields, the stage key §6:
//             kit     todo        Kit      stage kit      Intent writes: opened the cycle, the card goes to kitting
//             run     in-progress Run      stage exec     Kit writes: the kit is ready, execution
//             intent  review      Intent   stage check    the one who executed writes: the result goes to the check
//             accept  review      Intent   stage accept   Intent writes: the check passed, awaits the human's "yes";
//                                         refused before any write while the epic holds `k:volume` cards in done/Core -
//                                         the cycle closes first (`--to core-close`), the next acceptance goes after
//             close   done        Core     stage close    Intent writes: the human accepted; the file goes to done/
//           Who holds `run` is set by the card's `route-N` label (§6–7): `route-4` (the short route) - Kit executes, `run`
//           holds "Kit"; `route-0` and `route-1` - Intent executes, `run` holds "Intent"; the other routes - Run.
// --note  - the "what" in the stage line; without it - an error: an empty stage line says nothing.
// --node  - whose line; by default the node making this handover (see the table; for `intent` - the previous executor).
// --stage - the stage line by the same call (§6), the key from a closed list of seven
//           (card|approve|kit|exec|check|accept|close); with --to the key must match the target's stage - one call
//           writes one stage line; without --to - the line only: the status and the assignee do not change,
//           --node names whose line it is (the table §7 does not cover a no-move call - no default), the spend
//           and section flags are not accepted. An unknown key or a missing text - a stop before any write.
// The spend (AGENTS.md §3, ECONOMY.md) - the caller writes it right after the node's return; the same call also appends the spend line:
//           --duration-ms MS (seconds are rounded), --agent-id <id of the call>; both are needed. N, R and O are read from the call's transcript
//           (as `claude-economy.cjs line`); --tokens N - the fallback value: with it the line is written as is, without reading the transcript.
//           No transcript and no --tokens - N, R and O = unknown with the reason in the description, not zero.
//           --cache-read R - otherwise "(cache-read unknown)" with the reason in the description; --turns K - "K turns"; --engine - the engine tag; without it - the engine whose transcripts are the newest (the adapters), otherwise the only adapter.
//           The spend line goes from the `--node` node (the one whose call returned), before the stage line. Without these flags no spend is written.
// The card's sections - by the same call, without a separate file edit:
//           --kit    - the body of the "Kit" zone (six units, AGENTS.md §6); only with --to run: Kit writes the kit at the handover.
//           --result - the body of the "Result" zone; only with --to intent: the executor writes the result at the return to the check.
//           The value "-" reads the text from stdin (multiline text - via a heredoc); otherwise the argument itself is taken. The zone body is replaced
//           whole (when editing the kit after the return - the new kit, not an append). Only one of the two may be "-".
//           --session-spend NNN - only with --to accept|close: by the same call appends the `Intent` spend line over the card
//           (the output of the engine adapter's `card-session-spend.cjs NNN --write`, the line before the stage line); NNN - the number of this same card.
//           The adapters have no script or it gave nothing - an error before any write. No new spend - the line is not written, that is not an error.
// Closing the cycle: node .forma/board/card-move.cjs --to core-close <NNN|card-NNN-slug…> --note "<the grounds>" [--dry] - writes `Core`: on every named
//           card (done, assignee "Core") the line "closed - <the grounds>" in "History" and assignee: null; the rest does not change.
//           An unknown number, a repeat or a card not in done/Core - a stop before any write. The spend and section flags are not accepted here.
// --dry   - show the changes, do not write the file.
// --override - with --to kit only: one pass beyond the used-up attempt budget (§3) - refused without it; with it the pass
//           goes through and writes the "budget override" line into History (prohibition 3: the budget itself never changes silently).
// --gate-hash <hex> - record the readiness criterion's hash explicitly; only after the approval (--stage approve) or with
//           --to run. Without the flag the hash is recorded by itself at those two moments. A supplied hash must match the
//           current criterion - a mismatch is a stop before any write.
// --selftest - the gauges of the card sampling by code, the five-field approval, the executor-only attempt budget,
//           the gate hash and the acceptance volume in the OS temp directory (a dummy board); writes nothing; exit 0 - green.
// Writes `modified` (on `close` - and `completedAt`), appends a line into "History", then checks the board over this card;
// a red check restores the card (and for `close` removes the copy in done/), so a move never leaves a broken state.
// Part of the core: one for all engines, it knows no engine paths.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { makeCli } = require('../dashboard/lib/cli.cjs');
const { cardFiles, parseFrontmatter, frontmatterBlock, zoneHeadingIn, labelsOf, createdDay } = require('../dashboard/lib/card.cjs');
const { cardProblems: routeStageProblems } = require('./checks/route-stage.cjs');
const { normalize } = require('./run-in-card.cjs');
const { checkBoard } = require('./check-board.cjs');
const i18n = require('../i18n/index.cjs');
const { projectFile } = require('../dashboard/lib/fs.cjs');
const { formatSpendLine } = require('../dashboard/spend-line.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const BOARD = path.join(ROOT, '.devtool', 'features');
const msg = (key, params) => i18n.message(key, params, 'ru');

const cli = makeCli();
const { arg, flag } = cli;
const die = cli.die('card-move');

// --help: the invocation reference in the console (the transfer flags by this script's own parser, English only).
const HELP = `
card-move.cjs - hand a card to the next node in one call: the status + the
assignee + the stage line + the board check (AGENTS.md §6-7).

Usage:
  node .forma/board/card-move.cjs <card> --to kit|run|intent|accept|close --note "<what is done>" [flags]
  node .forma/board/card-move.cjs <cards...> --to core-close --note "<the grounds>"
  node .forma/board/card-move.cjs <card> --stage <key> --node <node> --note "<what>"   (the line only, no move)

Flags:
  --to <target>          Where the card goes: kit (todo, Kit), run
                         (in-progress, Run - or Kit/Intent by the route-N
                         label), intent (review, Intent), accept (review,
                         Intent), close (done, Core), core-close (the cycle
                         closing: several done cards, "closed" lines, the
                         assignee reset to null). accept is refused before
                         any write while the epic already holds k:volume
                         cards in done/Core: the cycle closes first
                         (--to core-close), the next acceptance goes after.
  --note "<text>"        The "what" of the stage line; required on every form.
  --kit "<text>"|-       The body of the "Kit" zone; only with --to run (Kit
                         writes the kit at the handover).
  --result "<text>"|-    The body of the "Result" zone; only with --to intent
                         (the executor writes the result at the return to the
                         check). The value "-" reads the text from stdin
                         (multiline - via a heredoc); only one of --kit and
                         --result may be "-".
  --session-spend <NNN>  The main session's spend line over the card; only
                         with --to accept|close; NNN - this same card's
                         number.
  --stage <key>          The stage key, a closed list of seven:
                         card|approve|kit|exec|check|accept|close; with --to
                         the key must match the target's stage; without --to
                         - the line only: the status and the assignee do not
                         change, --node names whose line it is.
  --node <name>          Whose line; by default the node making the handover
                         (for --to intent - the previous executor).
  --duration-ms MS       The spend line (AGENTS.md §3): the duration and the
  --agent-id <id>        call id - both required for a spend line; N, R and O
  --tokens N             are read from the call's transcript, --tokens N is
                         the fallback (the line written as is).
  --cache-read R         The cache-read tokens; without it - "(cache-read
                         unknown)" with the reason in the description.
  --turns K              The number of turns; --engine <tag> - the engine
                         tag (without it - the newest transcripts).
  --override             With --to kit only: one pass beyond the used-up
                         attempt budget; writes the "budget override" line
                         into History.
  --gate-hash <hex>      Record the readiness criterion's hash explicitly;
                         only with --stage approve or --to run. Without it
                         the hash is recorded at those moments by itself.
  --dry                  Show the changes, do not write the file.
  --selftest             The sampling gauges in the OS temp directory; writes
                         nothing; exit 0 - green.
  --help                 This reference.

The card is "NNN", "card-NNN" or the full "card-NNN-slug"; a short number is
accepted only with a single candidate; a card in done/ - nothing to hand over.
After the write the board check runs over this card; an error on it - exit 1.

Example:
  node .forma/board/card-move.cjs <NNN> --to intent --note "the result goes to the check" --result "<the result text>"
`;
if (flag('help')) { console.log(HELP.trim()); process.exit(0); }

const TARGETS = {
  kit: { status: 'todo', assignee: 'Kit', stage: 'kit', by: 'Intent' },
  run: { status: 'in-progress', assignee: 'Run', stage: 'exec', by: 'Kit' },
  intent: { status: 'review', assignee: 'Intent', stage: 'check', by: 'Run' },
  accept: { status: 'review', assignee: 'Intent', stage: 'accept', by: 'Intent' },
  close: { status: 'done', assignee: 'Core', stage: 'close', by: 'Intent' },
};
// The stage keys of §6 card-and-board.md - the same closed list the route-stage check keeps; --stage takes no others.
const STAGE_KEYS = ['card', 'approve', 'kit', 'exec', 'check', 'accept', 'close'];

// One frontmatter field by key, whole-value; no field - a stop (fail-closed), shared by both call forms.
const setField = (src, key, val) => {
  const re = new RegExp('^' + key + ':.*$', 'm');
  if (!re.test(src)) die(msg('board.card-move.no_field', { key }));
  return src.replace(re, `${key}: ${val}`);
};

// The card code: "NNN"|"card-NNN" → the short "card-NNN" (normalize); "card-NNN-slug" → the full code; otherwise null.
function cardCode(word) {
  const s = String(word || '').trim();
  if (/^(?:card-)?\d+$/.test(s)) return normalize(s);
  return /^card-\d+-.+$/.test(s) ? s : null;
}

/** The unified card sampling by code - an exact number, fail-closed under ambiguity:
 *  the full code card-NNN-slug - the exact file name, exactly one; a short number - the exact name or one prefix,
 *  only with a single candidate; two or more - `{ ambiguous: [relative paths] }`, the caller
 *  refuses with the list of candidates before any write. Only reads, writes nothing. */
function resolveCardFiles(root, cid) {
  const cands = /^card-\d+$/.test(cid)
    ? cardFiles(root, (n) => n === cid + '.md' || (n.startsWith(cid + '-') && n.endsWith('.md')))
    : cardFiles(root, (n) => n === cid + '.md');
  if (cands.length === 1) return { file: cands[0] };
  if (cands.length > 1) return { ambiguous: cands.map((f) => path.relative(root, f).replace(/\\/g, '/')) };
  return {};
}

const dieAmbiguous = (cid, rels) =>
  die(msg('board.card-move.ambiguous', { cid, rels: rels.join('\n  ') }));

/** 6b. The dashboard cache invalidation / recalculation at a card update - shared by both call forms. */
function refreshDashboardCache() {
  try {
    const cacheFile = path.join(ROOT, '.forma', 'dashboard', '.cache', 'data.json');
    if (fs.existsSync(cacheFile)) {
      let rebuilt = false;
      const candidates = [
        path.join(ROOT, '.forma', 'dashboard', 'generate.js'),
        path.resolve(__dirname, '../dashboard/generate.js'),
      ];
      for (const genFile of candidates) {
        if (fs.existsSync(genFile)) {
          try {
            const { buildData } = require(genFile);
            const data = buildData(ROOT);
            fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf8');
            rebuilt = true;
            break;
          } catch {}
        }
      }
      if (!rebuilt) {
        fs.rmSync(cacheFile, { force: true });
      }
    }
  } catch {}
}

// ---- --selftest: the sampling gauges in the OS temp directory (after the model of goal-freeze.cjs) -----------

function selftest() {
  const base = process.env.FORMA_TEST_TMP && fs.existsSync(process.env.FORMA_TEST_TMP) ? process.env.FORMA_TEST_TMP : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(base, 'card-move-'));
  const results = [];
  const check = (name, cond) => results.push({ ok: !!cond, name });
  // the fixture codes are assembled on the fly (the dynamic fixture-code convention): a literal card-NNN in a clean zone flags the scanner
  const probe = (n) => ['card', String(n)].join('-');
  const LIVE = probe(901) + '-zhivaya-proba', DONE = probe(901) + '-zakrytaya-proba', UNIQUE = probe(902) + '-unikalnaya-proba';
  const mk = (name) => `---\nid: "${name}"\nstatus: "todo"\n---\n\n# ${name}\n\n## Task\na sampling probe.\n\n## History\n\n## Result\n`;
  const board = path.join(dir, '.devtool', 'features');
  const snap = () => [board, path.join(board, 'done')].flatMap((d) => fs.existsSync(d)
    ? fs.readdirSync(d).filter((n) => n.endsWith('.md')).map((n) => n + ':' + fs.readFileSync(path.join(d, n), 'utf8')) : []).join('#');
  try {
    fs.mkdirSync(path.join(board, 'done'), { recursive: true });
    fs.writeFileSync(path.join(board, LIVE + '.md'), mk(LIVE));
    fs.writeFileSync(path.join(board, 'done', DONE + '.md'), mk(DONE));
    fs.writeFileSync(path.join(board, UNIQUE + '.md'), mk(UNIQUE));
    // (a) the full code resolves among prefix-colliding names
    const ra = resolveCardFiles(dir, DONE);
    check('(a) the full code with a number collision - exactly the done file', !!ra.file && path.basename(ra.file, '.md') === DONE);
    const ra2 = resolveCardFiles(dir, LIVE);
    check('(a) the full code alive - exactly the live file', !!ra2.file && path.basename(ra2.file, '.md') === LIVE);
    // (b) a short number with two candidates - a refusal with the list
    const rb = resolveCardFiles(dir, probe(901));
    check('(b) a short number under a collision - a refusal with the list', !!rb.ambiguous && rb.ambiguous.length === 2);
    check('(b) the list holds both paths - the live one and done', !!rb.ambiguous && rb.ambiguous.some((p) => p.endsWith(LIVE + '.md')) && rb.ambiguous.some((p) => p.endsWith(DONE + '.md')));
    // (c) a unique short number - resolves as before
    const rv = resolveCardFiles(dir, probe(902));
    check('(c) a short unique one resolves', !!rv.file && path.basename(rv.file, '.md') === UNIQUE);
    // (d) the refusal writes nothing
    const before = snap();
    resolveCardFiles(dir, probe(901));
    check('(d) the refusal writes nothing - the dummy board unchanged', snap() === before);
    // (e) an unknown number - an empty sampling (the call dies "not on the board")
    const rd = resolveCardFiles(dir, probe(500));
    check('(e) an unknown number - no candidates', !rd.file && !rd.ambiguous);
    // (f) the five-field approval (§6, route-labels.cjs): route-0…5 without the Intent line is flagged,
    // with the line passes; route-6…8 carry no approval condition.
    const { run: routeRun } = require('./checks/route-labels.cjs');
    const rroot = path.join(dir, 'routes');
    const rboard = path.join(rroot, '.devtool', 'features');
    fs.mkdirSync(rboard, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const mkRoute = (name, route, approved) => '---\nid: "' + name + '"\nstatus: "todo"\ncreated: "' + new Date().toISOString() + '"\nlabels: ["goal-x", "' + route + '"]\n---\n\n# ' + name + '\n\n## Task\na sampling probe.\n\n## History\n' + (approved ? '- `Intent`, ' + day + ': the human approved the five fields - the route is unlocked.\n' : '') + '\n## Result\n';
    fs.writeFileSync(path.join(rboard, probe(911) + '-r2-no.md'), mkRoute(probe(911) + '-r2-no', 'route-2', false));
    fs.writeFileSync(path.join(rboard, probe(912) + '-r2-ok.md'), mkRoute(probe(912) + '-r2-ok', 'route-2', true));
    fs.writeFileSync(path.join(rboard, probe(913) + '-r7-no.md'), mkRoute(probe(913) + '-r7-no', 'route-7', false));
    const rp = (num) => routeRun({ root: rroot, since: new Date(Date.now() - 864e5 * 365).toISOString().slice(0, 10) }).filter((p) => p.includes(probe(num)));
    check('(f) route-2 without the approval line - flagged', rp(911).length > 0);
    check('(f) route-2 with the approval line - green', rp(912).length === 0);
    check('(f) route-7 without the approval - untouched', rp(913).length === 0);
    // (g) the attempt budget (§3): only the executor's lines count, the Task field parses, the gate blocks and lets through
    const mkHist = (m) => Array.from({ length: m }, (_, i) => '- `Run`, ' + day + ': attempt, 100 tokens (10 cache-read), 5 s, "id-' + i + '" - a pass.').join('\n');
    const mixed = mkHist(2) + '\n- `Kit`, ' + day + ': attempt, 100 tokens (10 cache-read), 5 s, "id-k" - a pass.'
      + '\n- `Plumb`, ' + day + ': attempt, 100 tokens (10 cache-read), 5 s, "id-p" - a reading.'
      + '\n- `Kit`, ' + day + ': stage kit - x.';
    check('(g) the executor attempts are counted', attemptsIn(mixed, 'Run') === 2);
    check('(g) another node\'s passes are not the executor\'s attempts', attemptsIn(mixed, 'Kit') === 1);
    check('(g) the fixture holds four attempt lines in all', attemptsIn(mixed) === 4);
    check('(g) the executor follows the route-4 label', executorOf(['goal-x', 'route-4']) === 'Kit');
    check('(g) the executor follows the route-2 label', executorOf(['goal-x', 'route-2']) === 'Run');
    check('(g) the budget is parsed from the Task row', budgetOf('901 · tooling | a probe | check: true | 2 | core') === 2);
    check('(g) no number in the budget field - no gate', budgetOf('901 · tooling | a probe | check: true | core') === null);
    check('(g) the gate blocks at the budget', budgetGate({ attempts: 2, budget: 2 }) === 'block');
    check('(g) the gate passes under the budget', budgetGate({ attempts: 1, budget: 2 }) === 'pass');
    check('(g) no budget declared - no gate', budgetGate({ attempts: 9, budget: null }) === 'pass');
    // (h) the gate hash: stable for one criterion, different for another, none without five fields
    const gh = gateHashOf('901 · tooling | a probe | check: true | 2 | core');
    const gh2 = gateHashOf('901 · tooling | a probe | check: false | 2 | core');
    check('(h) the gate hash is recorded', !!gh && /^[a-f0-9]{16}$/.test(gh.hash));
    check('(h) a changed criterion has another hash', !!gh && !!gh2 && gh.hash !== gh2.hash);
    check('(h) no five fields - no gate hash', gateHashOf('901 · tooling | a probe') === null);
    check('(h) the last recorded hash wins', lastGateHash('- `Kit`, ' + day + ': x (gate-hash: aaaaaaaa)\n- `Intent`, ' + day + ': y (gate-hash: bbbbbbbb)') === 'bbbbbbbb');
    // (i) the pre-write gate: the prospective stage must fit the prospective status
    const probeText = (status, st) => '---\nstatus: "' + status + '"\n---\n- `Intent`, ' + day + ': route route-2 (why: tooling).\n- `Intent`, ' + day + ': stage ' + st + '.';
    check('(i) the pre-write gate catches a stage/status mismatch', routeStageProblems('probe.md', probeText('review', 'approve')).length === 1);
    check('(i) the pre-write gate passes a matching stage', routeStageProblems('probe.md', probeText('review', 'accept')).length === 0);
    // (j) the epic volume at acceptance (§3, `k:volume`): the done/Core counter per epic and the acceptance stop
    const vroot = path.join(dir, 'volume');
    const vboard = path.join(vroot, '.devtool', 'features');
    const vDone = path.join(vboard, 'done');
    fs.mkdirSync(vDone, { recursive: true });
    const mkVol = (n, epic, status, assignee) => '---\nid: "' + n + '"\nstatus: "' + status + '"\nassignee: "' + assignee + '"\nepic: "' + epic + '"\n---\n\n# ' + n + '\n\n## Task\na volume probe.\n\n## History\n\n## Result\n';
    for (let i = 0; i < 25; i++) fs.writeFileSync(path.join(vDone, probe(920) + '-vol-' + i + '.md'), mkVol(probe(920) + '-vol-' + i, 'lane-a', 'done', 'Core'));
    const vClosed = probe(921) + '-vol-closed';
    fs.writeFileSync(path.join(vDone, vClosed + '.md'), mkVol(vClosed, 'lane-a', 'done', 'null'));
    fs.writeFileSync(path.join(vboard, probe(922) + '-vol-live.md'), mkVol(probe(922) + '-vol-live', 'lane-a', 'review', 'Intent'));
    const vOther = probe(923) + '-vol-other';
    fs.writeFileSync(path.join(vDone, vOther + '.md'), mkVol(vOther, 'lane-b', 'done', 'Core'));
    check('(j) the counter reads only the epic\'s done/Core cards', doneCoreCount(vDone, 'lane-a') === 25);
    check('(j) a closed cycle (assignee null) is not counted', doneCoreCount(vDone, 'lane-a') === 25 && fs.existsSync(path.join(vDone, vClosed + '.md')));
    check('(j) a live card of the epic is not counted', fs.existsSync(path.join(vboard, probe(922) + '-vol-live.md')) && doneCoreCount(vDone, 'lane-a') === 25);
    check('(j) another epic counts on its own', doneCoreCount(vDone, 'lane-b') === 1);
    check('(j) at the threshold the acceptance is blocked', acceptVolumeGate({ count: 25, volume: 25 }) === 'block');
    check('(j) over the threshold the acceptance is blocked', acceptVolumeGate({ count: 26, volume: 25 }) === 'block');
    check('(j) under the threshold the acceptance passes', acceptVolumeGate({ count: 24, volume: 25 }) === 'pass');
    check('(j) no declared threshold - no gate', acceptVolumeGate({ count: 99, volume: null }) === 'pass');
    const failed = results.filter((r) => !r.ok);
    console.log((failed.length ? '✗ ' : '✓ ') + (failed.length
      ? 'mismatch: ' + failed.map((r) => r.name).join('; ')
      : 'the gauges green, ' + results.length + ' probes: the exact sampling, the five-field approval over route-0…5, the executor-only attempt budget, the gate hash, the pre-write gate, the acceptance volume'));
    return failed.length === 0;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
/** The body of a zone by its key: from under the heading line to the next `## ` heading - the same
 *  slice the History appends use; localized headings are resolved by the dictionary (zoneHeadingIn). */
function zoneText(src, key) {
  const zh = zoneHeadingIn(src, key);
  if (!zh) return '';
  const ls = src.split('\n');
  const at = ls.findIndex((l) => l.replace(/\r$/, '') === '## ' + zh);
  if (at < 0) return '';
  let end = ls.length;
  for (let k = at + 1; k < ls.length; k++) if (ls[k].startsWith('## ')) { end = k; break; }
  return ls.slice(at + 1, end).join('\n');
}
/** The executor by the route label (§2): route-4 - Kit, route-0/1 - Intent, the rest - Run. */
function executorOf(labels) {
  const l = Array.isArray(labels) ? labels : [];
  if (l.includes('route-4')) return 'Kit';
  if (l.includes('route-0') || l.includes('route-1')) return 'Intent';
  return 'Run';
}
/** The attempt lines of a History zone: `- ` + "Node" + `, YYYY-MM-DD: attempt, ...` - one pass of a task each (§3).
 *  With a node - only that executor's passes; Plumb readings and other nodes' lines are not the card's attempts. */
function attemptsIn(hist, node = null) {
  const re = /^-\s*`(\w+)`,\s*\d{4}-\d{2}-\d{2}:\s*attempt,/;
  return String(hist).split('\n').filter((l) => {
    const m = l.match(re);
    return m && (!node || m[1] === node);
  }).length;
}
/** The attempt budget: the 4th field of the Task row (`N · kind | what | criterion | budget | next`); no number - no gate. */
function budgetOf(task) {
  const row = String(task).split('\n').map((s) => s.trim()).find((l) => l && !l.startsWith('#') && l.includes('|'));
  if (!row) return null;
  const f = row.split('|').map((s) => s.trim());
  return f.length >= 4 && /^\d+$/.test(f[3]) ? Number(f[3]) : null;
}
/** The gate: at the used-up budget the pass is blocked; --override is the caller's decision, handled by the caller. */
function budgetGate({ attempts, budget }) {
  return budget != null && attempts >= budget ? 'block' : 'pass';
}
/** The epic's cards already accepted, waiting for `Core`: `done` with `assignee: "Core"` in done/ — the cycle's
 *  count (§3, counted per epic). One reading for both the acceptance stop and the informational close line. */
function doneCoreCount(doneDir, epic) {
  let count = 0;
  if (!fs.existsSync(doneDir)) return count;
  for (const f of fs.readdirSync(doneDir)) {
    if (!f.endsWith('.md')) continue;
    try {
      const cText = fs.readFileSync(path.join(doneDir, f), 'utf8');
      const cBlock = frontmatterBlock(cText) || '';
      const cEpic = (cBlock.match(/^epic:\s*"(.+?)"/m) || [])[1];
      const cAssignee = (cBlock.match(/^assignee:\s*"?(.+?)"?\s*$/m) || [])[1];
      const cStatus = (cBlock.match(/^status:\s*"(.+?)"/m) || [])[1];
      if (cEpic === epic && cStatus === 'done' && cAssignee === 'Core') count++;
    } catch {}
  }
  return count;
}
/** The acceptance stop at the epic's volume (§3, `k:volume`): at or over the threshold the card waits — the cycle
 *  closes first (`--to core-close`), the next acceptance goes after; below it the move goes on as before.
 *  No declared threshold — no gate: a number is never assumed here. */
function acceptVolumeGate({ count, volume }) {
  return volume != null && count >= volume ? 'block' : 'pass';
}
/** The hash of the readiness criterion (field 3 of the five-fields line); no five fields - null. */
function gateHashOf(taskText) {
  const line = String(taskText).split('\n').map((s) => s.trim()).find((l) => /^\d+\s*[·•]/.test(l));
  if (!line) return null;
  const parts = line.split('|').map((s) => s.trim());
  if (parts.length < 5) return null;
  return { criterion: parts[2], hash: crypto.createHash('sha256').update(parts[2]).digest('hex').slice(0, 16) };
}
/** The recorded gate hash: the last `gate-hash: <hex>` in History, or null. */
function lastGateHash(hist) {
  const matches = [...String(hist).matchAll(/gate-hash:\s*([a-f0-9]{8,64})/gi)];
  return matches.length ? matches[matches.length - 1][1] : null;
}
/** --gate-hash: present - an 8-64 hex value, allowed only in the named scopes; absent - null. */
function gateHashArg(allowed) {
  const v = arg('gate-hash');
  if (process.argv.includes('--gate-hash') && (v == null || v === '')) die(msg('board.card-move.gate_hash_need'));
  if (v != null && !/^[a-f0-9]{8,64}$/i.test(v)) die(msg('board.card-move.gate_hash_bad', { v }));
  if (v != null && !allowed) die(msg('board.card-move.gate_hash_scope'));
  return v == null ? null : v.toLowerCase();
}
/** The pre-write gate: the route and stage of the prospective card, under the same rule date as the board check. */
function preWriteStageProblems(name, text) {
  const { ruleSince } = require('../dashboard/lib/rules.cjs');
  const since = ruleSince(ROOT, 'route-stage');
  if (!since || createdDay(text) < since) return [];
  return routeStageProblems(name, text);
}
if (process.argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);

const id = cardCode(cli.positional()[0]);
const to = arg('to');
let note = arg('note');
const stage = arg('stage');

/** The early spend-parity check (ledger-parity) over the named cards, before any write:
 *  `problems` - a numeric drift of the line from the journal (it stops the handover before the status mutation),
 *  `notes` - "the journal does not cover" (a summary, not a barrier). `extraRows` - the spend lines not yet
 *  on the board (the line this handover itself will append). */
function preWriteParity(ids, extraRows = []) {
  const { run: parityRun } = require('./checks/ledger-parity.cjs');
  const { ruleSince } = require('../dashboard/lib/rules.cjs');
  const info = [];
  const found = parityRun({ root: ROOT, since: ruleSince(ROOT, 'ledger-parity'), info, extraRows });
  const mine = (list) => list.filter((p) => ids.some((cid) => p.includes(cid)));
  return { problems: mine(found), notes: mine(info) };
}

// Closing the cycle (`Core`): --to core-close <NNN…> --note "<the grounds>" - on every named card the line "closed - …" and assignee: null.
// The cards are already in done/ with assignee "Core"; the status and the other fields do not change. Any wrong number - a stop before the first write.
if (to === 'core-close') {
  const words = [];
  for (let i = 0; i < cli.argv.length; i++) {
    if (cli.argv[i] === '--dry') continue;
    if (cli.argv[i].startsWith('--')) { i++; continue; }
    words.push(cli.argv[i]);
  }
  const ids = words.map(cardCode);
  if (!ids.length || ids.some((x) => !x)) die(msg('board.card-move.coreclose_need_ids'));
  if (!note || /[\n]/.test(note)) die(msg('board.card-move.need_note_reason'));
  if (['kit', 'result', 'session-spend', 'tokens', 'duration-ms', 'agent-id', 'stage', 'gate-hash'].some((k) => process.argv.includes('--' + k))) die(msg('board.card-move.coreclose_no_other_flags'));
  const day0 = new Date().toISOString().slice(0, 10);
  const plan = [];
  for (const cid of ids) {
    const found = resolveCardFiles(ROOT, cid);
    if (found.ambiguous) dieAmbiguous(cid, found.ambiguous);
    if (!found.file) die(msg('board.card-move.no_card_nowrite', { cid }));
    if (plan.some((p) => p.cid === path.basename(found.file, '.md'))) die(msg('board.card-move.twice_nowrite', { cid }));
    const f0 = found.file;
    const cid0 = path.basename(f0, '.md');
    let tx = fs.readFileSync(f0, 'utf8');
    const fm0 = parseFrontmatter(tx);
    if (fm0.status !== 'done' || fm0.assignee !== 'Core') die(msg('board.card-move.need_done_core', { cid0, status: fm0.status, assignee: fm0.assignee }));
    const zh = zoneHeadingIn(tx, 'history');
    if (!zh) die(msg('board.card-move.no_history_zone_nowrite', { cid0 }));
    const hAt = tx.indexOf('\n## ' + zh);
    const zr = zoneHeadingIn(tx, 'result');
    const rAt = zr ? tx.indexOf('\n## ' + zr, hAt + 1) : -1;
    const hEnd = rAt === -1 ? tx.length : rAt;
    const hb = tx.slice(hAt, hEnd).replace(/\s*$/, '');
    tx = tx.slice(0, hAt) + hb + '\n- `Core`, ' + day0 + ': closed — ' + note.replace(/\.?\s*$/, '.') + '\n' + (rAt === -1 ? '' : tx.slice(rAt));
    if (!/^assignee:.*$/m.test(tx)) die(msg('board.card-move.no_assignee_field_nowrite', { cid0 }));
    tx = tx.replace(/^assignee:.*$/m, 'assignee: null');
    plan.push({ cid: cid0, file: f0, text: tx, before: fs.readFileSync(f0, 'utf8') });
  }
  // The early parity check - before the write: a numeric drift stops the closing, "the journal does not cover" - a summary.
  {
    const gate = preWriteParity(plan.map((p) => p.cid));
    if (gate.problems.length) die(msg('board.card-move.close_stopped_parity', { problems: gate.problems.join('\n') }));
    if (gate.notes.length) console.error(gate.notes.map((n) => '· ' + n).join('\n'));
  }
  if (flag('dry')) { for (const p of plan) console.log(path.relative(ROOT, p.file).replace(/\\/g, '/') + '\n' + p.text); process.exit(0); }
  const restore = () => { for (const p of plan) { try { fs.writeFileSync(p.file, p.before); } catch {} } };
  try {
    for (const p of plan) fs.writeFileSync(p.file, p.text);
    const bad = checkBoard(ROOT).filter((p) => plan.some((q) => p.includes(q.cid)));
    if (bad.length) {
      restore();
      console.error(msg('board.card-move.close_rolled_back', { problems: bad.join('\n') }));
      process.exit(1);
    }
  } catch (e) {
    restore();
    throw e;
  }
  for (const p of plan) console.log(msg('board.card-move.closed_ok', { cid: p.cid }));
  process.exit(0);
}

// The stage key: a closed list of seven (§6); with --to the key must match the target's stage - one call
// writes one stage line; an unknown key or a mismatch - a stop before any write.
if (process.argv.includes('--stage') && (stage == null || stage === '')) die(msg('board.card-move.stage_need_key', { keys: STAGE_KEYS.join('|') }));
if (stage != null && !STAGE_KEYS.includes(stage)) die(msg('board.card-move.bad_stage', { stage, keys: STAGE_KEYS.join('|') }));
if (stage != null && to != null) {
  if (!TARGETS[to]) die(msg('board.card-move.bad_to', { to, targets: Object.keys(TARGETS).join('|') }));
  if (stage !== TARGETS[to].stage) die(msg('board.card-move.stage_to_mismatch', { stage, to, target: TARGETS[to].stage }));
}

// --stage without --to: the stage line only (§6 card-and-board.md), no move - the status, the assignee and
// completedAt do not change; --node names whose line it is (the table §7 does not cover a no-move call);
// the spend and section flags belong to the moves - not accepted; the text after the dash is mandatory.
if (stage != null && !to) {
  const otherFlags = ['kit', 'result', 'session-spend', 'tokens', 'duration-ms', 'agent-id'].some((k) => process.argv.includes('--' + k));
  if (otherFlags || (process.argv.includes('--gate-hash') && stage !== 'approve')) die(msg('board.card-move.stage_no_other_flags'));
  const ghArg = gateHashArg(stage === 'approve');
  if (!id) die(msg('board.card-move.need_card_stage'));
  if (!note || /[\n]/.test(note)) die(msg('board.card-move.need_note'));
  const snode = arg('node');
  if (!snode) die(msg('board.card-move.stage_need_node'));
  if (!/^[A-Za-z]\w*$/.test(snode)) die(msg('board.card-move.bad_node', { node: snode }));
  const foundS = resolveCardFiles(ROOT, id);
  if (foundS.ambiguous) dieAmbiguous(id, foundS.ambiguous);
  if (!foundS.file) die(msg('board.card-move.no_card', { id }));
  const fileS = foundS.file;
  if (path.dirname(fileS) !== BOARD) die(msg('board.card-move.in_done', { id }));
  const cardIdS = path.basename(fileS, '.md');
  let textS = fs.readFileSync(fileS, 'utf8');
  const originalTextS = textS;
  if (stage === 'approve') {
    const gh = gateHashOf(zoneText(textS, 'task'));
    if (!gh) {
      if (ghArg) die(msg('board.card-move.gate_hash_no_five', { id: cardIdS }));
    } else {
      if (ghArg && ghArg !== gh.hash) die(msg('board.card-move.gate_hash_mismatch', { id: cardIdS, got: ghArg, expected: gh.hash }));
      if (!/gate-hash:/i.test(zoneText(textS, 'history')) && !/gate-hash:/i.test(note)) note = `${note} (gate-hash: ${gh.hash})`;
    }
  }
  const nowS = new Date().toISOString();
  textS = setField(textS, 'modified', `"${nowS}"`);
  const zoneHist = zoneHeadingIn(textS, 'history');
  const zoneRes = zoneHeadingIn(textS, 'result');
  if (!zoneHist) die(msg('board.card-move.no_history_zone'));
  const dayS = nowS.slice(0, 10);
  const lineS = `- \`${snode}\`, ${dayS}: stage ${stage} — ${note.replace(/\.?\s*$/, '.')}`;
  const histAt = textS.indexOf('\n## ' + zoneHist);
  const resAt = zoneRes ? textS.indexOf('\n## ' + zoneRes, histAt + 1) : -1;
  const histEnd = resAt === -1 ? textS.length : resAt;
  const body = textS.slice(histAt, histEnd).replace(/\s*$/, '');
  textS = textS.slice(0, histAt) + body + '\n' + lineS + '\n' + (resAt === -1 ? '' : textS.slice(resAt));
  const preS = preWriteStageProblems(cardIdS + '.md', textS);
  if (preS.length) die(msg('board.card-move.prewrite_red', { id: cardIdS, problems: preS.join('\n') }));
  if (flag('dry')) { console.log(path.relative(ROOT, fileS).replace(/\\/g, '/') + '\n' + textS); process.exit(0); }
  try {
    fs.writeFileSync(fileS, textS);
    const mine = checkBoard(ROOT).filter((p) => p.includes(cardIdS));
    if (mine.length) {
      fs.writeFileSync(fileS, originalTextS);
      refreshDashboardCache();
      console.error(msg('board.card-move.stage_rolled_back', { id: cardIdS, problems: mine.join('\n') }));
      process.exit(1);
    }
  } catch (e) {
    try { fs.writeFileSync(fileS, originalTextS); } catch {}
    refreshDashboardCache();
    throw e;
  }
  console.log(path.relative(ROOT, fileS).replace(/\\/g, '/'));
  refreshDashboardCache();
  console.log(`ok: ${cardIdS} · stage ${stage} (no move)`);
  process.exit(0);
}

if (!id || !to) die(msg('board.card-move.need_card_to', { targets: Object.keys(TARGETS).join('|') }));
if (!TARGETS[to]) die(msg('board.card-move.bad_to', { to, targets: Object.keys(TARGETS).join('|') }));
if (!note || /[\n]/.test(note)) die(msg('board.card-move.need_note'));
const t = TARGETS[to];


/** The engine tag by default: the adapter with the newest transcript; otherwise the only adapter; otherwise empty (--engine is needed). */
function activeEngineTag() {
  const E = require('../dashboard/lib/engines.cjs');
  const newest = (dir, depth) => {
    let t = 0;
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isFile()) t = Math.max(t, fs.statSync(f).mtimeMs);
        else if (e.isDirectory() && depth > 0) t = Math.max(t, newest(f, depth - 1));
      }
    } catch {}
    return t;
  };
  let best = null;
  for (const d of E.transcriptDirs(ROOT)) {
    const t = newest(d.dir, 2);
    if (t && (!best || t > best.t)) best = { t, tag: d.tag };
  }
  if (best) return best.tag;
  const tags = E.engineTags(ROOT);
  return tags.length === 1 ? tags[0].tag : '';
}

// The spend: --duration-ms and --agent-id are required; --tokens - the fallback value when the call's transcript is absent
const tokens = arg('tokens'), durationMs = arg('duration-ms'), agentId = arg('agent-id');
const cacheRead = arg('cache-read'), turns = arg('turns'), engine = arg('engine') || activeEngineTag();
const spendGiven = [tokens, durationMs, agentId].some((v) => v != null);
if (spendGiven) {
  if (durationMs == null || agentId == null) die(msg('board.card-move.spend_need_duration_agent'));
  const num = { ...(tokens != null && { tokens }), 'duration-ms': durationMs, ...(cacheRead != null && { 'cache-read': cacheRead }), ...(turns != null && { turns }) };
  for (const [k, v] of Object.entries(num)) if (!/^\d+$/.test(v)) die(msg('board.card-move.need_int', { k, v }));
  if (!/^[\w.:-]+$/.test(agentId)) die(msg('board.card-move.bad_agent_id', { agentId }));
  if (!engine) die(msg('board.card-move.no_engine'));
  if (!/^[a-z][\w-]*$/.test(engine)) die(msg('board.card-move.bad_engine_tag', { engine }));
}
// Without --tokens, N, R and O are read from the call's transcript: the adapter of the engine knows the layout and the step parsing
// (`findTranscript` → the adapter's `findSubagent`/`stepOf`; without `findSubagent` - the `agent-<id>.jsonl` layout over the sessions);
// read-only. The steps of one record are deduplicated by requestId (otherwise an overstatement).
// No transcript - N, R and O stay unknown with the reason in the description, not zero.
function readTranscript(agentId, tag) {
  const { findTranscript } = require('../dashboard/subagent-transcript.cjs');
  if (!/^[A-Za-z0-9_-]+$/.test(agentId)) return null;
  const found = findTranscript(agentId, ROOT, tag);
  if (!found || typeof found.parseUsage !== 'function') return null;
  let lines = [];
  try { lines = fs.readFileSync(found.file, 'utf8').split('\n'); } catch { return null; }
  const seen = new Set(), sum = { in: 0, write: 0, read: 0, out: 0 };
  let steps = 0;
  for (const ln of lines) {
    if (!found.stepOf && !ln.includes('cache_read_input_tokens')) continue;
    let j; try { j = JSON.parse(ln); } catch { continue; }
    let u, key;
    if (typeof found.stepOf === 'function') {
      let st = null;
      try { st = found.stepOf(j); } catch { st = null; }
      if (!st || !st.usage) continue;
      u = st.usage; key = st.requestId;
    } else {
      u = j.message && j.message.usage;
      if (!u || u.cache_read_input_tokens == null) continue;
      key = j.requestId || j.uuid;
    }
    if (key != null) { if (seen.has(key)) continue; seen.add(key); }
    const p = found.parseUsage(u);
    if (![p.tokens_in, p.tokens_out, p.cache_read, p.cache_write].every((x) => x != null && Number.isFinite(Number(x)))) return null;
    sum.in += Number(p.tokens_in); sum.write += Number(p.cache_write); sum.read += Number(p.cache_read); sum.out += Number(p.tokens_out);
    steps++;
  }
  return steps ? { input: sum.in, cacheCreate: sum.write, cacheRead: sum.read, output: sum.out } : null;
}
let fromTr = null, trWhy = '';
if (spendGiven && tokens == null) {
  fromTr = readTranscript(agentId, engine);
  if (!fromTr) trWhy = msg('board.card-move.tr_why');
}

// The sections: only on "their own" handovers, so the text does not land in the wrong zone
const kitText = arg('kit'), resultText = arg('result');
for (const [k, v] of [['kit', kitText], ['result', resultText]]) {
  if (process.argv.includes('--' + k) && (v == null || v === '')) die(msg('board.card-move.empty_value', { k }));
}
if (kitText != null && to !== 'run') die(msg('board.card-move.kit_only_run'));
if (resultText != null && to !== 'intent') die(msg('board.card-move.result_only_intent'));
if (kitText === '-' && resultText === '-') die(msg('board.card-move.one_stdin'));
const zoneBody = (v, what) => {
  const body = v === '-' ? fs.readFileSync(0, 'utf8') : v;
  if (!String(body).trim()) die(msg('board.card-move.empty_text', { what }));
  if (/^##\s/m.test(body)) die(msg('board.card-move.heading_line', { what }));
  return String(body).replace(/\r\n/g, '\n').replace(/\s+$/, '');
};
const kitBody = kitText != null ? zoneBody(kitText, 'kit') : null;
const resultBody = resultText != null ? zoneBody(resultText, 'result') : null;

// The main session's spend (`Intent`): the lines come from the engine adapter's script, the core knows no paths - it searches the adapters' scripts directory
const sessionSpendArg = arg('session-spend');
if (process.argv.includes('--session-spend') && (sessionSpendArg == null || sessionSpendArg === '')) die(msg('board.card-move.session_need_num'));
if (sessionSpendArg != null) {
  if (to !== 'accept' && to !== 'close') die(msg('board.card-move.session_only_accept_close'));
  if (!/^\d{1,4}$/.test(sessionSpendArg)) die(msg('board.card-move.session_bad_num', { v: sessionSpendArg }));
  if (sessionSpendArg.padStart(3, '0') !== id.replace(/^card-0*(\d+)(?:-.+)?$/, (m, d) => d.padStart(3, '0'))) die(msg('board.card-move.session_wrong_card', { v: sessionSpendArg, id }));
}
function sessionSpendLines(num) {
  const E = require('../dashboard/lib/engines.cjs');
  let script = null;
  for (const a of E.loadAdapters(ROOT)) {
    const f = path.join(ROOT, E.sourcesOf(a).scriptsDir, 'card-session-spend.cjs');
    if (fs.existsSync(f) && (!script || a.spendTag === engine || a.engine === engine)) script = f;
  }
  if (!script) die(msg('board.card-move.no_session_script'));
  const r = require('child_process').spawnSync(process.execPath, [script, num], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) die(msg('board.card-move.session_failed', { num, out: (r.stderr || r.stdout || msg('board.card-move.exit_code', { code: r.status })).trim() }));
  return r.stdout.split(/\r?\n/).filter((l) => l.startsWith('- '));
}

// 1. The card: only a live one - the unified sampling by the exact number, fail-closed under ambiguity
// PROJECT.md is read before any gate: the volume threshold (`k:volume`) is needed by the acceptance stop.
const projectMd = fs.readFileSync(projectFile(ROOT, 'PROJECT.md'), 'utf8');
const found = resolveCardFiles(ROOT, id);
if (found.ambiguous) dieAmbiguous(id, found.ambiguous);
if (!found.file) die(msg('board.card-move.no_card', { id }));
const file = found.file;
if (path.dirname(file) !== BOARD) die(msg('board.card-move.in_done', { id }));
const cardId = path.basename(file, '.md');

let text = fs.readFileSync(file, 'utf8');
const originalText = text;
const fm = parseFrontmatter(text);

// 1b. The attempt budget (§3, prohibition 3): only the executor's passes count; --to kit at the used-up budget
// is refused before any write. An explicit --override unlocks this one pass and writes the bypass line below.
const override = flag('override');
let budgetBlocked = false;
if (to === 'kit') {
  const executor = executorOf(labelsOf(text));
  const attempts = attemptsIn(zoneText(text, 'history'), executor);
  const budget = budgetOf(zoneText(text, 'task'));
  const exhausted = budgetGate({ attempts, budget }) === 'block';
  if (exhausted && !override) die(msg('board.card-move.budget_exhausted', { id: cardId, budget, attempts, executor }));
  budgetBlocked = exhausted && override;
}

// 1c. --gate-hash is scoped: the approval line or the first handover to execution.
const ghArg = gateHashArg(to === 'run');

// 1d. The epic's volume at acceptance (§3, `k:volume`): at or over the threshold the card waits before any write —
// the cycle closes first (`--to core-close`), the next acceptance comes after; below it the move goes as before.
// A card without an epic has no lane to count: no gate.
if (to === 'accept' && fm.epic) {
  const volume = i18n.rowNumber(projectMd, 'volume') ?? 25;
  const count = doneCoreCount(path.join(BOARD, 'done'), fm.epic);
  if (acceptVolumeGate({ count, volume }) === 'block') die(msg('board.card-move.accept_volume_stop', { id: cardId, epic: fm.epic, count, vol: volume }));
}

// 2. Who holds `run` (§7): by the route-N label - the short route (route-4) is executed by Kit, route-0/1 - by Intent
let assignee = t.assignee;
if (to === 'run') {
  const labels = labelsOf(text);
  if (labels.includes('route-4')) assignee = 'Kit';
  else if (labels.includes('route-0') || labels.includes('route-1')) assignee = 'Intent';

  // Gate integrity: the criterion's hash is recorded at the first handover to execution if approval did not.
  const gh = gateHashOf(zoneText(text, 'task'));
  if (!gh) {
    if (ghArg) die(msg('board.card-move.gate_hash_no_five', { id: cardId }));
  } else {
    if (ghArg && ghArg !== gh.hash) die(msg('board.card-move.gate_hash_mismatch', { id: cardId, got: ghArg, expected: gh.hash }));
    if (ghArg && !lastGateHash(zoneText(text, 'history')) && !/gate-hash:/i.test(note)) note = `${note} (gate-hash: ${gh.hash})`;
  }
}

// Gate integrity check on close: criterion must match the recorded hash unless gate-amendment was recorded.
if (to === 'close') {
  const gh = gateHashOf(zoneText(text, 'task'));
  const histText = zoneText(text, 'history') || '';
  if (gh) {
    const lastHash = lastGateHash(histText);
    if (lastHash && !gh.hash.startsWith(lastHash) && !lastHash.startsWith(gh.hash)) {
      if (!/gate-amendment/i.test(histText)) {
        die(msg('board.card-move.gate_hash_changed', { id: cardId, last: lastHash, current: gh.hash }));
      }
    } else if (!lastHash && !/gate-amendment/i.test(histText)) {
      // A legacy card may close without a hash; record the baseline and say so, never hide the gap.
      console.error(msg('board.card-move.gate_hash_missing', { id: cardId }));
      note = `${note} (gate-hash: ${gh.hash}, recorded at close)`;
    }
  }
}
// 3. Whose line: for `intent` - the one who executed, otherwise the node by the table
const node = arg('node') || (to === 'intent' && ['Run', 'Kit', 'Intent'].includes(fm.assignee) ? fm.assignee : t.by);
if (!/^[A-Za-z]\w*$/.test(node)) die(msg('board.card-move.bad_node', { node }));

// 4. The frontmatter edit: status, assignee, modified (+ completedAt on close)
const now = new Date().toISOString();
const day = now.slice(0, 10);
text = setField(text, 'status', `"${t.status}"`);
text = setField(text, 'assignee', `"${assignee}"`);
text = setField(text, 'modified', `"${now}"`);
if (to === 'close') text = setField(text, 'completedAt', `"${now}"`);

// 4b. The body of the "Kit" / "Result" zone - the heading is searched by the anchor or by the dictionary, in any card language
const setZone = (src, key, body) => {
  const head = i18n.headingRe('zone.' + key, '');
  const lines = src.split('\n');
  const i = lines.findIndex((l) => head.test(l.replace(/\r$/, '')));
  if (i < 0) die(msg('board.card-move.no_zone', { key }));
  let end = lines.findIndex((l, k) => k > i && l.startsWith('## '));
  if (end < 0) end = lines.length;
  return lines.slice(0, i + 1).concat(['', ...body.split('\n'), ''], lines.slice(end)).join('\n');
};
if (kitBody != null) text = setZone(text, 'kit', kitBody);
if (resultBody != null) text = setZone(text, 'result', resultBody);

// 5. The stage line - to the end of the "History" zone (before the result zone)
const zoneHist = zoneHeadingIn(text, 'history');
const zoneRes = zoneHeadingIn(text, 'result');
if (!zoneHist) die(msg('board.card-move.no_history_zone'));
const line = `- \`${node}\`, ${day}: stage ${t.stage} — ${note.replace(/\.?\s*$/, '.')}`;
const histAt = text.indexOf('\n## ' + zoneHist);
const resAt = zoneRes ? text.indexOf('\n## ' + zoneRes, histAt + 1) : -1;
const histEnd = resAt === -1 ? text.length : resAt;
const body = text.slice(histAt, histEnd).replace(/\s*$/, '');
const n = note.replace(/\.?\s*$/, '.');
const bypass = budgetBlocked ? `\n- \`${node}\`, ${day}: budget override — ${n}` : '';
const spend = !spendGiven ? '' : formatSpendLine({
  node, date: day,
  tokens: fromTr ? fromTr.input + fromTr.cacheCreate + fromTr.cacheRead + fromTr.output : (tokens != null ? Number(tokens) : null),
  cache_read: cacheRead != null ? Number(cacheRead) : (fromTr ? fromTr.cacheRead : null),
  tokens_out: fromTr ? fromTr.output : undefined,
  duration_s: Math.round(Number(durationMs) / 1000), turns: turns != null ? Number(turns) : undefined,
  call_id: agentId, engine, desc: n + (cacheRead != null || fromTr || trWhy ? '' : msg('board.card-move.cache_read_unknown')) + trWhy,
}).replace(/^/, '- ') + '\n';
const sessionLines = sessionSpendArg == null ? '' : sessionSpendLines(sessionSpendArg.padStart(3, '0'))
  .filter((l) => !text.includes(l.split(' — ')[0])).map((l) => l + '\n').join('');
text = text.slice(0, histAt) + body + '\n' + spend + sessionLines + line + bypass + '\n' + (resAt === -1 ? '' : text.slice(resAt));

// 5b. The pre-write gate: the prospective card's route and stage are judged before any mutation.
const pre = preWriteStageProblems(cardId + '.md', text);
if (pre.length) die(msg('board.card-move.prewrite_red', { id: cardId, problems: pre.join('\n') }));

// 5c. The early spend-parity check - before the write and before --dry: a numeric drift of the line from the journal
// stops the handover before the status mutation (the exit not after the write); "the journal does not cover" - a summary, not a barrier.
{
  const extraRows = [];
  if (spend) extraRows.push({ file: cardId + '.md', line: spend });
  for (const l of sessionLines.split('\n').filter(Boolean)) extraRows.push({ file: cardId + '.md', line: l });
  const gate = preWriteParity([cardId], extraRows);
  if (gate.problems.length) die(msg('board.card-move.move_stopped_parity', { problems: gate.problems.join('\n') }));
  if (gate.notes.length) console.error(gate.notes.map((n) => '· ' + n).join('\n'));
}

// 6. The write; on close the file goes to done/ (the board extension does it itself, without it - we).
// The move is committed only if the board check over the written card is green; otherwise the card is restored,
// so a failed handover never leaves a broken state behind.
const target = to === 'close' ? path.join(BOARD, 'done', cardId + '.md') : file;
if (target !== file && fs.existsSync(target)) die(msg('board.card-move.target_exists', { target: path.relative(ROOT, target).replace(/\\/g, '/') }));
if (flag('dry')) { console.log(path.relative(ROOT, target).replace(/\\/g, '/') + '\n' + text); process.exit(0); }
const rollback = () => {
  try { if (target !== file && fs.existsSync(target)) fs.rmSync(target, { force: true }); } catch {}
  try { fs.writeFileSync(file, originalText); } catch {}
  refreshDashboardCache();
};
if (target !== file) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.renameSync(file, target); }
try {
  fs.writeFileSync(target, text);
  // 7. The check over this card - before the move is reported as done
  const mine = checkBoard(ROOT).filter((p) => p.includes(cardId));
  if (mine.length) {
    rollback();
    console.error(msg('board.card-move.move_rolled_back', { id: cardId, problems: mine.join('\n') }));
    process.exit(1);
  }
} catch (e) {
  rollback();
  throw e;
}
console.log(path.relative(ROOT, target).replace(/\\/g, '/'));

// 6b. The dashboard cache invalidation / recalculation at a card update
refreshDashboardCache();
console.log(`ok: ${cardId} → ${t.status}/${assignee} · stage ${t.stage}`);

if (to === 'close') {
  const epic = fm.epic;
  if (epic) {
    // The informational line only (§3): the count is a reminder of the cycle, not a barrier — the barrier stands at `--to accept`.
    const cycleVol = i18n.rowNumber(projectMd, 'volume') ?? 25;
    const count = doneCoreCount(path.join(BOARD, 'done'), epic);
    const note = count >= cycleVol ? msg('board.card-move.cycle_time') : msg('board.card-move.cycle_accumulating');
    console.log(msg('board.card-move.cycle_line', { epic, count, vol: cycleVol, note }));
  }
  // The local backlog scan of the closed card (backlog.cjs's shared matcher): the Result's follow-up
  // observations are printed with the open-a-card hint - a reminder only; the move never aborts here,
  // even on an older install without the scanner.
  let followups = [];
  try { followups = zoneText(text, 'result').split('\n').map((l) => require('./backlog.cjs').followupTail(l)).filter(Boolean); } catch {}
  if (followups.length) {
    for (const l of followups) console.log(l);
    console.log(i18n.message('board.backlog.close_hint', {}, i18n.projectLang(ROOT)));
  }
}
