// Three free Kit graphs: goals, the live board, the arsenal.
//
// Everything they are built from is already written down explicitly - the cards' frontmatter, the goals'
// labels, the ROADMAP.md map, the roles' frontmatter, the tool log. So a model
// is never called here: parsing text, not extracting meaning.
// All the graphs are mechanical: none calls a model.
//
// Incrementally, by the file's hash: an unchanged file takes its nodes and edges from
// the cache, a changed one is parsed anew, a removed one leaves the graph together with its
// nodes. The graph is not rebuilt - it is appended with what changed.
//
// The structure graph (the project's structure: zone:/file:, card -> zone, spend by zones) - see the
// "structure" section below; the spec - project/ops/GRAPHS-STRUCTURE-SITE.md.
// The fourth graph - central: a merge of goals, arsenal, structure and board under unified id prefixes,
// assembled last, from the ready graphs (the files are not re-read).
// Unified id prefixes: card:<card-NNN> · goal:<goal-…> · epic:<epic> · role:<role> ·
// skill:<skill> · script:<script> · mcp:<server> · tool:<tool> · plugin:<plugin> ·
// node:<protocol node> · file:<path>. New graphs join by the same id contract.
// Cross-layer edges: card -> goal (serves, the goal-NN label), card -> epic (in_lane), card -> role (uses_role).
// An edge to a missing node is not built but counted in the report. The central cache - the hash of the three
// input graphs (without the built field) and the builder's version: unchanged inputs - 0 parsed.
// The report: cards without a goal and without a role, roles and goals without cards, the share accepted
// first time (by the number of the Run role's attempt lines in History) per role - a metric for Core.
//
// The manual (.forma/manual/**/*.md) and project (project/**/*.md without cards/, work/, node_modules) graphs - also
// mechanical: a doc per file (the caption - the first H1), a heading per H2, the edges contains and links_to.
//
//   node .claude/scripts/build-kit-graphs.cjs [--only goals|board|arsenal|structure|resources|manual|project|central]
//
// Output: .forma/living/graphs/{goals,board,arsenal,central}/graph.json - the graphify format
// ({nodes:[{id,label,type,source_file}], edges:[{source,target,relation}]}),
// cache: .forma/living/graphs/.kit-cache.json.
//
// Printed labels come from the core dictionary: English key in code, ru value as data.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJson } = require('../../.forma/dashboard/lib/fs.cjs');
const { makeCli } = require('../../.forma/dashboard/lib/cli.cjs');
const { field: fm, labelsOf: labels } = require('../../.forma/dashboard/lib/card.cjs');
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, '.forma/living', 'graphs');
const CACHE = path.join(OUT, '.kit-cache.json');
const BOARD = path.join(ROOT, '.devtool', 'features');
const CODES = ['analytics', 'structure', 'protocol', 'resources', 'balance', 'discussion', 'channels', 'competencies', 'results'];
const GOAL_LABEL = new RegExp('^goal-(\\d+|' + CODES.join('|') + ')$');

const rel = f => path.relative(ROOT, f).split(path.sep).join('/');
const hash = s => crypto.createHash('sha1').update(s).digest('hex');
const list = (dir, test) => fs.existsSync(dir) ? fs.readdirSync(dir).filter(test).map(f => path.join(dir, f)) : [];

const cardId = f => (path.basename(f).match(/^(card-\d+)/) || [])[1] || path.basename(f, '.md');

// --- engines: the sources come from the adapters (engines.sourcesOf), no directories are hardcoded here ------
// An adapter = a root directory with forma-adapter.cjs. The engine tag (in a role's id) - the engine field, else the id/name of the directory.

const ENGINES = require('../../.forma/dashboard/lib/engines.cjs');
const abs = p => path.join(ROOT, ...String(p).split('/'));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let ADAPTERS = null;
function adapters() {
  if (!ADAPTERS) ADAPTERS = ENGINES.loadAdapters(ROOT).map(a => ({ a, dir: a.dir, tag: a.engine || ENGINES.idOf(a), src: ENGINES.sourcesOf(a) }));
  return ADAPTERS;
}
const uniq = xs => [...new Set(xs.filter(Boolean))];
const srcDirs = key => uniq(adapters().map(e => e.src[key]));
const dirOfRel = f => path.posix.dirname(rel(f));
// The adapter whose roles directory (regular or run) holds the file; else null.
const engineOfRole = f => adapters().find(e => [e.src.rolesDir, e.src.runRolesDir].includes(dirOfRel(f))) || null;
const isRunRole = f => adapters().some(e => e.src.runRolesDir === dirOfRel(f));
// The signature of all sources of all adapters: what an adapter declares changes - the extractors' versions change.
const adaptersSig = () => hash(JSON.stringify(adapters().map(e => [e.dir, e.tag, e.src]))).slice(0, 8);
const scriptsAlt = () => srcDirs('scriptsDir').map(esc).join('|') || '(?!)';
const idsOfRole = (roles, name) => (roles && roles.get(name)) || [];

// --- extraction from one file: {nodes, edges} ------------------------------

function cardForGoals(f, text) {
  const id = cardId(f), goal = labels(text).find(l => GOAL_LABEL.test(l));
  const nodes = [{ id, label: id, type: 'card', status: fm(text, 'status') }];
  const edges = goal ? [{ source: id, target: goal, relation: 'serves' }] : [];
  return { nodes, edges };
}

// A card's section by the zone key (zone.kit, zone.history…; the heading - by an anchor or a label) - until the next "## ".
function zone(text, key) {
  const m = i18n.headingRe(key).exec(text);
  if (!m) return '';
  const rest = text.slice(m.index + m[0].length), next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

// The role from ## Kit: the first word after the "Role:" label (kit.role, ru and en); empty if there is no role.
function roleOf(text) {
  const m = zone(text, 'zone.kit').match(new RegExp('^[-*\\s]*\\**(?:' + i18n.alt('kit.role') + ')\\**\\s*:\\**\\s*`?([A-Za-z][\\w.\\-]*)', 'm'));
  return m ? m[1] : '';
}

// The spend: the sums over the spend lines of ## History ("<N> tokens … <T> s" in the key part before the dash).
function spendOf(text) {
  let tokens = 0, seconds = 0, lines = 0;
  for (const line of zone(text, 'zone.history').split('\n')) {
    const key = line.split(' — ')[0];
    const t = key.match(/,\s*(\d+)\s+tokens\b/);
    if (!t) continue;
    lines++; tokens += Number(t[1]);
    const s = key.match(/\)?,\s*(\d+(?:\.\d+)?)\s*s\b/);
    if (s) seconds += Number(s[1]);
  }
  return { tokens, seconds: Math.round(seconds * 100) / 100, spend_lines: lines };
}

