# Changelog

All notable changes to the Forma engine are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow the installer version in `.claude-plugin/plugin.json`.

## [0.0.18] - 2026-11-10

### Added

- `human-register` skill: section "Names in the chat language" — in chat every functional key travels with its human name in the chat language: routes and overlays by the route table's name (`ROUTES.md`, "Names"), law addresses by the section's name, prohibitions by a live gloss, named keys by the project's own name (`Plumb` — «отвес»). The address stays precise, the name rides beside it (prohibition 2); the test: the human understands the mention without opening the law. Copies synced: claude adapter, codex adapter.
- `intent.md` (all four adapters): one line beside the register paragraph pointing to that section.

### Fixed

- `route-0` wording in the "Intent as Conductor" block (`intent.md`, `route-choice.md`, all adapters): "micro-edits without a card" corrected to the canon of `ROUTES.md` §3 — `route-0` is `Intent` itself, the edit shorter than its card, still carded; `route-1` named as a copy of `Intent`.
- `intent.md` (all adapters): the duplicated "Intent as Conductor" block replaced by a pointer — the full rule lives once, in `on-demand/route-choice.md`.
- `intent.md`, `intent-session-start.md` (all adapters): Step 1's parameter numbers marked as the `project-setup` skill's defaults — the skill holds the truth; a divergence is corrected in the next release.
- `intent-goal-opening.md` (all adapters): the "Who forms each one" table bridged with the Epic-9 interview — the table names who sets each goal's default at installation, the interview refines all nine from the human's answers.
- `run-protocol-anglicize` role carried into the protocol source (was project-only): claude reference plus gemini, zcode and minimax adapters, each with its own engine frontmatter and the adapter's title convention.

## [0.0.17] - 2026-11-10

### Added

- `Intent`: three-step launch and intake algorithm (`intent.md`, `intent-session-start.md`):
  - Step 1: Project configuration proposal in chat (thresholds attempts=3, volume=25, auto-compact window=250k, RAM disk via `vdisk-setup`, standard routes) to clear STOP START before any production work or brief interview. Heavy filesystem audits and external interview UI server startups are prohibited during start turns.
  - Step 2: The human's request is placed in `backlog` as the primary desire / anchor for the brief interview. The interview asks strictly about Epic 9 (`results` — what the human wants), from which `Intent` derives and populates all remaining project goals (Epics 1–8).
  - Step 3: `Intent` acts as conductor and economist: global stable goal opens maximum decomposition (`route-8`/`route-7`, `Spec` waves, `Kit` roles, runner chains); uncertainty and fog open adaptive agile routes (`route-0`…`route-5`, `over-2`…`over-4`) to optimize tokens, speed, and subagent selection.
- `SETUP.md` (core and scaffolds): Step 0 `setup-0-project-setup` in Epic "3. Project protocol" declaring the setup card explicitly.
- `route-choice.md`: section "Intent as Conductor: Global Decomposition vs. Adaptive Routing".
- `intent-goal-opening.md`: section "The Focus of Questions: Epic 9 as the Single Source for All Goals".

### Fixed

- `intent.md`: clarified `new-card.cjs` CLI flag syntax (`--route <N> --why <code> --stage card` or `--quick`), removed incorrect recommendation to run `sync-engines.cjs --check` during user turns.
- `forma-commit.cjs`: added automatic synchronization of `package-lock.json` version upon `--release`.

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
