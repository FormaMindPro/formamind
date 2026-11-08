#!/bin/sh
# UserPromptSubmit: the human's code phrase (a Cyrillic literal, held as \u escapes below and named in
# AGENTS.md §2) -> a one-time marker .claude/hooks/.delete-unlock for guard-delete.sh (AGENTS.md §2).
# The prompt field is the human's message only: the agent's text does not get here.
# The look-alike reversed phrase does not fire: no Cyrillic or Latin letter may stand right before the
# verb - the negated character class of the pattern guards that.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
# jq when present; otherwise node (Git Bash on Windows ships without jq).
if command -v jq >/dev/null 2>&1; then
  HIT=$(jq -r '(.prompt // "") | test("(^|[^\u0410-\u044f\u0401\u0451A-Za-z])[\u041e\u043e]\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a\u0443")' 2>/dev/null)
else
  HIT=$(node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{try{const p=JSON.parse(s).prompt||"";process.stdout.write(String(/(^|[^\u0410-\u044f\u0401\u0451A-Za-z])[\u041e\u043e]\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a\u0443/.test(p)))}catch(e){}})' 2>/dev/null)
fi
[ "$HIT" = "true" ] && : > .claude/hooks/.delete-unlock
exit 0
