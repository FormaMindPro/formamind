#!/bin/sh
# Core check for updates of the "Forma" protocol repository (FormaMindPro/formamind). Two signals in one run:
#   release - the version published on GitHub (.claude-plugin/plugin.json) is strictly newer than the
#             installed one (.forma/install-manifest.json);
#   commits - the HEAD of main on GitHub differs from the last observation recorded in the state file
#             (the first observation records the base silently, nothing to compare against yet).
# The release signal wins: a newer release is named instead of the commits it shipped with.
# Silent whenever there is nothing to say: no network, an unparsed answer, equal versions, an unmoved
# HEAD - all exit quietly (exit 0, empty stdout).
#
# Entries (the hooks bound in settings.json):
#   SessionStart via check-plugin-update.sh - at most once a day: without --force a second run on the
#   same day exits silently; UserPromptSubmit via check-updates-request.sh - the chat phrase, --force.
#
# Where the installed version comes from. `.forma/install-manifest.json` is written by every install,
# by `npx` and by the plugin alike, so it is the version of the protocol in this project.
# Where the answers come from. `gh` first (it carries the human's authorization, so it works for a
# private repository too), then anonymous `curl` - enough for the public repository and for a machine
# without `gh`. Versions carry a suffix (`0.4.186-alpha`): the numeric part is compared, the suffix is
# kept for display only.
#
# The daily stamp and the commit base are written only after both network answers arrived, so an
# offline run never eats the day of checking.
#
# Test seams (used by deterministic checks; no effect on the hooks):
#   REPO_UPDATE_STATE - path of the state file (default .claude/hooks/.repo-check-state);
#   REPO_UPDATE_STUB  - path of a shell file sourced after the definitions below; it may override the
#                       fetchers fetch_published_version, fetch_head_commit, fetch_commit_count, so the
#                       signals are checked without the network.

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

REPO="FormaMindPro/formamind"
STATE="${REPO_UPDATE_STATE:-.claude/hooks/.repo-check-state}"
TODAY=$(date +%Y-%m-%d)
VER_RE='[0-9][0-9]*\(\.[0-9][0-9]*\)*\(-[0-9A-Za-z.]*\)\{0,1\}'

FORCE=0
[ "$1" = "--force" ] && FORCE=1

