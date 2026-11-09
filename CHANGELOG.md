# Changelog

All notable changes to the Forma engine are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow the installer version in `.claude-plugin/plugin.json`.

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
