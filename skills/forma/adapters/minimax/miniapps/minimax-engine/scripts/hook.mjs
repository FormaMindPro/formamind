#!/usr/bin/env node
'use strict';
/**
 * The hook handler of the MiniMax Code engine (the `.minimax/` zone of the Forma protocol).
 *
 * Five duties, one per event:
 *   UserPromptSubmit - catches the human code phrase and lays a one-shot
 *                      unlock marker (the phrase is a password, not a description; one action).
 *   PreToolUse       - the deletion guard: a destructive command against the protected set -> deny.
 *   SessionStart     - the main session (`Intent`) role delivery through additionalContext.
 *   SubagentStart    - remember when a node call started.
 *   SubagentStop     - the calls ledger: the platform call identifier and its duration.
 *
 * The input format is read tolerantly (the event field is looked up in several names): a hook that
 * did not understand the input stays silent and breaks nothing. The output format is exactly one
 * JSON object when the hook affects the course; otherwise empty stdout and code 0.
 *
 * The hook works only in a protocol project: it recognizes it by `AGENTS.md` and the `.minimax/` zone.
 * The package installed into the profile serves all projects, and there is nothing to guard in a
 * foreign project - the hook stays silent there.
 *
 * The spend numbers: the hook payload carries no tokens and no cache read, so they get into the
 * ledger record as null - and the spend line stays "unknown", not invented (AGENTS.md §3).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const PROJECT = process.env.MINIMAX_PROJECT_DIR || process.cwd();
const ZONE = path.join(PROJECT, '.minimax');
const PLUGIN_ROOT = process.env.PLUGIN_ROOT || process.env.MINIMAX_PLUGIN_ROOT || path.join(PROJECT, 'miniapps', 'minimax-engine');
const DATA = process.env.PLUGIN_DATA || path.join(ZONE, '.plugin-data');
const LEDGER = path.join(ZONE, '.ledger', 'calls.jsonl');
const TRANSCRIPTS = path.join(ZONE, '.transcripts');
const UNLOCK = path.join(ZONE, 'hooks', '.delete-unlock');
const STARTED = path.join(DATA, 'started');

/**
 * The transcript reader: the real spend numbers sit there, not in the hook payload.
 * The module sits next to the hook in the package; when it is absent the spend stays
 * unknown, not zero.
 */
let transcripts = null;
try {
  transcripts = require(path.join(PLUGIN_ROOT, 'scripts', 'transcripts.cjs'));
} catch {
  transcripts = null;
}

/**
 * The core dictionary of the protocol's languages. A Forma project always has it (installed at
 * `.forma/i18n/`); outside one the hook stays silent, so the English fallback below only covers
 * a Forma-shaped project without an installed dictionary (the tests' minimal fixture).
 */
let i18n = null;
try {
  i18n = require(path.join(PROJECT, '.forma', 'i18n', 'index.cjs'));
} catch {
  i18n = null;
}
const EN_FALLBACK = {
  'mhook.deny_reason':
    'The guard of the Forma protocol: this path is protected (the law, the roles, the cards, the knowledge bases). The phrase «',
  'mhook.deny_reason_tail': '» lifts the ban for one action.',
  'mhook.session_start':
    'The project runs on the Forma protocol. The main session is the `Intent` node. First read the role file ',
  'mhook.session_role_mid': ' and the session start file ',
  'mhook.session_start_tail':
    ', then speak with the human as `Intent`. The law rules are in AGENTS.md, §1–§7.',
};
const msg = (code) => (i18n ? i18n.message(code, null, 'ru') : EN_FALLBACK[code] || code);

/** The human code phrase: a password for one action, not a description of intent. */
const PHRASE = '\u041e\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a\u0443';

/** The destructive commands: the guard looks at them and only them. */
const DESTRUCTIVE = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bdel\b/i,
  /\bRemove-Item\b/i,
  /\bMove-Item\b/i,
  /\bgit\s+clean\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\btruncate\b/i,
  /\bshred\b/i,
];

