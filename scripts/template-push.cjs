#!/usr/bin/env node
// Publishing the project's anonymized files into the project's template (templates/<template>/skills/<template>/template/):
// .claude/scripts scripts -> template/scripts, Run profiles .claude/agents/run -> template/agents/run,
// the connector manifest -> template/mcp.json (name, type, variable names; no values).
// For the author only: protocol/ must be a git clone. Dry-run by default, writes nothing.
//   node .forma/protocol/scripts/template-push.cjs --template <name> --add <path> [--add ...] [--mcp name[=alias] ...] [--apply]
//   --add <path>   a file or directory inside .claude/scripts or .claude/agents/run (a path from the project root)
//   --mcp <name>    a connector from .mcp.json, .claude/.mcp.json or ~/.claude.json (user / project); the alias is its name in the manifest
//   --note <text> a line for the template's CHANGELOG.md under the new version (without it - the file list only)
//   --apply        write; the template plugin's patch version grows, the README "Contents" and CHANGELOG.md are rebuilt
// Anonymization: .env values -> [[NAME]], hosts from .env URLs -> <site-host>. A refusal (exit code 1, no file written) when
// a project trace remains (check-release TRACES), an e-mail, a secret literal or a long token-like string.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TRACES } = require('./check-release.cjs');
const { FORBIDDEN_PREFIX } = require('./lib/forbidden-transfer.cjs');
const i18n = require('../skills/forma/core/i18n/index.cjs');
const tr = (code, params) => i18n.message(code, params, 'en');

const root = process.cwd();
const protoDir = path.join(root, '.forma/protocol');
const ZONES = [['.claude/scripts/', 'template/scripts/'], ['.claude/agents/run/', 'template/agents/run/']];
const MIN_SECRET_LEN = 4;
const TRIVIAL = new Set(['true', 'false', 'null', 'none', 'yes', 'no', 'on', 'off']);
const norm = (s) => s.replace(/\r\n/g, '\n');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hostOf = (u) => { const m = /^[a-z][a-z0-9+.-]*:\/\/([^/\s:?#]+)/i.exec(u); return m ? m[1].toLowerCase() : null; };

function parseArgs(argv) {
  const a = { template: null, adds: [], mcp: [], note: null, apply: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--template') a.template = argv[++i];
    else if (v === '--add') a.adds.push(argv[++i].replace(/\\/g, '/').replace(/\/$/, ''));
    else if (v === '--mcp') a.mcp.push(argv[++i]);
    else if (v === '--note') a.note = argv[++i];
    else if (v === '--apply') a.apply = true;
    else { console.error(tr('tp.bad_arg', { arg: v })); process.exit(2); }
  }
  return a;
}

// .env: a value -> its name; the hosts of URL values.
function loadEnv(dir) {
  const secrets = new Map(), hosts = new Set();
  const f = path.join(dir, '.env');
  if (!fs.existsSync(f)) return { secrets, hosts };
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const val = m[2].replace(/^["'`]|["'`]$/g, '');
    const h = hostOf(val);
    if (h) hosts.add(h);
    if (val.length >= MIN_SECRET_LEN && !TRIVIAL.has(val.toLowerCase()) && !secrets.has(val)) secrets.set(val, m[1]);
  }
  return { secrets, hosts };
}

function scrub(text, env) {
  const counts = {};
  const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };
  let t = text;
  for (const [val, name] of [...env.secrets].sort((a, b) => b[0].length - a[0].length)) {
    t = t.replace(new RegExp(esc(val), 'g'), () => { bump('vars'); return `[[${name}]]`; });
  }
  for (const h of env.hosts) t = t.replace(new RegExp(`\\b${esc(h)}\\b`, 'gi'), () => { bump('site'); return '<site-host>'; });
  return { text: t, counts };
}

// The residue after anonymization: [{rule, line}] - no values.
function residue(text, env) {
  const found = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const r of TRACES) if (r.re.test(line)) found.push({ rule: r.id, line: i + 1 });
    for (const val of env.secrets.keys()) if (line.includes(val)) { found.push({ rule: 'secret-value', line: i + 1 }); break; }
    if (/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.test(line)) found.push({ rule: 'email', line: i + 1 });
    if (/\b(?:password|passwd|token|secret|api[_-]?key)\w*\s*[:=]\s*["'][^"'\s]{8,}["']/i.test(line)) found.push({ rule: 'credential-literal', line: i + 1 });
    for (const m of line.matchAll(/\b[A-Za-z0-9]{32,}\b/g)) if (/\d/.test(m[0]) && /[A-Za-z]/.test(m[0])) { found.push({ rule: 'token-like', line: i + 1 }); break; }
  });
  return found;
}

