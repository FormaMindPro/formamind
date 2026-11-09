---
name: spend-parity
description: Reconciling the claude-code spend across the call ledger, the cards' lines, the tally, and the Economy tab - invoke when attempt figures diverge or a difference needs explaining.
---

# spend-parity - why four counters show different numbers

Four sources count the same thing differently. The difference is not an error in itself; first break it down by causes.

## Sources and commands

| Source | What it counts | How to get it |
|---|---|---|
| A text grep | lines with `claude-code:` across all cards | `grep -rc "claude-code:" .devtool/features` |
| `tally` | parsed spend lines, deduplicated by `dedupKey` | `node .forma/dashboard/tally.cjs .devtool/features` → `byEngine["claude-code"].attempts` |
| The Economy tab | the engine's summary after `dedupeAttempts` deduplication | `economy.speed.summary.engines['claude-code']` in `generate.js buildData` |
| The call ledger | records of the `SubagentStop` hook | `.claude/.ledger/calls.jsonl` |

Descending order: grep ≥ tally ≥ the tab. The ledger is the shortest of all - it is kept only since the hook was installed.

## Causes of divergence

- **grep → tally:** lines that are not spend (quotes, descriptions of this very reconciliation); lines of the form `attempt N,` (N a number) without a token count - neither tally nor the tab reads them, and they do not land in `unparsed` either.
- **tally → tab:** the `(batch I/K)` mark. The dedup key in `tally.cjs` accounts for it, the one in `data/cards.cjs` (`dedupeAttempts`) does not, so the tab merges distinct attempts of one batch. This is the tab's undercount, not deduplication.
- **ledger → cards:** lines from before the hook, lines without a call id (`id unknown`), lines of Intent's main session (written by `card-session-spend.cjs`, they do not enter the ledger), lines written by hand per `spend-line.md`.

## The parity check

`.forma/board/checks/ledger-parity.cjs` compares in one direction only: a ledger record without a line in a card. The reverse direction ("a card line without a ledger record"), claimed in the file's header, is not in the code. `unknown` ids are skipped; an empty ledger yields an empty result without a message. Without `since`, the check raises other engines' records for all dates.

## How to break a difference down

1. Get the three numbers from the table above.
2. For each pair, name the cause from the list and count the lines by it; the causes' sum must equal the difference.
3. A remainder without a cause - a new finding: name the line's address and the expected value (prohibition 13), do not fix in place (prohibition 12).
