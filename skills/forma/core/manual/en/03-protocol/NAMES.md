# Names of the protocol

Every code carries a human name beside it; the code is the address, the name rides with it (the chat rule — skill `human-register`, "Names in the chat language"). This section is the registry of the names: routes, overlays, law sections, prohibitions, named keys. Keys stay English whatever the language; each language of the manual carries its own names in its own mirror.

## Routes route-0…8

| Code | Key | Name | Description |
|---|---|---|---|
| `route-0` | `intent-self` | on the fly | `Intent` understands, does, records into the card and accepts itself; chosen when the work is shorter than its card — a typo, one value, a rename by an exact list. Not a single call, so no fixed part of spend. |
| `route-1` | `intent-copy` | the double | A copy of `Intent` in a clean context executes from the card alone; the main `Intent` accepts. Chosen when `Intent` understands the task best but it is too large for the main context — `route-0` without the clutter. |
| `route-2` | `intent-run` | the errand | `Intent` writes the card with the criterion, `Run` executes in a clean context with the standard kit, `Intent` accepts by the criterion. Chosen when the brief lies in an accepted document, the kit is standard and the criterion is checked by fact. |
| `route-3` | `intent-kit-human` | the council | `Intent` names the question, `Kit` gathers grounds and options, the human decides. Chosen when the output is a question, not a delivery — `Run` has nothing to execute. |
| `route-4` | `intent-kit-intent` | the workshop | `Kit` executes itself after `Intent` writes the card. Chosen for tooling of the engine, recon of an unfamiliar stack, wiring up a tool or access — work where knowing the arsenal is the execution. |
| `route-5` | `intent-kit-run` | made to order | `Kit` assembles the kit for the task, `Run` executes, `Intent` accepts. Chosen when the brief is clear but a role is needed that the standard kit lacks — a special skill, access, MCP, an external service. |
| `route-6` | `spec-run` | by the pattern | `Spec` slices and the kit is taken by name from the library; `Run` executes, `Intent` accepts. Chosen when slicing is needed but the kind of task has been met before — the criterion is written by someone other than the acceptor. |
| `route-7` | `spec-kit-run` | full ahead | The full cycle: `Spec` slices and writes the criterion, `Kit` kits, `Run` executes, `Intent` accepts — four different contexts, each node catches its own loss. Chosen when the error is expensive or invisible, the stack is new or the criterion is not obvious. |
| `route-8` | `segments-waves` | the build | The scale pipeline: segments × waves of `route-2`…`route-7`, preparation divided per segment, independent tasks in parallel. Chosen for a large goal whose image is clear and stable. |

## Overlays over-1…4

| Code | Key | Name | Changes | Description |
|---|---|---|---|---|
| `over-1` | `kit-library` | the warehouse | the kit is taken ready-made | The kit is not assembled but taken ready-made by the name of the task kind; pays off on a recurring kind of task. |
| `over-2` | `external-model` | the contractor | the executor (external cheap model) | The executor is replaced by an external cheap model; pays off on mechanics checked by fact — not where judgment is needed. |
| `over-3` | `series` | the print run | number of executions per one preparation | One slicing and one kit for N executions; the fixed part of preparation is divided by N — pays off on a uniform series. |
| `over-4` | `batch-accept` | the lot | the acceptance | The acceptance becomes one per batch; pays off on a stream of uniform small tasks with one criterion for the whole batch. |

## Law sections §1–7

| § | Registry key | Name | Description |
|---|---|---|---|
| §1 | `law-1` | Five pairs | The five nodes as one body: what each judges a cycle by, what each decides about a next one, and what each collapses into if its pair breaks. |
| §2 | `law-2` | Route | The route from goal opening to `Core`'s verdict; the table of events says where every return goes. |
| §3 | `law-3` | Thresholds | The two declared numbers — attempts per task and cards per cycle — while token spend and elapsed time are statistics, not thresholds. |
| §4 | `law-4` | Position marker | The marker on the first line of every handoff, and the receiver's question tied to its own loss before starting work. |
| §5 | `law-5` | Prohibitions | The prohibitions phrased affirmatively; each carries a name and lives in this registry. |
| §6 | `law-6` | Card and form check | The card as five fields and four zones; the readiness criterion as a machine gate and a judged verdict; English keys; card material inside the card's folder. |
| §7 | `law-7` | Board | The board lives in `.devtool/features/`; a node taking a card syncs both `status` and `assignee` by `card-move.cjs`. |

## Prohibitions 1–18

| № | Registry key | Name | Description |
|---|---|---|---|
| 1 | `prohibition-1` | foreign acceptance | Only the receiving node confirms work — never the doer confirming their own. |
| 2 | `prohibition-2` | exact address | A gap is named precisely, by address and expected value — not dissolved into "unclear." |
| 3 | `prohibition-3` | budget through a stop | The budget changes only through a stop with a report and a record of the new value. |
| 4 | `prohibition-4` | own threshold | Every node stops at its own threshold, on its own. |
| 5 | `prohibition-5` | journal as is | Failures stay in `JOURNAL.md` as they are; "What was missing" is filled in every cycle, never rewritten after the fact. |
| 6 | `prohibition-6` | example is no measure | An example illustrates a possible shape; only the readiness criterion and the spec define what's required. |
| 7 | `prohibition-7` | clean card | The doer gets a clean card and kit — without the history of their own past failures. |
| 8 | `prohibition-8` | goal under lock | `GOAL.md` and reference-doc versions stay unchanged until the human confirms the goal reached; only the human can reopen an achieved goal. |
| 9 | `prohibition-9` | cache of the unchanging | The cycle cache carries only the unchanging — the changeable never enters it. |
| 10 | `prohibition-10` | a return changes the kit | Returning a task changes at least one of the six kit units. |
| 11 | `prohibition-11` | instruction into the record | A human instruction outside the route is recorded as a change — it never goes unrecorded. |
| 12 | `prohibition-12` | a foreign defect goes back | A defect outside one's own work goes back per the route table — never fixed on the spot. |
| 13 | `prohibition-13` | address and expectation | A discrepancy is named with both the address and the expected value — either alone isn't enough. |
| 14 | `prohibition-14` | second diagnosis is a stop | A second identical diagnosis in a row is a stop, not another reassembly. |
| 15 | `prohibition-15` | key in one house | Credentials live by kind in exactly one place; a card names a credential and its status, never its value. |
| 16 | `prohibition-16` | clean zones | Files that ship to other projects carry no trace of a project; the history lives in cards, `.forma/living/` and `JOURNAL.md`. |
| 17 | `prohibition-17` | exit through the scrub | Whatever leaves for an external model or service passes a scrubbing script first; a refusal is fail-closed. |
| 18 | `prohibition-18` | commit in English | Commit messages of the protocol repository are English only; the project repository keeps its own language. |

## Named keys

| Key | Name | In the ru mirror |
|---|---|---|
| `Plumb` | Plumb | the project's own name for `Plumb` |

The Plumb: role-fit measure between slicing and execution (`PLUMB.md`). The ru mirror of this registry carries the project's own name for `Plumb`.

## Where the name lives

- chat — skill `human-register`, "Names in the chat language";
- machine dictionary — `.forma/i18n/keys.json` (`routeNames` for routes and overlays, `lawSections` for law sections, `prohibitionNames` for prohibitions, `namedKeys` for named keys);
- law sections and prohibitions — this registry.
