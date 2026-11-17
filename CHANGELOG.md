# Changelog

All notable changes to the Forma engine are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow the installer version in `.claude-plugin/plugin.json`.

## [0.0.32] - 2026-11-17
### Changed
- spec role compression completed, claude, gemini and zcode adapters byte-identical: the `On demand` list reads file - trigger per line; the Slicing intro, the Batches bullets and the No-external-model remainder tightened with every judgment core kept; the role body shrinks from 18739 to 14376 chars (-23.3%). The codex and minimax adapters keep the pre-package role (dormant engines).

## [0.0.31] - 2026-11-17
### Added
- the constructive start gate: a red gate stops being a wall and starts asking - `node .forma/i18n/cli.cjs gate` opens the setup card itself (epic 3, when none is open yet; the readiness criterion stays `thresholds-declared.cjs --project`) and names the standard parameters with an explicit request for the human's decisions; `--json` wraps the same text into a strict `hookSpecificOutput` and the exit stays 0 always; the mechanic lives in the new `core/board/setup-card.cjs` (`ensureSetupCard` + a six-probe selftest, honors `FORMA_SUPPRESS_SETUP_CARD`), `new-card` and `check-board` accept `--root`, and `startGate` checks all four human goals (structure, channels, resources, results).
- the local backlog digest: `core/board/backlog.cjs` (`scanBacklog`) reads three sources in one pass - live cards standing on the backlog lane, follow-up labels in closed cards' Result zones, and uncarded "What was missing" journal lines - and speaks only when there is something to say (`--project` digest for the human, `--line` and `--json` for hooks, `--selftest`, exit 0 always); after a successful `--to close` `card-move.cjs` scans the closed card's Result for follow-up labels and tells the human which ones await a card, never aborting the move; the `backlog` CLI command (alias `backlog-line`, the same strict `--json` wrapper) carries the scan to every session start.
### Changed
- start-gate delivery: the Claude SessionStart gains the `resume|clear|compact` group beside startup, and the installer's verify runs under `FORMA_SUPPRESS_SETUP_CARD` - `init` creates no cards, the first real session creates exactly one; the zcode install copies `adapters/zcode/config.json` (the gate `--json` process hook on `startup|resume|clear|compact`) and covers it in the manifest; gemini, codex and minimax rules carry the first-session gate command in §8; project-setup and intent session docs point at the auto-opened card.
- backlog delivery: the Claude `check-ready.sh` prints the backlog line at session start; the zcode config gains a second SessionStart group for the digest (canon template + install); gemini, codex and minimax rules carry the optional first-session command in §8; the `followup` label prefixes live in the dictionary (en, ru) with `keys.test` parity.

## [0.0.30] - 2026-11-17
### Added
- `cardMask` in `skills/forma/core/i18n/keys.json`: the chat rendering of a card's name becomes a dictionary mask, not per-role prose - `Card-{n} "{title}"` (en), `Задача-{n} «{title}»` (ru); the rule pointers travel in `intent.md` (claude, gemini, zcode adapters), `NAMES.md` (en, ru) and the codex `human-register` mirror.
### Changed
- `forma-grill-with-ui` synced to upstream: dark theme, question importance levels, answer ratings, inline markdown rendering of question bodies (new `markdown.mjs`), a `--lan` mode for answering from a second machine behind a per-serve access token, and request hardening on the interview server (Host allowlist, Origin checks, a 1 MB body limit); per-language locales (en, ru) - a new pair in the codex mirror, extended in the core copy; the sync lands in the core canon and the claude and codex adapter mirrors (gemini and zcode read the core canon natively).
### Fixed
- dashboard server hardening: the listener binds loopback by default (`FORMA_DASH_HOST` is the escape hatch for an unusual setup), every request passes a Host allowlist (DNS rebinding), the interview state routes take POST with an Origin check (CSRF - a browser sets Origin on every cross-site POST; curl and tests send none and pass), and the static path check computes `path.relative` instead of a string prefix; the guards live in `dashboard/lib/http-guards.cjs`, covered by the new `serve-routes.test.cjs`.