/** The protected set: the core data, when it is there, otherwise the package set. */
const FALLBACK_PROTECTED = [
  '.claude', '.agents', '.codex', '.minimax', '.devtool',
  '.forma/manual', '.forma/living', 'miniapps',
  'AGENTS.md', 'PROJECT.md', 'GOAL.md', 'VARS',
];

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parseInput(text) {
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function eventName(payload) {
  if (!payload) return null;
  for (const k of ['hook_event_name', 'hookEventName', 'event_name', 'eventName', 'event']) {
    if (typeof payload[k] === 'string' && payload[k]) return payload[k];
  }
  return null;
}

/** A Forma protocol project: the law in place and the engine zone in place. */
function isFormaProject() {
  try {
    return fs.existsSync(path.join(PROJECT, 'AGENTS.md')) && fs.existsSync(path.join(ZONE, 'agents', 'intent.md'));
  } catch {
    return false;
  }
}

function protectedList() {
  const core = path.join(PROJECT, '.forma', 'rules', 'protected-paths.json');
  const own = path.join(PLUGIN_ROOT, 'scripts', 'protected-paths.json');
  for (const file of [core, own]) {
    try {
      if (!fs.existsSync(file)) continue;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const list = Array.isArray(data) ? data : data.paths || data.protected || [];
      if (Array.isArray(list) && list.length) return list;
    } catch {
      /* a broken list - take the fallback */
    }
  }
  return FALLBACK_PROTECTED;
}

/** Does the command hit the protected set? We look for a fragment as a separate path segment. */
function hitsProtected(command, fragments) {
  const cmd = String(command).replace(/\\/g, '/');
  return fragments.some((frag) => {
    const f = String(frag).replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[\\s"\'=(:;])' + f + '(/|\\b|$)').test(cmd);
  });
}

function isDestructive(command) {
  return DESTRUCTIVE.some((re) => re.test(command));
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* no place - write nowhere, but do not fall */
  }
}

function nodeName(agentType) {
  const stem = String(agentType || '').split(':').pop() || 'unknown';
  const map = { spec: 'Spec', kit: 'Kit', run: 'Run', core: 'Core', extractor: 'Extractor', 'plumb-haiku': 'Plumb' };
  return map[stem] || stem;
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

function handleUserPromptSubmit(payload) {
  const prompt = String((payload && payload.prompt) || '');
  if (!prompt.includes(PHRASE)) return;
  if (!isFormaProject()) return;
  ensureDir(path.dirname(UNLOCK));
  fs.writeFileSync(UNLOCK, new Date().toISOString(), 'utf8');
  // The source event: the phrase is about permission - not a prompt block, but a side action.
  process.exit(0);
}

function handlePreToolUse(payload) {
  const tool = String((payload && payload.tool_name) || '');
  if (tool !== 'bash') return;
  const input = payload && payload.tool_input ? payload.tool_input : {};
  const command = String(input.command || '');
  if (!command) return;
  if (!isFormaProject()) return;
  if (!isDestructive(command)) return;
  if (!hitsProtected(command, protectedList())) return;

  // The human phrase lifts the ban for one action: the marker is one-shot.
  if (fs.existsSync(UNLOCK)) {
    try { fs.unlinkSync(UNLOCK); } catch { /* the marker is gone - silently too */ }
    process.exit(0);
  }
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: msg('mhook.deny_reason') + PHRASE + msg('mhook.deny_reason_tail'),
    },
  });
}

function handleSessionStart() {
  if (!isFormaProject()) return;
  const intent = path.join(ZONE, 'agents', 'intent.md');
  const start = path.join(ZONE, 'agents', 'on-demand', 'intent-session-start.md');
  emit({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext:
        msg('mhook.session_start') + intent +
        msg('mhook.session_role_mid') + start +
        msg('mhook.session_start_tail'),
    },
  });
}