function walk(abs, rel) {
  const st = fs.statSync(abs);
  if (st.isFile()) return [rel];
  return fs.readdirSync(abs).flatMap((n) => walk(path.join(abs, n), rel + '/' + n));
}

// Connectors: .mcp.json, .claude/.mcp.json, ~/.claude.json (user first, then the project).
function readServers() {
  const out = {};
  const take = (o) => Object.assign(out, (o && (o.mcpServers || o)) || {});
  try {
    const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    take(j.mcpServers);
    for (const [p, v] of Object.entries(j.projects || {})) if (path.resolve(p).toLowerCase() === root.toLowerCase()) take(v.mcpServers);
  } catch { /* no file - no problem */ }
  for (const f of ['.claude/.mcp.json', '.mcp.json']) {
    try { take(JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))); } catch { /* none */ }
  }
  return out;
}

function manifestEntry(srv, env) {
  const e = { type: srv.type || (srv.url ? 'http' : 'stdio') };
  if (srv.url) {
    const h = hostOf(srv.url);
    e.urlTemplate = scrub(h ? srv.url.replace(h, '<site-host>') : srv.url, env).text;
  }
  if (srv.command) e.command = srv.command;
  if (srv.args) e.args = srv.args.map((x) => scrub(String(x), env).text);
  if (srv.env && Object.keys(srv.env).length) e.envNames = Object.keys(srv.env);
  if (srv.headers && Object.keys(srv.headers).length) e.headerNames = Object.keys(srv.headers);
  return e;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(path.join(protoDir, '.git'))) { console.error(tr('tp.no_git')); process.exit(2); }
  const pm = path.join(root, 'project/config/PROJECT.md');
  const tplName = a.template || (fs.existsSync(pm) && (fs.readFileSync(pm, 'utf8').match(/k:name\s*--> \| `([^`]+)`/) || [])[1]);
  if (!tplName) { console.error(tr('tp.no_template')); process.exit(2); }
  const tplRoot = path.join(protoDir, 'templates', tplName, 'skills', tplName);
  if (!fs.existsSync(tplRoot)) { console.error(tr('tp.no_tpl_dir', { path: path.relative(root, tplRoot) })); process.exit(2); }
  if (!a.adds.length && !a.mcp.length) { console.error(tr('tp.nothing_to_publish')); process.exit(2); }

  const env = loadEnv(root);
  const plan = [];   // {rel, dst, text, state, counts, bad}
  let refused = 0;

  for (const add of a.adds) {
    if (FORBIDDEN_PREFIX.some((p) => add.startsWith(p))) { console.error(tr('tp.forbidden_zone', { path: add })); process.exit(1); }
    const zone = ZONES.find(([p]) => add === p.slice(0, -1) || add.startsWith(p));
    if (!zone) { console.error(tr('tp.outside_zones', { zones: ZONES.map((z) => z[0]).join(', '), path: add })); process.exit(1); }
    const abs = path.join(root, add);
    if (!fs.existsSync(abs)) { console.error(tr('tp.no_file', { path: add })); process.exit(1); }
    for (const rel of walk(abs, add)) {
      if (!/\.(cjs|js|py|md|json|sh)$/i.test(rel)) { console.error(tr('tp.not_text', { path: rel })); process.exit(1); }
      const dst = path.join(tplRoot, zone[1] + rel.slice(zone[0].length));
      const raw = fs.readFileSync(path.join(root, rel), 'utf8');
      const { text, counts } = scrub(raw, env);
      const bad = residue(text, env);
      const state = bad.length ? tr('tp.state_refuse') : !fs.existsSync(dst) ? tr('tp.state_new') : norm(fs.readFileSync(dst, 'utf8')) === norm(text) ? tr('tp.state_same') : tr('tp.state_changed');
      if (bad.length) refused++;
      plan.push({ rel, dst, text, state, counts, bad });
    }
  }

  let manifest = null, manifestState = null;
  if (a.mcp.length) {
    const servers = readServers(), entries = {};
    for (const spec of a.mcp) {
      const [name, alias] = spec.split('=');
      if (!servers[name]) { console.error(tr('tp.connector_missing', { name })); process.exit(1); }
      entries[alias || name] = manifestEntry(servers[name], env);
    }
    manifest = JSON.stringify({ note: 'Connector manifest: names, types and variable names only. Values live in the project .env and the client connector settings.', servers: entries }, null, 2) + '\n';
    const residual = residue(manifest, env);
    const mf = path.join(tplRoot, 'template/mcp.json');
    manifestState = residual.length ? tr('tp.state_refuse') : !fs.existsSync(mf) ? tr('tp.state_new') : norm(fs.readFileSync(mf, 'utf8')) === norm(manifest) ? tr('tp.state_same') : tr('tp.state_changed');
    if (residual.length) { refused++; console.error(tr('tp.manifest_trace', { rules: residual.map((r) => r.rule).join(', ') })); }
  }

  console.log(tr('tp.header', { name: tplName, mode: a.apply ? tr('tp.mode_apply') : tr('tp.mode_dry') }));
  for (const p of plan) {
    const rep = Object.entries(p.counts).map(([k, v]) => k + ':' + v).join(' ');
    console.log(`  ${p.state.padEnd(13)} ${p.rel}${rep ? tr('tp.row_redacted', { rep }) : ''}`);
    for (const b of p.bad.slice(0, 10)) console.log(tr('tp.row_bad_line', { line: b.line, rule: b.rule }));
  }
  if (manifest) console.log(tr('tp.manifest_row', { state: manifestState, n: a.mcp.length }));

  if (refused) { console.error(tr('tp.stop_refused', { n: refused })); process.exit(1); }
  const changes = plan.filter((p) => p.state === tr('tp.state_new') || p.state === tr('tp.state_changed'));
  const mChange = manifestState === tr('tp.state_new') || manifestState === tr('tp.state_changed');
  if (!a.apply) { console.log(tr('tp.to_write', { n: changes.length + (mChange ? 1 : 0) })); return; }

  for (const p of changes) { fs.mkdirSync(path.dirname(p.dst), { recursive: true }); fs.writeFileSync(p.dst, p.text); }
  if (mChange) { const mf = path.join(tplRoot, 'template/mcp.json'); fs.mkdirSync(path.dirname(mf), { recursive: true }); fs.writeFileSync(mf, manifest); }
  if (!changes.length && !mChange) { console.log(tr('tp.nothing_to_write')); return; }
  bump({ tplName, tplRoot, note: a.note, changes, mChange, manifestState });
}

function bump({ tplName, tplRoot, note, changes, mChange, manifestState }) {
  const tplDir = path.join(protoDir, 'templates', tplName);
  const tplFiles = path.join(tplRoot, 'template');
  const pj = path.join(tplDir, '.claude-plugin/plugin.json');
  const j = JSON.parse(fs.readFileSync(pj, 'utf8'));
  const old = j.version, v = old.split('.'); v[2] = String(Number(v[2]) + 1); j.version = v.join('.');
  fs.writeFileSync(pj, JSON.stringify(j, null, 2) + '\n');
  const rel = (p) => path.relative(tplFiles, p).replace(/\\/g, '/');
  const lines = changes.map((p) => `- ${p.state === tr('tp.state_new') ? 'Added' : 'Changed'}: \`${rel(p.dst)}\``);
  if (mChange) lines.push(`- ${manifestState === tr('tp.state_new') ? 'Added' : 'Changed'}: \`mcp.json\` (connector manifest)`);
  writeChangelog(tplDir, j.version, note, lines);
  writeInventory(tplDir, tplRoot, j.version);
  console.log(tr('tp.written', { n: changes.length + (mChange ? 1 : 0), old, new: j.version }));
}