## [0.0.29] - 2026-11-17
### Added
- grilling: word each question so "yes" accepts its recommended answer - the body of a frontier question is phrased so that agreement with the round's recommended answer takes one word, not a restatement; the technique lands in the source (`core/skills/grilling`) and the claude and minimax mirrors, closing the gap the codex mirror carried alone since 0.0.28.
## [0.0.28] - 2026-11-16
### Changed
- `kit.md` compressed to holders (37 580 -> 26 314 body chars, -30%): the prose leaves the law - the run-role catalog is built by `run-catalog.cjs` from the role files themselves, the dup-check procedure and the startup pass move to `agents/on-demand/kit-catalog-growth.md`, the infrastructure and return mechanics to the `card-move.cjs` guard, `spend-line.md` and `extensions.cjs`; the judged canon (the six units, the A/B classification, the limits, the route rules) stays intact.
### Added
- the zcode adapter run-role catalog carried into the protocol source for the first time: run-css-audit, run-html-audit, run-html-mockup, run-image-audit, run-pillow-translate, run-site-upload, run-theme-local
- `run-catalog.cjs` and `agents/on-demand/kit-catalog-growth.md` as new files of the source (claude, gemini, zcode adapters)
- the codex adapter grilling skill record updated
### Fixed
- goldens re-recorded for the 28th on-demand holder (the count lines only)

(range note: five commits, not four as the release commit subject says - the parallel session carried the accumulation commits 0692772 and 9435394 inside the window)

## [0.0.27] - 2026-11-16
### Changed
- The `Intent` role gives up a third of its prose to the engine (29 588 -> 20 283 body chars): the project-setup recipe, the nine-epic table, the route re-telling, the uninstall walkthrough and the card-mechanics duplicates collapse into holder pointers (`project-setup`, `PROJECT.md`, `route-choice.md`, `card-and-board.md`); the adapters claude/gemini/zcode carry the shrunk role.
### Added
- Claude hooks that enforce what the prose used to ask: `check-thresholds-gate.sh` (SessionStart: one STOP START line while the thresholds and the nine goals are undeclared), `guard-cards.sh` (PreToolUse Write|Edit: a hand-made card, an off-enum status, a foreign goal or route label - refused), `ram-disk-status.sh` (SessionStart: the RAM disk in one line, one provision try, a spoken degradation to `os.tmpdir()`); the installer registers all three.
- `card-move.cjs`: the five-field approval gate - a route-0…5 card does not move to `kit` without the human approval line in `## History`; the attempt-budget guard - a return to `kit` at the used-up budget is refused, an explicit `--override` passes and records the bypass (the budget itself never changes); i18n keys in ru and en; the selftest grows to 17 probes, its fixture dates assembled dynamically.

## [0.0.26] - 2026-11-16
### Fixed
- Installer: an update without `--engines` reinstalls the engines the project's install manifest records, not claude alone (before, a plain `init --yes` refreshed only Claude Code, the engines installed beside it lagged a release behind, and their mirrors had to be rebuilt by hand); the interactive menu's Enter default on an update is the recorded set too. A recorded id dormant in this release or unknown to the installer is skipped with a note, not an error.
### Added
- Installer: `--all` — every component the project records in one run: the engines of its install manifest (a project without a manifest yet: every active engine of this release); `--engines` wins over `--all` and the conflict says so on stderr. A non-interactive update names the set it took: `Engines: … — the set recorded in .forma/install-manifest.json`.

## [0.0.25] - 2026-11-15

### Fixed

