---
name: project-setup
description: Initial setup wizard for a new project in the Forma protocol. Guides step-by-step configuration of virtual RAM disk, project thresholds (volume=25, attempts=3), Plumb calibration and models (OpenRouter typesafe/jev-1.14 or builtin, calibration thresholds, and .env key), and language localization (ru, en, or package generation). Invoke when starting the protocol in a new project, when "STOP START" appears in the session start report, or upon project configuration requests.
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

## 5 Setup Steps

```
1. RAM disk (vdisk-setup) ➔ 2. Thresholds (25 / 3) ➔ 3. Plumb (role fit / model) ➔ 4. Localization (i18n) ➔ 5. Clear STOP START
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

### Step 3. Plumb calibration and role fit

Configure Plumb in `project/config/PROJECT.md` under `## Routes` (`<!-- k:routes -->`):
1. **Calibration thresholds:**
   - `leadThreshold: 0.65` — minimum confidence for primary role fit.
   - `gapThreshold: 0.15` — minimum margin between top role and second candidate.
2. **Model and provider:**
   - Recommended external model: `openrouter:typesafe/jev-1.14` (fast, low-cost structural classifier).
   - Fallback in-family model: `claude-3-5-haiku` / `gemini-2.5-flash`.
3. **Credentials check:**
   - Verify OpenRouter API key presence in `.env` (`OPENROUTER_API_KEY`).
   - If absent and external Plumb is chosen, prompt user to supply key.

### Step 4. Language localization

Verify `<!-- k:language -->` in `project/config/PROJECT.md`:
- `Russian` for Russian (`ru`).
- `English` for English (`en`).
- For unbundled languages (e.g. `de`, `fr`), verify `.forma/translation-pending.json` schedule.

### Step 5. Clear STOP START gate

1. Run board and project integrity verification:
   ```bash
   node .forma/board/check-board.cjs
   ```
2. Confirm green gate across all configured thresholds.
3. Inform the user that project initialization is complete and production cycles may begin.