// --- The template's CHANGELOG.md: the newest entry on top, no dates (a clean zone, prohibition 16) ---
function writeChangelog(tplDir, version, note, lines) {
  const f = path.join(tplDir, 'CHANGELOG.md');
  const head = '# Changelog\n\nNewest first. The version is `.claude-plugin/plugin.json`; no dates (clean zone).\n';
  const old = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : head;
  const at = old.search(/^## /m);
  const entry = `## ${version}\n\n${note ? note + '\n\n' : ''}${lines.join('\n')}\n\n`;
  fs.writeFileSync(f, at === -1 ? old.trimEnd() + '\n\n' + entry : old.slice(0, at) + entry + old.slice(at));
}

// --- README.md: the block between the markers is rebuilt from the actual tree ---
const frontmatter = (text, key) => { const m = new RegExp('^' + key + ':\\s*(.+)$', 'm').exec(text.replace(/\r/g, '')); return m ? m[1].trim() : ''; };
// the description from the file's header: up to three comment lines (//, #, /* */, docstring), no file name at the start, up to the first period
const firstComment = (text, name) => {
  const got = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const l = raw.trim();
    if (!got.length && (!l || /^(#!|'use strict'|"use strict"|\/\*\*?$|"""$)/.test(l))) continue;
    const m = /^(?:\/\/+|#+|\*+|\/\*+|""")\s?(.*?)(?:\*\/|""")?$/.exec(l) || (got.length ? null : /^()(.+)$/.exec(l));
    const body = m && (m[2] !== undefined ? m[2] : m[1]).replace(/^"""/, '').trim();
    if (!body) break;
    got.push(body);
    if (got.length === 3) break;
  }
  let t = got.join(' ').replace(new RegExp('^' + esc(name) + '\\s*[—-]\\s*'), '');
  const dot = t.search(/\.(\s|$)/);
  if (dot > 20) t = t.slice(0, dot + 1);
  return t.length > 170 ? t.slice(0, 167) + '...' : t;
};
const cell = (x) => String(x || '—').replace(/\|/g, '\\|');

function inventory(tplDir, tplRoot, version) {
  const out = [];
  const protoVer = JSON.parse(fs.readFileSync(path.join(protoDir, '.claude-plugin/plugin.json'), 'utf8')).version;
  out.push(`Template version **${version}**, assembled against protocol **${protoVer}**. History — [CHANGELOG.md](CHANGELOG.md).`, '');
  const list = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort() : []);
  const skillsDir = path.join(tplDir, 'skills');
  const skills = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  out.push(`### Skills (${skills.length})`, '', '| Skill | What it is for |', '|---|---|');
  for (const n of skills) { const f = path.join(skillsDir, n, 'SKILL.md'); out.push(`| \`${n}\` | ${cell(fs.existsSync(f) ? frontmatter(fs.readFileSync(f, 'utf8'), 'description') : '')} |`); }
  const t = path.join(tplRoot, 'template');
  const scripts = list(path.join(t, 'scripts'));
  out.push('', `### Scripts → \`.claude/scripts/\` (${scripts.length})`, '', '| Script | What it does |', '|---|---|');
  for (const n of scripts) out.push(`| \`${n}\` | ${cell(firstComment(fs.readFileSync(path.join(t, 'scripts', n), 'utf8'), n))} |`);
  const runs = list(path.join(t, 'agents/run'));
  out.push('', `### \`Run\` profiles → \`.claude/agents/run/\` (${runs.length})`, '', '| Profile | What it does |', '|---|---|');
  for (const n of runs) out.push(`| \`${n.replace(/\.md$/, '')}\` | ${cell(frontmatter(fs.readFileSync(path.join(t, 'agents/run', n), 'utf8'), 'description').replace(/^Run — /, ''))} |`);
  const cfg = list(path.join(t, 'project/config'));
  out.push('', `### Project config stubs → \`project/config/\` (${cfg.length})`, '', cfg.map((n) => `- \`${n}\``).join('\n') || '—');
  const mf = path.join(t, 'mcp.json');
  out.push('', '### Connector manifest (`mcp.json`)', '');
  if (fs.existsSync(mf)) {
    const srv = JSON.parse(fs.readFileSync(mf, 'utf8')).servers || {};
    out.push('| Connector | Type | Variables |', '|---|---|---|');
    for (const [n, e] of Object.entries(srv)) out.push(`| \`${n}\` | ${e.type} | ${cell([...(e.envNames || []), ...(e.headerNames || [])].join(', '))} |`);
    out.push('', 'Names and types only — never values; the credentials stay in the project `.env` and the client connector settings.');
  } else out.push('Not published yet.');
  return out.join('\n');
}

function writeInventory(tplDir, tplRoot, version) {
  const f = path.join(tplDir, 'README.md');
  const START = '<!-- inventory:start -->', END = '<!-- inventory:end -->';
  const md = fs.readFileSync(f, 'utf8');
  const a = md.indexOf(START), b = md.indexOf(END);
  if (a === -1 || b === -1) { console.error(tr('tp.no_markers', { start: START, end: END })); process.exit(1); }
  fs.writeFileSync(f, md.slice(0, a) + START + '\n' + inventory(tplDir, tplRoot, version) + '\n' + END + md.slice(b + END.length));
}

main();
