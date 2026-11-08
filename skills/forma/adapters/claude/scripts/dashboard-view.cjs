'use strict';

/**
 * What the dashboard shows about Claude Code: the settings, the MCP configs, the transcripts catalog.
 * Read by the adapter (`.claude/forma-adapter.cjs`); the core does not know these paths itself.
 * READ ONLY. Prohibition 15: from `~/.claude.json` and `.mcp.json` - the server names only;
 * from `env` - the values, except variables whose name looks like a secret (for them the name only).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readJson } = require('../../.forma/dashboard/lib/fs.cjs');
const { parseFrontmatter } = require('../../.forma/dashboard/lib/card.cjs');
// Printed labels come from the core dictionary: English key in code, ru value as data.
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const SECRET = /KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL/i;
const SYNC_SCRIPT = path.join('.claude', 'scripts', 'sync-engines.cjs');

/** The MCP server files by level: the project ones ride with the repository, the user one - with the human. */
function mcpConfigs(root) {
  return [
    { rel: '.mcp.json', file: path.join(root, '.mcp.json'), level: msg('dashboard-view.level_project') },
    { rel: '.claude/.mcp.json', file: path.join(root, '.claude', '.mcp.json'), level: msg('dashboard-view.level_project') },
    { rel: '~/.claude.json', file: path.join(os.homedir(), '.claude.json'), level: msg('dashboard-view.level_user') },
  ];
}

/** The project's transcripts catalog. The engine builds the slug from the path: everything that is not a letter or a digit - a dash.
 *  The rule is undocumented, so there is a fallback - a case-insensitive search among the existing ones. */
function transcriptsDir(root) {
  const base = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(base)) return null;
  const encoded = root.replace(/[^A-Za-z0-9]/g, '-');
  for (const c of [encoded, encoded.charAt(0).toLowerCase() + encoded.slice(1)]) {
    const p = path.join(base, c);
    if (fs.existsSync(p)) return p;
  }
  const want = encoded.toLowerCase();
  const found = fs.readdirSync(base).find((d) => d.toLowerCase() === want);
  return found ? path.join(base, found) : null;
}

const subdirs = (dir) => (fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  : []);

function readEnv(st) {
  if (!st || !st.env) return [];
  return Object.keys(st.env).map((k) => ({ name: k, value: SECRET.test(k) ? null : String(st.env[k]), hidden: SECRET.test(k) }));
}

function readHooks(st) {
  const hooks = [];
  if (!st || !st.hooks) return hooks;
  for (const [event, groups] of Object.entries(st.hooks)) {
    for (const g of groups || []) {
      hooks.push({ event, matcher: g.matcher || '', commands: (g.hooks || []).map((h) => String(h.command || '').replace(/^bash\s+/, '')) });
    }
  }
  return hooks;
}

function readNodes(agentsDir) {
  if (!fs.existsSync(agentsDir)) return [];
  return fs.readdirSync(agentsDir).filter((x) => x.endsWith('.md')).sort().map((f) => {
    const fm = parseFrontmatter(fs.readFileSync(path.join(agentsDir, f), 'utf8'));
    const tools = String(fm.tools || '').split(/,\s*(?![^()]*\))/).map((s) => s.trim()).filter(Boolean);
    return { name: fm.name || f.replace(/\.md$/, ''), file: '.claude/agents/' + f, model: fm.model || null, effort: fm.effort || null, tools };
  });
}

function readMcpNames(root) {
  const names = (f) => { const j = readJson(f); return j && j.mcpServers ? Object.keys(j.mcpServers) : null; };
  const project = ['.mcp.json', '.claude/.mcp.json'].map((p) => ({ file: p, servers: names(path.join(root, p)) }));
  const uj = readJson(path.join(os.homedir(), '.claude.json'));
  const user = uj && uj.mcpServers ? Object.keys(uj.mcpServers) : [];
  let userProject = [];
  if (uj && uj.projects) {
    const norm = (s) => path.resolve(s).toLowerCase();
    for (const [k, v] of Object.entries(uj.projects)) {
      if (norm(k) === norm(root) && v && v.mcpServers) userProject = Object.keys(v.mcpServers);
    }
  }
  return { project, user, userProject };
}

