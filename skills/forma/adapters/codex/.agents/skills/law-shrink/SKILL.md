---
name: law-shrink
description: Shrinking AGENTS.md down to its holders - apply when the law has bloated or a law edit adds prose: constructive rules (prohibitions with script-holders) shrink by the principle "the address stays, the prose leaves, the holder is named", judgment rules are untouched; after shrinking, the law-shrink.cjs gate is obligatory.
---

# law-shrink - shrinking the law down to its holders

The law (`AGENTS.md`) loads into every session of every engine: its weight is a reading cost, not bytes for bytes' sake. A rule already held by a script need not explain in the law how it is executed - the holder's address suffices.

## Principle

**The address stays, the prose leaves, the holder is named.** A line of law whose execution a script carries shrinks to: what must hold + the holder's name in brackets. Example (prohibition 18): four lines of description → one - "held by `forma-commit.cjs` + pre-push".

- The prohibitions' numbers are permanent addresses: roles' references ("prohibition 17") and `law-pointers.cjs` live by them; do not renumber.
- A file the law names must exist - the gate checks every name in backticks.

## What is not shrunk

Judgment rules - what no script carries and no script could carry: prohibitions 2, 6, 7, 9-14, §1 (the five pairs), §2 (the route), §4 (the position markers). Shrinking them loses meaning, not weight. The pairs' character (§1) and the tabular forms are not touched either: they are not "prose" but the load-bearing structure.

## The order

1. **Baseline.** The law's volume before shrinking is recorded in `.forma/living/checks.json` (key `lawShrink.baselineBytes`) if not recorded yet: the gate judges "strictly less than the baseline".
2. **Shrinking.** Only what is already constructive: prohibitions with script-holders and the countable rules of §3. Every leaving piece of prose leaves behind the holder's address.
3. **The gate.** `node .forma/board/checks/law-shrink.cjs` - green is obligatory: the volume below the baseline, the prohibition numbers 1-18 and the §1-§7 headings in place, every backtick-named file on disk.
4. **The mirror reconciliation.** `node .claude/scripts/sync-engines.cjs --check` - the law travels across the engines; a red reconciliation = the edit is not finished.

## The bounds of honesty

The shrinking ceiling is real: the pool of constructive prose is finite (measured at the method's first application: ~2.3 KB at the honest ceiling); deeper than that cuts meaning. Shrinking does not chase bytes: if after shrinking a rule reads worse than it holds - roll the piece back. One test per edit - read the section aloud: if the holder is named and the rule is clear without the removed prose, the shrinking is honest.

The method has been executed and verified on the live law (14769 → 13649 B); the gate's holder is `law-shrink.cjs`, the precedent for recording the baseline is `.forma/living/checks.json`.
