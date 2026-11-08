#!/usr/bin/env node
// The Codex hooks shared by the PowerShell wrappers (.codex/hooks/*.ps1). They never block: exit 0.
//   intent-start - SessionStart: the main session = Intent (AGENTS.md section 1): the role and the start into the context, a link to the dashboard.
//   check-card   - PostToolUse (apply_patch): a board card is checked by sync-engines --check at the moment of writing.
//
// Printed labels come from the core dictionary: English key in code, ru value as data.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const i18n = require(path.join(ROOT, '.forma', 'i18n', 'index.cjs'));
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..');
const { readIfExists, projectFile } = require(path.join(ROOT, '.forma', 'dashboard', 'lib', 'fs.cjs'));
const projectChecks = require(path.join(ROOT, '.forma', 'i18n', 'project-checks.cjs'));
const read = p => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { return ''; } };
const out = o => process.stdout.write(JSON.stringify(o));

// The start gate (AGENTS.md section 3): the human's goals are not in a draft, the four thresholds are set.
function startGate() {
  const text = projectChecks.gateText(ROOT);
  return text ? text + '\n' : '';
}

function intentStart() {
  const url = 'http://localhost:5050/';
  // The Codex adapters only point at the authority.  Injecting them here used to
  // omit the actual Intent body and start procedure from the main session.
  const role = read('.claude/agents/intent.md').replace(/^---[\s\S]*?---\s*/, '');
  const start = read('.claude/agents/on-demand/intent-session-start.md').replace(/^---[\s\S]*?---\s*/, '');
  let cycle = '';
  try { cycle = execFileSync(process.execPath, [path.join(ROOT, '.claude', 'scripts', 'cycle-status.cjs')], { cwd: ROOT, encoding: 'utf8' }); } catch {}
  const ctx = startGate() + (cycle ? cycle + '\n' : '') + msg('codexhooks.main_session', { url }) + '\n\n' + role + '\n\n' + start;
  out({ systemMessage: msg('codexhooks.dashboard', { url }), hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx } });
}

function checkCard() {
  let input = '';
  try { input = fs.readFileSync(0, 'utf8'); } catch { return; }
  let j; try { j = JSON.parse(input); } catch { return; }
  const ti = j.tool_input || {};
  // apply_patch carries the paths inside the patch text; the other tools - in file_path/path.
  const text = [ti.command, ti.patch, ti.input, ti.file_path, ti.path].filter(x => typeof x === 'string').join('\n');
  const ids = [...new Set([...text.matchAll(/\.devtool[\/\\]features[\/\\](?:done[\/\\])?(card-[^\s\/\\]+?)\.md/g)].map(m => m[1]))];
  if (!ids.length) return;
  const script = path.join(ROOT, '.claude', 'scripts', 'sync-engines.cjs');
  if (!fs.existsSync(script)) return;
  let report = '';
  try { report = execFileSync(process.execPath, [script, '--check'], { cwd: ROOT, encoding: 'utf8' }); }
  catch (e) { report = (e.stdout || '') + (e.stderr || ''); }
  const problems = report.split('\n').filter(l => ids.some(id => l.includes(id)) && !/^\s*ok:/.test(l)).join('\n');
  if (!problems) return;
  out({
    systemMessage: msg('codexhooks.card_failed') + '\n' + problems,
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: msg('codexhooks.card_failed_fix') + '\n' + problems }
  });
}

try { ({ 'intent-start': intentStart, 'check-card': checkCard })[process.argv[2]]?.(); } catch {}
process.exit(0);
// The protocol's template: .forma/protocol/skills/forma/templates-codex/.codex/scripts/codex-hooks.cjs - carries forma-commit.cjs.