version_of() { sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\('"$VER_RE"'\)".*/\1/p' | head -1; }
core() { printf '%s' "${1%%-*}"; }

# Published version of the plugin manifest on GitHub, or empty when no answer.
fetch_published_version() {
  WANT=''
  if command -v gh >/dev/null 2>&1; then
    WANT=$(gh api "repos/$REPO/contents/.claude-plugin/plugin.json" \
             -H "Accept: application/vnd.github.raw" 2>/dev/null | version_of)
  fi
  if [ -z "$WANT" ] && command -v curl >/dev/null 2>&1; then
    WANT=$(curl -fsSL --max-time 5 "https://raw.githubusercontent.com/$REPO/main/.claude-plugin/plugin.json" 2>/dev/null | version_of)
  fi
  printf '%s' "$WANT"
}

# HEAD of main on GitHub as two lines - sha, then the first line of the commit message - or empty.
fetch_head_commit() {
  TWO=''
  if command -v gh >/dev/null 2>&1; then
    TWO=$(gh api "repos/$REPO/commits/main" --jq '.sha + "\n" + (.commit.message | split("\n")[0])' 2>/dev/null)
  fi
  if [ -z "$TWO" ] && command -v curl >/dev/null 2>&1; then
    RESP=$(curl -fsSL --max-time 5 "https://api.github.com/repos/$REPO/commits/main" 2>/dev/null)
    if [ -n "$RESP" ]; then
      SHA=$(printf '%s' "$RESP" | grep -o '"sha"[: ]*"[0-9a-fA-F]\{6,40\}"' | sed -n '1p' | sed 's/.*"\([0-9a-fA-F]*\)"$/\1/')
      SUBJ=$(printf '%s' "$RESP" | grep -o '"message"[: ]*"[^"]*"' | sed -n '1p' | sed 's/^"message"[: ]*"//; s/"$//' | sed 's/\\n.*//')
      [ -n "$SHA" ] && [ -n "$SUBJ" ] && TWO=$(printf '%s\n%s' "$SHA" "$SUBJ")
    fi
  fi
  # An error body is not an answer: gh prints the raw GitHub error into stdout on a failed request.
  # The answer is validated where it is accepted (after the call), so a 404 body, a truncated answer
  # or any non-hex first line reads as silence, and neither the message nor the state sees it.
  printf '%s' "$TWO"
}

# How many commits lead from the recorded base to the current HEAD; "?" when it cannot be counted.
fetch_commit_count() {
  N=''
  if command -v gh >/dev/null 2>&1; then
    N=$(gh api "repos/$REPO/compare/$1...$2" --jq '.total_commits' 2>/dev/null)
  fi
  if [ -z "$N" ] && command -v curl >/dev/null 2>&1; then
    N=$(curl -fsSL --max-time 5 "https://api.github.com/repos/$REPO/compare/$1...$2" 2>/dev/null \
        | grep -o '"total_commits"[: ]*[0-9][0-9]*' | sed -n '1p' | sed 's/.*[^0-9]//')
  fi
  printf '%s' "$N"
}

# The stub stands in for the network: sourced last, so its definitions win.
if [ -n "$REPO_UPDATE_STUB" ] && [ -f "$REPO_UPDATE_STUB" ]; then
  . "$REPO_UPDATE_STUB"
fi

# At most once a day without --force: the network on every session start is a delay for nothing.
STAMP_DAY=''
BASE_SHA=''
BASE_SUBJ=''
if [ -f "$STATE" ]; then
  read -r STAMP_DAY BASE_SHA BASE_SUBJ < "$STATE" 2>/dev/null
fi
if [ "$FORCE" != 1 ] && [ "$STAMP_DAY" = "$TODAY" ]; then
  exit 0
fi

# Installed: the project's install manifest, else the highest version directory of the plugin cache
# (the original entry's fallback - a source project answers from the manifest, an installed plugin
# without one answers from the cache).
HAVE=''
[ -f .forma/install-manifest.json ] && HAVE=$(version_of < .forma/install-manifest.json)
if [ -z "$HAVE" ]; then
  CACHE="$HOME/.claude/plugins/cache/forma/forma"
  HAVE=$(ls "$CACHE" 2>/dev/null | grep -xE '[0-9]+(\.[0-9]+)*(-[0-9A-Za-z.]+)?' | sort -V | tail -1)
fi

PUBLISHED=$(fetch_published_version)
HEAD_ANSWER=$(fetch_head_commit)
HEAD_SHA=$(printf '%s' "$HEAD_ANSWER" | sed -n '1p')
HEAD_SUBJ=$(printf '%s' "$HEAD_ANSWER" | sed -n '2p')

# An answer is validated where it is accepted, not where it is fetched: gh prints the raw GitHub error
# body into stdout on a failed request, so the head answer counts only when its first line is wholly
# hex (6-40 chars). Anything else - a 404 body, a truncated answer - reads as silence, and neither the
# message nor the state sees it.
printf '%s' "$HEAD_SHA" | grep -Eq '^[0-9a-fA-F]{6,40}$' || { HEAD_SHA=''; HEAD_SUBJ=''; }

# The version answer alone feeds the release signal and the daily stamp; the HEAD answer feeds only the
# commit base. A missing HEAD leaves the base empty (the state still records the day), so a run that
# heard the version still speaks, and the commit signal waits for a later, fuller run.
if [ -z "$PUBLISHED" ]; then
  exit 0
fi

write_state() { printf '%s %s %s\n' "$TODAY" "$HEAD_SHA" "$HEAD_SUBJ" > "$STATE" 2>/dev/null; }

# Release: strictly newer, not merely "different" - in the source repository the local version runs
# ahead of the published one, and "update" there would be untrue.
RELEASE=0
if [ -n "$HAVE" ] && [ "$(core "$HAVE")" != "$(core "$PUBLISHED")" ]; then
  NEWEST=$(printf '%s\n%s\n' "$(core "$HAVE")" "$(core "$PUBLISHED")" | sort -V | tail -1)
  [ "$NEWEST" = "$(core "$PUBLISHED")" ] && RELEASE=1
fi

if [ "$RELEASE" = 1 ]; then
  if command -v node >/dev/null 2>&1 && [ -f .forma/i18n/cli.cjs ]; then
    node .forma/i18n/cli.cjs msg hook.repo_update_release have="$HAVE" want="$PUBLISHED"
  else
    printf 'Forma: a new release is on GitHub - installed %s, published %s.\n' "$HAVE" "$PUBLISHED"
  fi
  write_state
  exit 0
fi

# Commits: the base exists and the HEAD moved. First observation - the base is recorded silently.
if [ -z "$BASE_SHA" ]; then
  write_state
  exit 0
fi

if [ "$BASE_SHA" != "$HEAD_SHA" ]; then
  COUNT=$(fetch_commit_count "$BASE_SHA" "$HEAD_SHA")
  # Same discipline for the count: gh prints the raw error body into stdout on a failed request, so
  # only a whole integer counts as the count, anything else reads as "?".
  case $COUNT in
    ''|*[!0-9]*) COUNT='?' ;;
  esac
  # awk, not cut: the test contract runs hooks on a tool-restricted PATH (no cut, no dirname).
  SHORT=$(awk -v s="$HEAD_SHA" 'BEGIN { print substr(s, 1, 7) }')
  if command -v node >/dev/null 2>&1 && [ -f .forma/i18n/cli.cjs ]; then
    node .forma/i18n/cli.cjs msg hook.repo_update_commits n="$COUNT" sha="$SHORT" subj="$HEAD_SUBJ"
  else
    printf 'Forma: new commits on GitHub main - %s since the last check, latest: %s %s.\n' "$COUNT" "$SHORT" "$HEAD_SUBJ"
  fi
fi

write_state
exit 0
