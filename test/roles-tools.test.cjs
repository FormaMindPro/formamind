'use strict';
// A role whose text tells one to run a board script must have it in its `tools:` list: otherwise in a live subagent
// call the command is rejected and the role silently falls back to hand-editing the card. A measurement in the main
// session (where everything is allowed) does not see such a hole - only checking the role text against the list catches it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AGENTS = path.join(__dirname, '..', 'skills', 'forma', 'adapters');
const SCRIPTS = ['card-move', 'new-card', 'check-board', 'run-in-card'];
const ENGINES = ['claude', 'gemini'];

function role(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) return null;
  const tools = (m[1].match(/^tools:\s*(.*)$/m) || [])[1];
  return { tools: tools == null ? null : tools, body: m[2] };
}

const allows = (tools, script) => tools.includes(`Bash(node .forma/board/${script}.cjs *)`) || tools.includes('Bash(node .forma/board/*)');

for (const engine of ENGINES) {
  const dir = path.join(AGENTS, engine, 'agents');
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    test(`${engine}/${name}: the board scripts from the role text are allowed in tools`, () => {
      const r = role(path.join(dir, name));
      if (!r || r.tools == null || !/\bBash\b/.test(r.tools)) return; // a role without a list or without Bash - not our case: Bash is not given to it at all
      const used = SCRIPTS.filter((s) => new RegExp(`node \\.forma/board/${s}\\.cjs\\b`).test(r.body));
      const missing = used.filter((s) => !allows(r.tools, s));
      assert.deepEqual(missing, [], `${engine}/${name}: the text has a call missing from tools: ${missing.join(', ')}`);
    });
  }
}

test('Spec creates cards with the script, Run and Core hand them over with card-move (not by editing the file)', () => {
  for (const engine of ENGINES) {
    const g = (n) => role(path.join(AGENTS, engine, 'agents', n + '.md'));
    assert.ok(allows(g('spec').tools, 'new-card'), engine + '/spec: no new-card');
    assert.ok(allows(g('run').tools, 'card-move'), engine + '/run: no card-move');
    assert.ok(allows(g('core').tools, 'card-move'), engine + '/core: no card-move');
  }
});