- Installer: the install-time clean no longer removes template-written files — the recorded template's paths (its own skill and `mcp.json`, sibling skills, template scripts and run roles; the same set the engines are told not to overwrite, computed from the recorded template even when the template step does not run on a plain `--yes` update) reach `clean-engine-files.cjs` as their own keep set beside owned, extension copies and protected names, without creating scan zones of their own; a file the template no longer ships is not in the set and is still removed as stale. Two tests: template files survive the clean (written this pass, kept as is, expected by the recorded template; a dropped one still stale), and a plain `--yes` update on a template project keeps the template files the clean used to remove.

## [0.0.24] - 2026-11-15

### Added

- Installer: foreign files self-resolution at install — after the engines, template and mirrors are laid, `clean-engine-files.cjs` walks the managed subfolders of the engine roots (`.claude`, `.zcode`, `.agents`, `.codex`) and classifies every file: owned by this pass, delivered from `project/extensions/`, protected (`settings.json`, `config.toml`, `project-layer.txt`, `.env`) or carried in the manifest of a previous install stays; a stale forma file (was in the previous manifest, not written now) is removed; anything else is foreign and moves whole, path preserved, into `project/source/engine-archive-<timestamp>/` with a rollback journal `.forma/living/migrations/engine-clean-<timestamp>.json` (`clean-engine-files.cjs --rollback <journal> --root .`). Dangling hook registrations in `settings.json` whose commands point at archived files are cleaned (unparseable JSON - a warning, left untouched). The gen-roles mirror zone (`.zcode/agents`) is classified by regeneration - `gen-roles --print-paths` prints the expected set of mirrors, so foreign mirrors leave with their source and forma mirrors (including the renamed `plumb-haiku` → `plumb-glmflash`) stay. Flag `--archive-foreign` / `--no-archive-foreign` (default on), line in HELP.

## [0.0.23] - 2026-11-14

### Added

- Intent roles (claude, gemini, zcode and minimax adapters): the new "Subagent work runs in background" rule inside "Starting work on a card" — subagent work (`Kit`, `Run`, `Plumb`) launches in the engine's background mode, so a human message never interrupts in-flight work (a lost agent takes its final report with it; the only exception is a sub-second mechanical lookup); a subagent is stopped only on the human's word, and after any interruption the interrupted agent's completed work — card files, experience docs, server-side changes — is collected into the card first, and the work continues from there.

## [0.0.22] - 2026-11-14

### Changed

- Names line in `intent.md` (claude, gemini, zcode and minimax adapters): the card joins the named key in the chat rule — `card-NNN` never raw to the human; in a Russian chat the engine prefix translates (Карточка-NNN) and the card's task title travels beside it.
- `human-register` (claude, codex and minimax mirrors): the **Cards** bullet in "Names in the chat language" — the address stays precise in files, the law and the board; only the chat rendering is the human's; the section's closing paragraph names the board's card headlines as the source of a card's name — taken from the board, not from the dictionary.
- `NAMES.md` registry (en, ru): "Where the name lives" gains the cards line — no registry row and no dictionary entry: a card's name is the project's, taken live from the board; the ru mirror names the Russian chat render (Карточка-NNN «Название задачи») beside the pointer.

## [0.0.21] - 2026-11-13

### Changed

- Skills delivery: the gemini and zcode adapters read the engine-neutral core canon `.forma/skills` natively - `skillsDir` declared in both adapters' `sources` (the dashboard's `${dir}/skills` convention no longer fills it for gemini) and the reading functions scan the canon. No engine depends on which other engines are installed beside it: a gemini-only or zcode-only machine receives its skills from the core step every install lays.
- Installer: `installZCode` no longer lays the `.agents/skills` mirror - the mirror is Codex's consumer path, laid by `installCodex`; the zcode manifest expectation drops it; the zcode-only install test asserts the canon in place and the mirror absent.
- zcode role generator (`gen-roles.cjs`): the `.claude/skills/` path transposition goes straight into the canon; the gemini generator picks the sink's `sources.skillsDir` as before.
- Engine rules and living dictionaries: `zcode-8.md`, `gemini-8.md` and the gemini dictionary files name the canon instead of the shared mirror; the role mirrors (gemini `kit.md`; zcode `kit.md`, `spec.md`, `core.md`, `kit-limits.md`, `intent-housekeeping.md`, `run-image-series.md`) regenerated accordingly; the kimi check's fallback points at the canon.

