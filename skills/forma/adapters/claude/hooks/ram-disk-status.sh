#!/bin/sh
# SessionStart: one line about the machine's temp RAM disk (the law §3 - statistics by fact; intent.md, rule 11).
# Mounted - one line with the path. Not mounted - the machine's provision is tried once (the vdisk-setup
# skill's setup script, machine-local); still absent - one degradation line: the work continues on os.tmpdir().
# A missing disk degrades the work, never silently fails it. Never blocks: exit 0.
# Selftest: bash .claude/hooks/ram-disk-status.sh --selftest (the formatter over fixture readings).
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
command -v node >/dev/null 2>&1 || exit 0

if [ "$1" = "--selftest" ]; then
  exec node -e '
const { formatStatus } = require(process.cwd() + "/.claude/hooks/ram-disk-status.lib.cjs");
const cases = [
  [{ mounted: true, path: "R:/forma-tmp", source: "env" }, "RAM disk ready"],
  [{ mounted: false, provisionTried: true, provisionOk: false, fallback: "os.tmpdir()" }, "degraded"],
  [{ mounted: false, provisionTried: true, provisionOk: true, path: "R:/forma-tmp" }, "RAM disk provisioned"],
];
let fail = 0;
for (const [reading, want] of cases) {
  const line = formatStatus(reading);
  const ok = line.includes(want);
  if (!ok) fail++;
  console.log((ok ? "PASS" : "FAIL") + " | " + JSON.stringify(reading) + " -> " + line);
}
console.log("selftest ram-disk-status:", fail === 0 ? "PASS" : "FAIL");
process.exit(fail === 0 ? 0 : 1);
'
fi

node -e '
const { readStatus } = require(process.cwd() + "/.claude/hooks/ram-disk-status.lib.cjs");
readStatus((line) => {
  if (line) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: line } }));
});
'
exit 0
