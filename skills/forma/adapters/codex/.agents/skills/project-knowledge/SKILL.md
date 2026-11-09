---
name: project-knowledge
description: Where to record new project knowledge - a decision (ADR), an environment fact (experience), a term (glossary), a schema decision, a node rule, an external link; duplicate check and challenging a term. Invoke at the moment the knowledge appears, before writing it down.
---

# Recording project knowledge

The law: knowledge about the project is written into the project's files per this table, not into the engine's memory (`AGENTS.md` §6). Product knowledge - a fact or a setting of this site/project - only into `project/` (`AGENTS.md`, "Three layers of files"): never into a role, a skill, a script, the manual, or the protocol source. Here - only the "how".

Basis: `domain-modeling` from `mattpocock/skills` (https://github.com/mattpocock/skills, `engineering/domain-modeling`), adapted.

## The route

| What appeared | Where | Format |
|---|---|---|
| A decision that passed **all three** conditions (below) | `project/adr/NNNN-<slug>.md` | `project/adr/README.md`; the ADR names the card code |
| A fact about the site/environment: a gotcha, a constraint, what did not work and why | `project/experience/<subject>.md` | `project/experience/README.md`; the subject has a file - a line into it, do not start a second one |
| A domain term | `project/ops/GLOSSARY.md` | the file's header; one or two phrases of what it *is*, without implementation |
| A decision about the schema itself (roles, law, route) | `.forma/living/CHANGELOG.md` | a dated entry |
| A rule of a node's conduct | the role, skill, or law it belongs to | in engine parity |
| An external link, a source | `project/reference/` | one file per source kind |
| A decision that failed the three conditions | the card only | nothing beyond |

**Engine memory is not a place for project knowledge.** Other engines and nodes do not read it. Only what concerns the engine session itself belongs there; otherwise at most a pointer to a project file.

## The three-condition filter (ADR)

All three, or there is no ADR:
1. **Hard to reverse** - rolling back costs noticeable work.
2. **Would surprise without context** - a reader six months later will ask "why like this?".
3. **There was a real choice** - alternatives were considered, one rejected for a reason.

Do not propose an ADR "for completeness".

## Who writes what, and when

- **ADR** - a standing record of a closed decision card (or any card whose result is a decision) that passed the filter above; the format is `project/adr/README.md`. `Intent` writes it when confirming that card; the ADR names the card code.
- **The glossary** (`project/ops/GLOSSARY.md`) - domain terms only, no implementation; the format is in the file's header. `Intent` writes at the moment a term is settled, not in batches; it also challenges the human's words against the glossary, the code, and the site. The other nodes take terms from there and name a conflict (`AGENTS.md` §2), they do not redefine.

## Before writing - the duplicate check

1. Grep the subject across the destination and its neighbors: `project/experience/`, `project/adr/`, `project/ops/GLOSSARY.md`, `.forma/living/CHANGELOG.md`, the roles and skills.
2. Found by meaning (not only by words) - append what is missing to that same file; do not start a second one.
3. Found a contradiction - do not overwrite silently: name what was and what is now, with the date and the source.
4. Carrying over from memory/chat - facts verbatim: numbers, ids, paths, dates, the "why".

## Challenging a term

- The human's word diverges from the glossary - name it at once: "the glossary says X, you seem to mean Y - what is meant?".
- A word is vague or overloaded - propose one precise word.
- The human says how something works - check against the code/site by fact; name a divergence, do not smooth it over.
- A term has settled - a line into the glossary at once, not a batch at the end.
- Apart from the glossary's keeper (`Intent`), nodes do not redefine a term - a conflict is named per the route (§2).
