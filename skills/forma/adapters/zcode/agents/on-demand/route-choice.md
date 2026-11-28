---
model: glm-5.3-flash
effort: high
---
# Route choice

Read this file only at the moment of choosing a route: `Intent` before the first call on a task, `Spec` while slicing a `route-8` segment. The law it serves — `AGENTS.md` §2 "Choosing the route", §6 route labels, §7 wave gate; what each route costs and why — `.forma/manual/en/03-protocol/ROUTES.md` §3–§6. The project's settings — enabled routes, the `route-0` size limit, `over-2`/`over-4`, parallel `Run` per wave, the dispatcher — are read from `project/config/PROJECT.md`, "Routes" (Russian: «Маршруты»). A route or overlay that section leaves disabled is not chosen, whatever the rule below gives: the next question answers instead.

## Intent as Conductor: Global Decomposition vs. Adaptive Routing

You orchestrate execution based on **project economy (faster and cheaper)** and the **degree of certainty**:
- **Global Stable Goal (`route-8` / `route-7`):** When the full outcome is known, the image stable, and the domain understood:
  `Spec` slices the segment into waves, `Kit` builds/selects competencies and roles (`run-*.md`), subagents execute in parallel chains, and `Intent` monitors acceptance.
- **Adaptive Execution under Uncertainty:** Projects are rarely ideal from day one; we do not always foresee every technical detail or intermediate step. Blindly slicing into 25 cards when there is fog is a slicing failure. In uncertain terrain, act flexibly across the route spectrum:
  - **Fog / Risk / Recon:** `route-3` (`Kit` gathers facts / human decides) or `route-4` (`Kit` tooling) to dissolve fog before production.
  - **Routine & Mechanical:** `route-2` with ready roles and `over-2` (cheap external model via `external-model-bridge.cjs` for mechanical file edits) to preserve main session context and tokens.
  - **Quick & Direct:** `route-0` (`Intent` itself — the edit shorter than its card, still carded) and `route-1` (a copy of `Intent`).
  - **Unknown Stack / Critical:** `route-7` (full five-node discipline with multi-stage checks).
  - **Batching:** `over-4` (batch acceptance up to 10 cards) or `over-3` (pilot trial card before full batch).
- **Subagent Selection:** You govern subagents by cost and task nature: the engine's lightweight tier for routine work (the node's default in `PROJECT.md`, "Node defaults"), the project-named external executor (`over-2`), the card's `Model` unit or the role's registry binding for the rest, reserving heavy tiers only when complex synthesis is required.

## The rule

Seven questions, in order; the **first "yes"** is the route.

| № | Question | Route |
|---|---|---|
| 1 | The output is a question, not a delivery? | `route-3` — `Intent` → `Kit` gathers grounds → human decides |
| 2 | The work is shorter than its card (within the `route-0` limit in `PROJECT.md`)? | `route-0` — `Intent` itself |
| 3 | The whole volume of the goal is known and the image stable? | `route-8` — segments × waves; each segment card goes through questions 4–7 again |
| 4 | The error is expensive or invisible, the stack new, or the criterion not obvious? | `route-7` — `Spec` → `Kit` → `Run` → `Intent` |
| 5 | Slicing is needed and a kit for the kind is recorded? | `route-6` — `Spec` → `Run`, kit from the library (`why: plumb`) |
| 6 | The brief lies in an accepted document, or the card is routine and complete (five fields) with a ready `Run` profile? standard kit → | `route-2` — `Intent` → `Run` |
| | … a special role, access, skill or service → | `route-5` — `Intent` → `Kit` → `Run` |
| | … it is tooling of the engine or recon → | `route-4` — `Intent` → `Kit`, `Kit` executes |
| 7 | `Intent` understands the task best, and it is large? | `route-1` — a copy of `Intent`, given only the card |

No "yes" at all — `route-7`. Doubt between two — the longer one.

**Name the route to the human.** A reply that mentions a route carries its movement name next to the code — `route-1 (intent-copy)`, `route-7 (spec-kit-run)`, `over-2 (external-model)` — never a bare number. Names: `.forma/manual/en/03-protocol/ROUTES.md` §3, keys `routeNames` in `.forma/i18n/keys.json`.

**The label binds the executor.** A card labelled `route-2`, `5`, `6` or `7` is executed by `Run`, never by `Intent` in its own session: a label with no call behind it is a route on paper (prohibitions 1 and 7). `Intent` that wants to do the work itself changes the label first — `route route-N → route-0 (why: <code>)` — within the `route-0` limit, or hands the card on. The board check `route-executor` reports a card in `review`/`done` on such a route with no `Run` attempt in its history.

