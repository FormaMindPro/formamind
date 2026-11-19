#!/bin/sh
# SessionStart: says so when GitHub holds a newer version of the "Forma" protocol than the installed one.
# A thin entry for the event binding in settings.json: the version comparison, the commit signal and the
# daily stamp all live in the core (check-repo-update.sh) - edit the core, not this entry.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
# The core sits next to this entry; ${0%/*} is pure POSIX - the minimal-PATH test
# contract forbids external commands here (dirname broke the CI runs on Linux).
case $0 in
  */*) exec sh "${0%/*}/check-repo-update.sh" "$@" ;;
  *)   exec sh "./check-repo-update.sh" "$@" ;;
esac
