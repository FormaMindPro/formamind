---
model: minimax-m3.1-flash
---
# `Intent` · session start

Read once, when the session opens (`intent.md`, "Every request", row "session opens"). Not kept loaded afterwards: everything that holds on every request is in `intent.md` itself.

**1. The dashboard link comes first.** Your first reply in the session opens with the dashboard address — `http://localhost:5050/`, or the one the start hook printed. The hook also shows it to the human; you repeat it so it stands in the conversation, not only in the terminal header.

**2. Read the start report, name what it found.** The start hooks print what is missing (`check-ready`: thresholds, map, language, access). Anything named there goes to the human in the first reply, one line each — not fixed silently, not deferred. An empty "Project language" field is asked at once: it decides the language of every card (`AGENTS.md` §6).

**2a. Start gate (`AGENTS.md` §3) & The Three Steps of Intake.** A "СТОП СТАРТА" in the start report — a threshold empty, `resources` or `results` in draft — means no cycle opens.
When starting a session or opening a fresh project, follow three clear steps:
- **Step 1 (Epic "3. Project protocol" — Configuration):** Immediately propose standard parameters directly in chat (attempts: 3, volume: 25, context window: 250,000 tokens, RAM disk via `vdisk-setup`, all routes enabled, Plumb on `haiku`/`jev`). Upon confirmation, write them to `project/config/PROJECT.md` and clear STOP START. Token spend and time are statistics, never asked; paid external services add a limit only if listed in `PROJECT.md`.
- **Step 2 (Human's request as the anchor for Epic 9 and all goals):** The human's request is received and carded in `backlog` with `assignee: null` (epic "6. Discussion of affairs"). It becomes the primary anchor for the brief interview:
  - The interview focuses strictly on **Epic "9. Goal achievement" (`results`) — what the human wants**.
  - From those answers, `Intent` shapes, contextualizes, and populates **all nine goals** (Epics 1–8).
- **Step 3 (Route selection & flexible orchestration):** Once goals are populated, choose routes based on stability and economy (`on-demand/route-choice.md`). Global stable goal -> maximum decomposition (`route-8` / `route-7`: `Spec` slices waves, `Kit` builds roles, `Run` subagents execute chains). Uncertainty / fog -> adaptive routing (`route-0`…`route-5`, `over-2`…`over-4`) to optimize speed, risk, and subagent spend.
A missing threshold or a goal still in draft is resolved in chat — never assumed, never deferred. A request that arrives meanwhile still becomes a card, but waits in `backlog` until the gate is closed. A production card under a goal in draft is reported by `sync-engines --check`.

**2b. Demo offer (a fresh project only).** The start gate is closed (2a), the board holds no card of the human's and `node .forma/i18n/cli.cjs demo` prints `none` — the start report also says "demo cycle was never offered". After the dashboard link and the report, once, offer a short demonstration: two small cards through the whole route, a few minutes, nothing of it stays in the project statistics. Three answers: **start** — read `on-demand/intent-demo.md` and run it; **skip** — `cli.cjs demo declined`, never offered again; **later** — `cli.cjs demo later:2` (offered again after that many session starts). The human's own first request is never held for the offer: it becomes a card as in item 6, the offer waits one reply. Not offered when the marker is anything but `none`, when the board has a real card, or when the gate is already open. The Claude start hook counts `later:<n>` down itself; on another engine run `cli.cjs demo-tick` once at session start.

**3. Look at the board before taking a request:**

| On the board | What you do |
|---|---|
| "Круг по эпикам: … 10/10 — пора Core" in the start report | offer the human to hand that epic to `Core` (`AGENTS.md` §7) |
| "протокол: K коммит(ов) в dev до выпуска" | the release waits for its volume or a closed cycle; name K, `--release` only then or on command |
| a card in `review` | it waits for your check or the human's acceptance — name it |
| `done` with `assignee: "Core"` | the cycle is not closed — name it; closing is `Core`'s |
| epic "3. Project protocol" flagged as awaiting a decision | the human owes a decision — name it |
| `backlog` with `assignee: null` on a card `Spec` didn't create | a signal, not an error: the card never went through slicing (no five fields, not tied to a goal) — ask the human whether it needs slicing and which goal to attach it to, rather than stamping `"Spec"` on a card `Spec` hasn't seen — that would be untrue (`AGENTS.md` §7) |

**4. Empty brief — the interview is the first work.** `project/brief/` holds no interview record: before any goal, the interview (`on-demand/intent-goal-opening.md`), opened with the question of where it runs (`intent.md`, "Every request", item 3).

**5. Session length.** When the conversation moves to an unrelated **topic** (not a new task within the topic), say so in one line and offer `/clear`; the human decides. `/compact` with an instruction ("keep the plan and open questions") within a topic. Not in the middle of an unfinished task; not again once declined on the same topic. Why: every call carries the whole conversation, and session length is the one lever the numbers confirm. **Auto-compact threshold: 250K by default** — the installer offers `CLAUDE_CODE_AUTO_COMPACT_WINDOW=250000` in `.claude/settings.json` → `env` (default on a 1M window is ~967K); applies to subagents too. Why: noisy work lives in the nodes, so `Intent`'s window grows only from the dialog — 250K holds a session. The human's own value (environment, `~/.claude/settings.json`, `.minimax/settings.local.json`) wins and the installer never touches it; `npx github:FormaMindPro/formamind init --compact <n|off>` changes the project's value.

**6. The graph digest.** The start hook appends the breaks of the `central` graph (cards without a goal or role, roles and goals without cards, edges to nodes that don't exist, zones without a README, resources without a description). Name only what bears on the request or on the cycle; the rest stays in the digest. A question to the graph — `intent.md`, "Every request", item 10.

**7. Then the request.** The human's first request becomes a card before any work (`intent.md`, "Every request", item 1).

<!-- moved-from-law: start-gate -->
**No start without the two thresholds and the nine goals (law §3).** The first cycle does not open — no card beyond the interview and the tooling it needs — until both thresholds (attempts, volume) hold a value in `PROJECT.md` and each of the nine main goals has its image; `resources` and `results` come from the human alone (who forms the rest — `intent-goal-opening.md`, "How goals are formed"). A paid external service in `PROJECT.md`, "External services" (an external Plumb executor is one), adds a third limit per cycle, in its own unit (calls); an empty table — none. A missing threshold or a goal in draft is asked at once, in the interview — never assumed, never deferred. **One exception:** a demonstration cycle the human agreed to — its cards carry the label `demo`, stay out of spend and statistics, and are removed when it ends (`intent-demo.md`).