**`route-6` ("by the pattern") — the normal path of a covered kind (`why: plumb`).** For a card whose kind the library covers, `Spec` calls the Plumb (`spec.md`, "Role routing — the Plumb"); when the reading clears the thresholds in `PROJECT.md`, `Spec` slices and writes the kit into `## Kit` (Role, Skill, Tool, Access, Data; Model from the card's candidate list), and `Intent` launches `Run` directly, without `Kit`; the kit is taken by name from the kind's library entry (`over-1`). The human's consent has moved to the library and the registry: a `route-6` card needs no separate "yes" on the five fields, because the human approves the library and the registry at the cycle's opening; acceptance of the result and `Core`'s verdict are unchanged. Below the thresholds the card goes to `Kit`, which creates the role and lengthens the route (`route-5`/`route-7`). A card wholly written by `Intent`, complete with its kit already set, keeps `route-2` and `why: ready`.

**Project-named Plumb executor.** When `PROJECT.md`, "Routes" names a project-named executor for the Plumb (the `plumb` setting), the caller runs `node .forma/plumb/plumb-run.cjs <card> --write` instead of the engine's local executor, with no separate scrub step (the driver scrubs the task and the catalog itself) and no line to write by hand (`--write` appends the Plumb line to the card's `## History`; on a fallback it writes none): the driver sends the scrubbed task and catalog to the external service the project names, through `external-model-bridge.cjs`, and returns the same `choice`/`score`/`noul` shape. It falls back to the engine's in-family lightweight fallback on its own — no key, a bridge error, a scrub refusal — by printing `{"fallback":"haiku","reason":...}` and exiting 0; the caller then runs the engine's local executor and records that reading as the local executor's, with the reason. The switch itself (`node .claude/scripts/plumb-switch.cjs`) stops without writing `PROJECT.md` when the project-named executor's key is absent, and never sets the call limit or the executor's own thresholds — those are the human's (`AGENTS.md` §3).

**`Run` runs on the lightweight tier by default** (the node's default in `PROJECT.md`, "Node defaults"). `Kit` only kits; a `Run` on a stronger tier needs an override with its reason in the card's history before the call (`kit.md`, "Task kitting"). `Intent` never raises the model without that line.

**Batches.** `Spec` slices several tasks per call. `Kit` kits 3–4 cards per call, at most 4. One agent per card remains only for different subjects or dependent cards (`after-card-*`). Spend: `AGENTS.md` §6, "Any reach to a subagent".

**Guard on `route-0`:** after several `route-0` in a row the next goes through `route-1` or `route-2` — clutter accumulates unseen.

## When, who, the dispatcher

- **When:** before the first call of any node on the task. A route chosen after the work began is a record, not a choice.
- **Who:** `Intent` on a single task (and chooses `route-8` or piecewise for a goal). On `route-8` choice is layered: `Spec` proposes each card's route while slicing, `Kit` refines it by the arsenal (kit ready or to be assembled; who executes), `Intent` approves the segment's route map as one decision and changes a card only with a reason in its history.
- **The dispatcher decides nothing.** Whoever mechanically launches the waves — a scripted workflow or `Intent` — neither reorders nor reassembles; a deviation from the plan goes back along the route (`AGENTS.md` §2).
- **The dispatcher's channel: the script prints, the session launches.** One path from a card to a run on its model — `node .claude/scripts/dispatch-address.cjs --node <Node> --card <path> --snapshot <path> --marker <marker> [--note "..."] [--with-task] [--probe]` prints the `CreateWorkflow` spec (`name`, `subagent_model`, the `script` carrying the node's prompt from `dispatch-prompt.cjs`); the session, which holds the host's workflow tools, puts the human's confirmation on the run and starts it. The script never launches a run and never approves one on the human's behalf. `--probe` prints the same spec whose task is "return the marker and do nothing else" — the channel check before a real dispatch.
  - **Sources of the address, in order:** the card's `## Kit` unit `Model` — the first `providerId/modelId[$level]` token written in backticks there, or a bare model id that is the whole unit; an empty unit — the node's row in `PROJECT.md`, the section marked `<!-- k:tooling -->`, its second column, the default set by the human; neither — refusal, never a guessed default.
  - **Address format:** `providerId/modelId`, optionally `$low|$high|$max`. A bare model id resolves only within the session's provider, named by the `ListModels` snapshot's `[current]` row; no such row — refusal, never a guess.
  - **Refusal is fail-closed, exit code 2:** no snapshot, an address absent from the snapshot, no address in the unit and no default declared — the address (or `(none)`) and its source go to stderr, stdout stays empty, no spec is printed.
  - **The run's spend line** (`AGENTS.md` §3) comes from the workflow actor's transcript `model-io-sess_dwf-<run>-actor_<N>_<M>.jsonl` through `card-subagent-spend.cjs`: a bare `dwfrun-*` id is accepted while one actor, or one visit, matches; several — the caller names the actor (`<run>-actor_<N>`) and the locator lists the candidates instead of picking one. No transcript — `unknown`, never zero.
