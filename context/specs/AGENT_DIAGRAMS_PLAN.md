# Agent-written notes with real diagrams: the plan

_2026-11-14, written by Fable for Opus (the builder). Ramin's ruling the same day: **drop side-by-side columns** ("I am over-optimising"), **never depend on anything that could need payment or block us later**, and put the focus here: "my AI agent should freely write the doc while also building complex diagrams, good quality, flexible, efficient and fast. The AI should not have to work hard to build it." His use case is system-design notes, where the diagram matters as much as the text._

**Status: steps 0–5 BUILT and measured on 2026-11-14 (see "As built" at the end); step 6 (the editor rebuild) BUILT and switched on 2026-11-15 ([DOCS_EDITOR_V2_PLAN](DOCS_EDITOR_V2_PLAN.md) "As built": canvases and Mermaid diagrams are blocks of the new editor; agents' boards update in place on it).**

---

## 1. The idea in one line

**The agent says what is in the diagram; Recollect decides where everything goes.** Language models are good at naming parts and their connections and bad at coordinates. So the agent never writes a position: it writes a few lines of text, a real layout engine places and routes everything, and the agent can ask for a picture of the result to check its own work.

## 2. What is weak today

- `add_canvas` takes verbose JSON: about five times the tokens of the same diagram as text, so it is slow and costs more.
- The layout is a small home-made one: no groups, straight arrows only, and wide boards shrink to unreadable in a doc.
- There are 7 plain shapes. A system-design sketch needs zones ("VPC", "API tier"), queues, caches, clients, and icons that say what a box is.
- The agent works blind. It cannot see what it drew, so it cannot fix overlap or clutter.
- Changing a board means rewriting the whole section, and that throws away any arranging Ramin did by hand.
- Mermaid blocks render only in the browser. A syntax error shows to Ramin, never to the agent that wrote it.

## 3. Two diagram blocks, one rule for agents

| Use | Block | Why |
|---|---|---|
| Architecture, request flows, data flows, concept maps: boxes and arrows Ramin may rearrange | **Canvas** (editable board) | Laid out by the engine, then his to move |
| Sequence, ER, state, class, timeline, mind map | **Mermaid** (drawn from text) | Mermaid already does these well, and every model knows its syntax |

The tool descriptions state this rule, so the agent never has to choose by trial.

## 4. The canvas for agents

**4.1 A text language the agent already knows.** A ` ```canvas ` fence accepts a subset of Mermaid's flowchart syntax (a fence that starts with `{` is still the JSON form). Models write this fluently, so there is nothing new to learn:

````
```canvas
flowchart
  user([User]) -->|HTTPS| cdn[CDN] --> lb[Load balancer]
  subgraph api [API tier]
    a1[API server 1]
    a2[API server 2]
  end
  lb --> a1 & a2
  a1 & a2 -->|read| cache[(Redis)]:::red
  a1 & a2 -->|write| db[(Postgres primary)]:::blue
  db -.->|CDC| q[[Outbox queue]]:::yellow
  note: Writes go to the primary; reads try the cache first.
```
````

- **Shapes:** `[box]`, `(rounded)`, `([pill])`, `[(database)]`, `((circle))`, `{decision}`, `[[queue]]`.
- **Arrows:** `-->`, `-.->` (dashed, for async), `<-->`, `---`, each with an optional `|label|`; `&` fans out.
- **Zones:** `subgraph name [Title] … end`, nestable.
- **Colour:** `:::blue|green|yellow|red|gray`.
- **Notes:** `note: text` (a sticky), or `note for id: text` (a sticky placed beside that box).
- **Kinds (optional):** `id@{ kind: cache }` for `client, service, database, cache, queue, storage, cdn, gateway, function, external`. A kind sets the shape and a lucide icon. No brand logos.
- **Our own parser** (a few hundred lines, in the backend, no DOM): every error names the line and what was expected, so the agent fixes it in one round. Unknown syntax is an error, never a silent drop.

**4.2 A real layout engine.** ELK (`elkjs`, EPL-2.0, free) on the server: layered layout, zones as nested groups, right-angle arrow routing with bend points, label placement. It replaces the home-made layout.
- Direction comes from the first line (`LR`, `TB`); without one, the engine tries both and keeps the one that reads bigger in a doc column (today's rule). _As built: this very example written with `flowchart LR` shows at 46 % in a doc and at 98 % without a direction, so examples and the skill leave the direction out._
- The block's height is fitted to the result (today's rule).
- A board has a "Tidy up" button that runs the same layout in the browser.

**4.3 Edits that keep Ramin's arrangement.** The fence carries the canvas id on a comment line (`%% id: cv_…`).
- When an agent sends back an edited fence with the same id, boxes that still exist **stay where Ramin put them**; only new boxes are placed, next to what they connect to.
- A new tool `update_canvas(docId, canvasId, add/remove/rename …)` does the same for small changes without resending the diagram.

**4.4 The agent can look.** Every canvas write answers with a short report: size, box and arrow counts, and lint (`2 arrows cross`, `label over 40 characters on "x"`, `box "y" has no arrows`, `over 25 boxes: consider splitting`).
- A new tool `preview_diagram(docId, blockId)` returns a PNG of the board as laid out, for when the agent wants to check.
- Rendering uses a small SVG writer of our own (boxes, text, routed arrows) plus `@resvg/resvg-js` (MPL-2.0). There is no headless browser, so it also works on the future server.
- The same SVG gives "Download as PNG/SVG" in the board's menu and a static picture for read-only views.

**4.5 Better boards for Ramin too:** zones (frames that carry their boxes when moved), kind icons, right-angle arrows that follow the engine's route until he moves a box, Tidy up, and export.

## 5. Mermaid for agents

- **Check on write.** The server validates Mermaid source before storing it and answers 400 with Mermaid's own message, so the agent can correct it. Try `mermaid.parse` in Node first (time-box half a day). If it cannot run without a browser, record the browser's render error on the block and return it from `read_doc` and `preview_diagram`.
- `preview_diagram` works for Mermaid blocks as well (through the browser render if the server cannot draw it; say so in the tool's answer).
- In the editor: zoom, pan, full screen and export on the drawn diagram.

## 6. Writing a whole note in one call

- `create_doc` and `append_to_doc` already take Markdown with fences, so a note with three diagrams is **one tool call**. Keep that as the main path.
- **A recipe, not just a syntax list.** Add an MCP prompt/resource `note_recipe` and a Claude Code skill (`.claude/skills/recollect-notes/SKILL.md`): how a good system-design note is built (summary, the request path as a canvas, the data model as an ER diagram, the failure cases, self-test toggles), with two complete worked examples. This runs on Ramin's subscription and costs nothing per use.
- **The app's own AI uses the same road.** "Ask AI" (later phase of the editor plan) gets the same writers as tools: Markdown with fences, `update_canvas`, `preview_diagram`. Whatever an outside agent can draw, the in-app AI can draw.

## 7. Build order

| # | Step | Contents | Done when |
|---|---|---|---|
| 0 | **Stop the corruption** (hours) | Remove columns from the current editor and the server schema (Markdown already flattens them; convert any stored column blocks to plain blocks). Add a guard that refuses any change leaving the doc invalid | `invalid-repro.js` passes; no doc can become invalid |
| 1 | **Text language + ELK** | Parser, shapes, zones, kinds, ELK layout and routing on the server, fitted height, lint in every answer; the board draws zones, icons and routed arrows | The §4.1 example and two harder ones (15–25 boxes, nested zones) come out readable in a doc with no hand positioning; parser errors name their line |
| 2 | **Edits keep positions** | Canvas id in the fence, position carry-over, `update_canvas` | Ramin moves boxes; the agent adds two boxes; nothing he placed moves |
| 3 | **The agent can look** | SVG writer, `preview_diagram`, PNG/SVG export, Tidy up | In a live Claude Code session the agent draws, previews, fixes one issue it saw, and stops |
| 4 | **Mermaid checks** | Validation on write, zoom/pan/full screen, preview | A broken Mermaid block is refused with a message the agent can act on |
| 5 | **Recipe and skill** | `note_recipe`, the skill file, two worked examples | One prompt ("write me a note on consistent hashing") gives a complete note with at least two good diagrams in one call |
| 6 | **Editor rebuild** | [DOCS_EDITOR_V2_PLAN](DOCS_EDITOR_V2_PLAN.md) as revised: BlockNote core only, no columns | That plan's own bar |

Steps 1–5 do not depend on the editor rebuild: the board is a React component and the diagram logic lives on the server, so both carry over unchanged when the editor is swapped in step 6. Steps 1, 2 and 4 are mostly backend, so one worker can take them while the supervisor builds the board's new visuals (max 2 workers, no helpers).

## 8. Acceptance: is it actually easy for the agent?

Measure with real runs in Claude Code (Ramin's subscription, no API spend), on three prompts: a URL shortener, a chat system, a rate limiter.
- **Calls:** a full note with diagrams in at most 2 tool calls; a diagram fix in 1.
- **Tokens:** the same diagram costs at most a quarter of today's JSON form.
- **Quality, judged from the previews:** no overlapping boxes, no arrow through a box, labels readable at the doc's width.
- **Errors:** every refusal says what to change; no silent drops.
- Test the board changes like a person (memory `test-ui-like-a-person`), in light and dark.

## 9. Dependencies and licences (Ramin's rule: nothing that could cost money or block us later)

| Package | Licence | Note |
|---|---|---|
| `elkjs` | EPL-2.0 | Free for any use, closed-source included. Only changes to ELK's own files would have to be shared, and we make none |
| `@resvg/resvg-js` | MPL-2.0 | Same terms as above |
| `@xyflow/react` (already in) | MIT | |
| BlockNote core, react, server-util, code-block (step 6) | MPL-2.0 | The GPL parts (`xl-multi-column`, `xl-ai`) are **not used** |

Pin exact versions, each at least two weeks old on the day of install. If Ramin wants MIT/Apache only, `@dagrejs/dagre` (MIT) can replace ELK, with plainer layouts and no zone routing.

## 10. Not in this plan

Side-by-side columns; freehand drawing; brand icon packs; real-time cursors on boards; a standalone canvas page.

## As built (2026-11-14)

| # | Status | What was built (detail in CANVAS_BLOCK_SPEC §9 As built) |
|---|---|---|
| 0 | ✅ | Columns removed (editor, slash menu, server schema; code in `recollect/_archive/`). Stored rows flattened by `backend/src/services/docs/docRepair.ts` on load, on read, after agent Undo, and once by `scripts/repair-docs.ts`. `DocGuard` refuses local changes that leave a doc invalid; REST JSON saves are checked. `invalid-repro.js` passes |
| 1 | ✅ | Text language (`backend/src/services/docs/diagram/`), ELK 0.12.1 layout with zones, kinds and routes, lint and a report on every write, read_doc prints the text with `%% id`. Board: zones, kind icons and a "What it is" picker, rounded and queue shapes, routed arrows |
| 2 | ✅ | Edits keep positions: replace_section with the same `%% id`, and `update_canvas` (`diagram`, or `add` / `remove` / `rename`) |
| 3 | ✅ | Server SVG writer and PNG (`@resvg/resvg-js` 2.6.2, MPL-2.0), `preview_diagram`, `POST /api/canvas/layout` (Tidy up) and `/render` (Save as SVG/PNG) |
| 4 | ✅ | Mermaid 11.17.2 parses in Node (in a worker thread with a 3 s limit, DOMPurify stubbed): agents get a 400 naming the block and line; Ramin's paste and AI practice notes stay lenient. In the editor: full screen with zoom, pan, Save as SVG/PNG |
| 5 | ✅ | The skill `mcp/skills/recollect-notes/SKILL.md` (installed to `~/.claude/skills/` by `npm run install:skill`) and the MCP prompt `note_recipe` (the same text); `update_canvas` gained `relayout: true` (a kept-positions update can't change direction); real Claude Code runs below |

**§8 measured:**
- **Tokens** (`backend/scripts/diagram-token-cost.ts`, the three fixtures): the text form is 17–22 % of the JSON with positions that read_doc used to print, and 41–58 % of the leanest JSON an agent could write (no positions). So "a quarter" holds against the old printed form, about a half against lean JSON; the text also carries zones, kinds and notes the JSON had no way to say.
- **Calls** (four real Claude Code runs, Opus 5.5, `scratchpad/agent-runs/`; every run loaded the skill on its own and searched before writing):
  - URL shortener: one `create_doc` (2 canvases, 2 Mermaid), then one `update_canvas` for the crossing its report named. 2 writes.
  - Chat system: one `create_doc` (2 canvases at 88 % and 100 %, an ER and a sequence diagram), no problems. 1 write.
  - Rate limiter: found Ramin's stub doc, one `append_to_doc` (2 canvases, 1 Mermaid), then one `replace_section` that took the board from 6 crossings to none. 2 writes.
  - Consistent hashing (step 5's bar): found the stub, one `append_to_doc` (2 canvases, 1 Mermaid); its fix of a board at 60 % changed nothing, because an update keeps positions: `relayout: true` was added for that, and the lint now says so.
- **Quality, from the screens:** no overlapping boxes, numbered flows, zones and kind icons used unprompted, labels readable at the doc's width; one sticky's link crossed an arrow (reported).
- **Errors:** no Mermaid or canvas refusal happened in the runs; the refusal messages are covered by tests.
