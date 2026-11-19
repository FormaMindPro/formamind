#!/bin/sh
# SessionStart: says so when GitHub holds a newer version of the "Forma" protocol than the installed one.
# A thin entry for the event binding in settings.json: the version comparison, the commit signal and the
# daily stamp all live in the core (check-repo-update.sh) - edit the core, not this entry.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
exec sh "$(dirname "$0")/check-repo-update.sh" "$@"
