#!/usr/bin/env node
'use strict';

/**
 * sync-ledger.cjs - a module and CLI for the Gemini call ledger (.agents/.ledger/calls.jsonl):
 *  - formatting spend lines by the ECONOMY.md / AGENTS.md §3 contract;
 *  - checking the parity between the ledger records and the board cards (.devtool/features/);
 *  - dumping the aggregated spend into the dashboard's cache (.forma/dashboard/.cache/gemini-usage.json);
 *  - creating the .agents/.ledger/ directory structure in the shipped template.
 */

const fs = require('fs');
const path = require('path');

function resolveModule(candidates) {
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

// The layout differs between the installed copy and the template checkout - the same resolver the
// spend-line and ledger-parity modules go through.
function getI18nModule() {
  const p = resolveModule([
    path.resolve(__dirname, '../../.forma/i18n/index.cjs'),
    path.resolve(__dirname, '../../../core/i18n/index.cjs'),
    path.resolve(process.cwd(), '.forma/i18n/index.cjs'),
  ]);
  return require(p);
}

function getSpendLineModule() {
  const p = resolveModule([
    path.resolve(__dirname, '../../.forma/dashboard/spend-line.cjs'),
    path.resolve(__dirname, '../../../core/dashboard/spend-line.cjs'),
    path.resolve(__dirname, '../../claude/dashboard/spend-line.cjs'),
    path.resolve(process.cwd(), '.forma/dashboard/spend-line.cjs'),
  ]);
  return require(p);
}

function getLedgerParityModule() {
  const p = resolveModule([
    path.resolve(__dirname, '../../.forma/board/checks/ledger-parity.cjs'),
    path.resolve(__dirname, '../../../core/board/checks/ledger-parity.cjs'),
    path.resolve(process.cwd(), '.forma/board/checks/ledger-parity.cjs'),
    path.resolve(process.cwd(), '.forma/protocol/skills/forma/core/board/checks/ledger-parity.cjs'),
  ]);
  return require(p);
}

// Printed and written labels come from the core dictionary: English key in code, ru value as data -
// the CLI prints the same ru lines as before the translation.
const i18n = getI18nModule();
const msg = (code, params) => i18n.message(code, params, 'ru');

/**
 * Makes sure the .agents/.ledger/ directory structure and the calls.jsonl file exist.
 */
function ensureLedgerDir(root) {
  const base = root || process.cwd();
  const dir = path.join(base, '.agents', '.ledger');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const callsFile = path.join(dir, 'calls.jsonl');
  if (!fs.existsSync(callsFile)) {
    fs.writeFileSync(callsFile, '', 'utf8');
  }
  return dir;
}

/**
 * Reads the call records from .agents/.ledger/calls.jsonl.
 */
function getLedgerCalls(root) {
  const base = root || process.cwd();
  const ledgerFile = path.join(base, '.agents', '.ledger', 'calls.jsonl');
  if (!fs.existsSync(ledgerFile)) return [];
  const lines = fs.readFileSync(ledgerFile, 'utf8').trim().split('\n').filter(Boolean);
  const calls = [];
  for (const l of lines) {
    try {
      calls.push(JSON.parse(l));
    } catch {}
  }
  return calls;
}

/**
 * Builds a normalized spend line from a call record.
 */
function deriveSpendLineForCall(call, nodeName, description) {
  const { formatSpendLine } = getSpendLineModule();
  const d = (call.timestamp || new Date().toISOString()).slice(0, 10);
  const tokens = call.input_tokens != null && call.output_tokens != null
    ? call.input_tokens + call.output_tokens
    : null;

  return formatSpendLine({
    node: nodeName || 'Run',
    date: d,
    engine: 'gemini',
    tokens: tokens,
    cache_read: call.cache_read_tokens ?? null,
    tokens_out: call.output_tokens ?? null,
    duration_s: call.duration_s ?? null,
    call_id: call.conversationId || 'id unknown',
    desc: description || msg('spend.gemini-sync.default_desc'),
  });
}

/**
 * Checks the parity between the call ledger records and the cards.
 */
function checkLedgerParity(root, since) {
  const base = root || process.cwd();
  try {
    const { run } = getLedgerParityModule();
    return run({ root: base, since });
  } catch (err) {
    return [msg('spend.gemini-sync.parity_error', { message: err.message })];
  }
}

/**
 * Dumps the aggregated session spend into the dashboard's cache (.forma/dashboard/.cache/gemini-usage.json).
 */
function dumpUsageCache(root) {
  const base = root || process.cwd();
  const calls = getLedgerCalls(base);

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalTokens = 0;

  for (const c of calls) {
    const inp = c.input_tokens || 0;
    const out = c.output_tokens || 0;
    const cr = c.cache_read_tokens || 0;
    totalInput += inp;
    totalOutput += out;
    totalCacheRead += cr;
    totalTokens += (inp + out);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    engine: 'gemini',
    project: base,
    totals: {
      calls: calls.length,
      tokens: totalTokens,
      input: totalInput,
      output: totalOutput,
      cacheRead: totalCacheRead,
    },
    calls: calls.map((c) => ({
      conversationId: c.conversationId,
      timestamp: c.timestamp,
      tokens: (c.input_tokens || 0) + (c.output_tokens || 0),
      cacheRead: c.cache_read_tokens || null,
      duration_s: c.duration_s || null,
      subagent: c.subagentCall ? c.subagentCall.name : null,
    })),
  };

  const cacheDir = path.join(base, '.forma', 'dashboard', '.cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  const cacheFile = path.join(cacheDir, 'gemini-usage.json');
  fs.writeFileSync(cacheFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return cacheFile;
}

function main() {
  const args = process.argv.slice(2);
  const root = process.cwd();

  if (args.includes('--ensure')) {
    const dir = ensureLedgerDir(root);
    console.log(msg('spend.gemini-sync.ensured', { dir }));
    return;
  }

  if (args.includes('--dump-cache') || args.includes('--write-cache')) {
    const file = dumpUsageCache(root);
    console.log(msg('spend.gemini-sync.cache_saved', { file }));
    return;
  }

  if (args.includes('--format')) {
    const idx = args.indexOf('--format');
    const id = args[idx + 1];
    const calls = getLedgerCalls(root);
    const call = calls.find((c) => c.conversationId === id) || { conversationId: id };
    const nodeIdx = args.indexOf('--node');
    const node = nodeIdx >= 0 ? args[nodeIdx + 1] : 'Run';
    const descIdx = args.indexOf('--desc');
    const desc = descIdx >= 0 ? args[descIdx + 1] : msg('spend.gemini-sync.default_desc');
    console.log(deriveSpendLineForCall(call, node, desc));
    return;
  }

  if (args.includes('--check') || args.length === 0) {
    ensureLedgerDir(root);
    const problems = checkLedgerParity(root);
    if (problems.length > 0) {
      console.error(msg('spend.gemini-sync.parity_broken'));
      for (const p of problems) {
        console.error(`  — ${p}`);
      }
      process.exit(1);
    }
    console.log(msg('spend.gemini-sync.parity_ok'));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ensureLedgerDir,
  getLedgerCalls,
  deriveSpendLineForCall,
  checkLedgerParity,
  dumpUsageCache,
};