function cardForBoard(f, text) {
  const id = cardId(f);
  const title = (text.match(/^# (.+)$/m) || [])[1] || id;
  const status = fm(text, 'status'), assignee = fm(text, 'assignee'), epic = fm(text, 'epic');
  const ls = labels(text);
  const goal = ls.find(l => GOAL_LABEL.test(l));
  const one = re => ls.find(l => re.test(l)) || '';
  const after = ls.filter(l => /^after-card-\d+$/.test(l)).map(l => 'card-' + l.slice(11));
  const sp = spendOf(text);
  // The executor's attempts: the Run spend lines (on the short route route-4 Kit executes).
  const who = ls.includes('route-4') ? 'Kit' : 'Run';
  const attempts = zone(text, 'zone.history').split('\n')
    .filter(l => new RegExp('^[-*]\\s*`' + who + '`,[^:]*:\\s*(?:' + i18n.alt('hist.attempt') + ')\\b', 'i').test(l)).length;
  const nodes = [{
    id, label: title, type: 'card', status, assignee, epic,
    goal: goal || '', route: one(/^route-\d+$/), over: ls.filter(l => /^over-\d+$/.test(l)),
    wave: one(/^wave-\d+$/), seg: one(/^seg-\d+$/), after,
    role: roleOf(text), tokens: sp.tokens, seconds: sp.seconds, spend_lines: sp.spend_lines, attempts,
    priority: fm(text, 'priority'), created: fm(text, 'created'), modified: fm(text, 'modified'),
    completed: fm(text, 'completedAt'), labels: ls, file: rel(f),
  }];
  const edges = [];
  for (const a of after) edges.push({ source: id, target: a, relation: 'after' });
  if (goal) { nodes.push({ id: goal, label: goal, type: 'goal' }); edges.push({ source: id, target: goal, relation: 'serves' }); }
  if (epic) { nodes.push({ id: 'lane:' + epic, label: epic, type: 'lane' }); edges.push({ source: id, target: 'lane:' + epic, relation: 'in_lane' }); }
  if (assignee) { nodes.push({ id: 'node:' + assignee, label: assignee, type: 'node' }); edges.push({ source: id, target: 'node:' + assignee, relation: 'held_by' }); }
  const role = roleOf(text);
  if (role) edges.push({ source: id, target: 'role:' + role, relation: 'uses_role' });   // the target is checked at assembly against the arsenal's nodes
  // The files a card names - where tasks may collide.
  const seen = new Set();
  for (const m of text.matchAll(/`([\w.\-/]+\/[\w.\-]+\.(?:md|cjs|js|json|css|php|html|sh|toml))`/g)) {
    if (seen.has(m[1])) continue; seen.add(m[1]);
    nodes.push({ id: 'file:' + m[1], label: m[1], type: 'file' });
    edges.push({ source: id, target: 'file:' + m[1], relation: 'touches' });
  }
  return { nodes, edges };
}
cardForBoard.v = 4;   // a parser version change resets this extractor's cache

function roadmapForGoals(f, text) {
  const nodes = [], edges = [];
  let main = null, depth = -1;
  for (const line of text.split('\n')) {
    if (!line.includes('── ')) continue;                 // only the map's tree
    const m = line.match(/^(.*?)(goal-[\w-]+)\s*·\s*(.+?)\s*$/);
    if (!m) continue;
    const [, pre, id, rest] = m;
    const isMain = CODES.some(c => id === 'goal-' + c);
    nodes.push({ id, label: rest, type: isMain ? 'main_goal' : 'subgoal', kind: isMain ? id.slice(5) : null });
    if (isMain) { main = id; depth = pre.length; }
    else if (main && pre.length > depth) edges.push({ source: id, target: main, relation: 'part_of' });
  }
  return { nodes, edges };
}

// The profile's "takes / does not take" item: "- **Takes:** …" until the next item or an empty line.
function bullet(text, names) {
  const m = new RegExp('^[-*]\\s+\\*\\*(?:' + names.join('|') + '):?\\*\\*:?\\s*([^]*?)(?=\\n[-*]\\s|\\n\\s*\\n|$)', 'm').exec(text);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

// A role: an agent file from the adapter's rolesDir / runRolesDir. The node role:<engine>:<name>; the link role -> engine.
// Edges: role -> tool, role -> skill, role -> script, role -> connector.
function agentForArsenal(f, text) {
  const name = fm(text, 'name') || path.basename(f, '.md');
  const eng = engineOfRole(f), tag = eng ? eng.tag : 'unknown';
  const id = 'role:' + tag + ':' + name, tools = fm(text, 'tools') || '';
  const tl = tools.split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean);
  const nodes = [{
    id, label: name, type: 'role', name, engine: tag, model: fm(text, 'model') || '', tools: tl,
    takes: bullet(text, ['Takes']), not_takes: bullet(text, ['Does not take']), file: rel(f),
  }, { id: 'engine:' + tag, label: tag, type: 'engine' }], edges = [{ source: id, target: 'engine:' + tag, relation: 'of_engine' }];
  if (!isRunRole(f)) {   // the five protocol nodes: role <-> a tool-log node
    const node = 'node:' + name[0].toUpperCase() + name.slice(1);
    nodes.push({ id: node, label: node.slice(5), type: 'node' });
    edges.push({ source: id, target: node, relation: 'is_node' });
  }
  for (const t of tl) {
    nodes.push({ id: 'tool:' + t, label: t, type: 'tool' });
    edges.push({ source: id, target: 'tool:' + t, relation: 'declares' });
  }
  const skills = new Set(skillNames());
  const declared = (fm(text, 'skills') || '').split(',').map(s => s.trim()).filter(Boolean);
  const used = new Set(declared.filter(s => skills.has(s)));
  for (const m of text.matchAll(/`([\w.\-]+)`/g)) if (skills.has(m[1])) used.add(m[1]);
  for (const sk of used) edges.push({ source: id, target: 'skill:' + sk, relation: 'uses_skill' });
  // A skill declared in the frontmatter but nonexistent - a dangling link (checked at assembly).
  for (const sk of declared) if (!skills.has(sk)) edges.push({ source: id, target: 'skill:' + sk, relation: 'uses_skill' });
  // Role -> script: from the Bash(node <scriptsDir>/X …) permissions and from the <scriptsDir>/X paths in the text (the scriptsDir of all adapters);
  // a bare name X.cjs in the text counts only if such a script exists.
  const scripts = new Set(scriptNames()), runs = new Set();
  const permRe = new RegExp('^Bash\\(\\s*node\\s+(?:' + scriptsAlt() + ')\\/([\\w.\\-]+)');
  const pathRe = new RegExp('(?:' + scriptsAlt() + ')\\/([\\w\\-]+\\.(?:cjs|js|sh))', 'g');
  for (const t of tl) { const m = t.match(permRe); if (m) runs.add(m[1]); }
  for (const m of text.matchAll(pathRe)) runs.add(m[1]);
  for (const m of text.matchAll(/`([\w\-]+\.(?:cjs|js|sh))`/g)) if (scripts.has(m[1])) runs.add(m[1]);
  for (const s of runs) edges.push({ source: id, target: 'script:' + s, relation: 'runs_script' });
  // Role -> connector: mcp__<server>[__<tool>] in tools.
  const conns = new Set();
  for (const t of tl) { const m = t.match(/^mcp__([^_](?:[^_]|_(?!_))*)/); if (m) conns.add(m[1]); }
  for (const c of conns) edges.push({ source: id, target: 'mcp:' + c, relation: 'uses_connector' });
  return { nodes, edges };
}
agentForArsenal.v = () => 5 + hash(skillNames().join(',') + '|' + scriptNames().join(',') + '|' + adaptersSig()).slice(0, 8);   // a new skill, script or an adapter edit resets the roles' cache

const SCRIPT_RE = /\.(cjs|js|sh)$/;
const scriptFiles = () => srcDirs('scriptsDir').flatMap(d => list(abs(d), f => SCRIPT_RE.test(f)));
const skillFiles = () => srcDirs('skillsDir').flatMap(d => list(abs(d), () => true)).map(d => path.join(d, 'SKILL.md')).filter(f => fs.existsSync(f));
function scriptNames() { return uniq(scriptFiles().map(f => path.basename(f))); }
function skillNames() { return uniq(skillFiles().map(f => path.basename(path.dirname(f)))); }

function pluginForArsenal(f, text) {
  let p = {}; try { p = JSON.parse(text); } catch { /* unparseable - empty */ }
  const name = p.name || path.basename(path.dirname(f));
  const id = 'plugin:' + name, edges = [];
  // The plugin's directory: the roles - agents/*.md and agents/run/*.md next to plugin.json; the skills - the plugin's skills/,
  // or, absent it, the owner adapter's skillsDir. Goals without a node are dropped at assembly.
  const dir = path.dirname(f), owner = pluginOwner(f), tag = owner ? owner.tag : 'unknown';
  const mdNames = d => list(d, x => x.endsWith('.md')).map(x => path.basename(x, '.md'));
  for (const r of [...mdNames(path.join(dir, 'agents')), ...mdNames(path.join(dir, 'agents', 'run'))])
    edges.push({ source: id, target: 'role:' + tag + ':' + r, relation: 'has_role' });
  const own = path.join(dir, 'skills'), skDir = fs.existsSync(own) || !owner || !owner.src.skillsDir ? own : abs(owner.src.skillsDir);
  for (const d of list(skDir, () => true)) if (fs.existsSync(path.join(d, 'SKILL.md'))) edges.push({ source: id, target: 'skill:' + path.basename(d), relation: 'has_skill' });
  return { nodes: [{ id, label: name, type: 'plugin', version: p.version || '', description: (p.description || '').slice(0, 160), file: rel(f) }], edges };
}
pluginForArsenal.v = () => 3 + hash(skillNames().join(',') + '|' + adaptersSig() + '|' + pluginFiles()
  .flatMap(m => [...list(path.join(path.dirname(m), 'agents'), () => true), ...list(path.join(path.dirname(m), 'agents', 'run'), () => true)].map(x => path.basename(x))).join(',')).slice(0, 8);

function skillForArsenal(f, text) {
  const name = fm(text, 'name') || path.basename(path.dirname(f));
  return { nodes: [{ id: 'skill:' + name, label: name, type: 'skill', description: (fm(text, 'description') || '').slice(0, 160) }], edges: [] };
}

function mcpForArsenal(f, text) {
  let servers = {};
  try { servers = JSON.parse(text).mcpServers || {}; } catch { /* unparseable - empty */ }
  return { nodes: Object.keys(servers).map(s => ({ id: 'mcp:' + s, label: s, type: 'mcp' })), edges: [] };
}

// The connectors named in the permissions and the settings' server lists: "mcp__<server>[__<tool>]".
function mcpFromSettings(f, text) {
  let cfg = {}; try { cfg = JSON.parse(text); } catch { /* unparseable - empty */ }
  const names = new Set(cfg.enabledMcpjsonServers || []);
  for (const v of Object.values(cfg.permissions || {})) {
    if (!Array.isArray(v)) continue;
    for (const p of v) { const m = typeof p === 'string' && p.match(/^mcp__([^_](?:[^_]|_(?!_))*)/); if (m) names.add(m[1]); }
  }
  return { nodes: [...names].map(s => ({ id: 'mcp:' + s, label: s, type: 'mcp' })), edges: [] };
}

// A script: one node script:<name> per name; same-named files of different engines converge into it (the nodes merge by id),
// and the node carries an implemented_by edge to every engine whose scriptsDir holds the file.
function scriptForArsenal(f) {
  const name = path.basename(f), id = 'script:' + name, nodes = [{ id, label: name, type: 'script' }], edges = [];
  for (const e of adapters().filter(e => e.src.scriptsDir && e.src.scriptsDir === dirOfRel(f))) {
    nodes.push({ id: 'engine:' + e.tag, label: e.tag, type: 'engine' });
    edges.push({ source: id, target: 'engine:' + e.tag, relation: 'implemented_by' });
  }
  return { nodes, edges };
}
scriptForArsenal.v = () => 2 + adaptersSig();

// The tool log is appended line by line - parsed whole, but without a model.
function logForArsenal(f, text) {
  const counts = new Map();
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    const [, who, , tool] = line.split(' · ').map(s => s && s.trim());
    if (!who || !tool || i18n.labelsOf('hist.error').includes(who)) continue;
    const node = 'node:' + (i18n.labelsOf('hist.session').includes(who) ? 'Session' : who[0].toUpperCase() + who.slice(1));  // the log writes "kit", the role is "Kit"
    const key = node + '|' + tool;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const nodes = [], edges = [];
  for (const [key, n] of counts) {
    const [node, tool] = key.split('|');
    nodes.push({ id: node, label: node.slice(5), type: 'node' }, { id: 'tool:' + tool, label: tool, type: 'tool' });
    edges.push({ source: node, target: 'tool:' + tool, relation: 'used', weight: n });
  }
  return { nodes, edges };
}

// --- manual / project: a mechanical parse of the markdown corpus ------------------------------
// doc:<path> per file (the caption - the first H1), heading:<path>#<n> per H2, contains doc->heading,
// links_to doc->doc (relative markdown links and the project/.claude/.forma paths, as in docForStructure).
function docForCorpus(f, text) {
  const key = rel(f), dir = path.posix.dirname(key), id = 'doc:' + key;
  const body = text.replace(/^```[\s\S]*?^```/gm, '');
  const h1 = (body.match(/^# (.+)$/m) || [])[1] || path.posix.basename(key);
  const nodes = [{ id, label: h1.trim().slice(0, 160), type: 'doc', path: key }], edges = [];
  let n = 0;
  for (const m of body.matchAll(/^## (.+)$/gm)) {
    const hid = `heading:${key}#${++n}`;
    nodes.push({ id: hid, label: m[1].trim().slice(0, 160), type: 'heading', path: key });
    edges.push({ source: id, target: hid, relation: 'contains' });
  }
  const links = new Set();
  for (const m of body.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    if (/^[a-z]+:|^\//i.test(m[1])) continue;
    links.add(normPath(path.posix.normalize(path.posix.join(dir, m[1]))));
  }
  for (const m of body.matchAll(PATH_RE)) links.add(normPath(m[0]));
  for (const l of links) if (l !== key) edges.push({ source: id, target: 'doc:' + l, relation: 'links_to' });
  return { nodes, edges };
}
docForCorpus.v = () => 1 + adaptersSig();

function mdTree(dir, skip) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
    if (e.name === 'node_modules' || e.name.startsWith('.') || (skip && skip(e.name))) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...mdTree(p, null));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// --- which files feed which graph -----------------------------------------------

// An adapter's plugin manifest: packageManifest from sources; without it - plugin.json next to the roles directory (if it lies there).
function manifestOf(e) {
  const m = e.src.packageManifest ? abs(e.src.packageManifest) : path.join(path.dirname(abs(e.src.rolesDir)), 'plugin.json');
  return fs.existsSync(m) ? m : null;
}
function pluginFiles() { return uniq(adapters().map(manifestOf)); }
const pluginOwner = f => adapters().find(e => manifestOf(e) === f) || null;

function sources() {
  const open = list(BOARD, f => f.endsWith('.md'));
  const done = list(path.join(BOARD, 'done'), f => f.endsWith('.md'));
  const mcpFiles = uniq(adapters().flatMap(e => (e.src.mcpConfigs || []).map(abs))).filter(f => fs.existsSync(f));
  const settings = uniq(adapters().flatMap(e => ['settings.json', 'settings.local.json'].map(n => path.join(abs(e.dir), n)))).filter(f => fs.existsSync(f));
  return {
    manual: mdTree(path.join(ROOT, '.forma', 'manual')).map(f => [f, docForCorpus]),
    project: mdTree(path.join(ROOT, 'project'), n => n === 'cards' || n === 'work').map(f => [f, docForCorpus]),
    goals: [[[path.join(ROOT, 'project', 'ops', 'ROADMAP.md'), path.join(ROOT, 'project', 'ROADMAP.md')].find(f => fs.existsSync(f)) || path.join(ROOT, 'project', 'ops', 'ROADMAP.md'), roadmapForGoals],
            ...[...open, ...done].map(f => [f, cardForGoals])],
    board: [...open, ...done].map(f => [f, cardForBoard]),   // the board: the open and the closed (done/)
    arsenal: [...uniq(adapters().flatMap(e => [e.src.rolesDir, e.src.runRolesDir])).flatMap(d => list(abs(d), f => f.endsWith('.md'))).map(f => [f, agentForArsenal]),   // on-demand/ is not included
              ...pluginFiles().map(f => [f, pluginForArsenal]),
              ...skillFiles().map(f => [f, skillForArsenal]),
              ...scriptFiles().map(f => [f, scriptForArsenal]),
              ...mcpFiles.map(f => [f, mcpForArsenal]),
              ...settings.map(f => [f, mcpFromSettings]),
              ...[path.join(ROOT, '.forma/dashboard', 'tool-usage.log')].filter(f => fs.existsSync(f)).map(f => [f, logForArsenal])],
  };
}

// --- assembly --------------------------------------------------------------------

function build(name, pairs, cache, roles) {
  const slot = cache[name] || (cache[name] = {});
  let hit = 0, miss = 0, orphan = 0;
  const alive = new Set();
  const nodes = new Map(), edges = [];
  for (const [file, extract] of pairs) {
    if (!fs.existsSync(file)) continue;
    const key = rel(file), text = fs.readFileSync(file, 'utf8'), h = hash(text);
    alive.add(key);
    const tag = extract.name + (typeof extract.v === 'function' ? extract.v() : extract.v || '');
    let part = slot[key];
    if (part && part.hash === h && part.extractor === tag) hit++;
    else { part = { hash: h, extractor: tag, ...extract(file, text) }; slot[key] = part; miss++; }
    for (const n of part.nodes) nodes.set(n.id, { ...nodes.get(n.id), ...n, source_file: nodes.get(n.id)?.source_file || key });
    for (const e of part.edges) {
      if (e.relation === 'uses_role' && roles) {            // the card -> role edge: to every existing arsenal node with this name
        const ids = idsOfRole(roles, e.target.slice(5));
        if (!ids.length) { orphan++; continue; }
        for (const rid of ids) {
          nodes.set(rid, { ...nodes.get(rid), id: rid, label: rid.split(':').slice(2).join(':'), type: 'role', source_file: nodes.get(rid)?.source_file || key });
          edges.push({ ...e, target: rid, source_file: key });
        }
        continue;
      }
      edges.push({ ...e, source_file: key });
    }
  }
  // Arsenal: an edge to a missing node does not enter the graph. For the role edges (script, skill, connector)
  // this is a dangling link - counted and printed; for the plugin edges the target is simply dropped.
  const dangling = [];
  if (name === 'arsenal') {
    const keep = [];
    for (const e of edges) {
      if (!['runs_script', 'uses_connector', 'uses_skill', 'has_role', 'has_skill'].includes(e.relation) || nodes.has(e.target)) keep.push(e);
      else if (['runs_script', 'uses_connector', 'uses_skill'].includes(e.relation)) dangling.push(e);
    }
    edges.length = 0; edges.push(...keep);
  }
  if (name === 'manual' || name === 'project') {   // a link to a file outside the corpus - not a graph edge
    const keep = edges.filter(e => nodes.has(e.target));
    edges.length = 0; edges.push(...keep);
  }
  let gone = 0;
  for (const key of Object.keys(slot)) if (!alive.has(key)) { delete slot[key]; gone++; }  // a removed file leaves with its own nodes
  const dir = path.join(OUT, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'graph.json'), JSON.stringify({
    built: new Date().toISOString(), extractor: 'deterministic', model_tokens: 0,
    nodes: [...nodes.values()], edges,
  }, null, 1));
  return { name, nodes: nodes.size, edges: edges.length, hit, miss, gone, orphan, dangling, graph: { nodes: [...nodes.values()], edges } };
}

// --- structure: the project's structure (zones, files, card -> zone, spend by zones) ------
// Nodes: zone:<directory path> (project/ of the first and second level, without node_modules and hidden ones),
// file:<path> (the files of the first-level directories, only root ones). The cards and goals are stubs
// with the same ids as in board/goals. The source files (cards, zone files, README/GOAL) are parsed
// by cacheable extractors; the directory tree is read from disk every time (a listing, not a parse).

const ZONE_ROOT = 'project';
const SKIP_DIR = n => n === 'node_modules' || n.startsWith('.');
const dirs = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory() && !SKIP_DIR(e.name)).map(e => e.name).sort() : [];
const files = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name).sort() : [];

function zoneTree() {
  const zones = [];   // {id, path, parent}
  for (const a of dirs(path.join(ROOT, ZONE_ROOT))) {
    zones.push({ path: `${ZONE_ROOT}/${a}`, parent: null });
    for (const b of dirs(path.join(ROOT, ZONE_ROOT, a))) zones.push({ path: `${ZONE_ROOT}/${a}/${b}`, parent: `${ZONE_ROOT}/${a}` });
  }
  return zones;
}

const normPath = p => p.replace(/[\/.]+$/, '').replace(/\/{2,}/g, '/');
// The path roots in the text: project, .forma and the adapters' directories.
const PATH_RE = new RegExp('(?<![\\w\\/.\\-])(?:project|\\.forma|' + uniq(adapters().map(e => e.dir)).map(esc).join('|') + ')\\/[\\w.\\-\\/@]*[\\w\\-\\/]', 'g');

// A card: the paths from the Task/Result/History zones, the goal label, the spend.
function cardForStructure(f, text) {
  const body = ['zone.task', 'zone.result', 'zone.history'].map(n => zone(text, n)).join('\n');
  const paths = [...new Set([...body.matchAll(PATH_RE)].map(m => normPath(m[0])).filter(p => p.includes('/') && !/NNN|\*|<|>/.test(p)))];
  const goal = labels(text).find(l => GOAL_LABEL.test(l)) || '';
  const sp = spendOf(text);
  return { nodes: [], edges: [], paths, goal, tokens: sp.tokens, seconds: sp.seconds };
}
cardForStructure.v = () => 1 + adaptersSig();

// A zone's file / README / GOAL: the caption (the first line of README, else the GOAL heading) and the links to other files.
function docForStructure(f, text) {
  const dir = path.posix.dirname(rel(f)), links = new Set();
  for (const m of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    if (/^[a-z]+:|^\//i.test(m[1])) continue;
    links.add(normPath(path.posix.normalize(path.posix.join(dir, m[1]))));
  }
  for (const m of text.matchAll(PATH_RE)) links.add(normPath(m[0]));
  const first = (text.split('\n').map(s => s.trim()).find(s => s && s !== '---') || '').replace(/^#+\s*/, '').slice(0, 160);
  const h1 = (text.match(/^# (.+)$/m) || [])[1] || '';
  return { nodes: [], edges: [], head: first, title: h1.slice(0, 160), links: [...links].filter(l => l !== rel(f)) };
}
docForStructure.v = () => 1 + adaptersSig();

function structureSources(zones) {
  const pairs = [...list(BOARD, f => f.endsWith('.md')), ...list(path.join(BOARD, 'done'), f => f.endsWith('.md'))].map(f => [f, cardForStructure]);
  for (const z of zones) {
    const abs = path.join(ROOT, z.path);
    if (!z.parent) for (const n of files(abs)) pairs.push([path.join(abs, n), docForStructure]);
    else for (const n of ['README.md', 'GOAL.md']) if (fs.existsSync(path.join(abs, n))) pairs.push([path.join(abs, n), docForStructure]);
  }
  return pairs;
}

function buildStructure(cache, goalIds) {
  const slot = cache.structure || (cache.structure = {});
  const zones = zoneTree(), zset = new Set(zones.map(z => z.path));
  let hit = 0, miss = 0, gone = 0;
  const alive = new Set(), parts = new Map();
  for (const [file, extract] of structureSources(zones)) {
    const key = rel(file), buf = fs.readFileSync(file), h = hash(buf);
    alive.add(key);
    const tag = extract.name + (typeof extract.v === 'function' ? extract.v() : extract.v || '');
    let part = slot[key];
    if (part && part.hash === h && part.extractor === tag) hit++;
    else { part = { hash: h, extractor: tag, ...extract(file, buf.toString('utf8')) }; slot[key] = part; miss++; }
    parts.set(key, { ...part, isCard: extract === cardForStructure, file });
  }
  for (const key of Object.keys(slot)) if (!alive.has(key)) { delete slot[key]; gone++; }

  const nodes = new Map(), edges = new Map();
  let dropped = 0;
  const droppedSample = [];
  const drop = (s, t, r) => { dropped++; if (droppedSample.length < 5) droppedSample.push(`${s} → ${t} (${r})`); };
  const addEdge = (source, target, relation, source_file) => {
    if (!nodes.has(source) || !nodes.has(target)) return drop(source, target, relation);
    edges.set(source + '|' + target + '|' + relation, { source, target, relation, source_file });
  };
  const fileOf = new Map();   // a README/GOAL/file path -> its parsed part
  for (const [key, p] of parts) if (!p.isCard) fileOf.set(key, p);
  // The zones, their captions, the first-level files.
  for (const z of zones) {
    let label = '';
    for (const n of ['README.md', 'GOAL.md']) {
      const p = fileOf.get(`${z.path}/${n}`);
      if (p) { label = n === 'README.md' ? p.head : p.title || p.head; break; }
    }
    nodes.set('zone:' + z.path, { id: 'zone:' + z.path, label: label || path.posix.basename(z.path), type: 'zone', path: z.path,
      caption: label, has_readme: fs.existsSync(path.join(ROOT, z.path, 'README.md')), source_file: z.path, tokens: 0, seconds: 0, split: {} });
    if (z.parent) edges.set(`zone:${z.parent}|zone:${z.path}|contains`, { source: 'zone:' + z.parent, target: 'zone:' + z.path, relation: 'contains', source_file: z.parent });
  }
  for (const z of zones.filter(z => !z.parent)) {
    for (const n of files(path.join(ROOT, z.path))) {
      const key = `${z.path}/${n}`, p = fileOf.get(key);
      nodes.set('file:' + key, { id: 'file:' + key, label: n, type: 'file', hash: p ? p.hash : '', source_file: key });
      edges.set(`zone:${z.path}|file:${key}|contains`, { source: 'zone:' + z.path, target: 'file:' + key, relation: 'contains', source_file: z.path });
    }
  }
  // links_to between the files (first-level .md).
  for (const [key, p] of fileOf) {
    if (!nodes.has('file:' + key) || !key.endsWith('.md')) continue;
    for (const l of p.links || []) {
      if (!l.startsWith(ZONE_ROOT + '/') || l === key) continue;   // outside project/ - not a graph link
      const abs = path.join(ROOT, l);
      if (fs.existsSync(abs) && !fs.statSync(abs).isFile()) continue;   // a directory is not a file-file link
      if (fs.existsSync(abs) && !nodes.has('file:' + l)) continue;      // a file deeper than the first level: no node by the spec
      addEdge('file:' + key, 'file:' + l, 'links_to', key);
    }
  }
  // The cards: a stub node, card -> zone / file, the spend.
  const zoneOf = p => { let best = ''; for (const z of zset) if ((p === z || p.startsWith(z + '/')) && z.length > best.length) best = z; return best; };
  const withZone = new Set(), cardsAll = [], missing = new Map(), zoneGoals = new Map();
  let touchZone = 0, touchFile = 0;
  for (const [key, p] of parts) {
    if (!p.isCard) continue;
    const code = cardId(p.file), id = 'card:' + code;
    cardsAll.push(id);
    nodes.set(id, { id, label: id, type: 'card', source_file: key });
    const zs = new Set(), bad = [];
    for (const q of [...p.paths, `${ZONE_ROOT}/cards/${code}`]) {
      if (!fs.existsSync(path.join(ROOT, q))) { if (q !== `${ZONE_ROOT}/cards/${code}`) { bad.push(q); drop(id, q, 'touches_zone'); } continue; }
      if (nodes.has('file:' + q)) { addEdge(id, 'file:' + q, 'touches_file', key); touchFile++; }
      const z = zoneOf(q);
      if (z) zs.add(z);
    }
    if (bad.length) missing.set(id, bad);
    for (const z of zs) { addEdge(id, 'zone:' + z, 'touches_zone', key); touchZone++; }
    if (zs.size) {
      withZone.add(id);
      for (const z of zs) {
        const n = nodes.get('zone:' + z);
        n.tokens += p.tokens / zs.size; n.seconds += p.seconds / zs.size;
        if (p.tokens || p.seconds) n.split[id] = zs.size;
        if (p.goal && goalIds.has(p.goal)) {
          const gid = 'goal:' + p.goal;
          if (!nodes.has(gid)) nodes.set(gid, { id: gid, label: p.goal, type: 'goal', source_file: '.forma/living/graphs/goals/graph.json' });
          addEdge('zone:' + z, gid, 'serves', key);
          (zoneGoals.get(p.goal) || zoneGoals.set(p.goal, new Set()).get(p.goal)).add(z);
        }
      }
    }
  }
  // The goals/goal-<code> directory's zone <-> the goal of the same name.
  for (const z of zones) {
    const m = z.path.match(/^project\/goals\/(goal-[\w-]+)$/);
    if (!m) continue;
    if (!goalIds.has(m[1])) { drop('zone:' + z.path, m[1], 'serves'); continue; }
    const gid = 'goal:' + m[1];
    if (!nodes.has(gid)) nodes.set(gid, { id: gid, label: m[1], type: 'goal', source_file: '.forma/living/graphs/goals/graph.json' });
    addEdge('zone:' + z.path, gid, 'serves', z.path);
    (zoneGoals.get(m[1]) || zoneGoals.set(m[1], new Set()).get(m[1])).add(z.path);
  }
  for (const n of nodes.values()) if (n.type === 'zone') { n.tokens = Math.round(n.tokens); n.seconds = Math.round(n.seconds * 100) / 100; }
  const E = [...edges.values()], N = [...nodes.values()];
  const touched = new Set(E.filter(e => e.relation === 'touches_zone').map(e => e.target));
  const Z = N.filter(n => n.type === 'zone');
  const report = {
    zones: Z.length, cards: cardsAll.length, card_zone_edges: touchZone, card_file_edges: touchFile, dropped_edges: dropped, dropped_sample: droppedSample,
    zones_without_readme: Z.filter(n => !n.has_readme).map(n => n.path),
    zones_without_cards: Z.filter(n => !touched.has(n.id)).map(n => n.path),
    cards_without_zones: cardsAll.filter(c => !withZone.has(c)),
    cards_with_missing_path: [...missing.keys()],
    goals_without_zone: [...goalIds].filter(g => !zoneGoals.has(g)),
    top_spend: Z.filter(n => n.tokens).sort((a, b) => b.tokens - a.tokens).slice(0, 3).map(n => ({ zone: n.path, tokens: n.tokens, seconds: n.seconds })),
  };
  const dir = path.join(OUT, 'structure');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'graph.json'), JSON.stringify({ built: new Date().toISOString(), extractor: 'deterministic', model_tokens: 0, nodes: N, edges: E, report }, null, 1));
  return { name: 'structure', nodes: N.length, edges: E.length, hit, miss, gone, report, graph: { nodes: N, edges: E, report } };
}

function printStructure(r) {
  const p = r.report, f = l => `${l.length}` + (l.length ? ' (' + l.slice(0, 3).join(', ') + (l.length > 3 ? ', …' : '') + ')' : '');
  console.log(msg('kgraphs.structure_line', { zones: p.zones, cz: p.card_zone_edges, cf: p.card_file_edges, dropped: p.dropped_edges }));
  console.log(msg('kgraphs.structure_gaps', { a: f(p.zones_without_readme), b: f(p.zones_without_cards), c: f(p.cards_without_zones), d: f(p.cards_with_missing_path), e: f(p.goals_without_zone) }));
}

// --- resources: the resources registry (asset:, a resource -> card/goal/zone) -----------------------
// The source - project/resources/_assets.json (kept by .claude/scripts/resources.cjs). The node asset:<sha256[:12]>,
// edges: made_by -> card, serves -> goal, used_in -> the consumer file's zone, contains: zone -> resource.
// No model is called; the cache - the registry file's hash and the builder's version (no changes - 0 parsed).

const RES_V = 3;
const RES_FILE = path.join(ROOT, 'project/resources/_assets.json');

function buildResources(cache, goalIds) {
  const file = path.join(OUT, 'resources', 'graph.json');
  const raw = fs.existsSync(RES_FILE) ? fs.readFileSync(RES_FILE, 'utf8') : '';
  const zones = new Set(zoneTree().map(z => z.path));
  const goalKey = [...goalIds].sort().join(',');
  const h = hash(RES_V + raw + goalKey + [...zones].join(','));
  const prev = fs.existsSync(file) ? readJson(file, null) : null;
  if (cache.resources && cache.resources.hash === h && prev && prev.report) {
    return { name: 'resources', nodes: prev.nodes.length, edges: prev.edges.length, hit: 1, miss: 0, gone: 0, report: prev.report, graph: prev };
  }
  const reg = raw ? JSON.parse(raw) : {};
  if (!reg.entries || typeof reg.entries !== 'object') reg.entries = {};   // an empty or missing registry does not crash the build
  const zoneOf = p => { const a = p.split('/'); for (let n = Math.min(3, a.length - 1); n >= 1; n--) { const z = a.slice(0, n).join('/'); if (zones.has(z)) return z; } return null; };
  const nodes = new Map(), edges = new Map();
  const addEdge = (s, t, r, sf) => edges.set(`${s}|${t}|${r}`, { source: s, target: t, relation: r, source_file: sf });
  const report = { assets: 0, by_state: {}, without_description: 0, without_file: [], without_entry: [], unclear: 0, orphan: [] };
  for (const [sha, e] of Object.entries(reg.entries)) {
    if (!e || !e.path || /^\.(claude|forma)\//.test(e.path)) continue;   // the protocol's scripts do not count as resources
    const id = 'asset:' + sha.slice(0, 12);
    report.assets++;
    report.by_state[e.state] = (report.by_state[e.state] || 0) + 1;
    if (e.format !== 'svg' && !e.description) report.without_description++;
    if (!fs.existsSync(path.join(ROOT, e.path))) report.without_file.push(e.path);
    if (e.state === '\u0431\u0435\u0441\u0445\u043e\u0437\u043d\u044b\u0439') report.orphan.push(e.path);
    nodes.set(id, { id, label: e.description ? e.description.slice(0, 70) : path.posix.basename(e.path), type: 'asset', source_file: 'project/resources/_assets.json',
      path: e.path, also: e.also, format: e.format, width: e.width, height: e.height, bytes: e.bytes, kind: e.kind, state: e.state, class: e.class, card: e.card, card_note: e.card_note, goal: e.goal, description: e.description, tags: e.tags, semantic_tags: e.semantic_tags, asset_type: e.type, used_in: e.used_in, described: !!e.description });
    const z = zoneOf(e.path);
    if (z) { if (!nodes.has('zone:' + z)) nodes.set('zone:' + z, { id: 'zone:' + z, label: z, type: 'zone', stub: true, source_file: '.forma/living/graphs/structure/graph.json' }); addEdge('zone:' + z, id, 'contains', e.path); }
    if (!e.description) { const rid = 'report:resource-without-description'; if (!nodes.has(rid)) nodes.set(rid, { id: rid, label: msg('kgraphs.no_description_label'), type: 'report', stub: true, source_file: 'project/resources/_assets.json' }); addEdge(id, rid, 'report', e.path); }
    if (e.card) { if (!nodes.has('card:' + e.card)) nodes.set('card:' + e.card, { id: 'card:' + e.card, label: e.card, type: 'card', source_file: '.forma/living/graphs/board/graph.json' }); addEdge(id, 'card:' + e.card, 'made_by', e.path); }
    if (e.goal && goalIds.has(e.goal)) { const g = 'goal:' + e.goal; if (!nodes.has(g)) nodes.set(g, { id: g, label: e.goal, type: 'goal', source_file: '.forma/living/graphs/goals/graph.json' }); addEdge(id, g, 'serves', e.path); }
    for (const u of e.used_in || []) { const uz = zoneOf(u); if (uz) { if (!nodes.has('zone:' + uz)) nodes.set('zone:' + uz, { id: 'zone:' + uz, label: uz, type: 'zone', stub: true, source_file: '.forma/living/graphs/structure/graph.json' }); addEdge(id, 'zone:' + uz, 'used_in', u); } }
  }
  const sort = readJson(path.join(ROOT, 'project/resources/_sort.json'), null);
  report.unclear = sort ? sort.count.unclear : null;
  if (sort) {
    const known = new Set(Object.values(reg.entries).flatMap(e => [e.path, ...(e.also || [])]));
    report.without_entry = Object.entries(sort.files).filter(([p, v]) => v.class === 'resource' && !known.has(p) && !/^project\/resources\/_(assets|sort)\.json$/.test(p)).map(([p]) => p);
  }
  for (const [k, x] of edges) if (!nodes.has(x.source) || !nodes.has(x.target)) edges.delete(k);
  const N = [...nodes.values()], E = [...edges.values()];
  const graph = { built: new Date().toISOString(), extractor: 'deterministic', model_tokens: 0, nodes: N, edges: E, report };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(graph, null, 1));
  cache.resources = { hash: h };
  return { name: 'resources', nodes: N.length, edges: E.length, hit: 0, miss: report.assets, gone: 0, report, graph };
}

function printResources(r) {
  const p = r.report, f = l => `${l.length}` + (l.length ? ' (' + l.slice(0, 3).join(', ') + (l.length > 3 ? ', …' : '') + ')' : '');
  console.log(msg('kgraphs.resources_line', { assets: p.assets, states: Object.entries(p.by_state).map(([k, v]) => `${k} ${v}`).join(', '), nodesc: p.without_description, unclear: p.unclear === null ? 'n/a' : p.unclear }));
  console.log(msg('kgraphs.resources_gaps', { a: f(p.without_file), b: f(p.without_entry) }));
}

// --- central: the merge of the graphs ---------------------------------------------------

const CENTRAL_V = 4;
const LAYER = t => ({ card: 'board', file: 'board', goal: 'goals', epic: 'goals', zone: 'structure', asset: 'resources' }[t] || 'arsenal');
const CENTRAL_PARTS = ['goals', 'arsenal', 'structure', 'resources', 'board'];   // structure before board: the cards' stubs do not overwrite the board's captions

function buildCentral(cache, graphs) {
  const strip = g => ({ nodes: g.nodes, edges: g.edges });
  const h = hash(CENTRAL_V + JSON.stringify(CENTRAL_PARTS.map(n => strip(graphs[n]))));
  const file = path.join(OUT, 'central', 'graph.json');
  const prev = fs.existsSync(file) ? readJson(file, null) : null;
  if (cache.central && cache.central.hash === h && prev && prev.report) {
    return { name: 'central', nodes: prev.nodes.length, edges: prev.edges.length, hit: 1, miss: 0, gone: 0, report: prev.report, graph: prev };
  }
  const nodes = new Map(), edges = new Map(), dropped = [];
  const mapId = (id, type) => {
    if (id.startsWith('card:') || id.startsWith('goal:')) return id;   // already prefixed (structure)
    if (type === 'card' || /^card-\d+$/.test(id)) return 'card:' + id;
    if (id.startsWith('goal-')) return 'goal:' + id;
    if (id.startsWith('lane:')) return 'epic:' + id.slice(5);
    return id;
  };
  for (const name of CENTRAL_PARTS) {
    const g = graphs[name], fallback = '.forma/living/graphs/' + name + '/graph.json', types = new Map(g.nodes.map(n => [n.id, n.type]));
    for (const n of g.nodes) {
      const id = mapId(n.id, n.type), old = nodes.get(id);
      if (n.stub && old) continue;   // a stub does not overwrite a real node
      const type = id.startsWith('epic:') ? 'epic' : id.startsWith('goal:') ? (n.type === 'goal' && old ? old.type : n.type) : n.type;
      nodes.set(id, { ...old, ...n, id, type, label: n.label || old?.label || id, source_file: old?.source_file || n.source_file || fallback });
    }
    for (const e of g.edges) {
      const s = mapId(e.source, types.get(e.source)), t = mapId(e.target, types.get(e.target));
      edges.set(s + '|' + t + '|' + e.relation, { ...e, source: s, target: t, source_file: e.source_file || fallback });
    }
  }
  for (const n of nodes.values()) n.layer = LAYER(n.type);
  const roleIds = name => [...nodes.values()].filter(n => n.type === 'role' && (n.name || n.id.split(':').slice(2).join(':')) === name).map(n => n.id);
  // The cross-layer edges are derived from the cards explicitly; a goal, epic or role without a node - the edge is not built.
  for (const c of [...nodes.values()].filter(n => n.type === 'card' && n.file)) {
    for (const [target, relation] of [[c.goal && 'goal:' + c.goal, 'serves'], [c.epic && 'epic:' + c.epic, 'in_lane'], [c.role && 'role:' + c.role, 'uses_role']]) {
      if (!target) continue;
      const hits = relation === 'uses_role' ? roleIds(c.role) : nodes.has(target) ? [target] : [];   // a role: the role:<engine>:<name> nodes of all engines
      if (!hits.length) { dropped.push({ source: c.id, target, relation }); continue; }
      for (const t of hits) edges.set(c.id + '|' + t + '|' + relation, { source: c.id, target: t, relation, source_file: c.file });
    }
  }
  // Edges to a missing node do not enter the graph.
  for (const [k, e] of edges) if (!nodes.has(e.source) || !nodes.has(e.target)) { dropped.push(e); edges.delete(k); }
  const E = [...edges.values()], N = [...nodes.values()];
  const cross = E.filter(e => nodes.get(e.source).layer !== nodes.get(e.target).layer).length;
  const out = rel => new Set(E.filter(e => e.relation === rel).map(e => e.source)), inn = rel => new Set(E.filter(e => e.relation === rel).map(e => e.target));
  const cards = N.filter(n => n.type === 'card' && n.file), served = out('serves'), withRole = out('uses_role');
  const byRole = {};
  let first = 0, known = 0;
  for (const c of cards.filter(n => n.status === 'done' && n.attempts > 0)) {
    const r = c.role || msg('kgraphs.no_role_key'), b = byRole[r] || (byRole[r] = { accepted: 0, first_time: 0 });
    b.accepted++; known++;
    if (c.attempts === 1) { b.first_time++; first++; }
  }
  const report = {
    cards: cards.length, cross_layer_edges: cross, dropped_edges: dropped.length,
    dropped_sample: dropped.slice(0, 5).map(e => e.source + ' → ' + e.target),
    cards_without_goal: cards.filter(c => !served.has(c.id)).map(c => c.id),
    cards_without_role: cards.filter(c => !withRole.has(c.id)).map(c => c.id),
    roles_without_cards: N.filter(n => n.type === 'role' && !inn('uses_role').has(n.id)).map(n => n.id),
    goals_without_cards: N.filter(n => n.id.startsWith('goal:') && !inn('serves').has(n.id)).map(n => n.id),
    core: { accepted_with_attempts: known, first_time: first, first_time_share: known ? Math.round(first / known * 1000) / 1000 : null, by_role: byRole },
    resources: graphs.resources.report ? (({ assets, by_state, without_description, without_file, without_entry, unclear }) => ({ assets, by_state, without_description, without_file: without_file.length, without_entry: without_entry.length, unclear }))(graphs.resources.report) : null,
    structure: graphs.structure.report ? (({ zones, card_zone_edges, dropped_edges, zones_without_readme, zones_without_cards, cards_without_zones, cards_with_missing_path, goals_without_zone }) =>
      ({ zones, card_zone_edges, dropped_edges, zones_without_readme: zones_without_readme.length, zones_without_cards: zones_without_cards.length,
         cards_without_zones: cards_without_zones.length, cards_with_missing_path: cards_with_missing_path.length, goals_without_zone: goals_without_zone.length }))(graphs.structure.report) : null,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const graph = { built: new Date().toISOString(), extractor: 'deterministic', model_tokens: 0, nodes: N, edges: E, report };
  fs.writeFileSync(file, JSON.stringify(graph, null, 1));
  cache.central = { hash: h };
  return { name: 'central', nodes: N.length, edges: E.length, hit: 0, miss: 5, gone: 0, report, graph };
}

function printCentral(r) {
  const p = r.report, f = l => `${l.length}` + (l.length ? ' (' + l.slice(0, 4).join(', ') + (l.length > 4 ? ', …' : '') + ')' : '');
  console.log(msg('kgraphs.central_line', { cross: p.cross_layer_edges, dropped: p.dropped_edges }) + (p.dropped_sample.length ? ' · ' + p.dropped_sample.join(', ') : ''));
  console.log(msg('kgraphs.central_cards', { cards: p.cards, no_goal: f(p.cards_without_goal) }));
  console.log(msg('kgraphs.cards_without_role', { count: f(p.cards_without_role) }));
  console.log(msg('kgraphs.roles_without_cards', { count: f(p.roles_without_cards) }));
  console.log(msg('kgraphs.goals_without_cards', { count: f(p.goals_without_cards) }));
  const c = p.core;
  console.log(msg('kgraphs.core_line', { first: c.first_time, total: c.accepted_with_attempts }) + (c.first_time_share === null ? '' : ` (${Math.round(c.first_time_share * 100)} %)`));
  for (const [role, b] of Object.entries(c.by_role)) console.log(`  ${role}: ${b.first_time}/${b.accepted}`);
}

// graph.html for the dashboard's "Graphs" tab: re-rendered when the graph changed or the html is not there yet.
function renderHtml(rows) {
  const { main: renderMain, CORPORA } = require('./build-graph-html.cjs');
  const todo = rows.filter(r => CORPORA.includes(r.name) &&
    (r.miss || r.gone || !fs.existsSync(path.join(OUT, r.name, 'graph.html')))).map(r => r.name);
  if (!todo.length) return;
  try { renderMain(todo); }
  catch (err) { console.log(msg('kgraphs.html_failed', { err: String(err && err.message || err) })); }
}

function main() {
  const cli = makeCli();
  const only = cli.eq('only', '') || cli.value('only', '');
  const cache = readJson(CACHE, {}); // the first run - an empty cache
  const src = sources();
  const rows = [];
  // The order: the goals, the competencies (the arsenal), then the cards (the board) - the board needs the roles' nodes.
  let roles = null, arsenal = null;
  const roleSet = () => {
    const g = arsenal || readJson(path.join(OUT, 'arsenal', 'graph.json'), { nodes: [] });
    roles = new Map();   // a role's name -> the ids of its role:<engine>:<name> nodes
    for (const n of g.nodes.filter(n => n.type === 'role')) { const nm = n.name || n.id.split(':').slice(2).join(':'); roles.set(nm, [...(roles.get(nm) || []), n.id]); }
    return roles;
  };
  for (const name of ['goals', 'arsenal', 'structure', 'resources', 'board', 'manual', 'project']) {
    if (only && only !== name) continue;
    if (name === 'resources') {
      const gg = (rows.find(r => r.name === 'goals') || {}).graph || readJson(path.join(OUT, 'goals', 'graph.json'), { nodes: [] });
      rows.push(buildResources(cache, new Set(gg.nodes.filter(n => /^goal-/.test(n.id) && n.type !== 'card').map(n => n.id))));
      continue;
    }
    if (name === 'structure') {
      const gg = (rows.find(r => r.name === 'goals') || {}).graph || readJson(path.join(OUT, 'goals', 'graph.json'), { nodes: [] });
      rows.push(buildStructure(cache, new Set(gg.nodes.filter(n => /^goal-/.test(n.id) && n.type !== 'card').map(n => n.id))));
      continue;
    }
    const r = build(name, src[name], cache, name === 'board' ? roleSet() : null);
    if (name === 'arsenal') arsenal = r.graph;
    rows.push(r);
  }
  if (!only || only === 'central') {   // last: from the just-assembled graphs, the missing ones - from the files
    const graphs = {};
    for (const n of CENTRAL_PARTS) {
      const row = rows.find(r => r.name === n);
      graphs[n] = row ? row.graph : readJson(path.join(OUT, n, 'graph.json'), { nodes: [], edges: [] });
    }
    rows.push(buildCentral(cache, graphs));
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  renderHtml(rows);
  for (const r of rows) {
    console.log(msg('kgraphs.summary_line', { name: r.name.padEnd(8), nodes: String(r.nodes).padStart(5), edges: String(r.edges).padStart(5), hit: r.hit, miss: r.miss, gone: r.gone }));
  }
  const cen = rows.find(r => r.name === 'central');
  if (cen) printCentral(cen);
  const st = rows.find(r => r.name === 'structure');
  if (st) printStructure(st);
  const rs = rows.find(r => r.name === 'resources');
  if (rs) printResources(rs);
  const a = rows.find(r => r.name === 'arsenal');
  if (a && a.dangling) {
    const names = [...new Set(a.dangling.map(e => e.source.slice(5) + ' → ' + e.target))];
    console.log(msg('kgraphs.dangling_roles', { roles: new Set(a.dangling.map(e => e.source)).size, links: a.dangling.length }) +
                (names.length ? ' · ' + names.slice(0, 5).join(', ') : ''));
    const cnt = rel => a.graph.edges.filter(e => e.relation === rel).length;
    console.log(msg('kgraphs.arsenal_edges', { script: cnt('runs_script'), conn: cnt('uses_connector'), prole: cnt('has_role'), pskill: cnt('has_skill') }));
  }
  const b = rows.find(r => r.name === 'board');
  if (b && b.dangling && roles) {
    const cards = b.graph.nodes.filter(n => n.type === 'card');
    const used = new Set(b.graph.edges.filter(e => e.relation === 'uses_role').map(e => e.target));
    const noRole = cards.filter(n => !n.role).length;
    const unlinked = cards.filter(n => n.role && !idsOfRole(roles, n.role).length).length;
    const allIds = [...roles.values()].flat();
    const idle = allIds.filter(r => !used.has(r)).length;
    console.log(msg('kgraphs.board_no_role', { noRole, unlinked, idle, total: allIds.length }));
  }
}

if (require.main === module) main();
module.exports = { build, sources };
