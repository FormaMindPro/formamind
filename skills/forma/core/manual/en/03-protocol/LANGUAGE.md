# LANGUAGE - the engine's language layer

How the engine speaks to the human: the speech modes, the dictionary policy, the report skeletons. Machine side - `.forma/i18n/registers.json`; this file is the human rule. The project's own config names the project language (`PROJECT.md`, "Project language"); this pair (`manual/en/` - the original, `manual/ru/` - the exact copy) does not translate with it.

## Speech modes

Two poles - the qualities of two nodes (`AGENTS.md` section 1):

| Mode | Sounds as | When |
|---|---|---|
| firm | codes and facts first: "The criterion admits two readings: A or B?" | work, spend, routes, the protocol, the product |
| soft | the same fact plus the state, in human words: "This one is scary to get wrong: A or B?" | interviews, balance proposals, the human's own testing |

The fact, the address and the cause are identical in both modes - only the wrapping changes. Softness that moved a fact is substitution.

## The map

`.forma/i18n/registers.json` binds every epic code of `PROJECT.md` ("Project epics") to a mode, carries the epic's human name per declared language (the ru name must match the config cell), the dictionary policy and the report skeletons. The human re-picks a mode by editing the map - no skill overrides it. `check-register` (`.forma/board/checks/`) fails an epic code without a mode, a key without a human name in a declared language, and a ru name drifted from the config.

## Dictionary policy

Keys are English whatever the project language (`AGENTS.md` section 6); the labels are only a fallback for documents without anchors. In speech to the human a functional key carries its human name in the chat language, the address beside it (prohibition 20). The registry of names - `.forma/i18n/keys.json` and the manual `NAMES.md`.

## Report skeletons

An engine report (a step, a handoff): what changed, by artifact; gate outputs with exit codes; open risks named by address and expected value. A project report (to the human): what the human can now see; where to look, links; what waits for the human's decision. The skeletons live in the map's `reportSkeleton`; the mode colors the wording, never the sections.

## The skill: human-register

`human-register` (`.forma/skills/human-register/SKILL.md`) turns the map into behavior: before speaking, the speaker reads the mode of the current epic and declares it. The skill is read by `Intent` only - no other role carries it. The installer lays a copy into every registry adapter by default; the delivery map - `.forma/verify/skill-delivery.json`:

| Adapter | Delivery | State |
|---|---|---|
| claude | `.claude/skills/human-register/` | installed copy |
| qoder | `.qoder/skills/human-register/` | installed copy (zone present, engine dormant) |
| zcode, gemini | `.forma/skills/human-register/` | the engine-neutral canon, read natively |
| codex, minimax | the declared path | zone absent - declaration only, no files |

`check-skill-delivery` (`.forma/verify/`) fails an adapter of the registry without a declared delivery, an installed zone whose copy is missing or drifted from the canon, skill files in a zone without an installed folder, and a role that reads the skill other than `Intent`.

## The bare-code warning

The Stop hook (`.claude/hooks/stop-names.cjs`) warns when the final message carries a bare code - an address without its human name beside it (prohibition 20). It is a reminder, not a check: the pre-send scan stays the speaker's. Engines whose hook events have no stop analog (gemini, qoder, zcode) do not get the wiring; the outbound scan stays theirs.
