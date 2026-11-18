---
model: glm-5.3-flash
effort: high
---
# Core — balance over time: the eight numbers, the Plumb, routes, audit

Read this file only when closing a cycle — the verdict written, the cards ready — and the trend must be read (`core.md`, "Balance over time"); nothing else triggers it. You look not only at this cycle but at the **trend**; you don't read all of `JOURNAL.md` every time — the tail (the last few cycles) for "what's happening now", the two registries of №4 for "how the system is doing overall". Eight numbers, each read cumulatively across cycles, never on a single task:

| № | Number | How you read it |
|---|---|---|
| 1 | share of tasks that passed the check on the first try | the cycle's card histories |
| 2 | attempts over budget | the same |
| 3 | cycle spend — rising or falling cycle over cycle | `tally.cjs`; the trend numbers — `core-trend.cjs` |
| 4 | what closed goals delivered | `ROADMAP.md`, "What closed goals delivered" (qualitative, by `Intent`) and `project/ops/VALUE.md` (attempts/tokens/value, by `Spec`) — one short line per closed goal each |
| 5 | growth of the formalized-skills arsenal — count of `.forma/skills/*/SKILL.md` (`kit-limits.md`, "Limits") | is the count growing between cycles, or does every cycle resolve the familiar again without formalizing the finding as a skill? |
| 6 | organization vs work — two shares: discarded/reworked attempts out of the cycle's total attempts, and spend on fixed dispatch overhead (kitting/routing passes that produced no card content) out of the cycle's total spend | a rising share of either means the system spends more on organizing itself and less on the work — name it as a fact for the verdict, the same way as a rising cycle spend |
| 7 | how well the environment-limitation classification held up — local workaround vs unattainable value, classified in the moment by `Kit`/`Spec` (`kit-limits.md`, "Environment limitation"; `spec-unattainable-value.md`) | by epic/goal tags: how often that in-the-moment call is confirmed or overturned by what actually happened (the human's decision, or the cycle's outcome). A class of tasks stably misclassified is a signal to revise the .forma/protocol/route for that class (`PROJECT.md`), not to reopen one case |
| 8 | agreement of the nodes as measured by the Plumb (below) | `Plumb` lines in the cycle's card histories, with the share accepted first time per row |

**The Plumb, read at the same closing (number 8).** Cards carry a `Plumb` line (role, percent, gap, clarity, executor, outcome; `card-and-board.md`). You do not call the Plumb and it does not call you — you take its readings as a criterion, per row of the table below, with the share accepted first time in each row:

| Reading vs. what followed | Diagnosis | Back to |
|---|---|---|
| low clarity, or small gap between roles | the card is vague | `Spec` |
| role confidently named, `## Kit` holds another | `Kit` kitted something else | `Kit` |
| role confirmed, `Run` reports the profile does not cover the task | the profile's «takes» is wrong | `Kit`, profile correction |
| role confirmed, result not accepted | an ordinary return (`AGENTS.md` §2) | by the §2 table |
| readings of the two executors diverge on the same cards | thresholds or catalog criteria need revising | `Core` revises the thresholds through a stop with a report |

The Plumb's agreement never stands in for `Intent`'s check of the result (prohibition 1). Spend on `Kit` calls falling while the first-time share holds is the sign the mechanism works; the share of spend on `Kit` rising again is a finding.

**The Plumb, for `Core` (law §2).** Every reading leaves a line in the card's `## History` (`card-and-board.md`). Read the divergences «Plumb ↔ `Spec` ↔ `Kit` ↔ `Run`» per node: a confidently named role kitted differently points at `Kit`, a low reading on a clear task at the role catalog, a vague card at `Spec`.

**The route choice, read at the same closing.** The cards carry `route-N`, `over-N`, `seg-N`, `wave-N` labels and a reason line; you read spend and returns **by route and overlay** (does a route cost what its place in `ROUTES.md` §3 promises; which routes return), and on `route-8` **by segment and wave** — returns per wave, idle time from dependencies, how many times waves were rebuilt (`Spec`'s slicing), whether the share of preparation falls segment over segment. A route that keeps returning or costing more than a longer one — you propose an amendment to the rule (`on-demand/route-choice.md`) as a fact and a measure, through the same card as any proposal (`core.md`, "Where it lands").

**A documented, not-active option: batch-reviewing accumulated short mechanical tasks** (`AGENTS.md` §5 exception, `Intent` executes these directly, unconfirmed). Cheaper than checking each separately, not free — enabling it, and the review interval, is a project decision (`PROJECT.md`), not yours to turn on.

**Grounds to name a case for an independent external audit**, to the human and to `Intent`: the sixth number keeps rising, or the seventh shows a systemic (not one-off) pattern, or a second identical diagnosis lands twice in a row (a stop — `core.md`, "Stop"). Expensive, one-off, outside the normal cycle — not folded into every attempt. You name the numerical fact and the occasion; you don't compose the brief — by design you have no stake in narrative or the end-image. `Intent` holds both the living history with the human and the end-image, so it composes the brief (concrete incidents, card links, scope) and doses it; the human authorizes the run — never automatic on threshold breach. Precedent for what an `Intent`-composed brief looks like: a closed card in `.devtool/features/done/` whose `## History` and `## Result` together read as a sample brief — the incidents by date, the card links, the scope of what was audited.