## [0.0.20] - 2026-11-13

### Added

- The acceptance layer - three skills sharing one vocabulary: `kinship` (Intent's thin everyday manner with the human - held stakes, micro-signals; the likeness is held, not worn), `acceptance-vector` (what the interlocutor passes before a yes - barriers, extremes, moods, feelings, guards; grilling's rounds number in the acceptance order), `acceptance-market` (the layer deployed outward - marketing research, strategy, tactics, metrics under guards stricter than the interview's, because the two sides' interests diverge). Core copies in `skills/forma/core/skills/`, mirrors in the claude, codex (`.agents/skills`) and minimax adapters.
- `grilling` (all copies): two pointers to the acceptance layer - the numbering clause in "Rounds and the frontier" (the frontier still decides the set) and the layer line after "Five axes of a whole picture".
- `human-register` carried into the minimax adapter mirror (it had lived only in the claude and codex mirrors): every engine's Intent now holds the register the acceptance layer references - the layer is available and applied for all of Forma's engines.

### Changed

- Intent roles (claude, gemini, minimax, zcode adapters): `uses`/`skills` carry the three skills; the character paragraph names them beside `human-register` (navigation, not a rule).

### Fixed

- grill skill: the core skills copy matches the adapter copy byte for byte (the two anglicization passes left different wording; the installer lays the core copy into the delivered `.claude/skills`, so the drift re-entered the engine at every install).
- locales and minimax adapter: the accepted route/overlay names carried into the dashboard locales (the values shipped stale, contradicting `keys.json` routeNames); minimax card-and-board on-demand mirror carries the engine frontmatter like every other mirror; minimax tool-usage and verify-profile declare fs/path before the i18n require that uses them (a load-order regression).
- zcode adapter: the card-and-board on-demand mirror carries the engine frontmatter like every other mirror file (its absence made the installed mirror diverge from the template copy).
- adapters: role mirrors for Gemini, ZCode and MiniMax synced with the three-step intake.

## [0.0.19] - 2026-11-11

### Added

- `NAMES.md` registry in both manual mirrors (en, ru): every code carries a human name beside it — 9 routes `route-0…8`, 4 overlays `over-1…4`, 7 law sections `§1–7`, 18 prohibitions, named key (`Plumb` — «отвес») — each with a one-sentence description compressed from the existing sections; the `ROUTES.md` "Names"/«Имена» tables carry the agreed names and point to the registry; both `03-protocol/README.md` indexes list it.
- `keys.json`: `routeNames` in the `{key, en, ru}` shape (key kept, names agreed), new sections `lawSections` (law-1…7), `prohibitionNames` (prohibition-1…18), `namedKeys` (`plumb`); `_doc` names the registry and the new-language rule.
- `keys.test.cjs`: the name-sections test — exact code sets, exactly the languages declared in `languages` (en always present, nothing empty), `key` non-empty for `routeNames`; locales-carry test on the new shape. A new language turns the gates red until translated (fail-closed).

### Changed

- `human-register` skill (claude and codex adapters): prohibitions now carry fixed names — the rule is "name + live gloss at first mention"; route and overlay names come from `keys.json` (`routeNames`) and the `NAMES.md` registry; law sections added (`law-N` with the name from `lawSections`).
- Dashboard: the UI language list comes from the server payload (`locales/*.json`, `_meta.name`), the manual language tabs from the book data (`docs.js`), no hardcoded EN/RU; `docs.cjs` enumerates manual languages from the directory listing (the same definition as the `manual-languages` check) — one definition of a language mirror across the code.
- `locale-parity` check: enumerates `locales/*.json` against the en reference instead of the hardcoded en/ru pair; `manual-languages` check: every mirror against the en original instead of the en/ru pair; findings name the language.
- Dashboard locales (`board.rn.*`): the agreed route and overlay names in en and ru.

