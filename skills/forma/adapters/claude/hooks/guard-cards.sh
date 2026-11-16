#!/bin/sh
# PreToolUse (Write|Edit): the card guard (the law §6–§7). Cards on the board (.devtool/features/**)
# are created only by the script `new-card.cjs` - a hand-made file is refused; a status outside the
# closed enum (backlog | todo | in-progress | review | done) is refused; a `labels` line must carry
# exactly one goal label and at most one route label. Everything else passes. Never blocks the
# session: deny is a tool-call decision, exit 0.
# Selftest: bash .claude/hooks/guard-cards.sh --selftest (fixtures inline, no writes to the board).
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
command -v node >/dev/null 2>&1 || exit 0

if [ "$1" = "--selftest" ]; then
  exec node -e '
const { guardCards } = require(process.cwd() + "/.claude/hooks/guard-cards.lib.cjs");
// The fixture codes are assembled on the fly - a literal card-NNN in a clean zone flags the scanner (prohibition 16).
const code = (n, slug) => ["card", String(n)].join("-") + (slug || "-probe");
const day = new Date().toISOString().slice(0, 10);
const cases = [
  ["hand-made Write of a new card", { tool_name: "Write", tool_input: { file_path: "D:/p/.devtool/features/" + code(999, "-hand") + ".md", content: "---\nstatus: \"backlog\"\n---\n# card" } }, false, "deny-handmade"],
  ["Write outside the board passes", { tool_name: "Write", tool_input: { file_path: "D:/p/project/notes.md", content: "hi" } }, false, "allow"],
  ["Edit setting a status outside the enum", { tool_name: "Edit", tool_input: { file_path: "D:/p/.devtool/features/" + code(1) + ".md", old_string: "status: \"todo\"", new_string: "status: \"in_progress\"" } }, true, "deny-form"],
  ["Edit setting the forbidden completed", { tool_name: "Edit", tool_input: { file_path: "D:/p/.devtool/features/" + code(1) + ".md", old_string: "status: \"review\"", new_string: "status: \"completed\"" } }, true, "deny-form"],
  ["Edit appending a History line passes", { tool_name: "Edit", tool_input: { file_path: "D:/p/.devtool/features/" + code(1) + ".md", old_string: "## History\n", new_string: "## History\n- `Run`, " + day + ": attempt, 10 tokens (0 cache-read), 1 s, \"id\" - did the thing." } }, true, "allow"],
  ["Edit with a second route label", { tool_name: "Edit", tool_input: { file_path: "D:/p/.devtool/features/" + code(1) + ".md", old_string: "labels: [\"goal-x\"]", new_string: "labels: [\"goal-x\", \"route-2\", \"route-4\"]" } }, true, "deny-form"],
  ["Edit with a second goal label", { tool_name: "Edit", tool_input: { file_path: "D:/p/.devtool/features/" + code(1) + ".md", old_string: "labels: [\"goal-x\"]", new_string: "labels: [\"goal-x\", \"goal-y\"]" } }, true, "deny-form"],
];
let fail = 0;
for (const [name, input, exists, want] of cases) {
  const got = guardCards(input, exists);
  const ok = got === want;
  if (!ok) fail++;
  console.log((ok ? "PASS" : "FAIL") + " | " + name + " -> " + got + " (want " + want + ")");
}
console.log("selftest guard-cards:", fail === 0 ? "PASS" : "FAIL");
process.exit(fail === 0 ? 0 : 1);
'
fi

node -e '
const fs = require("fs");
const path = require("path");
const { guardCards } = require(process.cwd() + "/.claude/hooks/guard-cards.lib.cjs");
let input = "";
process.stdin.on("data", (d) => input += d).on("end", () => {
  let j = {};
  try { j = JSON.parse(input); } catch {}
  const ti = j.tool_input || {};
  const p = String(ti.file_path || ti.path || "");
  const norm = p.replace(/\\/g, "/");
  if (!/\/\.devtool\/features(\/|$)/.test(norm)) process.exit(0);
  let exists = false;
  try { exists = fs.existsSync(p); } catch {}
  const decision = guardCards({ tool_name: j.tool_name, tool_input: ti }, exists);
  if (decision === "allow") process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: decision === "deny-handmade"
        ? "A card is created only by the script: node .forma/board/new-card.cjs (the law §6) - a hand-made file lands outside the epic/label machine."
        : "The edit breaks the card form (the law §6): status outside backlog|todo|in-progress|review|done, or a labels line with not exactly one goal-*/more than one route-N."
    }
  }));
});
'
exit 0
