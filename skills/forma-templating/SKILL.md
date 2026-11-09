---
name: forma-templating
description: Builds an installable project template (a separate plugin in the forma marketplace's templates/ directory) out of the current Forma project, under the name the human gives. Invoke when the human says "create a project template", "make a template from this project", "package the project as a template", "make a project template". Only on the human's direct request - never proactively, with no cards on the board.
---

# forma-templating - a project template out of the current project

A template = the route + the nine kinds of base goals in generic form + de-personalized skills. The shape exemplar - `templates/forma-wordpress-novamira/` in the `forma` plugin's catalog.

## What goes in / never goes in

| Goes in | Never goes in |
|---|---|
| `project/config/ROUTE.md` - the route (steps, entry/exit, why this order); `project/brief/idea.md` - only the section skeleton, the content de-personalized into "not yet asked" marks | the cards `.devtool/features/`, `project/cards/` |
| the base goals of nine kinds (`analytics`, `structure`, `protocol`, `resources`, `balance`, `discussion`, `channels`, `competencies`, `results`) - order, end-image and readiness criterion **in generic form**, as an algorithm | history, spend, `JOURNAL.md`, `dashboard/*.log` |
| the `goal-NN` subgoals - only as a generalized order of steps, without the project's subject matter | `VARS/`, `.env`, `project/brief/` (except the `idea.md` skeleton) |
| the project's skills, cleaned of bindings (`.claude/skills/*`, except the core `forma` skills) | `project/experience/`, `project/config/CONFIG.md`, `mockups/`, `reference/` |
| the `Run` profiles and the "template" layer's scripts - those lying in `project/extensions/template/<engine>/` that any project of this kind needs (not only this product): `project/extensions/template/claude/agents/run/*.md` → `template/agents/run/`, `project/extensions/template/claude/scripts/*` → `template/scripts/`, cleaned of project traces; names by function, not by card (`kit.md`, item 4a) | profiles and scripts needed only by this product; everything in the protocol core (the shared catalog of `Run` roles, the core's `.claude/scripts/`) |

The registry of kinds - `intent-goal-opening.md`, "Epic". Goals - `project/goals/`, the form of the whole - `project/ops/ROADMAP.md`.

## Steps

1. **The name.** Ask the human. Do not invent.
2. **Uniqueness.** The name must not collide with a `name` in the `forma` catalog's `.claude-plugin/marketplace.json` nor with names from `claude plugin list`. A collision - say with what, ask for a new one. Format: `kebab-case`, Latin script.
3. **Inventory.** Show the human what goes into the template: `ROUTE.md`, the `idea.md` skeleton, the nine base goals, the list of subgoals, the list of candidate skills. The human strikes out the excess.
4. **The de-personalization list** - assemble and show **before packaging**, as a table `what it was → what replaces it`:
   - the project/site name, domain(s), brand;
   - names and logins from `VARS/test-users.md`, `VARS/credentials.md` (only the key names; never read the values into output);
   - ids of posts/templates/snippets, server paths, URLs;
   - subject-matter entities (categories, sections) → their role in generic form ("a catalog entity", "section N").
   The replacement - a placeholder `{{PROJECT_NAME}}`, `{{DOMAIN}}` etc., or a generic word. **Package only after the human's explicit "yes" to this list.** The human's corrections - apply, show again.
5. **Packaging** into `<forma directory>/templates/<name>/`:
   - `.claude-plugin/plugin.json` - `name`, `displayName`, `description`, `version: "0.0.1"`, `license: "MIT"`;
   - `README.md` - what is inside, installation (`claude plugin install <name>@forma`), the route's status (walked by the system or a projection of practice - as in the original `ROUTE.md`);
   - `skills/<name>/SKILL.md` - the installer: puts into the project `project/config/ROUTE.md`, `project/brief/idea.md` (if present) and the nine kinds of `project/goals/goal-<code>/GOAL.md` (+ generalized subgoals) from `skills/<name>/template/`; does not silently overwrite what exists;
   - `skills/<skill>/` - the de-personalized skills of the project;
   - `skills/<name>/template/agents/run/` and `skills/<name>/template/scripts/` - the `Run` profiles and the "template" layer's scripts; the template installer puts them into the project's `project/extensions/template/claude/agents/run/` and `project/extensions/template/claude/scripts/` (the "template" layer; it does not touch `custom/`);
   - an entry in `.claude-plugin/marketplace.json`: `{"name": "<name>", "source": "./templates/<name>", "description": "..."}`.
6. **The leak check** - over the packaged folder, before the report:
   ```
   grep -rniE "<name>|<domain>|<name1>|<name2>|..." templates/<name>/
   ```
   The terms - exactly from the list approved in step 4. The output must be empty. Not empty - fix, repeat.
7. **A trial install** into an empty temporary folder (outside the repository): deploy the template with its own installer (or copy `template/` the way the installer would), rerun step 6's grep over the result. `claude plugin validate <path>` - if the command exists in the CLI version.
8. The **version** of the `forma` core's `plugin.json` - a patch step, as the project's practice goes. Do not push - only on the human's command.
9. Report to the human: the path, the composition, the grep result (empty), what remains with them (publishing, installing on their side).