### Fixed

- `key-language` test exceptions: eight engine files added whose Russian patterns read project-language card text (check-ready sandbox and checks, cycle-metrics); `run_profiles` removed from the anchor test's key list — grep showed zero consumers. (The project-side `PROJECT.md` anchors — plumb thresholds re-homed to per-key rows, `routes.enabled` — were fixed in the project, not in the protocol: `keys.test.cjs` asserts them for installed projects.)

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

## [0.0.7] - 2026-11-07

### Added

- adaptive test runner `scripts/test-runner.cjs` with RAM disk auto-detection and a `setup-ramdisk.ps1` helper; the surgical-testing rules land in the engine roles - intermediate passes run only the affected module's tests
- the board's readiness checks enter the template core: `check-ready.cjs` and `check-ready-sandbox.cjs` under `skills/forma/core/board/`, registered in the checks index
- ram-disk temp rule in all engine roles (intent, kit, run - claude, gemini, minimax, zcode adapters): temporary artifacts go to a per-project subdirectory of the resolved temp base; setup notes in `SETUP.md`

### Fixed

- zcode adapter test passes on a machine without the ZCode host: `transcriptsDir` answers null where no host rollout exists (CI red on ubuntu), and `mainSessions` restores the outer `ZCODE_HOME` provided by the caller

## [0.0.6] - 2026-11-07

### Changed

- the zcode install is self-sufficient on a fresh machine: `installZCode` ships the shared skills mirror (`.agents/skills`, the codex adapter zone copy) and rebuilds the role mirror from `.claude/agents` at install time; host runtime data (`.state/`) leaves the shipped adapter and is never installed
- the `engine-to-protocol` transfer map covers the zcode adapter with flat subpaths; the adapter test checks `transcriptsDir` existence only where the host runs ZCode; `engines-install` tests cover zcode - fresh install green end to end, claude auto-installed as core, dormant rejections unchanged

## [0.0.5] - 2026-11-07

### Added

- ZCode engine in the installer: the adapter suite in `skills/forma/adapters/zcode/` - role files, on-demand holders, run roles, `forma-adapter.cjs`, `gen-roles.cjs`, `lint-agent-keys.cjs`, `rules/zcode-8.md` and the adapter test
- Gemini promoted from beta; Claude ensured by default as the core engine

### Changed

- READMEs (en, ru): Gemini and ZCode promoted to ready status in badges and docs; community website URLs move to formamind.pro and formamind.tech

### Fixed

- date trace in `test-zcode-adapter`

## [0.0.4] - 2026-11-07

### Changed

- `engine-switch` rebuild skips engines whose adapter is not installed, covered by new test cases

## [0.0.3] - 2026-11-07

### Changed

- the installer, plugin update hooks and docs point at `FormaMindPro/formamind` - repository URLs across `marketplace.json`, `plugin.json`, `LICENSE`, the en/ru READMEs, `bin/forma.cjs`, the package files, adapter skills and `check-plugin-update` hooks, i18n messages and the manuals
- i18n: the live module and `keys.json` carried into the template, `.forma/i18n` covered in the transfer map; test fixtures and golden records aligned with the live checks

## [0.0.2] - 2026-11-06

### Changed

- version bump to `0.0.2` in `.claude-plugin/plugin.json` - the engine continues the FormaMind numbering

## [0.0.1] - 2026-11-06

### Added

- initial release: the Forma engine imported at `FormaMind v0.0.1` - the `.claude-plugin` manifests, the `bin/` installer, engine skills and adapters, `scripts/`, `templates/`, `docs/`, `test/` and the en/ru READMEs (869 files)
