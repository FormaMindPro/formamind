---
name: engine-switch
description: Enable or disable an engine (Codex, Gemini, MiniMax) - dormant mode via the .forma/engines.json registry, one command. Invoke when the human asks to wake, enable, put to sleep, or switch off an engine.
---

# Enabling and disabling engines

One marker: `.forma/engines.json` → `{ "dormant": ["codex", "minimax"] }`. An engine on the list sleeps: the installer neither offers nor installs it, it is not compared, not rebuilt. Its files (`.codex/`, `.minimax/`) stay untouched.

Status: `node .claude/scripts/engine-switch.cjs status`

## Wake an engine

1. `node .claude/scripts/engine-switch.cjs wake codex` - removes the marker, rebuilds the engine's data from `.claude/` (Codex: `sync-codex --apply`, then its test), runs `sync-engines --check`. Green - done.
2. Red: read the command output, fix the divergences in the engine's zone (`.codex/` is its zone, `AGENTS.md` §8), rerun the comparison.
3. Hand over to the protocol: a card, `node .forma/protocol/scripts/forma-commit.cjs "…"`, then `--release`. The registry lands in `core/engines.json`; after the release the installer offers the engine again.
4. Other projects - "forma update".

## Put an engine to sleep

1. `node .claude/scripts/engine-switch.cjs sleep codex`
2. Hand over to the protocol - as in item 3 above.

## Rules

- Only `claude` is never put to sleep.
- An engine without a row in the script's `REBUILD` table (Gemini) is woken by the marker alone plus the general comparison; add the rebuild for a new engine to `REBUILD`.
- Do not edit `.codex/` by hand for the comparison's sake - the rebuild does that itself.

## Catch up with the core after a long sleep

For dormant engines (`codex`, `minimax`): while an engine sleeps, `.claude/` and the law move ahead and the engine's mirrors fall behind.

1. `node .claude/scripts/engine-switch.cjs wake <engine>` - marker removed, mirrors rebuilt from `.claude/` per the `REBUILD` table (Codex: `sync-codex --apply`; MiniMax: `gen-roles.cjs`, `gen-plugin-agents.cjs`, `install-plugin.cjs`), then the adapter test.
2. Adapter test red - read the output, fix the divergences in the engine's zone (`.codex/`, `.minimax/`, `miniapps/minimax-engine/`), rebuild, rerun the test.
3. Green: `node .claude/scripts/sync-engines.cjs --check`, then hand over to the protocol (item 3 of "Wake an engine"). Not needed right now - `sleep <engine>` and hand over to the protocol as well.
