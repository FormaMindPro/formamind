'use strict';

/**
 * guard-core-cycle.cjs - the constructive gate of the Core cycle accumulation (AGENTS.md §7).
 * Checks whether the card volume has accumulated in the epic (25 by default, set by k:volume in PROJECT.md)
 * before the Core subagent is called to give the verdict and close the cycle.
 *
 * Blocks the Core call when accepted < volume, except when:
 *  - the --force flag is passed;
 *  - the FORMA_CYCLE_FORCE=1 environment variable is set;
 *  - the prompt/arguments carry an explicit early-closing marker.
 */

const fs = require('fs');
const path = require('path');
const i18n = require('../i18n/index.cjs');
const tr = (code, params) => i18n.message(code, params, 'ru');

function checkCoreCycleGuard(opts = {}) {
  const {
    toolName,
    args = {},
    root = process.cwd(),
    force = false,
    epic = null,
  } = opts;

  // 1. When a concrete platform tool is being checked (Antigravity PreToolUse)
  if (toolName && toolName !== 'invoke_subagent') {
    return { decision: 'allow' };
  }

  if (toolName === 'invoke_subagent') {
    const typeName = (args.TypeName || args.role || args.name || '').toLowerCase();
    const role = (args.Role || '').toLowerCase();
    const isCore = typeName === 'core' || role.includes('core');
    if (!isCore) {
      return { decision: 'allow' };
    }
  }

  // 2. The forced / early-run flags check
  const prompt = String(args.Prompt || args.prompt || '');
  const isForce = Boolean(
    force ||
    (process.env.FORMA_CYCLE_FORCE && process.env.FORMA_CYCLE_FORCE !== '0') ||
    (Array.isArray(process.argv) && process.argv.includes('--force')) ||
    /--force\b|\u0434\u043e\u0441\u0440\u043e\u0447\u043d/i.test(prompt)
  );

  if (isForce) {
    return { decision: 'allow', reason: 'force override' };
  }

  // 3. Reading the cycle volume from PROJECT.md
  const pmPath = path.join(root, 'project', 'config', 'PROJECT.md');
  const oldPmPath = path.join(root, 'project', 'PROJECT.md');
  let pm = '';
  try {
    pm = fs.readFileSync(fs.existsSync(pmPath) ? pmPath : oldPmPath, 'utf8');
  } catch {}

  const vm = pm.match(/<!--\s*k:volume\s*-->\s*\|\s*(\d+)/i) ||
             pm.match(/^\|\s*(?:\u041e\u0431\u044a\u0451\u043c\s*(?:\u043a\u0440\u0443\u0433\u0430|\u0446\u0438\u043a\u043b\u0430)|Cycle volume)[^|]*\|\s*(\d+)/mi);
  const volume = vm ? +vm[1] : 25;

  // 4. Counting the accepted cards in done/ (status: "done" and assignee: "Core")
  const boardDir = path.join(root, '.devtool', 'features');
  const doneDir = path.join(boardDir, 'done');
  const perEpic = new Map();

  if (fs.existsSync(doneDir)) {
    for (const f of fs.readdirSync(doneDir)) {
      if (!f.endsWith('.md')) continue;
      try {
        const text = fs.readFileSync(path.join(doneDir, f), 'utf8');
        const cEpic = (text.match(/^epic:\s*"(.+?)"/m) || [])[1];
        const cAssignee = (text.match(/^assignee:\s*"?(.+?)"?\s*$/m) || [])[1];
        const cStatus = (text.match(/^status:\s*"(.+?)"/m) || [])[1];
        if (cEpic && cStatus === 'done' && cAssignee === 'Core') {
          perEpic.set(cEpic, (perEpic.get(cEpic) || 0) + 1);
        }
      } catch {}
    }
  }

  // 5. Resolving the epic under check and the counter
  let targetEpic = epic;
  if (!targetEpic && prompt) {
    for (const ep of perEpic.keys()) {
      if (prompt.includes(ep)) {
        targetEpic = ep;
        break;
      }
    }
  }

  let accepted = 0;
  if (targetEpic && perEpic.has(targetEpic)) {
    accepted = perEpic.get(targetEpic);
  } else if (!targetEpic && perEpic.size > 0) {
    accepted = Math.max(...perEpic.values());
  }

  if (accepted < volume) {
    return {
      decision: 'deny',
      reason: tr('gate.core_cycle_deny', { accepted, volume }),
      accepted,
      volume,
      epic: targetEpic,
    };
  }

  return {
    decision: 'allow',
    accepted,
    volume,
    epic: targetEpic,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const epicIdx = args.indexOf('--epic');
  const epic = epicIdx !== -1 ? args[epicIdx + 1] : null;
  const res = checkCoreCycleGuard({ force, epic });
  if (res.decision === 'deny') {
    console.error(res.reason);
    process.exit(1);
  } else {
    console.log(res.reason || tr('gate.core_cycle_ok', { accepted: res.accepted || 0, volume: res.volume || 25 }));
    process.exit(0);
  }
}

module.exports = { checkCoreCycleGuard };
