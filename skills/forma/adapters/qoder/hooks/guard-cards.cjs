#!/usr/bin/env node
'use strict';

// PreToolUse / Write|Edit: a card write or edit must leave five fields and four zones in order.
// Write is judged on the content it carries; Edit is judged on the file it produces — the old_string is
// replaced by the new_string in memory and the result is checked, so a partial edit cannot break the form.
// The board scripts write files directly, so this guard does not stand in their way.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ZONES = ['## Task', '## Kit', '## History', '## Result'];

function isCardPath(file) {
  const text = String(file || '').replace(/\\/g, '/');
  return /(^|\/)\.devtool\/features\/(done\/)?card-\d+.*\.md$/.test(text);
}

function fiveFields(text) {
  const match = String(text).replace(/\r\n/g, '\n').match(/^## Task\s*\n\s*(\d+ · .+)$/m);
  if (!match) return null;
  const parts = match[1].split('|').map((s) => s.trim());
  return parts.length === 5 ? parts : null;
}

function zonesOk(text) {
  const at = ZONES.map((zone) => text.indexOf(zone));
  if (at.some((i) => i < 0)) return false;
  return at.every((value, i) => i === 0 || value > at[i - 1]);
}

const formOk = (text) => Boolean(fiveFields(text)) && zonesOk(text);

/** Why the text breaks the card form, or null when the form holds. */
function breakage(text) {
  if (!fiveFields(text)) return 'the Task line must carry five fields (kind | delivers | criterion | budget | next)';
  if (!zonesOk(text)) return 'the zones must be Task, Kit, History, Result in this order';
  return null;
}

function readCard(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** The file an Edit produces, or null when the replacement does not apply (the tool itself rejects that call). */
function applyEdit(original, oldString, newString, replaceAll) {
  if (!oldString || !original.includes(oldString)) return null;
  if (replaceAll) return original.split(oldString).join(newString);
  const at = original.indexOf(oldString);
  return original.slice(0, at) + newString + original.slice(at + oldString.length);
}

/**
 * The verdict on one hook input: null — the call passes, a string — the reason to block it.
 * `reader` is injectable so the selftest can run without touching the board.
 */
function judge(input, reader = readCard) {
  const tool = String(input.tool_name || input.toolName || '');
  const toolInput = input.tool_input || input.toolInput || {};
  const file = toolInput.file_path || toolInput.filePath || toolInput.path || '';
  if (!isCardPath(file)) return null;
  if (/^write/i.test(tool)) return breakage(String(toolInput.content || ''));
  if (!/^edit/i.test(tool)) return null;
  const oldString = toolInput.old_string ?? toolInput.oldString ?? '';
  const newString = toolInput.new_string ?? toolInput.newString ?? '';
  if (typeof oldString !== 'string' || !oldString) return null;
  const original = reader(file);
  if (original === null) return null;
  const edited = applyEdit(original, oldString, String(newString ?? ''),
    Boolean(toolInput.replace_all ?? toolInput.replaceAll));
  if (edited === null) return null;
  const why = breakage(edited);
  // Only an edit that breaks a form still standing is refused: a card already broken may still be repaired.
  return why && formOk(original) ? why : null;
}

const VALID = '# t\n\n## Task\n\n1 · tooling | x | check: node ok.cjs | 1 | human\n\n## Kit\n\n## History\n\n## Result\n';
const FOUR = '# t\n\n## Task\n\n1 · tooling | x | check: node ok.cjs | 1\n\n## Kit\n\n## History\n\n## Result\n';
const SWAPPED = '# t\n\n## Task\n\n1 · tooling | x | check: node ok.cjs | 1 | human\n\n## History\n\n## Kit\n\n## Result\n';

function editCase(name, toolInput, expected, original = VALID) {
  const verdict = judge(
    { tool_name: 'Edit', tool_input: Object.assign({ file_path: '.devtool/features/card-1-selftest.md' }, toolInput) },
    () => original
  );
  return [name, Boolean(verdict), expected];
}

function fileSystemCase(name, expected) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-cards-'));
  try {
    const file = path.join(dir, '.devtool', 'features', 'card-2-selftest.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, VALID);
    const verdict = judge({ tool_name: 'Edit', tool_input: { file_path: file, old_string: '## Result\n', new_string: '' } });
    return [name, Boolean(verdict), expected];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function selftest() {
  const cases = [
    // Write: the whole content is judged
    ['write valid card content', Boolean(judge({ tool_name: 'Write', tool_input: { file_path: '.devtool/features/card-1-selftest.md', content: VALID } })), false],
    ['write four task fields', Boolean(judge({ tool_name: 'Write', tool_input: { file_path: '.devtool/features/card-1-selftest.md', content: FOUR } })), true],
    ['write zones out of order', Boolean(judge({ tool_name: 'Write', tool_input: { file_path: '.devtool/features/card-1-selftest.md', content: SWAPPED } })), true],
    ['write outside the board', Boolean(judge({ tool_name: 'Write', tool_input: { file_path: 'src/app.js', content: 'x' } })), false],
    // Edit: the produced file is judged
    editCase('edit appends a History line', { old_string: '## History\n', new_string: '## History\n- `Kit`, a note.\n' }, false),
    editCase('edit is a no-op', { old_string: '## Result\n', new_string: '## Result\n' }, false),
    editCase('edit drops a task field', { old_string: '| 1 | human', new_string: '| human' }, true),
    editCase('edit drops the Result zone', { old_string: '## Result\n', new_string: '' }, true),
    editCase('edit swaps two zones', { old_string: '## Kit\n\n## History', new_string: '## History\n\n## Kit' }, true),
    editCase('edit old_string absent', { old_string: 'nowhere', new_string: 'x' }, false),
    editCase('edit repairs a broken card', { old_string: '| 1\n', new_string: '| 1 | human\n' }, false, FOUR),
    editCase('edit of a missing card', { old_string: '## Result\n', new_string: '' }, false, null),
    ['edit outside the board', Boolean(judge({ tool_name: 'Edit', tool_input: { file_path: 'src/app.js', old_string: 'a', new_string: 'b' } })), false],
    fileSystemCase('edit drops the Result zone on disk', true)
  ];
  let failed = 0;
  for (const [name, got, expected] of cases) {
    if (got !== expected) {
      console.error('guard-cards selftest: ' + name + ' expected ' + expected + ' got ' + got);
      failed += 1;
    }
  }
  if (failed) process.exit(1);
  console.log('guard-cards selftest: ok');
}

function block(reason) {
  console.error(reason);
  process.exit(2);
}

function main() {
  if (process.argv.includes('--selftest')) return selftest();
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (error) {
    block('[sled] card guard fail-closed: the hook input is unreadable: ' + error.message);
  }
  if (!String(raw).trim()) block('[sled] card guard fail-closed: empty hook input');
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch (error) {
    block('[sled] card guard fail-closed: the hook input is not JSON: ' + error.message);
  }
  const why = judge(input);
  if (!why) process.exit(0);
  const action = /^edit/i.test(String(input.tool_name || input.toolName || '')) ? 'card edit' : 'card write';
  block('[sled] ' + action + ' blocked: ' + why + '.');
}

main();
