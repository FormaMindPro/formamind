---
name: graph-build
description: Building the Kit graphs - which command builds each graph (goals, board, arsenal, structure, resources, central, manual, project, tendons, site, engine skeleton) and how to verify the result. Invoke when a card says to build or update a graph.
---

# graph-build

All graphs live at `.forma/living/graphs/<name>/graph.json`, in the graphify format (`nodes`, `edges`). All are built mechanically, by script: parsing frontmatter, headings, links, paths, regexes - no model. Cache keyed by file hash: unchanged files are not recomputed, a rerun reports "parsed 0".

## Commands

| Graph | Command |
|---|---|
| goals, board, arsenal, structure, resources, central | `node .claude/scripts/build-kit-graphs.cjs` (one: `--only goals\|board\|arsenal\|structure\|resources\|central`); `central` merges the rest and prints a breakage report for Core |
| manual, project | `node .claude/scripts/build-kit-graphs.cjs --only manual` and `--only project` |
| the resources registry (input to resources) | `node .claude/scripts/resources.cjs sort\|inventory\|report` - before the graph; `prepare`, `batch`, `apply`, `register`, `decide` - below |
| tendons | `node .claude/scripts/build-tendons.cjs` - **last** |
| site | `node .claude/scripts/build-site-graph.cjs` |
| engine (skeleton) | `node .claude/scripts/build-engine-graph.cjs` |
| engine (graph.html) | `node .claude/scripts/build-engine-graph-html.cjs` - for the dashboard tab |

The experience graph is not built separately: closed cards (`done`) are part of the `board` graph.

Order: kit-graphs → manual/project → tendons. Tendons requires `.forma/living/graphs/manual` and `.forma/living/graphs/project`; without them, do not run tendons - name that in the Result. The site graph is independent of tendons - its own command, its own cache.

**One run at a time.** Do not start a second run, nor send one to the background, until the first has finished: they share the cache file.

### The structure and resources graphs

`structure` - the zones and files of `project/`, edges card → zone, spend per zone. `resources` - the registry `project/resources/_assets.json` (keyed by sha256): node `asset:<sha12>`, edges `made_by` (card), `serves` (goal), `used_in` (consumer zone), `contains` (zone → resource); state `in work` / `in stock` / `unowned`. Rules - `project/config/resources.rules.json`.

**A resource** - any material of the project except drafts (`work/`, tmp, drafts, names draft/wip) and the service files (`~$*`, `.bkp`, `VARS`, the registry itself). Class by path (first match in `classes`): `source`, `generated`, `reference`, `prompt`, `script`, `doc`, `config`, `data`. Scripts and protocol files (`.claude/scripts`, `.forma/`) do not count as resources (`exclude_paths`).

**Descriptions.** Images and videos - the `asset-describer-haiku` agent. Texts, tables, schemas - `resources.cjs describe` without a model (headings, sheets, header rows). Semantic tags are a second pass: `resources.cjs tag-batch` → the model sets tags only from the closed `domain_tags` dictionary → `resources.cjs apply-tags`. Finding a resource by a word from its description - `node .claude/scripts/graph-query.cjs find <word>`.

Order for resources: `resources.cjs sort` (class resource/draft/unclear; unclear ones listed by folder, the human decides: `resources.cjs decide <folder> resource|draft`) → `inventory` → `prepare`/`batch --n N` (downscaling to ~1024 px and video frames via ffmpeg → `project/work/prep`, manifest `project/work/batch.json`) → the `asset-describer-haiku` agent reads the manifest and returns JSON (once per sha256) → `apply <json>` (the script writes into the registry) → `build-kit-graphs.cjs --only resources` → `report` (a file without a record, a record without a file, no description). First a trial run on 5-10 files, shown to the human; the full run only on their "yes". Nothing is deleted; drafts go to `project/work/` (in `.gitignore`).

### The site graph

Nodes: site → page/post/CPT/template/template_part/menu/media → section (a top-level `<section id>`, else a synthetic `content`) → widget (`heading`/`cta`/`link`). Edges: `contains`, `uses_template`, `uses_media`, `made` (card → page, by ID match), `described_in` (page → a `project/*.md` file).

The snapshot is a single read-only call of `novamira/execute-php` via `.claude/scripts/site-php.cjs`; the site is not modified. Cache - `.forma/living/graphs/site/.cache.json`.

Verifying the page count - compare against the snapshot: `node -e "const g=require('./.forma/living/graphs/site/graph.json');console.log(g.nodes.filter(n=>n.type==='page').length)"` against the list of published pages.

### The engine graph (skeleton)

Nodes: file (`.cjs`/`.js`/`.py`/`.sh` from `.claude/scripts`, `.claude/hooks`, `.forma/board`, `.forma/dashboard`, `.forma/protocol/bin`, `.forma/protocol/scripts`, no `.cache`) → its exports. Edges: `requires`, `exports`. The `.codex/` and `.agents/` mirrors are not walked - one mirror node per directory. Parsing by regex. Cache - `.forma/living/graphs/engine/.cache.json`.

The script's report (stdout): files with no incoming `requires` and dependency cycles.

## Asking questions of a graph

`node .claude/scripts/graph-query.cjs find <text> [--type T]` · `node <id>` (a node and its edges by relations) · `path <a> <b>` (shortest path) · `digest` (central breakages). Default graph `central`, another one - `--graph <name>`. Auto-rebuild after edits - the `auto-graphs.sh` hook (30 s debounce, lock).

## Verification

For each built graph:
`node -e "const g=require('./.forma/living/graphs/<name>/graph.json');console.log(g.nodes.length,g.edges.length)"`
Done: the JSON reads, nodes and edges > 0. Into the Result - nodes/edges of each graph.
