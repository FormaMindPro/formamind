#!/usr/bin/env node
'use strict';

/**
 * stop-names.cjs - the Stop reminder of bare codes (AGENTS.md section 1, prohibition 20;
 * the human rule: .forma/manual/en/03-protocol/LANGUAGE.md). When the session stops, the hook
 * reads the final assistant message from the transcript and warns about protocol codes carried
 * without their human name beside them. It is a reminder of the outbound scan, not a check:
 * the pre-send scan stays the speaker's. Wired for Claude Code only - the other engines' hook
 * events have no stop analog (manual LANGUAGE.md, "The bare-code warning").
 *
 * Fail-open: an unreadable input, a missing transcript or any other error prints nothing and exits 0.
 *
 *   echo '{"transcript_path":"<file>"}' | node .claude/hooks/stop-names.cjs
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

/** The text of the last assistant message in a transcript JSONL file; '' when none. */
function lastAssistantText(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const m = e && e.message;
    if (!m || m.role !== 'assistant') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      return m.content.filter((p) => p && p.type === 'text').map((p) => p.text).join('\n');
    }
  }
  return '';
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return; }
  const file = String(input.transcript_path || '');
  if (!file || !fs.existsSync(file)) return;
  const text = lastAssistantText(file);
  if (!text) return;
  const root = findRoot(__dirname);
  const names = require(path.join(root, '.forma', 'i18n', 'names.cjs'));
  const i18n = require(path.join(root, '.forma', 'i18n', 'index.cjs'));
  const lang = i18n.projectLang(root);
  const bare = [];
  const seen = new Set();
  for (const hit of names.scan(root, text, lang)) {
    if (seen.has(hit.code)) continue;
    const lineStart = text.lastIndexOf('\n', hit.index) + 1;
    const lineEnd = text.indexOf('\n', hit.index);
    const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
    if (line.includes(hit.name)) continue;
    seen.add(hit.code);
    bare.push(i18n.message('names.stop.line', { code: hit.code, render: hit.render }, lang));
  }
  if (!bare.length) return;
  console.error(i18n.message('names.stop.header', { n: bare.length }, lang));
  for (const line of bare) console.error('  - ' + line);
}

main();
