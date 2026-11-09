# 6. Discussion of affairs

Kind code: `discussion` · main goal: `project/goals/goal-discussion/GOAL.md`

All communication: incoming tasks, discussions, reviews, interviews (all of them, `grilling` and `synthesis` included), clarifications, solving problems. What comes in is brought down to key points that become production tasks. Goals are formed from here: first the analysis — what we expect and which goals — then the record in section 9.

| | |
|---|---|
| **Who forms the goal** | the core, by default: as is in fact, not provided for |
| **Route** | `Intent` resolves it itself (`route-0`, `route-1`, holds `in-progress`) or sends it into the route of its kind — for kind 7 that is `Spec`; the goal label is kept (`AGENTS.md` §7); interviews are held here |
| **Who confirms** | `Intent` decided — only the human accepts (prohibition 1) |

This also includes a card without slicing and a defect outside the current goal.

The `grilling` and `synthesis` interviews live here; they used to sit in section 4 (the "Project resources" epic).

## The Incubator Principle: Session Entry Node

Epic 6 serves as the universal **Incubator (Default Inbox)** for all incoming requests, ideas, drafts, interview transcripts, and unstructured tasks.

* **Single Entry Point:** Any new idea or raw request from the human, unless explicitly targeting a specific code task, is registered as a `discussion` card (`goal-discussion`).
* **Raw Context Isolation:** The card in Epic 6 keeps the conversation, transcript, and source drafts inside its working materials folder (`project/cards/card-NNN/draft.md`).
* **Minimal Overhead:** Inside the incubator, there are no rigid decomposition requirements; the card is steered by the `Intent` node, ensuring quick response and flexible design alignment.

## Cold Start Protection

At the start of a new session, the agent frequently encounters an unfamiliar context. Attempting to immediately classify an incoming task into production epics triggers the "cold start" error — recursive project file scanning (`Get-ChildItem`, scanning all `GOAL.md` and `PROJECT.md` files), taking several minutes and burning model context.

**Start Regulations:**
1. The agent is strictly forbidden from scanning the project directory tree upon receiving an unstructured request.
2. The task is immediately registered in Epic 6 via the standard `new-card.cjs` utility.
3. Analysis and routing are performed from the opened incubator card, never prior to its creation.

## Task Creation and the new-card Utility

Board card creation is conducted exclusively through the core script:
`node .forma/board/new-card.cjs`

### Quick Mode (--quick)

To instantly open a card in Epic 6, an express mode is provided:
```bash
node .forma/board/new-card.cjs --quick "<Task title>"
```

What `--quick` mode does:
* Automatically fills all mandatory fields: kind `discussion`, epic `6. Discussion of affairs`, goal label `goal-discussion`, route `route-0`, assignee `Intent`, stage `card`, status `backlog`, type `work`.
* Automatically creates the materials folder `project/cards/card-NNN/` with a `draft.md` file, preventing clean materials check failures (`card-materials.cjs`).
* Executes in ~300 ms without requiring manual input of the card's five fields.

### Duplicate Detection via the Task Graph

When creating any card, `new-card.cjs` automatically runs a duplicate check:
* The title is stripped of stop words and matched by word stems against existing card titles from the task graph (`.forma/living/graphs/board/graph.json` or board files).
* When overlaps are found, an informational notice is printed with matching card IDs and titles:
  `[dup-check] Найдено похожих карточек (совпадение стеммов): card-NNN ...`
* **Control Flags:**
  * `--strict-dup` — strict mode: aborts card creation with an error if a probable duplicate is detected.
  * `--no-dup-check` — disables duplicate checking (e.g. during batch card imports).

### Incremental Graph Auto-Assembly

When a new card is created, the board task graph is updated automatically:
* Immediately after writing the file, `new-card.cjs` invokes pure JavaScript incremental assembly for the `board` graph (`build('board', ...)`), which takes ~75 ms and requires no heavy visual rendering.
* A background trigger touches the central project graph (`auto-graphs.cjs touch`).
* The task graph always remains fresh for searches and link validations without delays.

## Two Execution Flows from the Incubator

Once a task is created in Epic 6 and primary materials are recorded, `Intent` determines the execution path:

### Express Route (route-4 and route-2)

Intended for simple, local tasks that do not require decomposition or heavy pipeline stages:
* **Examples:** Publishing an article or post, generating artwork or a product card, surgical configuration edits or documentation updates.
* **Route Scheme:**
  `Intent` (prepares draft in card folder) → `Plumb` (confirms ready catalog role) → `Run` (generates assets, builds post) → `Intent` (verifies artifact) → Human (accepts result).
* **Advantages:** `Spec` and `Kit` nodes are omitted; the card completes in minutes with minimal overhead.

### Full Pipeline (route-7 and route-8)

Intended for complex, multi-part engineering tasks:
* **Examples:** New engine capabilities, broad refactoring, architectural schema changes, multi-cycle external integrations.
* **Route Scheme:**
  The Epic 6 card serves as a **Parent Incubator**. The `Spec` node decomposes the task into child cards across target production epics:
  * `7. Production channels` — code and UI implementation.
  * `2. Project structure` — directory structure and services.
  * `3. Project protocol` — tooling, checks, and protocol rules.
  * `8. Competence segments` — skills and external integrations.
* Child tasks follow the full protocol lifecycle: `Spec` → `Plumb` → `Kit` → `Run` → `Intent` → `Core` (full cycle review).

## Linking with Child Cards

To maintain context integrity during transition from incubator to production, linking conventions are observed:
* **Data Source Link:** Child cards link to incubator materials inside their `## Kit` zone:
  `- [Source draft](project/cards/card-NNN/draft.md)`
* **Ordering Dependencies:** Child cards declare sequence relations with the parent task or peer cards via `after-card-NNN` labels.
* **Parent Card Completion:** The Epic 6 card is closed once child production cards are accepted, or moves to closure documenting references to deliverables in its `## Result` zone.

## Process Diagrams

Two core incubator processes are illustrated via vector diagrams:

1. **Incubator and Production Epics:**
   ![Epic 6 Incubator and Production Decomposition](assets/epic6-incubator-pipeline.svg)

2. **Two Execution Routes (Express vs Pipeline):**
   ![Express Route vs Full Pipeline](assets/epic6-two-routes.svg)