function handleSubagentStart(payload) {
  const agentId = (payload && payload.agent_id) || '';
  if (!agentId) return;
  if (!isFormaProject()) return;
  ensureDir(STARTED);
  fs.writeFileSync(
    path.join(STARTED, agentId.replace(/[^\w.-]/g, '_') + '.json'),
    JSON.stringify({ startedAt: new Date().toISOString(), agentType: (payload && payload.agent_type) || '' }),
    'utf8'
  );
  process.exit(0);
}

function handleSubagentStop(payload) {
  const agentId = (payload && payload.agent_id) || '';
  if (!agentId) return;
  if (!isFormaProject()) return;
  const file = path.join(STARTED, agentId.replace(/[^\w.-]/g, '_') + '.json');
  let started = null;
  try {
    if (fs.existsSync(file)) {
      started = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.unlinkSync(file);
    }
  } catch {
    started = null;
  }
  const duration = started ? Math.max(0, Math.round((Date.now() - Date.parse(started.startedAt)) / 1000)) : null;
  ensureDir(path.dirname(LEDGER));
  const agentType = (started && started.agentType) || payload.agent_type || '';

  // The real spend numbers are taken from the session transcript - the runtime writes them there
  // step by step. No transcript - null remains, and the spend line reads "unknown", not zero.
  let usage = null;
  let steps = [];
  if (transcripts) {
    try {
      usage = transcripts.readUsage(agentId);
      steps = transcripts.readSteps(agentId);
    } catch {
      usage = null;
    }
  }
  // The normalized transcript - for the dashboard: the floor of the window and the cuts by models.
  if (transcripts && steps.length) {
    try {
      const lines = transcripts.normalizedLines(steps);
      if (lines) {
        ensureDir(TRANSCRIPTS);
        const call = agentId.replace(/[^\w.-]/g, '_');
        fs.writeFileSync(path.join(TRANSCRIPTS, call + '.jsonl'), lines + '\n', 'utf8');
        // The layout the core reads (`card-move.cjs --agent-id`): <folder>/<call>/subagents/agent-<call>.jsonl.
        // The `requestId` deduplication key - per step: one runtime step = one API response.
        const core = transcripts.coreLines ? transcripts.coreLines(steps) : lines;
        const nested = path.join(TRANSCRIPTS, call, 'subagents', `agent-${call}.jsonl`);
        ensureDir(path.dirname(nested));
        fs.writeFileSync(nested, core + '\n', 'utf8');
      }
    } catch {
      /* the transcript did not write - the spend is written to the ledger anyway */
    }
  }

  const record = {
    timestamp: new Date().toISOString(),
    conversationId: agentId,
    node: nodeName(agentType),
    agent_type: agentType,
    duration_s: duration,
    input_tokens: usage ? usage.input : null,
    output_tokens: usage ? usage.output : null,
    cache_read_tokens: usage ? usage.cache_read : null,
    cache_write_tokens: usage ? usage.cache_write : null,
    model: usage ? usage.model : null,
    note: usage
      ? 'the numbers are from the runtime session transcript'
      : 'the hook payload carries no spend, no transcript found - the numbers stay unknown (AGENTS.md §3)',
  };
  fs.appendFileSync(LEDGER, JSON.stringify(record) + '\n', 'utf8');
  process.exit(0);
}

const payload = parseInput(readStdin());
const event = eventName(payload);

switch (event) {
  case 'UserPromptSubmit':
    handleUserPromptSubmit(payload);
    break;
  case 'PreToolUse':
    handlePreToolUse(payload);
    break;
  case 'SessionStart':
    handleSessionStart();
    break;
  case 'SubagentStart':
    handleSubagentStart(payload);
    break;
  case 'SubagentStop':
    handleSubagentStop(payload);
    break;
  default:
    // The event is not understood or not ours - silently, code 0.
    process.exit(0);
}
