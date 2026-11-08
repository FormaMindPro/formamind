'use strict';

/**
 * The MiniMax engine's tool log: a role's declared arsenal (the frontmatter) and the hook's record.
 *
 * The log's format - shared with the other engines (`ts · node · agent_id · tool · path`),
 * the log's file - shared with the core: `.forma/dashboard/tool-usage.log`. The plugin hook
 * of this engine writes it; while the plugin is not installed, there is no log - and that is a breakage, not silence:
 * `alive: false` means "the hook has never run".
 */

const i18n = require([path.resolve(__dirname, '../../.forma/i18n/index.cjs'), path.resolve(__dirname, '../../../../core/i18n/index.cjs')].find((p) => fs.existsSync(p)));
const msg = (code, params) => i18n.message(code, params, 'ru');
const fs = require('fs');
const path = require('path');

const LOG = path.join('.forma', 'dashboard', 'tool-usage.log');
const HOOK_ERROR = ['!ERROR', '!\u041e\u0428\u0418\u0411\u041a\u0410']; // the ru marker is a parse pattern (data), the escape pass holds it as \u sequences

/** A tool's bare name: `Bash(node x *)` -> `Bash`. */
function baseName(decl) {
  const i = String(decl).indexOf('(');
  return (i === -1 ? String(decl) : String(decl).slice(0, i)).trim();
}

/** A comma-separated list parse with a look at the brackets: `Bash(node x, y)` - one element. */
function splitTools(line) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(line)) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The roles' declared arsenal: a role's name -> { file, decls }. Only from the frontmatter, not from memory. */
function readDeclared(agentsDir) {
  const roles = new Map();
  let entries = [];
  try {
    entries = fs.readdirSync(agentsDir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md'));
  } catch {
    return roles;
  }
  for (const e of entries) {
    const file = path.join(agentsDir, e.name);
    const text = fs.readFileSync(file, 'utf8');
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) continue;
    const toolsLine = (fm[1].match(/^tools:.*$/m) || [''])[0].replace(/^tools:\s*/, '').trim();
    if (!toolsLine) continue;
    const name = (fm[1].match(/^name:\s*(.+)$/m) || [null, path.basename(e.name, '.md')])[1].trim();
    roles.set(name, { file: e.name, decls: splitTools(toolsLine) });
  }
  return roles;
}

/** The log's parse. No file - the hook has never run. */
function readLog(logFile = LOG) {
  if (!fs.existsSync(logFile)) return { alive: false, rows: [], errors: [] };
  const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/);
  const rows = [];
  const errors = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const parts = s.split('·').map((p) => p.trim());
    if (parts.length < 4) {
      errors.push({ ts: '?', reason: msg('mlog.unparsed', { line: s }) });
      continue;
    }
    const [ts, node, agentId, tool, file] = parts;
    if (HOOK_ERROR.includes(node)) errors.push({ ts, reason: tool });
    else rows.push({ ts, node, agentId, tool, file: file || null });
  }
  return { alive: true, rows, errors };
}

module.exports = { baseName, splitTools, readDeclared, readLog, LOG };
