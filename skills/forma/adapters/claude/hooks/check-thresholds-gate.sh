#!/bin/sh
# SessionStart: the STOP START gate (the law §3, fail-closed). The project's thresholds and the nine goals
# live as a declaration in project/config/PROJECT.md; `thresholds-declared.cjs` judges the declaration.
# Declared - silence: a start is lawful. Not declared (or the probe fails) - one line into the session
# context naming the holder: the skill `project-setup` and the check command. Never blocks: exit 0.
# Selftest: bash .claude/hooks/check-thresholds-gate.sh --selftest (fixtures in the OS temp dir).
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
command -v node >/dev/null 2>&1 || exit 0

if [ "$1" = "--selftest" ]; then
  exec node -e '
const fs = require("fs"), os = require("os"), path = require("path");
const mod = require(process.cwd() + "/.forma/board/checks/thresholds-declared.cjs");
const base = fs.mkdtempSync(path.join(os.tmpdir(), "thresholds-gate-"));
let passA = false, passB = false, a, b;
try {
  // Fixture A: a fresh project - an empty PROJECT.md, nothing declared: the gate must speak (ready: false).
  fs.mkdirSync(path.join(base, "empty", "project", "config"), { recursive: true });
  fs.writeFileSync(path.join(base, "empty", "project", "config", "PROJECT.md"), "# Project\n\nNo thresholds here.\n");
  a = mod.runProject({ root: path.join(base, "empty") });
  passA = a && a.ready === false;
  // Fixture B: a declared project - the live declaration copied as is: the gate must stay silent (ready: true).
  fs.mkdirSync(path.join(base, "full", "project", "config"), { recursive: true });
  const live = path.join(process.cwd(), "project", "config", "PROJECT.md");
  fs.writeFileSync(path.join(base, "full", "project", "config", "PROJECT.md"), fs.readFileSync(live, "utf8"));
  b = mod.runProject({ root: path.join(base, "full") });
  passB = b && b.ready === true;
} catch (e) {
  console.error("selftest error:", e && e.message || e);
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
console.log("selftest thresholds-gate:", passA && passB ? "PASS" : "FAIL",
  "| empty -> one line (ready:false):", passA, "| declared -> silence (ready:true):", passB);
process.exit(passA && passB ? 0 : 1);
'
fi

node -e '
const fs = require("fs");
let lang = "en";
try { lang = require(process.cwd() + "/.forma/i18n/index.cjs").projectLang(process.cwd()) || "en"; } catch {}
const M = {
  ru: "STOP START is active (AGENTS.md §3): the thresholds and the nine goals are not declared in project/config/PROJECT.md — offer the human the standard parameters (skill project-setup) and verify node .forma/board/checks/thresholds-declared.cjs --project before opening a cycle; a request meanwhile becomes a card and waits in backlog.",
  en: "STOP START is active (AGENTS.md §3): the thresholds and the nine goals are not declared in project/config/PROJECT.md — offer the human the standard parameters (skill project-setup) and verify node .forma/board/checks/thresholds-declared.cjs --project before opening a cycle; a request meanwhile becomes a card and waits in backlog."
};
let line = M[lang] || M.en;
try {
  const { runProject } = require(process.cwd() + "/.forma/board/checks/thresholds-declared.cjs");
  const r = runProject({ root: process.cwd() });
  if (r && r.ready) process.exit(0); // declared - silence
} catch (e) {
  line = "STOP START probe failed: " + String(e && e.message || e).slice(0, 160);
}
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: line } }));
'
exit 0
