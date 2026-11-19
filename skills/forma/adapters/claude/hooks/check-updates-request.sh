#!/bin/sh
# UserPromptSubmit: the human asks for a repository update check with a trigger phrase, the repository-
# update core runs with --force and its output goes into the chat context. Any other prompt exits at
# once: no match, no network, no delay.
#
# The trigger phrases live in the registry (.claude/hooks/update-phrases.list), not here: one line - one
# case-insensitive regex, # lines and blank lines are comments, the list is read on every invocation,
# so a new language is a new line, never a code change. This file carries no trigger phrases at all.
#
# Each registry line is matched in one of two branches - jq when present, node otherwise (Git Bash on
# Windows ships without jq). Both branches embed the line into a string literal of their own language
# (jq: a JSON string; node: a JavaScript string - the escape rules are the same), so the registry
# syntax is neutral to the branch: \uXXXX for non-ASCII letters, \\s for whitespace, no raw double
# quotes. A line that does not compile is skipped, never fatal.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

LIST="${UPDATE_PHRASES_LIST:-.claude/hooks/update-phrases.list}"
[ -f "$LIST" ] || exit 0
INPUT=$(cat 2>/dev/null)

# A trailing carriage return would ride into the pattern from a CRLF-edited registry and silently
# break it; strip it before matching.
CR=$(printf '\r')
HIT=false
while IFS= read -r LINE || [ -n "$LINE" ]; do
  LINE=${LINE%"$CR"}
  case $LINE in
    ''|'#'*) continue ;;
  esac
  if command -v jq >/dev/null 2>&1; then
    MATCH=$(printf '%s' "$INPUT" | jq -r '(.prompt // "") | test("'"$LINE"'"; "i")' 2>/dev/null)
  else
    MATCH=$(printf '%s' "$INPUT" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{try{const p=JSON.parse(s).prompt||"";process.stdout.write(String(new RegExp("'"$LINE"'","i").test(p)))}catch(e){}})' 2>/dev/null)
  fi
  [ "$MATCH" = "true" ] && HIT=true
done < "$LIST"

[ "$HIT" = "true" ] || exit 0
sh "$(dirname "$0")/check-repo-update.sh" --force
exit 0
