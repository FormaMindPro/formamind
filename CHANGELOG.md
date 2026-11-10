# Changelog

All notable changes to the Forma engine are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow the installer version in `.claude-plugin/plugin.json`.

## [0.0.16] - 2026-11-10

### Added

- Installer: a verify profile for ZCode — the role mirror's parity with the reference (`gen-roles --check`), the adapter files from the manifest, the §8 reference closure, and the adapter's fit test run at every install; the `not verified: no profile yet` note for zcode is gone, and a drift is named with the address and the fix in the zcode row (the red verdict stays the main layer's — the core owns parity)
- Installer: a verify profile for Gemini is declared the same way (a parallel land in the same version)

## [0.0.15] - 2026-11-10

### Changed

- Installer: the auto-compact window is no longer asked or set at install — the menu is four steps ([1/4]…[4/4]); the `project-setup` skill offers the window at setup next to the cycle thresholds, and `--compact <n|off>` remains the explicit path (the human's own value is still never overwritten)
- `project-setup` skill: the adapter copies catch up with the core canon — the Routes step enters the claude/codex/minimax copies (six steps), and the thresholds step offers the Claude Code auto-compact window

## [0.0.14] - 2026-11-10

### Fixed

- Installer: the ZCode role mirror is rebuilt after the template step — the run roles the template writes into `.claude/agents/run/` landed in `.zcode/agents/` only on a rerun, so a first install with ZCode and a template ended "install is broken" (the mirror had 24 roles against 31 in the reference); covered by a regression test

## [0.0.13] - 2026-11-10

### Changed

- Installer: the engine menu shows Claude Code as the default — pre-selected as 1, marked as the core that is always installed and cannot be deselected; the numbers entered only add engines on top of it (the behavioral freeze was already there, now it is visible and covered by a menu test)

## [0.0.12] - 2026-11-10

### Added

- Board: `cycle-report` — the cycle summary for the Core verdict as one file: per-card five fields, the last stage line, per-node spend totals, gate statuses; selection by goal label and/or card list, markdown to stdout and/or `--out`
- Board: `card-move --stage` — the stage history line in the same call as the move, without a status change; the closed key list of seven, fail-closed on an unknown key or empty text, composes with `--session-spend`
- Board: `new-card --node` — the history lines carry the calling node (default `Intent`); numbering without a race: exclusive file create, rescan when the number is taken
- `project-setup` skill: a Routes step asks the project's human the five route questions (enabled routes, the small-task threshold, the external cheap model with its per-cycle cap, the batch acceptance size, the dispatcher) with recommended starting values — the human fills the values, the wizard never writes them silently
- release-check: publishing requires the changelog section of the declared version — a declared version without its section fails the release gate

### Changed

- i18n: live dictionaries synced with the clone (en/ru parity in both trees); plumb threshold aliases learn the scaffold's localized wording, so a fresh template's row parses
- Plumb: the reading line's verdict text reflects the actual comparison against the declared thresholds — a below-threshold noul no longer reports "passed"; fraction and percent spellings normalize to one scale
- README: the static version badge is replaced with a shields.io badge that follows the latest release tag
- The engine's console log speaks English across the board: the dashboard, `release-check` and the last six scripts that kept a Russian canon (test-runner, forma-commit, template-push, scaffold-engine and the rest), with the test expectations aligned to the English log

### Fixed

- `new-card`: the stage line separator and its missing dictionary key — the silent fallback printed the raw key code
- Plumb driver: the noul threshold parse swallowed a trailing comma into NaN and compared a percent against a fraction, so recalibrated rows read as passed

## [0.0.11] - 2026-11-09

### Added

- CHANGELOG.md (Keep a Changelog, sections 0.0.8-0.0.10 backfilled); release notes publish the changelog section of the released version, GitHub auto notes are always on

### Changed

- Installer: check marks tint on TTY only - green ok / red fail, plain text in pipes, tests and CI
- release-check: a date in CHANGELOG.md is not a project trace - the version history is published by design (per-file exception + test)

## [0.0.10] - 2026-11-09

### Added

- Scaffold packages (en and ru) bundle in `templates/_scaffold` with installer support, a `scaffold-sync` tool and localized parity tests
- Core skills `project-setup` and `vdisk-setup` with multi-engine adapters (claude, codex, gemini, minimax, zcode)
- Board: law-gate checkers for external exits, thresholds declared as a gate, push verify rule, goal-freeze checker; quick incubator mode in `new-card`
- Law: epic "3. Project protocol" requirements defined; english-only skill authoring enforced
- English-code gate: executable code of the template clean zones carries no Cyrillic

### Changed

- All executable code anglicized — board core, skill scripts, hooks, spend accounting, dashboard modules, adapters, tests (identifiers, comments, canonical strings; i18n dictionaries keep the localized surface)
- Release versions synchronized across plugin, package and lock files
- `vdisk-setup` skill: enhanced RAM-disk detection

### Fixed

- Dashboard: zombie supervisor processes prevented, clean cross-platform process teardown
- zcode and gemini adapters: i18n resolves from the installed project root

## [0.0.9] - 2026-11-08

### Added

- Budget-change gate, stop-row trace check, thresholds declared, strict dispatch marker
- Exact-number card resolver
- Credentials scanner ships with a hook
- Goal-freeze checker ships in the core board checks

### Changed

- Law compressed to its holders

## [0.0.8] - 2026-11-07

### Added

- Push-verdict rule in engine roles: a push is finished by the remote's checks verdict, not by git's exit code
- zcode adapter: card-and-board paragraph parity (gate-and-verdict criterion)
