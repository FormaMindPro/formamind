#!/usr/bin/env node
// Creating a card on the .devtool/features/ board - without manually copying the epic name, the number and the template.
//
//   node .forma/board/new-card.cjs --kind <code> --title "<title>" [--goal goal-NN] [--type work|tooling|decision]
//                                     [--status backlog] [--assignee Intent] [--priority medium] [--lang ru|en] [--dry]
//                                     [--node <name>]
//                                     [--route N] [--over N]… [--seg N] [--wave N] [--after NNN]… [--trial] [--demo]
//                                     [--delivers "<what it gives>"] [--criterion "<criterion>"] [--budget "<attempts>"] [--next "<where next>"]
//                                     [--why <code>] [--why-detail "<a note>"] [--stage card|approve]
//   node .forma/board/new-card.cjs --quick "<title>" [--dry]
//                                     (fast incubator mode: kind=discussion, goal=goal-discussion, route=0,
//                                      creates card and materials folder project/cards/card-NNN/)
//
// --kind   - the kind code from PROJECT.md, "Project epics" (analytics, structure, protocol, resources, balance, discussion, channels, competencies, results).
//            The epic name is substituted exactly from the table - the `epic` field (AGENTS.md §7).
// --goal   - the goal label; by default the kind's main goal `goal-<code>` (AGENTS.md §6, exactly one label).
// --route/--over/--seg/--wave/--after/--trial - the route labels (AGENTS.md §6; ROUTES.md §9). --over and --after are repeatable.
// --demo  - the `demo` label: a card of the demonstration cycle (intent-demo.md); it does not go into the spend and the statistics, allowed under a goal draft.
// --delivers/--criterion/--budget/--next - the task fields (§6) right away, without editing the file after the write; an unset one stays the <…> blank.
// --why - the route reason (§6, the codes: human|ready|scale|risk|decision|tooling|plumb): writes into History the line `route route-N (why: …)`;
//            --stage - the line `stage <key>` (card - the task is written, approve - awaits the human's "yes"). Without the flag the line is not written.
// --node  - the node signing the history lines (the route reason, the stage); `Intent` by default - the cards
//            are opened by Intent (§7). A bare name only (`Intent`, `Run`); `9x` stops before any write.
// The number - the next free `card-NNN` over the board and done/. The zones - in the project language (§6).
// After the write - the core's board check (.forma/board/check-board.cjs) over this card; an error on it - exit code 1.
// Part of the core: one for all engines, it knows no engine paths.

