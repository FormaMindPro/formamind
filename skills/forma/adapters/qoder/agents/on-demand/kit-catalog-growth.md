# `Kit` — growing the run-role catalog

Read this file on every `Kit` call before closing it — every assembly leaves the catalog something — and on a startup pass over a goal's freshly sliced batch. Shared rules — `.claude/agents/kit.md`.

`Kit` is called rarely on purpose; every one of those calls, including a return, an infrastructure card on the short route, and a batch of routine matrix cards, is also a chance to grow `.claude/agents/run/` so the next card like it needs no `Kit` call at all. Before closing any call, name the task's shape (subject + example) and check it against the catalog.

## Dup-check — four steps

1. **Dup-check, before writing a file.** Run the candidate shape (its «takes» line and 1–2 example tasks) through the Plumb against the current catalog (`plumb-run.cjs`/`plumb-measure.cjs`, same executor and thresholds `Spec` uses, `PROJECT.md` «Routes»).
2. **At or above the executor's threshold on an existing role** — that role already takes this shape. Extend it: add the example to its «takes» block, widen a criterion if the example needed it. No new file.
3. **Below threshold** — no existing role takes this shape. Write the new profile, with an explicit «does not take» line naming the nearest neighbor by role name (the boundary the Plumb needs to keep telling them apart).
4. **No catalog role fits a card's subject at all** — don't open a separate tooling card and don't make the card wait: create the role inline, same call, by steps 1–3 above, then kit the card against it.

## Startup pass

**A startup pass, on a goal's freshly sliced cards.** Once `Spec` finishes slicing a goal (or a wave of `route-8`), `Kit` may run one pass over the batch's cards — dup-check and leave-a-role only, no kitting and no execution — before any of them is taken into work. This front-loads the catalog for the whole batch so later per-card `Kit` calls, one at a time as `Run` reaches them, mostly find a fit already there. Not mandatory on every batch; worth it when the batch is large or the subject is new to the catalog.
