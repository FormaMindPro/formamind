'use strict';
/**
 * guard-cards.lib.cjs - the decision logic of the card guard (PreToolUse on .devtool/features/**).
 * One function, pure over (tool call, target existence): "allow" | "deny-handmade" | "deny-form".
 * Part of the project extensions (project/extensions/custom/claude/hooks/), synced to .claude/hooks/.
 */
const STATUSES = ['backlog', 'todo', 'in-progress', 'review', 'done'];

/** The text a tool call puts into the card file: Write - the whole content, Edit - the injected string. */
function incomingText(call) {
  const ti = call.tool_input || {};
  if (call.tool_name === 'Write') return String(ti.content || '');
  return String(ti.new_string || '');
}

function guardCards(call, targetExists) {
  const ti = call.tool_input || {};
  const p = String(ti.file_path || ti.path || '');
  if (!p) return 'allow';
  // Only the board is guarded: any write outside .devtool/features passes untouched.
  if (!/\/\.devtool\/features(\/|$)/.test(p.replace(/\\/g, '/'))) return 'allow';
  // A hand-made card: a Write of a file the board does not have yet. The script new-card.cjs is the only maker.
  if (call.tool_name === 'Write' && !targetExists) return 'deny-handmade';
  const text = incomingText(call);
  if (!text) return 'allow';
  // Status: only a written status line is judged, and only against the closed enum (§7).
  const status = text.match(/status:\s*"([^"]+)"/);
  if (status && !STATUSES.includes(status[1])) return 'deny-form';
  // Labels: exactly one goal label, at most one route label - on a labels line the edit writes or replaces.
  const labels = text.match(/labels:\s*\[[^\]]*\]/);
  if (labels) {
    const goals = labels[0].match(/goal-[a-z0-9-]+/g) || [];
    const routes = labels[0].match(/route-[0-8]/g) || [];
    if (goals.length !== 1 || routes.length > 1) return 'deny-form';
  }
  return 'allow';
}

module.exports = { guardCards, STATUSES };