- **Settings are not thresholds.** The route settings — which routes are enabled, the size limit of `route-0`, the batch of `over-4`, parallel `Run` per wave — are project configuration in `PROJECT.md`, "Routes", not thresholds of the law (`AGENTS.md` §3).
- **`Kit` may lengthen a route, never shorten it** past what the human approved; the change is a history line with its reason (`AGENTS.md` §2).

## Overlays

After the route, each independently; a second label, `over-N`:

| Condition | Overlay | Changes |
|---|---|---|
| a kit for the kind is recorded in `project/config/CONFIG.md` | `over-1` | the kit is taken by name |
| mechanics checked by fact ("was → becomes", a file); no judgment | `over-2` | executor — the external model (`external-model-bridge.cjs`) |
| N uniform tasks | `over-3` | one slicing and kit for N; the first card is `trial`, the rest start after its acceptance |
| a stream of small, cheap, reversible tasks under one criterion | `over-4` | acceptance — one per batch |

## Labels

Set in `labels` beside the goal label (`new-card.cjs --route N`); never as frontmatter keys — the board erases them.

| Label | How many | Set by |
|---|---|---|
| `route-N` (`route-0`…`route-8`) | exactly one | `Intent`; on a segment `Spec` |
| `over-N` (`over-1`…`over-4`) | zero or more | `Spec` or `Kit` |
| `seg-N` | one, `route-8` only | `Spec` |
| `wave-N` | one, `route-8` only | `Spec` |
| `after-card-NNN` | zero or more | `Spec` |
| `trial` | zero or one | `Spec` |

## Approval

`route-0`…`route-5`: the criterion is written by the one who accepts by it, so the human approves the five fields before the first call; until then the card stays in `backlog`. `route-6`…`route-8` need none. On `route-8` `Intent` approves the segment's route map in one decision (`GOAL.md`, "Segments"), not card by card.

## History lines

Key part in English; the description after the dash in the card's language (`AGENTS.md` §3, §6).

- Choice: `` `Intent`, YYYY-MM-DD: route route-N (why: <code>) — <причина>. `` (`Spec` on a segment card writes its own name.) Code — `human` · `ready` · `scale` · `risk` · `decision` · `tooling` · `plumb` (`AGENTS.md` §6).
- Plumb reading, by `Spec` right after the call: the call's spend line with the reading in its description: `` `Plumb`, YYYY-MM-DD: attempt, N tokens (R cache-read), T s, `<call id>` — zcode: role <name>, N % (gap G, clarity C), <executor>, <fits / below threshold / returned>. `` (`AGENTS.md` §6). `ready`: the five fields and the kit are already set — the route goes straight to the executor.
- Change: `` `Kit`, YYYY-MM-DD: route route-2 → route-5 (why: <code>) — <причина>. ``
- Stage, on every move along the route: `` `Node`, YYYY-MM-DD: stage <key> — <что>. `` Keys `card` · `approve` · `kit` · `exec` · `check` · `accept` · `close`; the last line is where the card stands (`AGENTS.md` §6).
- Human approval (`route-0`…`route-5`): `` `Intent`, YYYY-MM-DD: human approved the five fields, 0 tokens, 0 s — <что одобрено>. `` No call id — nothing returned one.

The reason names which question answered "yes" and why — `Core` checks the choice by it.

**Cross-cutting:** a work item whose result is read by an agent, not a human, names the consumer and the form in its criterion. A card changing protocol files carries the template clause (`spec.md`, "Protocol files in the criterion").

<!-- moved-from-law: choosing-route-rules -->
**Two rules of route choice that stay law (law §2).**
- `route-0`…`route-5` open only on the human's approval of the five fields. On them the criterion is written by the one who will accept by it; the human's "yes" is the independent eye `Spec` would otherwise be. Without it the card stays in `backlog`. `route-6`…`route-8` need no such approval.
- `Kit` may lengthen a route, never shorten it past what the human approved; the change is a history line with its reason.

The codes (`route-0`…`route-8`, overlays `over-1`…`over-4`) and costs: `.forma/manual/en/03-protocol/ROUTES.md`.
