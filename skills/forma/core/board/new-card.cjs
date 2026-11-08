#!/usr/bin/env node
// Creating a card on the .devtool/features/ board - without manually copying the epic name, the number and the template.
//
//   node .forma/board/new-card.cjs --kind <code> --title "<title>" [--goal goal-NN] [--type work|tooling|decision]
//                                     [--status backlog] [--assignee Intent] [--priority medium] [--lang ru|en] [--dry]
//                                     [--route N] [--over N]… [--seg N] [--wave N] [--after NNN]… [--trial] [--demo]
//                                     [--delivers "<what it gives>"] [--criterion "<criterion>"] [--budget "<attempts>"] [--next "<where next>"]
//                                     [--why <code>] [--why-detail "<a note>"] [--stage card|approve]
//
// --kind   - the kind code from PROJECT.md, "Project epics" (analytics, structure, protocol, resources, balance, discussion, channels, competencies, results).
//            The epic name is substituted exactly from the table - the `epic` field (AGENTS.md §7).
// --goal   - the goal label; by default the kind's main goal `goal-<code>` (AGENTS.md §6, exactly one label).
// --route/--over/--seg/--wave/--after/--trial - the route labels (AGENTS.md §6; ROUTES.md §9). --over and --after are repeatable.
// --demo  - the `demo` label: a card of the demonstration cycle (intent-demo.md); it does not go into the spend and the statistics, allowed under a goal draft.
// --delivers/--criterion/--budget/--next - the task fields (§6) right away, without editing the file after the write; an unset one stays the <…> blank.
// --why - the route reason (§6, the codes: human|ready|scale|risk|decision|tooling|plumb): writes into History the line `route route-N (why: …)`;
//            --stage - the line `stage <key>` (card - the task is written, approve - awaits the human's "yes"). Without the flag the line is not written.
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

const kind = arg('kind');
const title = arg('title');
if (!kind || !title) die(msg('board.new-card.need_kind', { codes: [...lanes.keys()].join(', ') }));
if (!lanes.has(kind)) die(msg('board.new-card.unknown_kind', { kind, codes: [...lanes.keys()].join(', ') }));
const epic = lanes.get(kind);

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
const route = arg('route');
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
const type = arg('type', Z.types[kind === 'channels' ? 0 : 1]);
const fields = [['delivers', 'board.new-card.ph_delivers'], ['criterion', 'board.new-card.ph_criterion'], ['budget', 'board.new-card.ph_budget'], ['next', 'board.new-card.ph_next']]
  .map(([k, ph]) => { const v = arg(k); if (v !== undefined && /[|\n]/.test(v)) die(msg('board.new-card.bad_field_chars', { k })); return v || msg(ph); });

// 3b. The history lines: the route reason and the stage (§6)
const WHY_CODES = ['human', 'ready', 'scale', 'risk', 'decision', 'tooling', 'plumb'];
const STAGE_KEYS = ['card', 'approve'];
const why = arg('why'), stage = arg('stage');
if (why !== undefined && !WHY_CODES.includes(why)) die(msg('board.new-card.bad_why', { why, codes: WHY_CODES.join('|') }));
if (stage !== undefined && !STAGE_KEYS.includes(stage)) die(msg('board.new-card.bad_stage', { stage, keys: STAGE_KEYS.join('|') }));
const routeLabel = routeLabels.find(l => l.startsWith('route-'));
if (why !== undefined && !routeLabel) die(msg('board.new-card.why_needs_route'));

// 4. The status and the assignee by the route (AGENTS.md §7): backlog holds Spec on production, on the other lanes - Intent
const noSpec = kind !== 'channels'; // Spec cuts only production (7); the other lanes are opened by Intent
const status = arg('status', 'backlog');
const assignee = arg('assignee', noSpec ? 'Intent' : 'Spec');
const priority = arg('priority', 'medium');

// 5. The number
let max = 0;
for (const f of cardFiles(ROOT, /^card-\d+/)) max = Math.max(max, +path.basename(f).match(/^card-(\d+)/)[1]);
const num = String(max + 1).padStart(3, '0');
// The Cyrillic → latin transliteration for slugs; the keys by escapes - the gate guards this file too.
const TR = { '\u0430':'a','\u0431':'b','\u0432':'v','\u0433':'g','\u0434':'d','\u0435':'e','\u0451':'e','\u0436':'zh','\u0437':'z','\u0438':'i','\u0439':'j','\u043A':'k','\u043B':'l','\u043C':'m','\u043D':'n','\u043E':'o','\u043F':'p','\u0440':'r','\u0441':'s','\u0442':'t','\u0443':'u','\u0444':'f','\u0445':'h','\u0446':'c','\u0447':'ch','\u0448':'sh','\u0449':'sch','\u044A':'','\u044B':'y','\u044C':'','\u044D':'e','\u044E':'yu','\u044F':'ya' };
const slug = title.toLowerCase().split('').map(c => TR[c] ?? c).join('')
  .replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 50).replace(/-$/, '');
const id = `card-${num}-${slug || 'task'}`;
const now = new Date().toISOString();
const day = now.slice(0, 10);
const detail = arg('why-detail');
const history = [
  why !== undefined ? `- \`Intent\`, ${day}: route ${routeLabel} (why: ${why})${detail ? ' — ' + detail.replace(/\.?$/, '.') : '.'}` : '',
  stage !== undefined ? '- `Intent`, ' + day + ': stage ' + stage + msg('board.new-card.stage_created') : '',
].filter(Boolean).join('\n');

const text = `---
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

const file = path.join(BOARD, id + '.md');
if (flag('dry')) { console.log(file + '\n' + text); process.exit(0); }
fs.mkdirSync(BOARD, { recursive: true });
fs.writeFileSync(file, text);
console.log(path.relative(ROOT, file).replace(/\\/g, '/'));

// 6. The check over this card
let out = '';
try { out = execFileSync(process.execPath, [path.join(__dirname, 'check-board.cjs'), id], { cwd: ROOT, encoding: 'utf8' }); }
catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
const mine = out.split('\n').filter(l => l.includes(id));
if (mine.length) { console.error(mine.join('\n')); process.exit(1); }
console.log(`ok: ${epic} · ${goal} · ${status}/${assignee}`);
