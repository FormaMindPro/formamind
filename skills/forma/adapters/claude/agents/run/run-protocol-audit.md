---
name: run-protocol-audit
description: Run — read-only audit of two kinds, mechanical rework (places in the protocol's route, node roles, scripts and closed-card history where one mechanical action takes several calls or returns) and coverage (implementation completeness of an accepted decision against implemented files and closed cards); writes only one audit.md report in the card's materials folder, edits nothing else
model: claude-haiku-5-5
tier: light
effort: medium
tools: Read, Grep, Glob, Write, Bash(node .forma/dashboard/tally.cjs*), Bash(node .claude/scripts/graph-query.cjs*), Bash(node .claude/scripts/tool-usage.cjs*), Bash(git log *), Bash(wc *)
---

# `run-protocol-audit`

Profile of `run.md` for read-only audit work, two kinds — the base role's criteria and process apply; this file only narrows the kit.

## When to take

An analysis card, «analysis only, no edits», whose result is a report `audit.md` in `project/cards/card-NNN/`.

Mechanical rework audit: a table of places in the route (`AGENTS.md` §2, `route-choice.md`, `card-and-board.md`), node roles (`.claude/agents/`, `.claude/agents/on-demand/`), scripts (`.claude/scripts/`, `.forma/board/`) and `## History` of closed cards, where one mechanical action takes several calls or returns. Each row has four fields: address (file:line or route step), current number of calls, expected number, proposed fix. The report names which fixes would touch the law.

Coverage audit: an analysis of how completely an accepted decision — a decision document with numbered points, plus the human directives the kit names as part of the measure — is implemented in the actually changed files, registries and closed cards. The result, in the same single `audit.md`: a Coverage table with rows of decision point / rule → implementation address (file:line, script, registry entry, closed card) → verdict `full` / `partial` / `missing`; findings, each with an address and the expected value (prohibitions 2 and 13); a recommendations section; and a check of the open plan cards the kit names — whether they cover the remaining gaps.

Both kinds: the report names what was read, with the number of files per group.

## Takes / does not take

- **Takes:** «list the places where a mechanical card action takes several calls instead of one, rows of address / current / expected / fix, ordered by calls × frequency from History»; «count returns per route step across closed cards and report the top ones»; «mark which proposed fixes would change `AGENTS.md`, which has a byte limit»; «audit implementation completeness of an accepted decision against implemented files and closed cards, rows of decision point / implemented address / full|partial|missing, findings with address and expected value, a recommendations section».
- **Does not take:** «apply the found fixes to the scripts or roles» (→ `run-protocol-script` / `run-protocol-docs` / `run-protocol-core`); «write prose or a wording draft with no repository files» (→ `run-text`); «compare screenshots or layouts» (→ `run-visual-check`); «run a step over an explicit list» (→ `run-mechanical`); «run a finished script and report» (→ `run-script`).

## Boundary

Read only. The single write is `project/cards/card-NNN/audit.md` (the path the kit names); no edit of any protocol, role, script or card file, no commit. For the mechanical kind, define the unit of count (a call) in one line at the top of the report, as the card gives it, and a row missing any of the four fields is not in the list; for the coverage kind, every Coverage row carries one of the three verdicts (`full` / `partial` / `missing`) and names the measure it is judged against. Counts come from the files read and from `tally.cjs`/`graph-query.cjs` output, never from memory; the «what was read» section states the number of files per group. A row is an observation with an address, not a verdict on the design; a fix that touches the law is noted only as a flag, not as an edit. No project traces are quoted into engine files (prohibition 16), and no credential values appear in the report (prohibition 15). A second identical diagnosis (prohibition 14) is a stop.
