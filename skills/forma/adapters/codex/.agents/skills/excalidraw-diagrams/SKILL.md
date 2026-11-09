---
name: excalidraw-diagrams
description: "Project's Excalidraw diagrams: font, palette, two ways to draw (a local file or the cloud connector), typical mistakes."
---

# excalidraw-diagrams - drawing rules for Excalidraw

## Font - always Excalifont

`fontFamily: 5` (Excalifont) is Excalidraw's current font since 2024, preset as the default in the app itself. **Never `fontFamily: 1`** (Virgil) - the old font displaced by Excalifont, yet many examples on the web and older generators still use `1` out of inertia.

The full `FONT_FAMILY` table (`packages/common/src/constants.ts` in `excalidraw/excalidraw`):

| Value | Name | Purpose |
|---|---|---|
| 1 | Virgil | old handwriting (do not use) |
| 2 | Helvetica | normal (deprecated slot) |
| 3 | Cascadia | code (deprecated slot) |
| 5 | **Excalifont** | **handwriting, the default - use it** |
| 6 | Nunito | normal text |
| 8 | Comic Shanns | code |

On every text element (`type: "text"`) and in the `label` of a shape's caption - the field `fontFamily: 5`, unless a different font is explicitly needed (code is 8, normal text is 6).

## Two ways to draw - which one when

| Way | When | Notes |
|---|---|---|
| **A local `.excalidraw` JSON file** (a Node script generates the whole file) | A large structural diagram for `.forma/manual/diagrams/`, kept in the project and refined over time | No live engine - text wrapping and block height are computed by hand (see below); in exchange, one pass, no round-trips; opens in the user's local app |
| **The `claude.ai Excalidraw` cloud connector** (`create_view`, `export_to_excalidraw`) | A diagram to show right in the chat, or a shareable excalidraw.com link is needed | `create_view` - draws with animation, requires `cameraUpdate` as the first element (4:3, see the `read_me` hint); `export_to_excalidraw` - uploads ready JSON, returns `https://excalidraw.com/#json=...`. **`read_me` is called once per conversation** - a second call shows nothing new |

Both ways accept the same element schema (`rectangle`/`ellipse`/`diamond`/`arrow`/`text`), but `create_view` additionally understands the shortened `label` syntax on a shape (a caption without a separate text element) - for hand-generated JSON `label` does not fit; there you need a separate `text` element or `boundElements`/`containerId`.

## Local generation - mandatory manual text wrapping

Excalidraw does not recompute a container's height itself when the JSON is written programmatically (unlike a `label` caption in `create_view`, which the engine auto-centers). Before writing:

1. estimate the character width as `fontSize * 0.5-0.56`;
2. count how many lines the text takes at the block width minus padding (~16px per side);
3. wrap the text by hand (`\n` inside `text`), do not rely on `width` - it only affects wrapping for `type: "text"` without ready `\n`, and even then not always predictably;
4. block height - from the accumulated height of all lines plus padding, not "by eye".

An example of a finished generator - `.forma/manual/en/assets/` (the older `project-structure.excalidraw` was removed by the human) (the script lived in a session scratchpad, not in the project - on reuse, write it anew after this pattern, do not hunt for the old file).

## Palette

For diagrams of **this project's** structure (the five nodes Intent/Spec/Kit/Run/Core) - not a generic Excalidraw palette but the accepted project one (matches `.forma/manual/diagrams/five-nodes-console.html` and `.forma/manual/diagrams/five-nodes.excalidraw`):

| Node | Hex |
|---|---|
| Intent | `#b98cff` |
| Spec | `#6fd3ff` |
| Kit | `#7199ff` |
| Run | `#7be0a8` |
| Core | `#ff6b57` |

The background is dark `#0f2a4a` (`appState.viewBackgroundColor`), not the default white: the project keeps a single dark blueprint style across all diagrams and artifacts.

For diagrams **not about the project structure** (generated via `create_view`, one-off explanatory sketches) - stick to the palette of that server's `read_me` (the `Color Palette`/`Excalidraw Fills`/`Background Zones` sections); it is tuned for a white background and readability in chat.

## An expensive mistake - never re-read a large generated file in full

An `.excalidraw` file is one long JSON without line breaks. The `Read` tool cannot read a single-line file page by page (it hits the ~25000-token preview limit and truncates). If a **point** fix is needed (say, one field's value everywhere) - edit via `sed`/`grep -o … | wc -l` for verification, not via `Read` + rewriting. If the **whole** file text is needed (say, for `export_to_excalidraw`) - that is unavoidably expensive (tens of thousands of tokens for a large diagram); do it deliberately and on request, not "just in case" after every edit.
