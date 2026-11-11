---
name: project-setup
description: Initial setup wizard for a new project in the Forma protocol. Guides step-by-step configuration of virtual RAM disk, project thresholds (volume=25, attempts=3), route settings (enabled routes, route-0 threshold, over-2 model and limit, over-4 batch, dispatcher), the Claude Code auto-compact window (250000 or off), Plumb calibration and models (OpenRouter typesafe/jev-1.14 or builtin, calibration thresholds, and .env key), and language localization (ru, en, or package generation). Invoke when starting the protocol in a new project, when "STOP START" appears in the session start report, or upon project configuration requests.
---

# project-setup — initial project setup wizard

A core Forma protocol skill. Guides `Intent` through the first-run procedure in a fresh project, fills mandatory configuration fields in `project/config/PROJECT.md`, and clears the start gate (`AGENTS.md` §3).

Without clearing the start gate, no production cycles can open: all work remains in `backlog` until configuration is complete.

---

## When to invoke

- First launch of an agent session in a fresh project (after `forma init`).
- Session start hook report indicates **"STOP START"** (`check-ready`).
- Missing thresholds (`attempts`, `volume`) or Plumb settings in `project/config/PROJECT.md`.
- User explicitly requests "setup project", "configure project", or "initial setup".

---

## 6 Setup Steps

```
1. RAM disk (vdisk-setup) ➔ 2. Thresholds (25 / 3) ➔ 3. Routes (route table) ➔ 4. Plumb (role fit / model) ➔ 5. Localization (i18n) ➔ 6. Clear STOP START
```

### Step 1. Virtual RAM disk

Invoke [`vdisk-setup`](../vdisk-setup/SKILL.md).
1. Check status: `node ../vdisk-setup/scripts/check-vdisk.cjs --status`
2. If unmounted, propose setup to the user:
   - Explain advantages: **2–8x faster** filesystem and test I/O (up to 7.5x in protocol tests), zero NAND flash wear and host disk clutter.
   - Provide choice: mount disk (`powershell -ExecutionPolicy Bypass -File ../vdisk-setup/scripts/setup-ramdisk.ps1`) or continue in graceful degradation mode (`os.tmpdir()`).
3. Configuring the RAM disk at this step ensures subsequent tests, page builds, and artifact generation operate directly in memory.

### Step 2. Protocol thresholds

Record the two fundamental protocol thresholds in `project/config/PROJECT.md` under section `## Thresholds` (`<!-- k:thresholds -->`):

| Threshold | Value | Meaning |
|---|---|---|
| Task attempt budget <!-- k:attempts --> | **3** | Maximum execution attempts by node `Run` before returning for re-slicing |
| Cycle volume cap, cards (per epic) <!-- k:volume --> | **25** | Standard card cap per production cycle of an epic before submission to `Core` |

> [!NOTE]
> Token spend and elapsed time are statistics, not thresholds. They are recorded by fact in card history and are never capped or set in advance (`AGENTS.md` §3). No spending limit in dollars is ever set.

**Auto-compact window for Claude Code** (when the project runs Claude Code). Ask the user: the token window after which Claude Code compacts the conversation in this project — recommended **250000**, or `off` (Claude Code's own default). The user fills in the value — never write it silently:
- write `CLAUDE_CODE_AUTO_COMPACT_WINDOW` into the `env` of `.claude/settings.json` (the hooks wiring in the same file stays intact);
- a value of the human's own — environment variable, `~/.claude/settings.json`, `settings.local.json`, or an edited project value — is **never** overwritten: report it and keep it;
- the installer's `--compact <n>|off` writes the same key explicitly, without the wizard.

### Step 3. Routes

Fill the route settings with the user in `project/config/PROJECT.md` under `## Routes` (`<!-- k:routes -->`). Ask each question with its recommended starting value; **the user fills in the values** — never write them into `PROJECT.md` silently:

| Question | Recommended starting value |
|---|---|
| Enabled routes | all `route-0`…`route-8` and overlays `over-1`…`over-4` enabled |
| `route-0` small-task threshold | work smaller than its own card: up to 3 edits in up to 3 files, mechanical, without interpretation |
| `over-2` (external cheap model) | enabled — mechanical "was → becomes" edits through `external-model-bridge.cjs`; external model `openrouter:typesafe/jev-1.14` (same channel as the Plumb `jev`), cycle call limit **100** |
| `over-4` (batch acceptance) | enabled — batch up to **10** cards, one acceptance per batch |
| Dispatcher | `Intent` (Workflow not connected; no threshold for switching to Workflow) |

> [!NOTE]
> Route codes and the choice rule — `route-choice.md`, costs and movement names — `.forma/manual/en/03-protocol/ROUTES.md` §3–§6. Route settings are project configuration, not thresholds of the law (`AGENTS.md` §3): every value is the project's own choice, the table only proposes a start.

### Step 4. Plumb calibration and role fit

Configure Plumb in `project/config/PROJECT.md` under `## Routes` (`<!-- k:routes -->`):
1. **Calibration thresholds:**
   - `leadThreshold: 0.65` — minimum confidence for primary role fit.
   - `gapThreshold: 0.15` — minimum margin between top role and second candidate.
2. **Model and provider:**
   - Recommended external model: `openrouter:typesafe/jev-1.14` (fast, low-cost structural classifier).
   - Fallback in-family model by engine: Claude Code — `claude-3-5-haiku` (`haiku`); Gemini (Antigravity) — `gemini-3.8-flash (low)`; Codex — `gpt-5.6-luna (low)`; MiniMax — `minimax-m3.1-flash`; ZCode — `glm-4-flash`.
3. **Credentials check:**
   - Verify OpenRouter API key presence in `.env` (`OPENROUTER_API_KEY`).
   - If absent and external Plumb is chosen, prompt user to supply key.

### Step 5. Language localization

Verify `<!-- k:language -->` in `project/config/PROJECT.md`:
- `Russian` for Russian (`ru`).
- `English` for English (`en`).
- For unbundled languages (e.g. `de`, `fr`), verify `.forma/translation-pending.json` schedule.

### Step 6. Clear STOP START gate

1. Run board and project integrity verification:
   ```bash
   node .forma/board/check-board.cjs
   ```
2. Confirm green gate across all configured thresholds.
3. Inform the user that project initialization is complete and production cycles may begin.
