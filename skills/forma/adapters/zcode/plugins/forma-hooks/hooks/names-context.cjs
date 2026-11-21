#!/usr/bin/env node
'use strict';

/**
 * names-context.cjs - the UserPromptSubmit reminder of names for ZCode (AGENTS.md section 1, prohibition 20).
 * Reads the human prompt; when protocol codes are mentioned, resolves human names via
 * .forma/i18n/names.cjs and returns them as hookSpecificOutput.additionalContext.
 *
 * Fail-open: any error or invalid input prints nothing and exits 0.
 */

const fs = require('node:fs');
const path = require('node:path');

function findRoot(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, '.forma', 'i18n', 'names.cjs'))) return dir;
    if (fs.existsSync(path.join(dir, 'skills', 'forma', 'core', 'i18n', 'names.cjs'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function loadModules(root) {
  const installed = path.join(root, '.forma', 'i18n');
  if (fs.existsSync(path.join(installed, 'names.cjs')) && fs.existsSync(path.join(installed, 'index.cjs'))) {
    return { names: require(path.join(installed, 'names.cjs')), i18n: require(path.join(installed, 'index.cjs')) };
  }
  const source = path.join(root, 'skills', 'forma', 'core', 'i18n');
  if (fs.existsSync(path.join(source, 'names.cjs')) && fs.existsSync(path.join(source, 'index.cjs'))) {
    return { names: require(path.join(source, 'names.cjs')), i18n: require(path.join(source, 'index.cjs')) };
  }
  return null;
}

function main() {
  let text = '';
  let root = null;
  try {
    const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (typeof payload.prompt === 'string') text = payload.prompt;
    else if (typeof payload.userPrompt === 'string') text = payload.userPrompt;
    const start = payload.cwd
      || (Array.isArray(payload.workspacePaths) && payload.workspacePaths[0])
      || process.env.CLAUDE_PROJECT_DIR
      || process.cwd();
    root = findRoot(start);
  } catch {
    return;
  }
  if (!text || !root) return;
  try {
    const mod = loadModules(root);
    if (!mod) return;
    const lang = mod.i18n.projectLang(root);
    const hits = mod.names.scan(root, text, lang);
    if (!Array.isArray(hits) || hits.length === 0) return;
    const tag = mod.i18n.message('names.tag', {}, lang);
    const header = mod.i18n.message('names.header', {}, lang);
    const block = tag + ' ' + header + '\n' + hits.slice(0, 8).map((h) => '- ' + h.render).join('\n');
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: block },
    }));
  } catch {
    // Fail-open: no output, no effect.
  }
}

try { main(); } catch { /* Fail-open. */ }
process.exit(0);
