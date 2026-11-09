---
name: skill-authoring
description: How to shape a new skill (SKILL.md) when the arsenal lacks one, and how to write text an agent reads (a skill, a role file, a law line, a description). Used by Kit (equipping a task, `kit-limits.md`) and Intent (housekeeping, editing .claude/skills/ directly), when no ready skill exists in the arsenal or in the ready-made sources.
---

# skill-authoring - how to shape a new skill

The official source of the mechanics is https://code.claude.com/docs/en/skills.md. Here - only what is specific to this project on top of the official format, without retelling the whole documentation.

## When

`Kit` - `kit-limits.md`, "Limits": the skill exists neither in `.claude/skills/` nor in the ready-made sources (the table below) - raises the tier to strongest and designs it itself.

## Ready-made sources - before designing a skill

The sources differ in who connects them and what may be done with a find:

| Source | Where | Who connects it | What you do with the find |
|---|---|---|---|
| Own `project/config/CONFIG.md` | the project | - | **look first, before anything external**: the gap may have closed in a past goal (the experience store - `kit.md`, "Experience") |
| Skills already available in Claude Code | the list the environment shows at session start: the project's `.claude/skills/`, global (`~/.claude/skills/`) and plugin ones (`impeccable`, `dataviz`, `artifact-design`) | already connected | the cheapest source - invoke `Skill`, copy and shape nothing |
| The plugin marketplace | connected sources (`claude plugin marketplace list`, `claude plugin list`, `claude plugin details <name>`) | **the human** - it changes the shared environment of all projects | a request to the human; do not install it yourself |
| `github.com/anthropics/skills` | via the browser (`new_page` + `take_snapshot`) | - | a template: copy and shape it as your own in `.claude/skills/` - ordinary work, no approval needed |
| Third-party skill catalogs connected per project (e.g., an MCP catalog of design skills) | per project, when equipping specific work | already connected | status first, if the server needs it, then search; the browser (`new_page` + `take_snapshot`) is the fallback path. A find is a template, as above |

A source unavailable - `kit-limits.md`, "Limits" and "Environment limitation".

## A skill that will equip `Run` more than once is not written by eye

`skill-creator` - if the plugin is connected or it sits in `.claude/skills/skill-creator/` (the official `anthropics/skills`) - it is a process: draft → test prompts → evals → edits → benchmark → `description` optimization. A weak skill in `Run`'s equipment is distortion, a loss for `Kit`: it will not surface at once, it will show itself on the first attempt where the wording failed. This is the base process for any skill, a small one-off gap included: there is no lighter path of our own. The project's rules on top of `skill-creator` - "This project's specifics" below.

`Intent` - housekeeping (`AGENTS.md` §1): editing `.claude/skills/*/SKILL.md` directly with the human, outside the production route - its own toolkit, not a product of the site.

## SKILL.md mechanics (official, briefly)

- No frontmatter fields are required; de facto `name` and `description` are needed.
- `description` - up to 1536 characters, the key usage scenario first: the model decides from it whether to invoke the skill. A vague description will not be found when needed. The criterion, [adapted from mattpocock/skills](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md): the leading trigger word first, not mid-phrase; one branch of a scenario - one trigger (synonyms of the same branch collapse, not enumerate); do not repeat in the description what the file body already makes clear.
- Keep `SKILL.md` compact (the official guide is up to ~500 lines); large content goes into neighboring files of the same directory (`reference.md`, `examples.md`), not into the one file. The criterion of what exactly to move out (same source as above): into the file - what not every branch of the skill's use needs; what all branches need at once stays in `SKILL.md`.
- There are optional fields (`disable-model-invocation`, `context: fork`, `allowed-tools`, `model`/`effort`, `paths`…) - not used in any skill of this project yet. Do not add without a reason: minimal frontmatter (`name`+`description`) already works for all current skills (`grilling`, `excalidraw-diagrams`, `skill-creator` etc.) - do not complicate by default.

## This project's specifics

- **Where to put it**: `.claude/skills/<name>/SKILL.md` - the project level, not personal (`~/.claude/skills/`) and not a plugin. Connecting a plugin or a personal directory is not something you arrange yourself: it is a request to the human (`kit-limits.md`, "Limits") - it changes the shared environment of all projects, not only this one.
- **The name**: Latin script, kebab-case, after the pattern of the existing ones (`grilling`, `excalidraw-diagrams`, `project-knowledge-pattern`) - not a Cyrillic slug. Cyrillic in this project is only for the board's card files (`spec.md`), not for skills.
- **Language: English only.** Every skill (`SKILL.md`) — frontmatter (`name`, `description`), section headings, instructions, scripts, code, and examples — MUST be authored strictly in English (prohibitions 16 and 19). Skills are cross-engine runtime assets and tooling for AI models. Never author skills in Russian or any other localized language, even if the user or host project uses Russian. Cyrillic in a skill is an immediate stop in `check-english-code.cjs`.
- **The description** - in English, in the style of the other skills: one line of what it is and when to apply it, no filler.
- **No registry**: the list of skills is the `SKILL.md` files themselves; the "what it is good for" line is their `description`. No separate inventory is kept.
- **A skill copied/adapted from an external source** (a skill catalog, a repository like `mattpocock/skills`) - a link to the source in the file body, as in `grilling`. Do not pass off another's work as invented here (prohibition 6, `AGENTS.md` §5).

## Writing text an agent reads

A skill, a role file, a law line, a `description`. Four rules from `mattpocock/skills`, `productivity/writing-for-agents` (https://github.com/mattpocock/skills/tree/main/skills/productivity/writing-for-agents). What the schema already holds is not repeated here: affirmative phrasings - `AGENTS.md` §5; one source - §8 of the engine file and "do not duplicate" below; the completion criterion - §6.

- **The pointer** (a `description`, a line naming another file): the leading word first; one trigger per distinct case - synonyms of one case collapse into one; what the body says about itself is cut. The pointer loads on every turn, so it is cut harder than the body.
- **Hunting idle strokes:** a sentence that changes nothing against the model's default behavior is deleted whole, not trimmed. A word too weak to override the default is replaced by a stronger one.
- **Leading words:** an explanation repeated in several places collapses into one word the model already knows (examples from the source: _tight_, _red_); a coined word - only when no fitting one exists, and defined once.
- **Retelling the environment is a cache:** what one file or one command shows (a config, a directory structure, `--help`) is left to the environment; only what an inspection cannot find is written - the cause, the gotcha.

## What not to do

- Do not assemble a skill "for the future", without a concrete gap it closes right now - a bloated arsenal is known to no one in full (`kit.md`: "There is no separate inventory - it would drift from reality").
- Do not duplicate what already stands as common text in `AGENTS.md`/`.claude/agents/*.md` - a skill is a narrow technique of "how to do", not a retelling of the common rules in other words.