/** The reason lines from the reconciliation output: the `✗` items with subitems and the table rows not marked `✓`. */
function syncReasons(out) {
  const lines = out.split(/\r?\n/);
  const reasons = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/✗/.test(l) && !/^\|/.test(l)) {
      const sub = [];
      for (let j = i + 1; j < lines.length && /^\s{3,}—/.test(lines[j]); j++) sub.push(lines[j].replace(/^\s*—\s*/, '').trim());
      reasons.push(l.trim() + (sub.length ? ': ' + sub.join('; ') : ''));
    } else if (/^\|/.test(l) && !/✓|\u0421\u0442\u0430\u0442\u0443\u0441|---/.test(l)) { // \u0421\u0442\u0430\u0442\u0443\u0441 = the ru table's "Status" header, a parse pattern held as escapes
      const c = l.split('|').map((s) => s.trim()).filter(Boolean);
      reasons.push(c[0] + ' - ' + c[c.length - 1]);
    }
  }
  return reasons;
}

/** The reconciliation indicator: the real exit code of `sync-engines --check` on every build. */
function runSyncCheck(root) {
  const script = path.join(root, SYNC_SCRIPT);
  if (!fs.existsSync(script)) return { ran: false };
  const r = spawnSync(process.execPath, [script, '--check'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  const out = String(r.stdout || '') + String(r.stderr || '');
  return { ran: true, exitCode: r.status, ok: r.status === 0, reasons: syncReasons(out), command: 'node .claude/scripts/sync-engines.cjs --check' };
}

/**
 * Finds the `claude` executable in the process's PATH. On Windows `spawnSync('claude', ...)` without
 * `shell: true` does not resolve the npm shim (`claude.cmd`) - CreateProcess does not read PATHEXT itself,
 * only cmd.exe does. So an explicit path with the extension is looked up once at startup (the cache below),
 * not on every call - "an explicit path at startup", not a search in place.
 */
function findExecutable(name) {
  const isWin = process.platform === 'win32';
  const dirs = String(process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);
  const exts = isWin ? String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';') : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* no file - try on */ }
    }
  }
  return null;
}

const CLAUDE_BIN = findExecutable('claude');

/** The engine's plugins: `claude plugin list --json` - id/scope/enabled, no secret values (prohibition 15). */
function readPlugins(root) {
  if (!CLAUDE_BIN) {
    return { ran: false, list: [], reason: msg('dashboard-view.no_claude_bin') };
  }
  const r = spawnSync(CLAUDE_BIN, ['plugin', 'list', '--json'], { cwd: root, encoding: 'utf8', timeout: 15000 });
  if (r.error) return { ran: false, list: [], reason: msg('dashboard-view.spawn_error', { error: r.error.message }) };
  if (r.status !== 0) {
    return { ran: false, list: [], reason: msg('dashboard-view.plugin_exit', { code: r.status }) };
  }
  let arr;
  try { arr = JSON.parse(r.stdout); } catch { return { ran: false, list: [], reason: msg('dashboard-view.not_json') }; }
  if (!Array.isArray(arr)) return { ran: false, list: [], reason: msg('dashboard-view.not_json_array') };
  return { ran: true, list: arr.map((p) => ({ id: p.id, scope: p.scope, enabled: !!p.enabled })) };
}

/** The "Engine" tab: the Claude Code settings, the node roles, MCP, skills, the reconciliation. */
function engineSettings(root) {
  const st = readJson(path.join(root, '.claude', 'settings.json'));
  return {
    present: !!st,
    env: readEnv(st),
    hooks: readHooks(st),
    nodes: readNodes(path.join(root, '.claude', 'agents')),
    skills: subdirs(path.join(root, '.claude', 'skills')).sort(),
    mcp: readMcpNames(root),
    check: runSyncCheck(root),
    plugins: readPlugins(root),
  };
}

module.exports = { mcpConfigs, transcriptsDir, engineSettings };
