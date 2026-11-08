'use strict';

/**
 * The MiniMax engine's capabilities - facts, not opinions (contract 9).
 *
 * The file `.minimax/.state/capabilities.json` is written by the probe, not by a node. The core reads it
 * instead of a self-report: the isolation gate in `.forma/board/new-card.cjs` looks at
 * `isolation.available` and does not let a production cycle run in the degraded mode.
 *
 * The probe is honest: what cannot be proven from the file system is marked `available: null` with a reason;
 * what is proven absent - `available: false` with a reason; `true` is set only where a proof is named.
 * A discipline not substituted by a construction is declared a discipline.
 *
 * Printed labels come from the core dictionary: English key in code, ru value as data.
 *
 * Run: node .minimax/scripts/capabilities.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const i18n = require([path.resolve(__dirname, '../../.forma/i18n/index.cjs'), path.resolve(__dirname, '../../../../core/i18n/index.cjs')].find((p) => fs.existsSync(p)));
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..');
const STATE = path.join(ROOT, '.minimax', '.state', 'capabilities.json');
const LEDGER = path.join(ROOT, '.minimax', '.ledger', 'calls.jsonl');
const PLUGIN_ID = 'minimax-engine';
/** The package's source in the project and the installed copy in the runtime profile. */
const PLUGIN_SOURCE = path.join(ROOT, 'miniapps', PLUGIN_ID, '.minimax-plugin', 'plugin.json');
const PLUGIN_PROFILE = path.join(
  process.env.MINIMAX_DATA_DIR || path.join(os.homedir(), '.minimax'),
  'plugins', PLUGIN_ID, '.minimax-plugin', 'plugin.json'
);
/** The events the engine's package carries. */
const PLUGIN_EVENTS = ['PreToolUse', 'UserPromptSubmit', 'SessionStart', 'SubagentStart', 'SubagentStop'];
/** The session's observations witness: the role delivery and the roles registration - not derived from files. */
const WITNESS = path.join(ROOT, '.minimax', '.state', 'observed-runtime.json');

