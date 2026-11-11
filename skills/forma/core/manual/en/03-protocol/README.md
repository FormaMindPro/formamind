# 3. Project protocol

Kind code: `protocol` · main goal: `project/goals/goal-protocol/GOAL.md`

The form of the project: the protocol's own tasks — everything about the engine: nodes, descriptions of actions, tasks, orders, protocols, laws. The machine of routes (`route-0…8` and how they are chosen) lives here; building routes from efficiency will come here too.

| | |
|---|---|
| **Who forms the goal** | the core, by default: an engine assembled from whatever is available — fine-tuned along the way |
| **Route** | short route `route-4` — `Intent` → the human → `Kit` → `Intent`: the human approves the five fields of the card instead of `Spec` (`AGENTS.md` §2); the route belongs to the card, not to the epic |
| **Who confirms** | `Intent` or the human; `Intent`'s work — only the human |

Complete reference documents of the engine live here — they are not divided into sections:

| File | About |
|---|---|
| [PROTOCOL.md](PROTOCOL.md) | structure and rationale: the five pairs, the loss ladder, return, prohibitions, the schema language, the emotional compass |
| [SCHEME.md](SCHEME.md) | composition, environment requirements, cycle cache, cycles, who talks to the human, dashboard, reading levels |
| [KITTING.md](KITTING.md) | kitting of the project at deployment |
| [ZONES.md](ZONES.md) | zones of the protocol constructor |
| [LEVERS.md](LEVERS.md) | register of levers that raise efficiency and the leaks they close |
| [SKILLS.md](SKILLS.md) | skills of the nodes as skills of the environment |
| [five-nodes.md](five-nodes.md) | the route of the five nodes, diagram |
| [PLUMB.md](PLUMB.md) | the Plumb: role-fit measure between slicing and execution, executors, scrubbing, what `Core` reads |
| [ROUTES.md](ROUTES.md) | route choice for a task: `route-0`…`route-8`, overlays `over-1`…`over-4`, the choice rule, waves at scale |
| [NAMES.md](NAMES.md) | registry of the names: routes, overlays, law sections, prohibitions — a name and a description for each |
| [LOCALIZATION.md](LOCALIZATION.md) | dashboard localization: two languages, dictionaries, the `locale-parity` check |
| [PROTOCOL-DEVELOPMENT.md](PROTOCOL-DEVELOPMENT.md) | developing the protocol from a project: clone, engine alignment, transfer, trace check, push |
| [ENGINE-MAP.md](ENGINE-MAP.md) | the engine map: three levels of rules with sizes, sources outside them, machinery, hooks, what the engine produces, gaps found |
| [FUNCTIONS.md](FUNCTIONS.md) | engine functions and architecture: virtual disk (RAM disk), CPU interaction, comparative benchmark results |

## Tasks, requirements, and mandatory skills

### Tasks in Epic 3
Tasks of the project's own form and engine infrastructure:
1. Engine and tooling: modifying or adding scripts (`.cjs`, `.js`, `.sh`, `.ps1`), dashboard code, board tools (`new-card`, `check-board`, `card-move`), hooks, installers.
2. Skills and roles: creating, modifying, or testing agent skills (`SKILL.md`) and role definitions.
3. Engine adapters: configuring or reconciling `.claude/`, `.agents/`, `.codex/`, `.minimax/`, and `.forma/engines.json`.
4. Scaffold packages: managing and syncing canonical packages (`templates/_scaffold/`).
5. Human row decisions: tasks arriving from the route table's "human" row (`human-row-trace`).
6. Protocol releases: upstream transfers and releases to `.forma/protocol`.

### Requirements
- **Language: English only.** All code, scripts, tools, tests, and agent skills (`SKILL.md`, role files) created or modified in Epic 3 must be authored strictly in English. Localized text is permitted only in user manuals (`manual/<lang>/`) and i18n catalogs (`.forma/i18n/`).
- **Clean zone compliance (prohibition 16):** zero project traces in files that ship with the protocol.
- **Verification gates:** must pass `node .forma/protocol/skills/forma/core/board/checks/check-english-code.cjs` and `node .claude/scripts/sync-engines.cjs --check` before completion.

### Mandatory skills for Epic 3
- `skill-authoring`: mandatory when creating or modifying skills in the arsenal.
- `vdisk-setup`: mandatory when running test suites, web page builds, or batch file I/O operations.
- `scaffold-sync`: mandatory when touching scaffold templates or verifying localized parity.
- `engine-switch`: mandatory when changing engine adapter configurations.

## Demo cycle

A fresh project (start gate closed, empty board) gets one offer in the first session: a short demonstration of the whole route on two small cards. The human answers **start**, **skip** or **later**; the answer is kept in `project/config/DEMO` (`none`, `declined`, `later:<n>`, `done`), so it is asked once. The demo cards carry the label `demo`: they are the only cards allowed under a closed gate, they stay out of the dashboard's spend and statistics, and the demo ends with a node-by-node table (attempts, tokens, time) and a clean-up — remove or keep. Procedure: `intent-demo.md`.
