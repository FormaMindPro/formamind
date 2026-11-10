'use strict';

// Install verify profile for Gemini (Antigravity): adapter wiring (hooks, roles, references) and test behavior.
// The core (`.forma/verify/verify-install.cjs`) finds this file via the manifest (`engines[].profile`) and calls `check(ctx)`.
// Expectations come from the manifest (`engine.expect`), not from code: the installer recorded what it installed — the profile checks that against disk.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const walkFiles = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walkFiles(p) : [p];
  });
};

/** Wiring: rules, forma-adapter.cjs, hooks.json (when in expect), plugin.json, mcp_config.json, calls ledger. */
function checkWiring(ctx, expect, out) {
  const { root, finding } = ctx;

  const gemini8 = path.join(root, '.agents', 'rules', 'gemini-8.md');
  if (!fs.existsSync(gemini8)) out.push(finding('.agents/rules/gemini-8.md', 'Gemini §8 rules', 'file missing'));

  const adapter = path.join(root, '.agents', 'forma-adapter.cjs');
  if (!fs.existsSync(adapter)) out.push(finding('.agents/forma-adapter.cjs', 'Gemini adapter', 'file missing'));

  const ledger = path.join(root, '.agents', '.ledger', 'calls.jsonl');
  if (!fs.existsSync(ledger)) out.push(finding('.agents/.ledger/calls.jsonl', 'calls ledger', 'file missing'));

  const pluginFile = path.join(root, '.agents', 'plugins', 'forma', 'plugin.json');
  if (!fs.existsSync(pluginFile)) {
    out.push(finding('.agents/plugins/forma/plugin.json', 'Gemini plugin manifest', 'file missing'));
  } else {
    try { JSON.parse(fs.readFileSync(pluginFile, 'utf8')); }
    catch (e) { out.push(finding('.agents/plugins/forma/plugin.json', 'valid JSON', e.message)); }
  }

  for (const rel of ['.agents/plugins/forma/mcp_config.json', '.agents/mcp_config.json']) {
    const f = path.join(root, rel);
    if (!fs.existsSync(f)) {
      if (rel.includes('plugins')) out.push(finding(rel, 'MCP config', 'file missing'));
    } else {
      try { JSON.parse(fs.readFileSync(f, 'utf8')); }
      catch (e) { out.push(finding(rel, 'valid JSON', e.message)); }
    }
  }

  if (expect.hooks) {
    const hooksFile = path.join(root, '.agents', 'hooks.json');
    if (!fs.existsSync(hooksFile)) {
      out.push(finding('.agents/hooks.json', 'Gemini hooks configuration', 'file missing'));
    } else {
      let cfg;
      try { cfg = JSON.parse(fs.readFileSync(hooksFile, 'utf8')); }
      catch (e) { out.push(finding('.agents/hooks.json', 'valid JSON', e.message)); }

      if (cfg && typeof cfg === 'object') {
        for (const [hookId, spec] of Object.entries(cfg)) {
          if (!spec || typeof spec !== 'object') continue;
          for (const [event, groups] of Object.entries(spec)) {
            if (!Array.isArray(groups)) continue;
            for (const group of groups) {
              for (const h of (group.hooks || [])) {
                if (h && typeof h.command === 'string') {
                  const parts = h.command.trim().split(/\s+/);
                  const scriptArg = parts.find((p) => p.endsWith('.cjs') || p.endsWith('.sh') || p.includes('/')) || (parts.length > 1 ? parts[1] : parts[0]);
                  const target = path.join(root, '.agents', scriptArg);
                  if (!fs.existsSync(target)) {
                    out.push(finding(`.agents/${scriptArg}`, `hook script for ${hookId} (${event})`, 'file missing'));
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

/** Roles: five nodes are present, at least one executor, no placeholders in tools, no root GEMINI.md. */
function checkRoles(ctx, out) {
  const { root, finding } = ctx;
  const dir = path.join(root, '.agents', 'plugins', 'forma', 'agents');
  for (const a of ['intent', 'spec', 'kit', 'run', 'core']) {
    if (!fs.existsSync(path.join(dir, a + '.md'))) {
      out.push(finding(`.agents/plugins/forma/agents/${a}.md`, 'node role', 'file missing'));
    }
  }
  const runDir = path.join(dir, 'run');
  const hasExecutors = (fs.existsSync(runDir) && fs.readdirSync(runDir).some((f) => /^run.*\.md$/.test(f)))
    || (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => /^run.*\.md$/.test(f)));
  if (!hasExecutors) {
    out.push(finding('.agents/plugins/forma/agents/run/*.md', 'at least one executor', 'none'));
  }
  for (const f of walkFiles(dir).filter((x) => x.endsWith('.md'))) {
    const fm = fs.readFileSync(f, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const tools = fm && (fm[1].match(/^tools:.*$/m) || [''])[0];
    if (tools && /mcp__<[^>]*>/.test(tools)) {
      out.push(finding(path.relative(root, f).split(path.sep).join('/') + ' — tools:', 'tool names without placeholders', tools.match(/mcp__<[^>]*>[^,\s]*/)[0]));
    }
  }
  if (fs.existsSync(path.join(root, 'GEMINI.md'))) {
    out.push(finding('GEMINI.md', 'no root GEMINI.md (it shadows reading AGENTS.md)', 'file present'));
  }
}

/** Reference closure: a bare `name.md` in the law and §8 (lowercase, no path) names a file that exists in `.agents/`, `.claude/` or `.forma/`. */
function checkReferences(ctx, out) {
  const { root, finding } = ctx;
  const known = new Set();
  for (const d of ['.agents', '.forma', '.claude']) for (const f of walkFiles(path.join(root, d))) known.add(path.basename(f));
  for (const src of ['AGENTS.md', '.agents/rules/gemini-8.md']) {
    const f = path.join(root, src);
    if (!fs.existsSync(f)) { if (src !== 'AGENTS.md') out.push(finding(src, '§8 Gemini', 'file missing')); continue; }
    const seen = new Set();
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/`([a-z][a-z0-9-]*\.md)`/g)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      if (!known.has(m[1])) out.push(finding(`${src} → \`${m[1]}\``, 'file in .agents/, .claude/ or .forma/', 'no such file'));
    }
  }
}

/** Behavior: node .agents/tests/test-gemini-adapter.cjs exits with 0. */
function checkBehavior(ctx, out) {
  const { root, finding } = ctx;
  const testFile = path.join(root, '.agents', 'tests', 'test-gemini-adapter.cjs');
  if (fs.existsSync(testFile)) {
    const r = spawnSync(process.execPath, [testFile], { cwd: root, encoding: 'utf8' });
    if (r.error || r.status !== 0) {
      const why = ((r.stdout || '') + (r.stderr || '')).split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('— ') || l.startsWith('! ')).slice(0, 5);
      out.push(finding('node .agents/tests/test-gemini-adapter.cjs', 'exit 0', r.error ? r.error.message : 'exit ' + r.status + (why.length ? ': ' + why.join(' | ') : '')));
    }
  }
}

function check(ctx) {
  const out = [];
  const expect = ctx.engine.expect || {};
  checkWiring(ctx, expect, out);
  checkRoles(ctx, out);
  checkReferences(ctx, out);
  if (ctx.behavior) checkBehavior(ctx, out);
  return out;
}

module.exports = { id: 'gemini', check };