function readWitness() {
  try {
    if (!fs.existsSync(WITNESS)) return null;
    const w = JSON.parse(fs.readFileSync(WITNESS, 'utf8'));
    return w && typeof w === 'object' ? w : null;
  } catch {
    return null;
  }
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** A path from the project root - the facts file must hold no machine paths (a clean zone). */
function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

function probe() {
  const now = new Date().toISOString();

  // Isolation: child sessions with a separate context is given by the runtime (task + the continuation of the call).
  // The proof - the runtime's agents roster: without it isolation is not claimed.
  const agentsRoot = path.join(os.homedir(), '.minimax', 'agents');
  const roster = fs.existsSync(agentsRoot)
    ? fs.readdirSync(path.join(agentsRoot, '.builtin'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
  const pluginInstalled = exists(PLUGIN_PROFILE);
  const pluginRoles = 'minimax-engine:spec|minimax-engine:kit|minimax-engine:run|minimax-engine:core|minimax-engine:extractor|minimax-engine:plumb-haiku|minimax-engine:asset-describer-haiku';
  const witness = readWitness();
  const seenRegistry = witness && witness.observations && witness.observations.agentRegistry ? witness.observations.agentRegistry : null;
  const isolation = fs.existsSync(agentsRoot)
    ? {
        available: true,
        mechanism: msg('mcap.mech_task'),
        verifiedBy: msg('mcap.roster') + (roster.length ? roster.join(', ') : msg('mcap.empty')) + msg('mcap.roster_tail'),
        projectRolesRegistered: seenRegistry ? true : null,
        projectRolesMechanism:
          msg('mcap.plugin_registers') + PLUGIN_ID + msg('mcap.plugin_registers_tail') + pluginRoles,
        projectRolesReason: seenRegistry
          ? msg('mcap.delegation_seen') + seenRegistry.what + msg('mcap.delegation_seen_tail')
          : pluginInstalled
            ? msg('mcap.delegation_pending')
            : msg('mcap.package_absent'),
      }
    : {
        available: false,
        reason: msg('mcap.no_roster'),
        verifiedBy: msg('mcap.check_agents'),
        projectRolesRegistered: false,
        projectRolesReason: msg('mcap.no_registry'),
      };

  // Hooks: the engine's package sits in the runtime profile and carries the deletion guard, the main
  // session's role delivery and the calls log. Installed - so the mechanism is there; whether the output
  // reaches a live session is a separate question, and it is marked honestly.
  const pluginSourceExists = exists(PLUGIN_SOURCE);
  const seenHooks = witness && witness.observations && witness.observations.hooks ? witness.observations.hooks : null;
  const hooks = pluginInstalled
    ? {
        available: true,
        events: PLUGIN_EVENTS,
        package: PLUGIN_ID,
        source: pluginSourceExists ? rel(PLUGIN_SOURCE) : null,
        verifiedBy: msg('mcap.hooks_verified'),
        observedLive: seenHooks ? seenHooks.observedLive : [],
        observedOnlyInSimulation: seenHooks ? seenHooks.observedOnlyInSimulation : PLUGIN_EVENTS,
        deliveredInSession: seenHooks ? true : null,
        deliveredReason: seenHooks
          ? null
          : msg('mcap.hook_unobserved'),
      }
    : {
        available: false,
        reason: msg('mcap.hooks_absent'),
        source: pluginSourceExists ? rel(PLUGIN_SOURCE) : null,
      };

  // The continuation of the same call: a runtime mechanism (task_append by task_id), not derivable
  // from the file system - the proof is a live call, the record in the session's observations witness.
  // `null` is an honest "not proven by the probe", not a default `true`.
  const seenContinuation = witness && witness.observations && witness.observations.continuation ? witness.observations.continuation : null;
  const continuation = seenContinuation
    ? {
      available: true,
      reason: null,
      mechanism: msg('mcap.mech_task_append'),
      what: seenContinuation.what,
      how: seenContinuation.how,
      observedAt: seenContinuation.observedAt || witness.observedAt,
      sessionId: seenContinuation.sessionId || witness.sessionId,
      childSessionId: seenContinuation.childSessionId || null,
      verifiedBy: msg('mcap.witness_continuation'),
    }
    : {
      available: null,
      reason:
        msg('mcap.continuation_note'),
      mechanism: msg('mcap.mech_task_append'),
    };

  // The main session's role delivery: the package's SessionStart hook hands the role over in the documented
  // form (hookSpecificOutput.additionalContext). The form is verified by a hook run, the delivery - by a session
  // observation; neither is derivable from files, so the proof is the witness.
  const seenDelivery = witness && witness.observations && witness.observations.roleDelivery ? witness.observations.roleDelivery : null;
  const roleDelivery = seenDelivery
    ? {
        available: true,
        reason: null,
        method: msg('mcap.intent_reads_first'),
        hook: 'SessionStart → hookSpecificOutput.additionalContext',
        what: seenDelivery.what,
        observedAt: witness.observedAt,
        sessionId: witness.sessionId,
        verifiedBy: msg('mcap.witness'),
      }
    : {
        available: null,
        reason:
          msg('mcap.delivery_form_note'),
        method: msg('mcap.intent_reads_first'),
        hook: 'SessionStart → hookSpecificOutput.additionalContext',
      };

  // The spend: the calls log is the spend lines' source. The SubagentStop hook keeps it.
  const ledgerExists = exists(LEDGER);
  const ledgerRecords = ledgerExists
    ? fs.readFileSync(LEDGER, 'utf8').split(/\r?\n/).filter((l) => l.trim()).length
    : 0;

  return {
    engine: 'minimax',
    engineTag: 'minimax',
    probedAt: now,
    isolation,
    continuation,
    hooks,
    roleDelivery,
    usage: {
      source: 'ledger',
      available: ledgerExists,
      reason: ledgerExists
        ? null
        : msg('mcap.no_ledger_yet'),
      ledger: rel(LEDGER),
      records: ledgerRecords,
      verifiedBy: ledgerExists
        ? msg('mcap.ledger_line') + rel(LEDGER) + msg('mcap.ledger_line_tail')
        : null,
      writer:
        msg('mcap.subagentstop_note'),
    },
    note:
      msg('mcap.honesty_note'),
  };
}

function main() {
  const cap = probe();
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(cap, null, 2) + '\n', 'utf8');
  console.log(msg('mcap.written') + path.relative(ROOT, STATE).replace(/\\/g, '/'));
  console.log(JSON.stringify(cap, null, 2));
}

if (require.main === module) main();

module.exports = { probe, STATE };
