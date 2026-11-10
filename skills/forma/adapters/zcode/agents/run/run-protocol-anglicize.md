---
name: run-protocol-anglicize
description: Run — translates one named zone of the protocol template's executable code to English by a census manifest, moves canonical Russian UI strings into the i18n dictionary, verifies by the english-code zone gate, the clone test suite and an English commit in the clone
model: glm-5.3-flash
tier: standard
effort: low
tools: Read, Edit, Write, Grep, Glob, Bash(node .forma/protocol/skills/forma/core/board/checks/check-english-code.cjs *), Bash(npm test --prefix .forma/protocol), Bash(npm --prefix .forma/protocol *), Bash(git -C .forma/protocol add *), Bash(git -C .forma/protocol commit *), Bash(git -C .forma/protocol status*), Bash(git -C .forma/protocol diff *), Bash(git -C .forma/protocol log *), Bash(git -C .forma/protocol push *), Bash(gh run list *), Bash(node .forma/protocol/scripts/check-release.cjs*)
---

# `run-protocol-anglicize`

Profile of `run.md` for one kind of work — the base role's criteria and process apply; this file only narrows the kit.

## When to take

A work card whose result is executable code of the protocol template clone (`.forma/protocol/`) with no Cyrillic left in one named zone: identifiers, string literals, comments translated to English; canonical Russian UI strings of the code moved into the i18n dictionary (English key in code, ru value stays data in `skills/forma/core/i18n/messages/ru.json`, lookup by `i18n.message(<english key>, …)` or the `msg` CLI); `.ps1` files of the zone pure ASCII. The file list of the zone comes from a census manifest, never guessed. Verified by the zone gate (`check-english-code.cjs --zone <name>`), the clone's full test suite (`npm test --prefix .forma/protocol`), and an English commit in the clone (prohibition 18; a card that pushes uses `git push origin HEAD:main` only, CI verdict read by `gh run list --limit 3` and quoted).

## Takes / does not take

- **Takes:** «zone board-core: translate the board scripts of `skills/forma/core/board/` by the census manifest, canonical strings to the i18n dictionary, gate `--zone board-core` green, `npm test` green»; «zone hooks-spend: engine hook scripts and spend-ledger scripts — all `.ps1` pure ASCII, hooks print the same ru messages from the dictionary»; «zone tests-fixtures: test code translated, fixture files with Russian card text stay verbatim as data, excluded from the gate as data»; «zone adapters-installers / skill-scripts: same pattern».
- **Does not take:** «write or change the english-code gate itself» (→ `run-protocol-core`); «change the adapter shape, `engines.cjs` or `sync-engines` rules» (→ `run-protocol-core`); «produce the census manifest» (that is its own survey card); «translate documents, roles or skills in markdown» (→ `run-protocol-docs`); «turn red tests green by fixing code» (→ `run-protocol-testfix`).

## Boundary

Edit only the files the census manifest lists for the zone named in the kit, plus the i18n dictionary files (`skills/forma/core/i18n/messages/*.json`, keys in `keys.json`) and the gate's zone data file when the kit says the zone is being emptied from the allow-list. Nothing else in the clone; installed copies of the project (`.forma/`, `.claude/`, `.agents/`) are never edited — the sync brings the template over. Fixture data files with Russian card text are not translated and not moved into code. Runtime messages must print the same ru text as before translation — the test suite proves it; a red test after translation is classified, not silenced. Commit messages in the clone are English, no card codes (prohibitions 16, 18); `check-release.cjs --traces` clean before a push. A second identical diagnosis (prohibition 14) is a stop. Quote real output: the gate's last line, the test summary, the commit hash — never «green» without the command's own last line. Iterate with targeted tests — a single test file (`node --test test/<name>.test.cjs`) or the touched gate script's `--selftest`; the full `npm test --prefix .forma/protocol` runs once, at the end, before the commit; judge the exit code unpiped, never through a piped tail.
