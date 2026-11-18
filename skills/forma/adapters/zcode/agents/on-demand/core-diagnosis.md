---
model: glm-5.3-flash
effort: high
---
# Core — diagnosis: the node map of a "not reached" verdict, and the signatures

Read this file only when a cycle's verdict is **not reached** and a node must be named, or when a node's tooling is being diagnosed (`core.md`, "Cycle verdict" / "Discrepancy signatures"); nothing else triggers it. Two projections of one node map: what the records show when the cycle fell short, and what a node kitted with the wrong thing looks like in the numbers.

**The verdict table — not reached, name the node by the record signatures** (`core.md`, "Cycle verdict"). The `Node` and `Loss` columns are the law's address — `AGENTS.md` §1, the five pairs:

| What the records show | Node | Loss |
|---|---|---|
| the criterion allowed more than one reading | `Intent` | generalization |
| the criterion was unambiguous, but the parts don't cover the image, or connections were lost | `Spec` | omission |
| the parts cover it, the kit pointed the wrong way | `Kit` | distortion |
| the kit was correct, but something similar got done | `Run` | substitution |

## Discrepancy signatures

Reading the numbers, tell apart exactly what a node is missing:

| Node kitted with the wrong thing | What it looks like |
|---|---|
| `Intent` | the readiness criterion doesn't get the same answer from two readers |
| `Spec` | a spike in exhausted budgets: cards are formally correct but unworkable |
| `Kit` | a spike in returns at the form check |
| `Run` | discrepancies at the check despite a clean form |

Prototype mismatch has no signature: it's invisible in the numbers entirely. Only comparing the thing against the prototype catches it — meaning the human.

## Soundness signatures

Symmetric to a discrepancy: soundness also reads indirectly, not off a single number. `Run` rarely errs, stays within budget, `Intent` accepts without remarks — this isn't only `Run`'s clean work: without correct slicing from `Spec` and correct kitting from `Kit`, there'd be nothing to get there this cheaply with (`PROTOCOL.md`, "The second word as a chain"). The reverse also holds, and it's cheaper for diagnosis: rising attempts and returns at `Run` despite a clean card form — look first not at `Run`, but at what stands before it in the chain; the cause is often there, not in the execution.
