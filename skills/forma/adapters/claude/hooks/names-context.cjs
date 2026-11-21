#!/usr/bin/env node
'use strict';

/**
 * names-context.cjs - the UserPromptSubmit reminder of names (AGENTS.md section 1, prohibition 20).
 * The main session receives the human's prompt; when it mentions protocol codes, the hook appends
 * the resolvable names, so the answer is built with them. It is a reminder of context, not a check
 * of the answer: Claude Code has no final-message hook, and the outbound scan stays the speaker's.
 *
 * Fail-open: an unreadable input, a missing resolver or any other error prints nothing and exits 0.
 * Only the main session gets this event; subagents do not.
 *
 *   echo '{"prompt":"<text>"}' | node .claude/hooks/names-context.cjs
 */

const fs = require('node:fs');
const path = require('node:path');

function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.forma', 'i18n', 'names.cjs'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(start);
    dir = up;
  }
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return; }
  const text = String(input.prompt || input.userPrompt || '');
  if (!text) return;
  const root = findRoot(__dirname);
  const names = require(path.join(root, '.forma', 'i18n', 'names.cjs'));
  const i18n = require(path.join(root, '.forma', 'i18n', 'index.cjs'));
  const lang = i18n.projectLang(root);
  const hits = names.scan(root, text, lang);
  if (!hits.length) return;
  const tag = i18n.message('names.tag', {}, lang);
  const header = i18n.message('names.header', {}, lang);
  const lines = hits.slice(0, 8).map((h) => '- ' + h.render);
  process.stdout.write(tag + ' ' + header + '\n' + lines.join('\n') + '\n');
}

try { main(); } catch { /* fail-open: a reminder never blocks the prompt */ }
process.exit(0);