const fs = require('fs');
const { projectFile } = require('../dashboard/lib/fs.cjs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeCli } = require('../dashboard/lib/cli.cjs');
const { cardFiles, zoneHeading } = require('../dashboard/lib/card.cjs');
const i18n = require('../i18n/index.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const BOARD = path.join(ROOT, '.devtool', 'features');
const msg = (key, params) => i18n.message(key, params, 'ru');

const cli = makeCli();
const { arg, flag, values: args } = cli;
const die = cli.die('new-card');

// 1. The epics from PROJECT.md
const projectMd = fs.readFileSync(projectFile(ROOT, 'PROJECT.md'), 'utf8');
const lanes = new Map();
for (const m of projectMd.matchAll(/^\|\s*`([a-z-]+)`\s*\|\s*([^|]+?)\s*\|/gm)) lanes.set(m[1], m[2]);
if (!lanes.size) die(msg('board.new-card.no_lanes'));

const quick = arg('quick');
const kind = arg('kind', quick ? 'discussion' : undefined);
const title = arg('title', quick);
if (!kind || !title) die(msg('board.new-card.need_kind', { codes: [...lanes.keys()].join(', ') }));
if (!lanes.has(kind)) die(msg('board.new-card.unknown_kind', { kind, codes: [...lanes.keys()].join(', ') }));
const epic = lanes.get(kind);

// 1c. Similar cards duplicate check (graph-based)
if (!flag('no-dup-check')) {
  const similar = checkDuplicates(title, ROOT);
  if (similar.length) {
    console.log('notice: found similar cards in the task graph:');
    for (const s of similar) console.log(`  · ${s.id} (${s.status || 'open'}) — ${s.label.slice(0, 75)}`);
    if (flag('strict-dup') && similar.some(s => s.matchCount >= 2) && !flag('force')) {
      die('potential duplicates found (pass --force to proceed)');
    }
  }
}

// 1b. The isolation gate (AGENTS.md §2, prohibitions 1 and 7)
// The probes file - every adapter has it in its folder (`<folder>/.state/capabilities.json`); the core walks the adapters, knowing no names.
const capFiles = require('../dashboard/lib/engines.cjs').loadAdapters(ROOT).map((a) => path.join(ROOT, a.dir, '.state', 'capabilities.json'));
for (const capFile of capFiles) {
  if (!fs.existsSync(capFile)) continue;
  try {
    const caps = JSON.parse(fs.readFileSync(capFile, 'utf8'));
    if (caps.isolation && caps.isolation.available === false && kind === 'channels' && !flag('force')) {
      die(msg('board.new-card.isolation_closed'));
    }
  } catch {}
}

// 2. The goal label
const goal = arg('goal', 'goal-' + kind);
if (!/^goal-(\d+|[a-z-]+)$/.test(goal)) die(msg('board.new-card.bad_goal', { goal }));
const goalsDir = path.join(ROOT, 'project', 'goals');
if (fs.existsSync(goalsDir) && !fs.readdirSync(goalsDir).some(d => d === goal || d.startsWith(goal + '-')))
  die(msg('board.new-card.no_goal_dir', { goal }));

// 2b. The route labels
const routeLabels = [];
let route = arg('route');
if (route === undefined && quick) route = '0';
if (route !== undefined) { if (!/^[0-8]$/.test(route)) die(msg('board.new-card.bad_route', { route })); routeLabels.push('route-' + route); }
for (const o of args('over')) { if (!/^[1-4]$/.test(o || '')) die(msg('board.new-card.bad_over', { o })); routeLabels.push('over-' + o); }
for (const k of ['seg', 'wave']) { const v = arg(k); if (v === undefined) continue; if (!/^[1-9]\d*$/.test(v)) die(msg('board.new-card.bad_natural', { k, v })); routeLabels.push(k + '-' + v); }
for (const a of args('after')) { const n = (a || '').replace(/^card-/, ''); if (!/^\d+$/.test(n)) die(msg('board.new-card.bad_after', { a })); routeLabels.push('after-card-' + n.padStart(3, '0')); }
if (flag('trial')) routeLabels.push('trial');
if (flag('demo')) routeLabels.push('demo');

// 3. Keys of a card are English whatever the project language is: zone headings (Task, Kit, History, Result) and the kind
// (work, tooling, decision). The project language shows only in texts (placeholders, history lines); --lang picks the placeholder language.
let lang = arg('lang');
const code = i18n.langCode((i18n.reader(projectMd).inline('language') || '').split(/\s+/)[0]);
if (!lang) lang = code === 'ru' ? 'ru' : 'en';
const Z = {
  task: zoneHeading('task'), kit: zoneHeading('kit'), hist: zoneHeading('history'), res: zoneHeading('result'),
  types: ['work', 'tooling', 'decision'],
};
const defaultType = quick ? 'work' : Z.types[kind === 'channels' ? 0 : 1];
const type = arg('type', defaultType);

const defaultDelivers = quick ? title : msg('board.new-card.ph_delivers');
const defaultCriterion = quick ? 'check: node .forma/board/check-board.cjs ; verdict: task discussion and acceptance by the human' : msg('board.new-card.ph_criterion');
const defaultBudget = quick ? '2' : msg('board.new-card.ph_budget');
const defaultNext = quick ? 'Intent: triage; human' : msg('board.new-card.ph_next');

const fields = [['delivers', defaultDelivers], ['criterion', defaultCriterion], ['budget', defaultBudget], ['next', defaultNext]]
  .map(([k, ph]) => { const v = arg(k); if (v !== undefined && /[|\n]/.test(v)) die(msg('board.new-card.bad_field_chars', { k })); return v || ph; });

// 3b. The history lines: the route reason and the stage (§6)
const WHY_CODES = ['human', 'ready', 'scale', 'risk', 'decision', 'tooling', 'plumb'];
const STAGE_KEYS = ['card', 'approve'];
let why = arg('why'), stage = arg('stage');
if (quick && why === undefined) why = 'human';
if (quick && stage === undefined) stage = 'card';

if (why !== undefined && !WHY_CODES.includes(why)) die(msg('board.new-card.bad_why', { why, codes: WHY_CODES.join('|') }));
if (stage !== undefined && !STAGE_KEYS.includes(stage)) die(msg('board.new-card.bad_stage', { stage, keys: STAGE_KEYS.join('|') }));
const routeLabel = routeLabels.find(l => l.startsWith('route-'));
if (why !== undefined && !routeLabel) die(msg('board.new-card.why_needs_route'));

// 4. The status and the assignee by the route (AGENTS.md §7): backlog holds Spec on production, on the other lanes - Intent
const noSpec = kind !== 'channels'; // Spec cuts only production (7); the other lanes are opened by Intent
const status = arg('status', 'backlog');
const assignee = arg('assignee', noSpec ? 'Intent' : 'Spec');
const priority = arg('priority', 'medium');

// 4b. The node signing the history lines (§6): whoever calls the script. `Intent` stays the default - the
// cards are opened by Intent (AGENTS.md §7). A bare name only (`Intent`, `Run`); `9x` stops before any write.
const node = arg('node', 'Intent');
if (!/^[A-Za-z]\w*$/.test(node)) die(msg('board.new-card.bad_node', { node }));

// 5. The number - chosen by what is actually on the disk at the moment of the write: the scan runs inside the
// write loop, and the write itself is an exclusive create (wx). A card appearing between the scan and the
// write (a concurrent invocation) fails wx, the loop re-scans and takes the next number - two files never
// share one number.
// The Cyrillic → latin transliteration for slugs; the keys by escapes - the gate guards this file too.
const TR = { '\u0430':'a','\u0431':'b','\u0432':'v','\u0433':'g','\u0434':'d','\u0435':'e','\u0451':'e','\u0436':'zh','\u0437':'z','\u0438':'i','\u0439':'j','\u043A':'k','\u043B':'l','\u043C':'m','\u043D':'n','\u043E':'o','\u043F':'p','\u0440':'r','\u0441':'s','\u0442':'t','\u0443':'u','\u0444':'f','\u0445':'h','\u0446':'c','\u0447':'ch','\u0448':'sh','\u0449':'sch','\u044A':'','\u044B':'y','\u044C':'','\u044D':'e','\u044E':'yu','\u044F':'ya' };
const slug = title.toLowerCase().split('').map(c => TR[c] ?? c).join('')
  .replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 50).replace(/-$/, '');
const now = new Date().toISOString();
const day = now.slice(0, 10);
const detail = arg('why-detail', quick ? 'quick incubator without project scanning' : undefined);
const history = [
  why !== undefined ? `- \`${node}\`, ${day}: route ${routeLabel} (why: ${why})${detail ? ' — ' + detail.replace(/\.?$/, '.') : '.'}` : '',
  stage !== undefined ? '- `' + node + '`, ' + day + ': stage ' + stage + msg('board.new-card.stage_created') : '',
].filter(Boolean).join('\n');

let num, id, file, text;
for (;;) {
  let max = 0;
  for (const f of cardFiles(ROOT, /^card-\d+/)) max = Math.max(max, +path.basename(f).match(/^card-(\d+)/)[1]);
  num = String(max + 1).padStart(3, '0');
  id = `card-${num}-${slug || 'task'}`;
  file = path.join(BOARD, id + '.md');
  text = `---
id: "${id}"
status: "${status}"
priority: "${priority}"
assignee: ${assignee === 'null' ? 'null' : `"${assignee}"`}
epic: "${epic}"
dueDate: null
created: "${now}"
modified: "${now}"
completedAt: null
labels: [${[goal, ...routeLabels].map(l => `"${l}"`).join(', ')}]
order: "a0"
---
# card-${num} · ${title}

## ${Z.task}
${num} · ${type} | ${fields.join(' | ')}

## ${Z.kit}

## ${Z.hist}
${history ? history + '\n' : ''}
## ${Z.res}
`;
  if (flag('dry')) break;
  fs.mkdirSync(BOARD, { recursive: true });
  try { fs.writeFileSync(file, text, { flag: 'wx' }); break; }
  catch (e) { if (e.code !== 'EEXIST') throw e; } // the number was taken in flight - re-scan
}
if (flag('dry')) { console.log(file + '\n' + text); process.exit(0); }
console.log(path.relative(ROOT, file).replace(/\\/g, '/'));

// Auto-create card materials folder for quick mode (or --materials flag)
if (quick || flag('materials')) {
  const cardDir = path.join(ROOT, 'project', 'cards', `card-${num}`);
  if (!fs.existsSync(cardDir)) {
    fs.mkdirSync(cardDir, { recursive: true });
    const draftFile = path.join(cardDir, 'draft.md');
    fs.writeFileSync(draftFile, `# card-${num} · ${title}\n\n## Input materials\n- Recorded: ${day}\n`);
  }
}

// 6. The check over this card
let out = '';
try { out = execFileSync(process.execPath, [path.join(__dirname, 'check-board.cjs'), id], { cwd: ROOT, encoding: 'utf8' }); }
catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
const mine = out.split('\n').filter(l => l.includes(id));
if (mine.length) { console.error(mine.join('\n')); process.exit(1); }
console.log(`ok: ${epic} · ${goal} · ${status}/${assignee}`);

// 7. Auto-update board task graph
if (!flag('no-graph')) updateBoardGraph(ROOT);

// --- Helpers: duplicate check and graph update ---
function checkDuplicates(targetTitle, root) {
  const STOP = new Set([
    '\u0432', '\u043D\u0430', '\u0438', '\u0434\u043B\u044F', '\u043F\u043E', '\u043A\u0430\u043A',
    '\u0441\u0434\u0435\u043B\u0430\u0442\u044C', '\u0441\u043E\u0437\u0434\u0430\u0442\u044C', '\u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C',
    '\u0438\u0437', '\u043F\u043E\u0434', '\u043D\u0430\u0434', '\u043F\u0440\u0438', '\u043F\u043E\u0441\u043B\u0435',
    '\u0438\u043B\u0438', '\u0447\u0442\u043E', '\u044D\u0442\u043E', '\u0432\u0441\u0435', '\u043F\u0440\u043E',
    '\u043D\u0435', '\u0436\u0435', '\u0442\u0430\u043A', 'card', '\u0437\u0430\u0434\u0430\u0447\u0430',
    '\u043D\u043E\u0432\u044B\u0439', '\u043D\u043E\u0432\u0430\u044F',
    'in', 'on', 'and', 'for', 'to', 'the', 'a', 'an', 'with', 'from', 'by', 'task', 'new'
  ]);
  const getStems = str => str.toLowerCase()
    .replace(/[^a-z\u0400-\u04FF0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOP.has(w))
    .map(w => w.slice(0, 5));

  const qStems = [...new Set(getStems(targetTitle))];
  if (!qStems.length) return [];

  const graphFile = path.join(root, '.forma', 'living', 'graphs', 'board', 'graph.json');
  let candidates = [];
  if (fs.existsSync(graphFile)) {
    try {
      const g = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
      candidates = (g.nodes || []).filter(n => n.type === 'card').map(n => ({ id: n.id, label: n.label || n.id, status: n.status || '' }));
    } catch {}
  }
  if (!candidates.length) {
    for (const f of cardFiles(root, /^card-\d+/)) {
      const base = path.basename(f, '.md');
      const m = base.match(/^(card-\d+)-(.*)/);
      candidates.push({ id: m ? m[1] : base, label: base, status: f.includes('done') ? 'done' : 'open' });
    }
  }

  const hits = [];
  for (const c of candidates) {
    const cStems = new Set(getStems(c.label || c.id));
    const common = qStems.filter(s => cStems.has(s));
    if (common.length >= 1) {
      hits.push({ id: c.id, label: c.label, status: c.status, matchCount: common.length });
    }
  }
  return hits.sort((a, b) => b.matchCount - a.matchCount).slice(0, 4);
}

function updateBoardGraph(root) {
  try {
    const buildScript = path.join(root, '.claude', 'scripts', 'build-kit-graphs.cjs');
    if (!fs.existsSync(buildScript)) return;
    const { build, sources } = require(buildScript);
    const outDir = path.join(root, '.forma', 'living', 'graphs');
    const cacheFile = path.join(outDir, '.kit-cache.json');
    const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
    const src = sources();
    if (src && src.board) {
      const res = build('board', src.board, cache, null);
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
      console.log(`graph: board updated (+${res.miss} parsed, ${res.nodes} nodes)`);
    }
  } catch (err) {}

  try {
    const autoGraphs = path.join(root, '.claude', 'scripts', 'auto-graphs.cjs');
    if (fs.existsSync(autoGraphs)) {
      require('child_process').spawn(process.execPath, [autoGraphs, 'touch'], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
  } catch {}
}
