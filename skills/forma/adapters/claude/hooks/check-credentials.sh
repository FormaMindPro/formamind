#!/bin/sh
# PostToolUse (Claude adapter): a written file is checked for credential VALUES outside the two allowed
# places (.env at the root, project/VARS/credentials.md — prohibition 15), by the same core scanner the
# gates run (--file mode). Fail-closed: a finding exits 2 so the session sees the stop at once; the
# value itself is never printed — the file, line and family are. Infrastructure missing (no node, no
# scanner) — exit 0, like check-clean-zone.sh: a broken guard never blocks every write.

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
command -v node >/dev/null 2>&1 || exit 0
[ -f .forma/board/checks/credentials-zone.cjs ] || exit 0
input=$(cat)
file=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&(j.tool_input.file_path||j.tool_input.path))||"")}catch{}})')
[ -z "$file" ] && exit 0
out=$(node .forma/board/checks/credentials-zone.cjs --file "$file" 2>&1)
code=$?
if [ "$code" -eq 1 ]; then
  printf '%s\n' "$out" >&2
  exit 2
fi
exit 0
