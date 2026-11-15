# Docs editor v2: review and rebuild plan

_2026-11-14, written by Fable for Opus (the builder) after Ramin's verdict on the current editor: "a third-grade copy of Notion", not smooth, and it sometimes throws `Called contentMatchAt on a node with invalid content`. Ramin wants a faithful Notion-style doc with side-by-side layout, custom blocks (diagram, canvas, more later), and docs that agents and the app's own AI can write and restructure with ease._

**Status (2026-11-15): BUILT through phase 5 and SWITCHED (every doc on the new editor; Ask AI inside a doc; "As built" at the end); phase 6 (cleanup) left, after Ramin has used the new editor a while. Originally: PLAN, approved by Ramin with the revision below and the §11 block audit. It is step 6 of [AGENT_DIAGRAMS_PLAN](AGENT_DIAGRAMS_PLAN.md) (steps 0–5 built) and is Phase 3 of [ECOSYSTEM_PLAN](ECOSYSTEM_PLAN.md): stage 5 of its build order (with the doc backend and sharing of MANAGER_AND_DOCS_PLAN): after the loop, the Revise import and the manager, **before** the deploy (Ramin, 11-14 late night). Ask AI there runs on the one tool catalogue (ECOSYSTEM_PLAN change 12).**

> **Revision, 2026-11-14 (Ramin's ruling after reading this plan):**
> - **No side-by-side columns.** "I am over-optimising; I don't even need it." Drop `xl-multi-column`, the `:::columns` syntax, the columns checklist items and spike item 3. Nothing GPL is used: every package in this plan is MPL-2.0 or MIT.
> - **Rule:** no dependency that could need payment or block us later.
> - **Focus first:** agent-written notes with real diagrams ([AGENT_DIAGRAMS_PLAN](AGENT_DIAGRAMS_PLAN.md)). This rebuild follows it.
> - **Smaller Phase 0a:** about 25 essential Notion behaviours (handle, drag, nesting, keys, slash menu, selection), not 60–80. Ramin has Notion open and logged in at `https://app.notion.com/p/41755e0b0a9b8046b44bdfa59e449c60`; if the REA browser needs a login, open that page there and he will log in.
> - **§9 answers:** 1 yes · 2 not needed (no columns) · 3 yes, any package may be installed · 4 yes, as above.
> - Where the text below mentions columns, read it as removed.
> - **Block audit (Ramin, later the same day):** every existing block and option is re-checked and made compatible with MCP and the home AI; the old "Ask AI to write" node goes. See §11.

---

## 1. Review: why the current editor feels wrong

**The foundation is the wrong shape.** The editor is TipTap's StarterKit, a *flowing document* schema: paragraphs, and lists as `ul > li`. Notion is a *tree of blocks*: every block is the same kind of unit, has an id, can hold child blocks, and gets the same handle, drag, selection and indent behaviour. We have been imitating block behaviour on a document schema with hand-written patches:

| Patch | File | What it imitates |
|---|---|---|
| Handle rules | `components/docs/editor/BlockHandle.tsx` | which block the handle belongs to |
| Row hit-testing | `lib/extensions/RowHit.ts` | "the row under the pointer is the block" |
| Drop logic | `lib/extensions/BlockDrop.ts` | above or below by the target's half |
| Columns | `lib/extensions/Columns.ts` | side-by-side, drop on an edge, resize |
| Keys | `lib/extensions/BlockKeys.ts` | Backspace, Tab, Enter as in Notion |
| Canvas absorb | `lib/extensions/Canvas.tsx` | ids for duplicated blocks |

Each patch fixes one symptom and none shares a model with the others, so combinations break. That is the "inconsistency" Ramin feels, and it has no end: nesting any block under any block, selecting several blocks, moving a group, and indenting are all still missing, and each would be another patch.

**The error is a real data-corruption bug, reproduced.** Dragging a list item onto the side of a paragraph makes a column that holds a bare list item, which the schema forbids. Nothing validates it, Yjs stores it, and the doc stays broken (every later edit can throw). Repro: `scratchpad/scripts/invalid-repro.js` prints `Invalid content for node column: <listItem(…)>`. The same hole exists wherever our code builds nodes by hand (`columnType.create`, `replaceRange` of a dragged slice).

**There is no measured target.** The Notion behaviours were written from memory, not captured from Notion. Only typography was measured (`context/research/design-v2/notion-editor-rea.md`).

**The agent path is lossy.** Agents write Markdown only. Columns are flattened, tables become code, and a precise edit ("change this one block") means rewriting a whole section.

**What is sound and stays:** Yjs + Hocuspocus live editing, the agent edit log with Undo, tokens and theme v2, the canvas board itself (`components/docs/editor/canvas/`), Recall, practice notes and the coach.

## 2. Decision: rebuild the doc editor on BlockNote

**BlockNote** (blocknotejs.org) is an open-source Notion-style block editor on ProseMirror and TipTap 3, the same engine we already run. Checked on 2026-11-14 from the published packages (v0.57.0, released 2026-10-30):

| Need | BlockNote |
|---|---|
| Block tree, ids, nesting with Tab | core model (`blockGroup > blockContainer`) |
| Handle, drag with drop line, slash menu, formatting bar | built in, each replaceable with our own component |
| Side-by-side columns: drop on an edge, resize | `@blocknote/xl-multi-column` |
| Tables, toggles, toggle headings, code with highlighting, images, files, comments | built in |
| Custom blocks in React (canvas, Mermaid, callout, anything later) | `createReactBlockSpec` |
| Live collaboration through our Hocuspocus | Yjs via y-prosemirror, as today |
| A block API for agents and AI | `insertBlocks`, `updateBlock`, `removeBlocks`, `replaceBlocks`, `nestBlock`, Markdown in and out |
| The same conversions on the server | `@blocknote/server-util` (`blocksToYXmlFragment`, `yDocToBlocks`, Markdown) |
| Our stack | React 18/19; depends on `@tiptap/*` ^3.31.3 (we pin 3.32.2, so one copy) |

**Licences.** Core, react, server-util and code-block are MPL-2.0 (fine for closed-source use). `xl-multi-column` and `xl-ai` are **GPL-3.0 or a paid commercial licence**. For Ramin's own use GPL costs nothing. If Recollect is ever served to other people, the columns package needs the commercial licence, or the frontend must be open-sourced, or columns must be rewritten on the MPL core. This plan uses `xl-multi-column` and does **not** use `xl-ai` (§5 builds AI on our own server path, which is licence-free and shared with agents).

**Why not the alternatives:**
- *Keep patching the current editor:* the list in §1 never ends, because the schema has no block tree.
- *Write our own block tree on TipTap:* that is rebuilding BlockNote, at months of work.
- *TipTap's Notion-like template:* paid, tied to their cloud, and has no columns.
- *Plate (Slate):* MIT with columns, but a different engine; the Yjs server stack, agent writes and canvas integration would all be rewritten.
- *BlockSuite (AFFiNE):* has a canvas natively, but web components and an unstable API; it replaces the whole stack.

**Candour on "exact replica".** No library gives a pixel-for-pixel Notion. BlockNote gives Notion's mechanics; §3 measures Notion and §6 holds us to that measurement. Out of scope: Notion databases, synced blocks, page-in-page.

## 3. Phase 0: measure Notion, and prove the stack (no product code)

**0a. Notion behaviour spec, by REA.** Output: `context/research/notion-editor-behaviour.md`. Use REA (memory `rea-reverse-engineering-tool`) on a real Notion page, plus screen captures.
- **Metrics:** handle position and size per block type, hover delay, drop-line colour, thickness and offsets, column gap, resize-grip width, indent per level, selection tint, menu sizes, every animation's duration and easing.
- **Behaviour checklist:** numbered items (target 60–80), each one sentence that a test can check. Cover: handle show/hide rules, drag (one block, several, into and out of toggles, lists and columns), the drop zones for making columns, column resize and removal, multi-block selection by dragging from the margin, Tab and Shift-Tab nesting, Enter and Backspace per block type, slash menu filtering and keys, turn-into, Markdown shortcuts, paste, undo grouping.
- Every item gets an id (`NB-01` …). The checklist is the acceptance test for §6.

**0b. Spike** in a throwaway route `/lab/editor` (deleted afterwards). Prove, in this order, and stop at the first failure:
1. BlockNote 0.57.0 renders in Next 16 / React 19 with one copy of `@tiptap/core` (check `npm ls @tiptap/core prosemirror-model`).
2. It syncs through our Hocuspocus in two tabs, on a **new** Y fragment named `blocks` (the old `default` fragment stays untouched for rollback).
3. `xl-multi-column`: drop on an edge makes columns, resize works, and dragging a list item to an edge produces a valid doc.
4. One custom React block (the canvas, reusing `CanvasBoard`) works, including its Y root maps.
5. `ServerBlockNoteEditor` with the **same schema including the custom block** converts blocks ⇄ Y fragment ⇄ Markdown in Node without a DOM. This is the main risk: custom blocks are defined with React on the client, and the server needs their schema without React. Find the supported way (a shared schema-only definition) before anything else is built on it.
6. Our own side menu, slash menu and formatting bar can replace BlockNote's defaults (`BlockNoteViewRaw` with controllers, or the shadcn kit), styled on `.rc` tokens to the 0a metrics without `!important` fights.

**Status 2026-11-15 morning: phases 0–3 done, phase 4 prepared (dry run on a database copy: 55/55 docs convert, nothing lost), the switch waits for Ramin. See "As built" at the end.** **Progress (2026-11-15): 0a done** (Ramin's Notion, one scratch page made and deleted; 26 `NB-` items and the metrics in [notion-editor-behaviour.md](../research/notion-editor-behaviour.md)). **0b: step 5 passes at the library level (isolated, outside the app); steps 1, 2, 4, 6 remain; step 3 dropped (no columns, no GPL). Needs Yjs ≥ 13.6.33 and one Tiptap copy. See [blocknote-spike.md](../research/blocknote-spike.md).** Write the result to `context/research/blocknote-spike.md`: what passed, what needed a workaround, bundle-size change. **If 2, 3 or 5 fails, stop and report to Ramin; do not improvise a different stack.**

## 4. Target architecture

```
Browser                                Server
───────                                ──────
BlockNote editor (schema registry)     ServerBlockNoteEditor (same schema)
  ├ built-in blocks                      ├ DocOps: read · insert · update · move · delete
  ├ custom blocks (one folder each)      ├ Markdown dialect ⇄ blocks
  └ our side menu / slash / toolbar      └ validation at every boundary
        │ Yjs (fragment "blocks" + canvas root maps)   │
        └──────────── Hocuspocus ───────────────────────┘
                           ▲
        MCP tools ─────────┤  one path: every write is one Yjs
        In-app AI ─────────┘  transaction, logged, undoable
```

**4.1 Block registry (this is the customisability).** One folder per custom block, `recollect/lib/blocks/<name>/`, holding:
- `spec.ts`: type name, props and content model, with no React. The server imports this file too.
- `View.tsx`: the React view.
- `menu.ts`: its slash-menu entry and turn-into rules.
- `markdown.ts`: how it prints to and parses from the Markdown dialect.

A block exists everywhere (editor, server, agents, AI) once its folder is registered in `lib/blocks/index.ts`. Adding a block later is adding a folder. First custom blocks: `callout`, `mermaid`, `canvas` (port the existing board unchanged), `embed`.

**4.2 Integrity rules (they end the corruption class of bug).**
- Client code changes doc structure **only** through BlockNote's API. No hand-built ProseMirror nodes or transactions on structure.
- The server validates and normalises every incoming block against the schema and answers 400 with the reason.
- Hocuspocus validates before storing; an invalid doc is logged and not written over the last good state.
- Tests assert `doc.check()` after every step.

**4.3 Server DocOps** (`backend/src/services/docs/ops/`). One module that every writer uses:
- `outline(docId)`: block ids, types and first words (cheap for agents).
- `read(docId, { format: 'markdown' | 'blocks', from?, to? })`.
- `insert(docId, blocks | markdown, { after | before | under: blockId } | 'end')`.
- `update(docId, blockId, patch)`, `move(docId, ids, target)`, `remove(docId, ids)`.
- `replaceSection(docId, heading, …)`: kept for convenience.

Each call is one Yjs transaction through the existing `liveDoc.ts`, recorded in `AgentEdit` with the existing selective Undo.

**4.4 Markdown dialect v2: lossless for every block.** Agents write prose most naturally in Markdown, so the dialect must carry everything:
- GitHub Markdown, with real tables (BlockNote has them).
- Callouts `> [!TIP]`, toggles `<details>`, ` ```mermaid ` and ` ```canvas ` fences (as today).
- **Columns:** a directive block, so an agent can lay out side by side:
  ```
  :::columns
  :::column
  Left text
  :::
  :::column
  ```mermaid
  flowchart LR; A --> B
  ```
  :::
  :::
  ```
- A round-trip test per block type: blocks → Markdown → blocks must be equal.

## 5. Agents and the app's own AI: one set of tools

- **MCP v2:** keep `create_doc`, `append_to_doc`, `read_doc`, `add_canvas`; add `get_outline`, `insert_blocks`, `update_block`, `move_blocks`, `delete_blocks`. Tool descriptions teach the dialect, with one worked example of a good learning note that uses columns, a diagram and toggles.
- **In-app AI ("Ask AI" in the slash menu and on a selection):** the backend runs Claude Opus 5.5 with the **same DocOps as tools** and the doc's outline as context. Design reference: Ramin's ERP pipeline and what to take from it (`context/research/erp-ai-pipeline.md`: curated surfaces with house definitions, numbers computed by code, a second opinion only where a wrong answer costs). Its edits stream into the open doc as live agent edits, labelled and undoable, exactly like MCP writes. One code path means the app's AI can use every block an agent can, and every new block is available to both on the day it is registered.
- Load the `claude-api` skill before writing this. The spend cap and usage log already exist (`services/claude/`).
- `xl-ai` (inline accept/reject suggestions) is a later option, with its licence, not part of this plan.

## 6. Build phases (after Phase 0 passes and Ramin says go)

| # | Phase | Contents | Done when |
|---|---|---|---|
| 1 | **Editor core** behind `?editor=v2` | Registry, BlockNote on fragment `blocks`, our side menu, slash menu and toolbar on `.rc` tokens to the 0a metrics, key map, image upload through `uploadToCloud` | Every `NB-` item for built-in blocks passes |
| 2 | **Custom blocks** | callout, mermaid, canvas (ported), embed, columns | Their `NB-` items pass; canvas keeps full screen, live sync and undo |
| 3 | **Server** | Shared specs, `server-util` conversions, DocOps, dialect v2, validation, agent API v2, MCP v2; Recall, practice note and coach read through DocOps | Backend tests green; round-trip test per block; an agent writes a note with columns, a diagram and a canvas live into an open doc |
| 4 | **Migration and switch** | Converter from the old fragment to blocks (old JSON mapped directly, not through Markdown); dry run on a DB copy; convert; `/docs/[id]` uses v2 | Every doc opens equal to its old self; the old fragment is still in each Y.Doc |
| 5 | **In-app AI** | "Ask AI" on DocOps tools | AI drafts a section and restructures blocks live; Undo takes it back |
| 6 | **Cleanup** (only after Ramin signs off on 4) | Delete `BlockHandle`, `BlockDrop`, `RowHit`, `BlockKeys`, `Columns`, the old schema and server mirror, and unused TipTap packages | typecheck, lint and tests green |

Phases 1 and 3 can overlap: 3 is backend work for one worker agent (max 2 at once, no helpers), while the supervisor builds 1 and 2 himself.

## 7. Test method: the bar for "done"

- **Like a person.** The mouse glides in steps, drags are slow, keys have pauses (memory `test-ui-like-a-person`). Jump-to-target checks do not count.
- **In the repo, not the scratchpad.** Port the QA scripts to Playwright tests under `recollect/tests/editor/`, one test per `NB-` item, named by id, run with one command.
- **Fuzz for corruption.** 500 random actions (drag anything onto anything, indent, split, paste, delete, undo) with `doc.check()` after each; zero failures and zero console errors.
- **Matrix.** Light and dark; 1366, 1536 and 1920; two tabs live; an agent writing while Ramin types.
- **Side by side with Notion.** For the ten most-used interactions, record ours and Notion's and compare timing and positions against the 0a metrics.
- Report honestly: list every `NB-` item that fails or was not tested. Never say "done" over a failing item.

## 8. Risks

| Risk | Handling |
|---|---|
| Custom block schema on the server without React | Spike item 5; a hard stop if unsolved |
| BlockNote is pre-1.0 and its API moves | Pin 0.57.0 exactly; upgrade only on purpose, with the test suite |
| GPL on columns if Recollect becomes a product | Ramin's call in §9; the registry keeps columns swappable |
| Converting existing docs | Old fragment kept in every Y.Doc; DB dump before converting; only about 20 dev docs exist today, so now is the cheapest time |
| The Revise import (later) | It will write through DocOps, so it lands in the new model directly |
| Theme fights with a UI kit | Spike item 6 decides between the raw view with our own components and the shadcn kit |

## 9. Ramin decides before Phase 1

1. **Go with the BlockNote rebuild?** (Recommended. The alternative is more patches on the current editor.)
2. **Columns licence:** use the GPL package now for your own use, and buy BlockNote's commercial licence only if Recollect is opened to others? (Recommended.)
3. **Installing packages:** OK to add `@blocknote/core`, `react`, `server-util`, `code-block` and `xl-multi-column`, all at 0.57.0?
4. **REA on Notion:** capturing editing behaviour needs a logged-in Notion page. May the builder use your Notion login in the REA browser, on a scratch page it creates and deletes?

## 10. Notes for the builder

- BlockNote 0.57.0 sources are unpacked for reference in `scratchpad/dl-blocknote/` (types under `*/package/types/src`).
- The session's standing rules still apply: local files only, no commits unless asked, Revise is read-only, never touch `recollect/components/todo/task_Input/utils.tsx`, at most 2 workers and no helpers, run vitest from PowerShell.
- Keep `STATE.md` current at every phase boundary, and record deviations from this plan in an "As built" section at the end of this file.

## 11. Block audit: every block and option the doc has today (Ramin, 2026-11-14)

**Ramin's ask:** "rework each existing node or option this doc already had, which may or may not need fixing, and make sure it is compatible with MCP and our home AI; the whole doc and all its features designed or redesigned and well thought out for our architecture. The old 'Ask AI to write' node is not needed and very outdated; we will later add support for our new home Ask AI."

**When:** decide in Phase 0 (a step **0c** after the spike, written into the registry list of §4.1); build in Phases 1–3; nothing in the old editor is patched for it (the step 0 rule).

**The bar every block and option must pass** (one line each in the registry, checked by tests):
1. Markdown print and parse round-trip without loss (MCP `read_doc` and every write).
2. DocOps can insert, update, move and delete it by block id (agents and the home AI use the same tools).
3. The home AI can make it: its tool description says when to use it.
4. It shows right in the read-only viewer and the public `/doc/[slug]` page.
5. Its words reach search, snippets and Recall material.
6. Copy, paste and Duplicate keep it whole (a canvas keeps its board).
7. Live in two tabs, Undo groups it sensibly, and an agent edit to it can be undone.
8. Light and dark, the keyboard, and its own like-a-person `NB-` tests.

**Inventory and the starting recommendation** (Opus re-checks each one in 0c):

| What the doc has today | Recommendation |
|---|---|
| Paragraph, headings 1–3, bullet / numbered / to-do lists (nested), quote, divider, hard break | Keep: BlockNote built-ins, nesting with Tab |
| Bold, italic, underline, strike, inline code, link, highlight (tints) | Keep |
| Text colour (TextStyle + Color) | Keep in the editor; decide whether Markdown carries it (today it is dropped, so agents can't see or keep it) |
| Callout (5 kinds, `> [!TIP]`) | Redesign as a custom block; same Markdown |
| Toggle (details) | BlockNote toggle, plus toggle headings; same `<details>` Markdown |
| Code block (language picker, Copy, highlighting) | Keep (`@blocknote/code-block`) |
| Mermaid (a code block with `mermaid`: preview/edit, full screen, save) | Its own "Diagram" block: source and drawing, full screen, checked on write (AGENT_DIAGRAMS step 4) |
| Canvas (boards in Yjs root maps) | Port unchanged (spike item 4) |
| Image (resizable, Cloudinary) | Keep: BlockNote image with our upload |
| Plain `image` (old server content) | Convert to the new image block in the migration |
| Embed (YouTube and links, `[Embed: kind](url)`) | Decide: a proper paste-a-link-to-embed block, or drop it |
| Media row / media item (old gallery) | Remove: convert stored ones to plain images |
| **Old "Ask AI to write"** (`inlineAi` node, `AINodeView`, slash item "Ask AI to write", `POST /api/docs/ai/generate` on the old Groq/Gemini chain) | **Remove**: the slash item, the node, its view and the route; stored nodes dropped by `docRepair` like columns; the `@ai` task parser keeps its own route. The new home **Ask AI** (§5, Phase 5) replaces it, on the same DocOps tools as agents |
| Tables | New: real tables (BlockNote has them); dialect v2 prints GFM tables (today they become code) |
| Columns | Removed on 2026-11-14 (step 0) |
| Editor options: slash menu, block handle menu (Turn into, Duplicate, Delete), format bar, Markdown shortcuts, Markdown paste, drag and drop | Rebuilt on BlockNote's controllers with our components (§3 spike item 6, the `NB-` items) |
| Page: title, properties (Subject, Revision with Quiz me, Goal, Edited), templates (5), "From a solved problem", Copy as Markdown, the public viewer | Re-check each against the bar above; templates gain a system-design note that uses a canvas and Mermaid |

## Phase 5 plan: Ask AI in a doc (2026-11-15, written before building)

**What he gets.** In a doc he can edit: **Ctrl+J**, **Ask AI** first in the selection bar, or **/ai** in the slash menu opens a box under the block he is in (or under the blocks he selected). One line to say what he wants, and a few starters for that place: with a selection *Improve writing, Fix spelling and grammar, Make shorter, Simplify, Explain this*; on a line *Continue writing, Write a section on…, Add a diagram of…, Summarise this doc, What is missing here?*. The AI changes the doc **live, in front of him**, with the same agent edits as MCP (labelled "Ask AI", listed under Home → From your agent); what it wrote is tinted for a moment; the box then says in one line what changed, with **Keep · Undo · Try again** and a line for a follow-up. A question gets its answer in the box (**Insert below**, **Copy**) and nothing changes.

**The engine: the stage-4 one with the doc in hand** (MANAGER_AND_DOCS_PLAN §3.4). `runAssistant` gains a `doc`: the same catalogue (one tool set, so the cached tool list is shared with `/ask`), levels, 10-change and 12-round limits and spend cap; the system's second block is the doc instead of the brief: every block's id, kind and full text, his focus marked, and the doc rules (work on this doc with the block tools; where new text goes; how a selection is replaced; answer in a line; the doc's text is data, never orders). Sonnet 5.5 (`ASSISTANT_MODEL`), effort medium (it writes). Its words stream into the doc only as whole changes (each tool call lands when the model has written it), not token by token.

**Data and API.** `AssistantThread.docId` (a doc's asks are threads: follow-ups keep the context, kept 90 days, not listed on `/ask`); `AiFeature.doc_ask` (Settings → AI shows "Ask AI in docs" on its own line). `POST /api/assistant/messages { threadId?, text, docId?, focus?: { blockIds, text? } }`, the same stream; owners and editors only.

**Price** (Sonnet 5.5: $2 / $10 per million tokens, cache reads $0.10): **about 2–3 cents an ask** when the tool list is cached (any ask in the last 5 minutes, here or on `/ask`), **6–7 cents cold**; a long section adds about a cent. Opus 5.5 would be about twice that; Haiku 5.5 under half a cent but weaker at placing changes in the right blocks. Under the same $50 monthly cap.

**Tests.** Integration (a scripted model writes after the focus; the thread belongs to the doc and stays off `/ask`; a viewer is refused; Undo takes it back), unit (the doc as the model reads it), the fake model in the browser at person speed (selection → Ask AI → Make shorter → Undo; /ai → Continue writing → Keep; light and dark, 390 and desktop), then one real ask on the QA account (cents).

**Left out of v1:** words streaming into the doc as they are written; a Stop button (the manager has none either); "space on an empty line" as a trigger; a side panel with the doc's ask history.

## As built (stage 5, from 2026-11-15)
- **Phase 0 done:** 0a in [notion-editor-behaviour.md](../research/notion-editor-behaviour.md) (26 `NB-` items); 0b steps 1, 2, 4, 5, 6 pass ([blocknote-spike.md](../research/blocknote-spike.md)).
- **Phase 1 started behind a switch:** `/docs/<id>?editor=v2` renders `components/docs/v2/LabEditor.tsx` (BlockNote 0.57 with `withCollaboration`, fragment `blocks`, our side menu / slash menu / format bar on Notion's numbers, drop line 4 px at 43 %, `>` + space makes a toggle like Notion). The registry started in `lib/blocks/` (`schema.ts`, `canvas/spec.ts` + `View.tsx`). Old docs open empty under v2 until phase 4 migrates them.
- **Phase 1 so far (checked like a person, scripts `scratchpad/scripts/v2-*.js`):** block sizes to Notion's numbers (paragraph 40 px, H1/H2/H3 79/67/58, list rows 30, children +32 px); the grip's two-line tooltip after 250 ms (NB-05); the block menu with a focused "Search actions…" field, arrows, Enter, Esc, the block tinted while it is open (NB-07; it opens under the grip, since to its left the app's scrolling area would cut it); **block selection** (NB-12 to NB-15: Esc, ↑/↓, Shift+↑/↓, Ctrl+D, Backspace/Delete, Enter back to text, the margin marquee) in `components/docs/v2/useBlockSelection.ts`; `>` + space makes a toggle (NB-16); Ctrl+Shift+↑/↓ moves a block (NB-23). Pasted or dropped images upload through `uploadToCloud` (wired, **not tested**). **Phase 2 started:** the callout block (`lib/blocks/callout/`: 5 kinds, the icon's menu changes the kind, the old look; `/callout`; kept after reload; screen 52). **Left in phase 1:** nesting by the drag's horizontal offset with the parent tint and an indented drop line (NB-10), testing image upload through `uploadToCloud`, one React warning seen only with two tabs on `/lab/editor`, then the full `NB-` run as Playwright tests in `recollect/tests/editor/`.
- **Phase 1 done (2026-11-15 morning): all 26 `NB-` items pass as Playwright tests** in `recollect/tests/editor/` (`handle`, `drag`, `selection`, `typing`, `slash` specs; one test per id, person-speed, QA account, a fresh doc per test, any page error fails it). Run: `npm run test:editor` in `recollect/` with the app running (3.3 min; `@playwright/test` 1.64.1 pinned, using the Chromium already on the machine). What it took beyond BlockNote's defaults:
  - **Our drop model** (`components/docs/v2/blockDrop.ts`): the row under the pointer picks the block; upper half above, lower half below; over a list item or toggle, right of its text start, the block nests (our 4 px line starts where the child will sit, the future parent tinted at 7 %); a parent whose children show takes it as its **first** child (the line sits right under the parent's row, so that is where it lands; NB-10 said "last child", measured on a parent with no children); at the end of a nested list, left of the block's edge, it drops after the parent; a paragraph never takes children by the drag. BlockNote draws the sibling line through its `computeDropPosition` hook; the move is one `editor.transact` (one Undo).
  - Notion's horizontal numbers: block boxes start 8 px left of a paragraph's text and list text sits at +32 (children start under it; the editor moves 6 px left so text still lines up with the title); the grip is 18 px from the text (Notion 18).
  - The grip sits on the first line of every block (a floating-ui middleware replacing BlockNote's heading offsets); the ghost keeps the grab offset (`setDragImage`; its opacity is the browser's, not Notion's 40 %).
  - Keys: Backspace at the start of a heading merges into the block above (BlockNote first turned it into text); Ctrl+Enter ticks a to-do (text 50 % ink, line 35 %).
  - Pasted images upload through `uploadToCloud` and **survive the live server's orphan cleanup** (the new image blocks carry no `imageId`, so the cleanup now also keeps images whose URL is in the `blocks` fragment; before this fix it would have deleted them from Cloudinary on the next disconnect). Delete for good removes them.
  - The React warning with two tabs came from `useCollaboration` setting DocPage state while BlockNote set its awareness during render; the update is now deferred a microtask.
- **Phase 2 done (2026-11-15 morning; `tests/editor/blocks.spec.ts`, 5 tests):** callout; **Diagram** (`lib/blocks/diagram/`: Mermaid source as the block's plain content, the drawing under it, Hide/Edit source, a double-click on the drawing edits, a broken source keeps the last drawing and says why, Full screen, Copy; `/diagram` and ` ```mermaid ` + space make one; Enter is a new line, Shift+Enter leaves it; the block is registered first so its input rule beats the code block's); the **canvas** block's height grip (8 px steps) and full screen; **our file panel** for an empty image (Upload through `uploadToCloud`, or Link; a broken image file answers 400 with what to do). The slash menu now has Notion's words and Markdown hints (Text, Heading 1–3, Bulleted, Numbered, To-do, Toggle, Quote, Divider, Callout · Image · Code, Diagram, Canvas); left out until they have their UI: video, audio, file, emoji, H4–H6, toggle headings, **tables** (no handles to add rows yet). **Embed: dropped** (no stored doc has one; an old one becomes a paragraph with its link). Screens 53–54.
- **Phase 3 done (server):** `backend/src/services/docs/blocks/`: `specs.ts` (schema-only callout, diagram, canvas; `tests/unit/docs/blockSpecs.test.ts` keeps them equal to the browser's), `serverEditor.ts` (`@blocknote/server-util` 0.57.0; Yjs crosses between BlockNote's ESM copy and the server's CJS copy only as bytes, never objects), `fromOldJson.ts` (old TipTap JSON → blocks, node by node), `markdown.ts` (**dialect v2**: print blocks → Markdown here; parse = the old dialect's validated parse → blocks, so agents write what they write today, plus GFM tables; a round trip per block type in `blocksMarkdown.test.ts`), `docOps.ts` (**DocOps**: outline, insert after/before/under/at, update in place (props alone keep concurrent typing), move with children, remove; `docOps.test.ts`). The agent API (`/api/agent/docs/:id/outline`, `/blocks`, `PATCH /blocks/:blockId`, `/blocks/move`, `/blocks/delete`; scopes read / docs:write) runs each change as one live transaction with a snapshot and an `AgentEdit` of the new kind **`doc_blocks`** (migration `20261115090000_doc_blocks_edit`); Undo now covers the `blocks` fragment. MCP: `get_outline`, `insert_blocks`, `update_block`, `move_blocks`, `delete_blocks` (64 tools; in the manage group until the switch; a doc on the old editor answers 409 pointing to append/replace). **Checked live:** an agent wrote a callout, a Mermaid diagram and a canvas into an open v2 doc while the person typed; the typing stayed and Undo took exactly the agent's part back (screen 55). A board inserted live used to fit at the smallest zoom: the canvas now refits when it gets its size or first boxes (until the person pans).
- **Phase 4 prepared, not switched (needs Ramin's sign-off):** `scripts/migrate-blocks.ts` (dry run by default; `--database`, `--write`, `--doc`; counts only, never text) writes each doc's blocks into the same Y.Doc from its old content, which stays for going back; a doc that has blocks is never touched; `updatedAt` kept. **Dry run on a copy of the database** (`recollect_migration_dry`, restored from this morning's dump; dropped after the run): **55 of 55 docs convert, no word missing anywhere** (a word-for-word check per doc), idempotent (a second run: 55 already on blocks); dropped only the one old "Ask AI to write" node; one callout's two paragraphs joined by a line break. QA docs as migrated open in the new editor with no errors (boards and Mermaid drawn; screen 56). **Readers and writers made ready (a doc with blocks uses them; every other doc is unchanged):** the stored and live readers (`yjsStateToDocJson`, `currentContent`, the preview) read the blocks through `blocks/toOldJson.ts` (blocks → old JSON, round-trip tested per block type), so read_doc, search text, previews, Recall material, practice note and coach read a doc with blocks unchanged; `append_to_doc` and `replace_section` write blocks on such a doc (`agentBlocks.service.ts`: one change, Undo; a rename by a same-level heading; 404 listing the headings); the image cleanup keeps images by URL. **Still to do at the switch (Ramin's sign-off):** run `migrate-blocks.ts --write` on the real database (after a dump); `/docs/[id]` on the new editor by default (the old one behind `?editor=v1` for a while); new docs and templates created as blocks; the public viewer and "Copy as Markdown" on blocks; `update_canvas` checked on a doc with blocks; the block tools into the default "docs" group (and the skill's text); the `?editor=` switch and `/lab/editor` removed with phase 6.
- **The switch, done (2026-11-15 ~11:00, Ramin's go: "I give my go for the new editor switch").** With the backend stopped (no doc open in memory), a dump (`recollect_dev-2026-11-15-1101.dump`), then `migrate-blocks.ts --write` on the real database: **57 docs, 56 converted, 1 already on blocks, 0 missing words** (dropped: one old "Ask AI to write" node; one callout's two paragraphs joined); a second dry run: 57 already on blocks. What changed with it:
  - **`/docs/[id]` draws the new editor by default.** `?editor=v1` shows the old editor's frozen copy, **read-only**, with one quiet line saying so and a link back (an edit there would never reach the new editor: a silent split, so it is not offered). `?editor=v2` still works (the tests use it). The page drives the body through a small `BodyApi` (`enterFromTitle`, `focusStart`, `isEmpty`): Enter in the title starts the body's first line with the text after the caret, ↓ goes into the body; `LabEditor` hands its editor over with `onEditor`. The old body (TipTap) is only made under `?editor=v1`.
  - **New docs are made on the new editor** (`blocks/newDocState.ts`): agents and practice notes (`createDocFromMarkdown`: blocks, their boards, the title in the metadata map, no old fragment), templates (`POST /api/docs { title, content }` converts the template's JSON to blocks; "New doc" no longer opens with `?template=`), the QA seed. **One rule for which editor a doc is on** (`onNewEditor`): the new one unless it holds old content and no blocks; an empty doc takes blocks on its first write (append, insert_blocks: no 409).
  - **update_canvas on blocks:** the canvas block is found in the `blocks` fragment (its height is a block prop). **replace_section on blocks keeps an edited fence's board in place** (same id, his arrangement kept, a diff; any other canvas a fresh id), as on the old editor; it used to give the fence a new id on blocks.
  - **Code blocks** get the old editor's look (surface 2, ink, mono 13.5/1.6, radius 8); BlockNote's own black box with white text showed as a frame around the app's tint (seen on the public page).
  - **MCP:** `get_outline`, `insert_blocks`, `update_block`, `delete_blocks` are in the default "docs" group (`move_blocks` stays on `more_tools`); to keep the default set under 40,000 characters, `add_milestone`, `complete_milestone`, `update_milestone`, `remove_milestone`, `update_focus`, `remove_focus` moved to manage (no skill uses them; the in-app manager has every tool). The `recollect-notes` skill says when to use the block tools. **D8 done:** `Doc.docType` and its enum dropped (migration `20261115110000_drop_doc_type`, after a dump); the API ignores a `docType` it is sent.
  - **Checked:** `npm run test:editor` 31/31 after the switch; `editor-switch.test.ts` (4: template → blocks, an empty doc's first write, which editor, update_canvas on a block + Undo); `scratchpad/scripts/switch-qa.js` 7/7 (New doc with a template, title Enter, Copy as Markdown, a migrated QA doc, `?editor=v1`; screens 89-91).
  - **Not done:** D3 (the state as bytes); the `?editor=` switch and `/lab/editor` go with phase 6.
  - **Markdown paste (after the switch):** plain-text Markdown pasted into the new editor (a note copied from a chat) goes through the server's dialect (`POST /api/agent/markdown { as: "blocks" }` → blocks + boards): callouts, toggles, ```mermaid → Diagram, ```canvas → a board (written into the doc's maps first); it lands after the caret's block (or replaces an empty one) and Ctrl+Z takes it back. Inside code or a diagram, or with HTML on the clipboard, BlockNote pastes as it does. Tests: `blocks.spec.ts` "Paste", `markdown-paste.test.ts` (+1).
- **Table handles (2026-11-15, after the switch):** `components/docs/v2/RcTableHandles.tsx` gives BlockNote's `TableHandlesController` our parts (its own need a component library we don't load): a grip on the hovered row (left) and column (top) that drags it or opens a menu (Insert above/below or left/right, Header row/column on the first one, Delete), and a "+" strip under and beside the table that adds a row or a column with one click (no drag-to-extend; no per-cell menu: merging and cell colours are left out). Tables on our tokens (hairline cells, a surface-2 header). **"Table" is back in the slash menu.** Test: `blocks.spec.ts` "Table" (person-speed: /table, insert below, header row, delete column, the "+" strip); screens 93-94.
- **Colour in the format bar (2026-11-15, after the switch):** a Color menu (text colour and background, Notion's families in light and dark, no purple) in `LabEditor.tsx` (`ColorButton`) with the tokens in `lab-editor.css`; BlockNote marks inline colours as `[data-style-type][data-value]`, block props as `[data-text-color]`: both are styled. Checked: `scratchpad/scripts/colors-qa.js` 8/8 at person speed (red text, a yellow background, its `==…==` for agents, the dark tint, Default takes it off); screens 123-125. **"Turn into" in the bar** followed the same day (`TurnIntoButton`: the selected blocks' kind, the grip menu's list; `scratchpad/scripts/turninto-qa.js` 8/8 light and dark; screens 126-127).
- **Code block colours (2026-11-15 ~14:50, after the switch):** `lib/blocks/code/` replaces only the code block's **view**: the config stays BlockNote's own (`codeBlock`, `language` default "text", plain content), so the server keeps the built-in (`blockSpecs.test.ts` checks the two agree), and BlockNote's HTML paste, keys (Tab, Enter, Enter twice at the end or Shift+Enter to leave, Delete on an empty one) and "```ts " rule are reused from `createCodeBlockSpec`. The view is the old editor's: a quiet bar with a searchable language picker (`RcPicker`; options now carry keywords, so "ts" finds TypeScript, and the search ranks exact and starting matches first) and Copy; BlockNote's native `<select>` (which also threw on a language it didn't list) is gone. Colours: BlockNote's `SyntaxHighlightingExtension` with our own Shiki bundle (`highlighter.ts`: `@shikijs/core`, `engine-javascript`, `langs-precompiled`, `themes` **4.5.0, pinned with overrides**: 4.6.0 is under two weeks old; `@blocknote/code-block` not used, its list lacks Go), 47 languages each loaded on first use (the block's `highlight` meta maps an alias to our id, so Shiki only ever loads a name it has), GitHub's light and dark default palettes (the old editor's colours; the light comment grey #6e7781 → #59636e for 5.5:1 on the code surface), chosen by the theme in CSS. Checked: `scratchpad/scripts/code-qa.js` 31/31 (a stored TypeScript block coloured in both themes, "```py " + typing, picker search + Enter, Copy, Enter twice leaves, the public page read-only, 390 px), `blocks.spec.ts` "Code"; screens 128-130.
- **Scope after Ramin's verdict (2026-11-15 ~15:00): "it's good"; docs are complete after four items:** finish headings (the slash menu: Heading 1–4 and Toggle heading 1–3, the builder's call; H5–H6 in Markdown still show and round-trip), a block handle you can **tap** on phones, and Ask AI in a doc with **Stop** and **word-by-word streaming**. Later: **embeds** (YouTube and other links; parked by Ramin the same day, "not needed for now"), audio, video, file blocks (uploads to his Cloudinary are fine then). Not planned: table drag-to-extend, merging and cell colours, emoji. **Phase 6 (the old editor goes) in about a week (~11-22).**
- **H4–H6 and toggle headings (started 2026-11-15, server side):** the dialect prints headings up to `######` and a toggle heading as `<details>\n<summary>## Title</summary>\n\n…</details>`; the parse for blocks keeps levels to 6 (`markdownToDocJson(md, { maxHeading: 6 })`; the old editor's callers keep 3) and turns a summary "## Title" or "<h2>Title</h2>" into a toggle heading (`fromOldJson`); `toOldJson` (read_doc, search, previews) keeps the level and prints a toggle heading the same way. **The editor side (done the same afternoon):** the slash menu and Turn into offer Heading 4 and Toggle heading 1–3 (Notion's slash menu has Heading 1–4, measured in 0a); H4 18/600, H5 16/600, H6 15/600 in ink 2, with smaller space above; **a toggle he makes starts open, as in Notion** (BlockNote keeps each toggle's state in localStorage by block id and starts new ones closed, so the slash items, `> ` and Turn into mark the new toggle open first; then Enter after its title goes inside, BlockNote's own open-toggle rule); a toggle heading's space above moves onto its frame so the triangle sits on the heading's line. The MCP guide and skill no longer say "headings up to ###" or "no tables". Checked: `scratchpad/scripts/headings-qa.js` 19/19 (light, dark), `blocks.spec.ts` "Headings", `blocksMarkdown.test.ts` 23/23 (H1–H6, toggle headings, GitHub's `<h3>` summary, read_doc's printing); screen 131.
- **Ask AI's words stream in, and Stop (2026-11-15 ~18:00): the last doc item; docs are now complete (Ramin's scope).** The engine calls Claude through a streamed call (`AiClient.streamMessage`: the SDK's `beta.messages.stream()` with `on('text')` and `finalMessage()`, from the claude-api skill; tool inputs are not streamed eagerly, since nothing shows a tool's input before it runs, so the API keeps checking them; a client without it is called as before, so test fakes are unchanged). The stream carries `delta { text, round }` events between the tools, in order. **Stop:** `POST /api/assistant/threads/:id/stop` aborts the running turn (an AbortController per user and thread, held in the one backend process): the model call in flight ends (the SDK's signal), no further tool runs, what was done stays with its Undo, and the turn still answers `done` with `stopped: "stopped"`, the words so far plus "Stopped. What was done before you stopped stays, and each change can be undone."; a stopped call is metered from what had arrived. Leaving the page still lets a turn finish (only Stop stops it). **In the box:** the words appear under a "Writing… · Stop" line that stays put (a Stop under the growing words was a moving target: the first QA run's click missed it); Esc while it writes stops it (heard on the whole page, since the line is gone while it works); a stopped answer with no change offers Close and Try again, never "Insert below" for half an answer. **On /ask** the same: words as they come, "Working… · Stop". The fake model streams its words too (45 ms each), so all this is checked for free. Checked: integration `assistant-stream.test.ts` (2), `scratchpad/scripts/ask-stream-qa.js` 14/14 (doc light + dark, /ask), `ask.spec.ts` on the fake, and the real model (`stream-real.js`, QA account: an explain streamed 19 pieces, first words at 2.9 s, done at 4.0 s, 4.8¢ cold; a long answer stopped after its first words: "stopped", 0.2¢); screens 137-139.
- **The block handle on a phone (2026-11-15 ~17:30):** on a touch screen BlockNote's grip appears at x = −42 (off the screen; there's no gutter at 390 px) and hides at the first key, so a phone had no handle. `components/docs/v2/PhoneBlockBar.tsx`: while the editor holds the focus on a coarse pointer, a bar sits on the keyboard (placed from the visual viewport, so it rides on top of Chrome's keyboard) and acts on the caret's block: its kind ("Text ▾": the Turn into list as a sheet), Move up and Move down (a phone can't drag), Indent and Outdent (enabled only when they can), and "⋯" (Duplicate, Ask AI, Delete). Buttons are 44 px and never take the focus, so the keyboard stays; the bottom tab bar steps aside while it shows; a caret that would sit behind the bar is scrolled above it. Checked: `scratchpad/scripts/phone-bar-qa.js` 35/35 (emulated Android, 390 light and 360 dark, and no bar on a desktop), `tests/editor/phone.spec.ts`, and **on his real phone** (`phone-bar-real.js` 7/7: the keyboard comes up on a real tap, the bar sits exactly on it, Move up keeps the keyboard, the sheet turns the block; `phone-bar-caret.js` 4/4: a caret moved behind the bar comes back above it, a wrapping line too); screens 132-136.
- **Phase 5, Ask AI in a doc (2026-11-15, after the switch): built as the plan above.**
  - **Backend:** `services/assistant/docContext.ts`: the doc as the model reads it (`[id] Markdown` per block in the dialect, children indented, `»` on his focus, his focus said in words: the blocks he selected, the words he selected, or the line his cursor is on, empty or not); a doc over 60 000 characters keeps whole only the blocks within 8 of his focus (the rest: first words, and read_doc has it all); the doc rules. `runAssistant({ doc })`: the doc replaces the brief in the system's second block (cached for the message's later rounds), effort medium, metered `doc_ask`. `POST /api/assistant/messages { docId, focus }`: owners and editors (a viewer 403, a stranger 404), 409 for a doc in the trash; a doc's thread can't go on from `/ask` or the other way (400). `AssistantThread.docId` (cascade with the doc; not listed on `/ask`) and `AiFeature.doc_ask` (migration `20261115120000_doc_ask`, after a dump). The fake model (`ASSISTANT_FAKE`) picks real block tools inside a doc, so the box is checked for free.
  - **Frontend:** `components/docs/v2/DocAsk.tsx` + `doc-ask.css` (the box: starters by place, live changes, Keep · Undo · Try again, Copy · Insert below for an answer, follow-ups on the same thread pointing at what it wrote); `LabEditor` opens it on Ctrl+J, the selection bar's "Ask AI" and `/ai` (only where he can edit; never on the public page); `useBlockSelection` hands over its selection and ignores keys typed in the box. What the AI wrote is found by watching the doc while it runs: in this setup BlockNote marks those changes "local", not remote, so his own typing is told apart by focus (the box holds the keys). Settings → AI lists "Ask AI in docs". `cleanResult` no longer shows block ids on `/ask`.
  - **Tests:** unit `docContext.test.ts` (4), integration `assistant-doc.test.ts` (3: the doc and focus reach the model and the write lands after the focus as "Ask AI" with Undo; refusals before any stream; the thread goes with the doc), `tests/editor/ask.spec.ts` (person-speed; runs only with `ASK_AI_FAKE=1` against a backend started with the fake for the QA account), `scratchpad/scripts/docai-qa.js` 25/25 in light, dark and at 390 px (screens 103-117). A phone bug found by it and fixed: the starters scrolled under the bottom tab bar (scroll margins now keep the box and its menu clear of both bars). Full suites after it: backend 1006 unit + 511 integration, the editor 34/34 (with `ask.spec.ts`).
  - **One real run (Sonnet 5.5, QA account, `scratchpad/scripts/docai-real.js`; screens 118-119):** *Make shorter* on a 302-character paragraph: 6.0 s, **5.3¢** (cold: the tool list written to the cache), two clear sentences, nothing lost. */ai* "a short section comparing the token bucket with the leaky bucket, with a small mermaid diagram": 7.5 s, **1.3¢**: a heading, a paragraph, a Diagram that draws, four bullets and a callout, landed where the cursor was. *Explain this* on the heading: 3.9 s, **0.8¢**, a plain answer in the box, the doc unchanged. So about 1¢ an ask when warm and 5¢ cold, under the plan's estimate. (QA runs on the fake model also meter their made-up usage on the QA account, as the manager's fake does; no money is spent.)
- **The old editor's open issues, for the rebuild to get right (QA chunk 3, 2026-11-15; not patched in the old editor, by the step-0 rule):** Turn into → Toggle empties the title and nests oddly in lists and quotes; Turn into → Callout does nothing from a list; a new toggle from `/toggle` starts closed and Enter leaves it; `"` + space makes no quote; the slash filter closes on a space ("/heading 2"); the Turn into submenu can clip at the top of a short window; the canvas's selection bar can overlap its tool bar near the top, and a double-clicked box lands ~80 px from the click.
