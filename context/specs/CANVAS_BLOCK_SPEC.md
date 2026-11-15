# Canvas block v1 (Phase E, last slice) — contract

_2026-11-14. Ramin: "E part is still pending, finish it up first." The plan (HOME_DOCS_AGENT_PLAN §5 step 4) names React Flow (MIT, already prototyped in `walkthrough-demo/`) and says canvas data must not be one giant attribute: it gets its own Y.Map._

**What ships:** a `canvas` block in docs: a board of boxes, sticky notes, text and arrows you can drag, connect, resize, colour and edit, side by side with text through columns, live in every open tab, with full-screen editing. Agents read it (as a ```canvas JSON fence in the doc's Markdown) and write it (the same fence, or the MCP tool `add_canvas`). Freehand drawing, images on the canvas, frames/groups, presence cursors and a standalone canvas page are **not** in v1.

---

## 1. The node (identical on both schemas)

| | |
|---|---|
| name | `canvas`, group `block`, `atom: true`, `selectable: true`, `draggable: false` |
| HTML | `div[data-type="canvas"]` |
| attr `canvasId` | string or null (default null). HTML `data-canvas-id`. Format `cv_` + 12 chars of `[A-Za-z0-9_-]` |
| attr `height` | number, default 440 (the inline frame height in px). HTML `data-height`. Readers clamp to 240–1400 |
| attr `data` | a Board (§3) or null (default null). **A transient carrier only**: set on JSON that travels (Markdown → JSON, clipboard, agent input) and taken out before anything reaches the Yjs fragment. HTML `data-board` = JSON text, rendered only when non-null |

## 2. Where the board lives: two root maps per canvas in the doc's Y.Doc

- `ydoc.getMap('canvas:<canvasId>:nodes')`: node id → NodeRecord (a plain JSON value, never a nested Y type)
- `ydoc.getMap('canvas:<canvasId>:edges')`: edge id → EdgeRecord

Root maps never collide (they are named), sync and store with the doc (Hocuspocus stores the whole state), and one moved box rewrites one map entry. Deleting a canvas block leaves its maps (so text Undo brings it back whole); nothing garbage-collects them in v1.

## 3. Records and the Board JSON

```ts
type Shape = 'rect' | 'pill' | 'ellipse' | 'diamond' | 'cylinder' | 'sticky' | 'text';
type Color = 'default' | 'gray' | 'blue' | 'green' | 'yellow' | 'red';
interface NodeRecord { id: string; shape: Shape; text: string; x: number; y: number; w: number; h: number; color: Color; z: number; size?: 's' | 'm' | 'l' }
interface EdgeRecord { id: string; from: string; to: string; label: string; line: 'solid' | 'dashed'; arrow: 'end' | 'both' | 'none'; path: 'straight' | 'curved' | 'elbow' }
interface Board { nodes: NodeRecord[]; edges: EdgeRecord[] }
```

- x, y = top-left in canvas units; w, h = size (h is a minimum: text may make a box taller on screen).
- Default sizes: rect 160×64 · pill 160×56 · ellipse 140×80 · diamond 140×100 · cylinder 120×96 · sticky 200×140 · text 200×40.
- z: stacking order (higher on top). Nodes are listed in z order.

**Input normalisation** (server `normalizeBoard`, used for Markdown fences and agent input; a clear 400 on anything it can't fix, so agents can correct themselves):
- `nodes` must be an array (≤ 300); `edges` optional array (≤ 600).
- Node `id`: trimmed, only `[A-Za-z0-9_-]`, ≤ 40 chars; missing → `n1`, `n2`, …; two nodes with the same id → 400.
- `text` (alias `label`): string, trimmed, ≤ 1000 chars, line breaks kept.
- `shape` aliases: box/rectangle → rect · stadium/terminal/round → pill · circle/oval → ellipse · decision/rhombus → diamond · database/db/store → cylinder · note/postit → sticky · label/title → text. Unknown → rect.
- `color` aliases: grey → gray · orange/amber → yellow · purple/pink/brown → default. Unknown → default.
- x, y: finite numbers (rounded, clamped ±1e6) or absent; w, h: clamped 16–4000, else the shape default.
- Edge `from`/`to` (aliases `source`/`target`) must name nodes → else 400 `Edge 3 points at "xyz", which is not a node`. `label` ≤ 200. `line`: dashed/dotted → dashed, else solid. `arrow`: none/both/end (default end). `path` aliases: curve → curved · step/orthogonal → elbow; default straight. Missing/duplicate edge ids → `e1`, `e2`, ….
- **Auto-layout** for nodes without x or y: layered (rank = longest path over the edges, cycles broken), direction `layout: 'LR'` (default) or `'TB'` from the input; LR = ranks 240 apart left to right, rows 120 apart, each rank centred; TB = ranks 160 apart, columns 220 apart. If some nodes already have positions, the laid-out ones go below their bounding box (120 gap).
  - _As built (server, 2026-11-14):_ the spacing grows when the laid-out boxes are bigger than the default rect, so they never overlap (LR: at least widest + 80 across, tallest + 40 down; TB: tallest + 64 down, widest + 40 across); a rank is ordered by where its predecessors sit (fewer crossings). `layout` also takes `TD`/`vertical`/`horizontal`; anything else is a 400. Text or a label over its limit is a 400 (not cut). The unknown-edge 400 adds the node ids: `Edge 3 points at "xyz", which is not a node. Node ids: "a", "b".` Readers of stored maps (`readBoard`) drop edges whose ends are not nodes.

## 4. Markdown: the ```canvas fence

Printed (fields equal to their default are left out to keep it short; numbers are integers):

````
```canvas
{
  "id": "cv_Ab3dE6gH9jK0",
  "nodes": [
    {"id":"client","text":"Client","x":0,"y":0,"w":160,"h":64},
    {"id":"db","shape":"cylinder","text":"Postgres","color":"blue","x":480,"y":0,"w":120,"h":96}
  ],
  "edges": [
    {"id":"e1","from":"client","to":"db","label":"SQL","line":"dashed"}
  ]
}
```
````

- One node or edge per line. `"height": N` is added when the block's height isn't 440.
- Parsing: a fence whose language is `canvas` → `JSON.parse` → `normalizeBoard` → `{ type: 'canvas', attrs: { canvasId: null, height, data: board } }`. Bad JSON → 400 `The canvas block is not valid JSON: …`. The fence's `id` is ignored on input (a parsed canvas always gets a fresh id), so replace_section with an edited fence makes a new canvas and Undo brings the old one back.
- Any other fence language stays a code block.

## 5. Absorb and inject (where the transient `data` goes in and out)

**Absorb** (JSON → Yjs). For every canvas node in walk order: id null or already seen in this doc → a fresh id, and the maps get `data` (or, without data, a copy of the seen id's board). Otherwise, if `data` is set and that id's maps are empty → write `data`. Then `data` → null. In the server this happens in:
- `docJsonToYjsState` (doc create, practice notes, REST saves)
- agent append and replace-section (in the same `live.apply` transaction as the fragment insert, through `fragment.doc`)

In the browser it is a ProseMirror `appendTransaction` on local transactions (paste, slash insert, template, Duplicate), never on remote (y-sync) ones.

**Inject** (Yjs → JSON for reading): canvas nodes get `attrs.data = readBoard(ydoc, canvasId)`, so Markdown export (read_doc, Copy as Markdown), search text, Recall and the public viewer see the boxes. Server: `currentContent()` and the stored-state readers. Browser: `yjsStateToJson()`.

**REST save** (`saveDocFromEditor`): when the existing doc has canvas maps for ids still present in the new content, they carry over into the new state.

**Undo of an agent change** (`yjsChanges.revertUpdate`): the UndoManager scope is the fragment plus every `canvas:*` root map the change touched, so an agent edit to a board is undone with it. The snapshot fallback also restores the snapshot's canvas maps.

## 6. Agents (MCP)

- MARKDOWN_GUIDE gains one line on ```canvas fences: shapes, colours, `layout`, positions optional.
- New tool `add_canvas` {docId, nodes, edges?, layout?, height?}: a zod schema with the enums above, which builds the fence and POSTs append. It answers `Added a canvas with 5 boxes and 4 arrows to doc <id>.` plus the Undo hint. That makes 20 tools.
- read_doc shows the fence (with the canvas id). To change a board the agent rewrites the section that holds it (replace_section); the old board comes back with Undo.

## 7. Browser (supervisor builds)

- `@xyflow/react` **12.12.0** pinned (released 2026-09-24; 12.12.1 is under two weeks old). Base CSS only; every colour comes from `.rc` tokens.
- `lib/editor/canvasBoard.ts` (types, defaults, Y helpers, inject), `lib/extensions/Canvas.tsx` (node, absorb plugin, copy carries the board, Backspace selects before it deletes, `insertCanvas`), `components/docs/editor/canvas/*` (the node view, board, shapes, floating edges, toolbars, CSS).
- Slash menu: "Canvas" (Advanced; aliases whiteboard, board, boxes, draw, sketch, system).
- Interactions:
  - Drag from a side dot to another box connects them; dropping on empty space makes a connected box there.
  - Clicking a side dot adds a connected box in that direction.
  - Double-click on empty space adds a box. Double-click or Enter edits text.
  - Shift-drag selects several. Delete removes. Ctrl Z / Ctrl Shift Z undo inside the board (its own Y.UndoManager).
  - Ctrl D duplicates. Ctrl C / Ctrl V copy boxes between boards.
  - The page scrolls normally over an inactive board; after a click inside, the wheel pans and Ctrl-wheel or a pinch zooms. Escape leaves.
  - Full screen from the view controls.

## 8. Not in v1 (backlog)
Freehand pen; images on the canvas; live cursors inside the board; a standalone canvas page; garbage-collecting maps of deleted canvases. _(Frames/groups and `update_canvas` were built in v2 as zones and the in-place update: §9.)_

## As built (2026-11-14, supervisor additions)
- **Layout without `layout`:** the server lays the board out both ways and keeps the one that shows it bigger in a doc's 720 px column (LR on a tie): long chains go top to bottom.
- **Fitted height:** a fence without "height" gets the block height that shows the whole board at the zoom the browser fits it at (fit padding 0.12, plus 48 px for the bars), 280–880 on the 8 px grid; it is then printed in the fence.
- **Rank depth:** each rank is only as deep as its own biggest box (default boxes keep the spec's 240 / 160 pitch); boxes no arrow touches sit beside the flow (right of TB, under LR), not in rank 0.
- **Browser:** the selection bar is our own floating bar, clamped inside the board (React Flow's NodeToolbar was clipped at the edges); boxes, arrows and bars on `.rc` tokens; no dot grid (the craft floor). The block passes mousemove to the editor so the block handle reaches it.

## 9. v2: diagrams for agents (AGENT_DIAGRAMS_PLAN steps 1–2, contract written 2026-11-14)

The contract between the server (parser, ELK layout, printer, lint) and the browser (drawing). Additive: every v1 record stays valid.

**NodeRecord additions**
```ts
type Shape = 'rect' | 'rounded' | 'pill' | 'ellipse' | 'diamond' | 'cylinder' | 'queue' | 'sticky' | 'text' | 'zone';
type Kind = 'client' | 'user' | 'mobile' | 'service' | 'worker' | 'function' | 'database' | 'cache' | 'queue' | 'stream'
          | 'storage' | 'search' | 'cdn' | 'dns' | 'gateway' | 'lb' | 'auth' | 'external' | 'monitor' | 'scheduler' | 'notify' | 'model';
interface NodeRecord { /* v1 fields */ kind?: Kind; parent?: string }
```
- `rounded`: a box with a larger radius (Mermaid `(text)`); default 160×64. `queue`: a horizontal cylinder, a pipe (Mermaid `[[text]]`); default 160×64.
- `zone`: a frame that holds other nodes (Mermaid `subgraph`). `text` is its title (drawn at its top-left), `color` tints it. It is drawn behind its children, and moving it moves them.
- `parent`: the id of the zone the node sits in. **x, y are then relative to that zone's top-left** (React Flow's `parentId` rule); top-level nodes are relative to the board origin. Zones nest. A `parent` that is not a zone on the board is dropped when read (the node becomes top level, keeping its numbers). The server lists every zone before its children.
- `kind`: what the box is. The browser draws its lucide icon left of the text, and it sets the default shape: client rounded · user pill · mobile rounded · service rect · worker rect · function rounded · database cylinder · cache cylinder · queue queue · stream queue · storage cylinder · search rect · cdn rounded · dns rounded · gateway rect · lb rect · auth rect · external rect · monitor rect · scheduler rounded · notify rounded · model rect. Icons: Monitor, User, Smartphone, Server, Cog, SquareFunction, Database, Zap, Layers, Waves, HardDrive, Search, Globe, Signpost, Network, Split, ShieldCheck, Cloud, Gauge, Clock, Bell, BrainCircuit. No brand logos.
- Kind aliases (input only): browser/web/frontend → client · phone/app → mobile · server/backend/api/microservice → service · job/consumer/worker → worker · lambda/serverless → function · db → database · mq/broker → queue · topic/log/eventbus/kafka-like → stream · blob/bucket/s3 → storage · index → search · proxy/apigateway → gateway · loadbalancer/balancer → lb · iam/identity/login → auth · thirdparty/saas → external · metrics/monitoring/observability → monitor · cron/timer → scheduler · email/push/notification → notify · llm/ml/ai → model. Unknown kind → 400 naming the list.

**EdgeRecord addition**
```ts
interface EdgeRecord { /* v1 fields */ route?: { points: Array<[number, number]>; label?: [number, number] } }
```
- `route.points`: the engine's path in **board coordinates** (absolute, never relative to a zone), from the point on the source's border to the point on the target's border, right-angle segments. `route.label`: the label's centre (absolute).
- A route is only true while neither end moves: the browser deletes `route` from every edge touching a box it moves or resizes (or touching anything inside a zone it moves), in the same transaction. Without a route the browser draws `path` as in v1. The server writes routes when it lays a board out.
- `from` / `to` may name a zone.

**The text form of a board** (the ```canvas fence; a fence that starts with `{` is still the v1 JSON). A subset of Mermaid's flowchart syntax, specified with examples in AGENT_DIAGRAMS_PLAN §4.1, plus:
- `%% id: cv_…` names the canvas (the printer writes it first; step 2 uses it to keep positions). `%% height: N` asks for a frame height. Other `%%` lines are comments.
- Printing (read_doc, Copy as Markdown) writes the text form: `%% id`, `flowchart LR|TB` (the direction the boxes mostly run), zones as `subgraph id [Title] … end`, then the boxes with their shape brackets, `:::color` and `@{ kind: x }`, then the arrows, stickies as `note id: text` (or `note id for box: text` when a sticky's only link is a plain dashed line to one box). Positions and sizes are not printed: the server keeps them by id.
- Every write that makes a canvas answers with a report per canvas (boxes, arrows, zones, laid-out size, the zoom it shows at in a doc, and lint lines).

**As built (server and MCP, step 1, 2026-11-14).** Code: `backend/src/services/docs/diagram/` (parse, measure, layout, lint, print, resolve, geometry); fixtures `backend/tests/fixtures/diagrams/`.
- **ELK:** `elkjs` **0.12.1** pinned (released 2026-10-28), `elk.bundled.js`, loaded on the first layout. Layered, `INCLUDE_CHILDREN`, orthogonal routing, `elk.json.edgeCoords: ROOT` (works in 0.12.1: routes and label boxes come back absolute), model order kept (`considerModelOrder NODES_AND_EDGES`; in a loop the arrow back to a box written earlier is the one turned round, `cycleBreaking MODEL_ORDER`), `NETWORK_SIMPLEX` placement, components packed. Spacing for a 720 px column: 32 between boxes in a layer, 24 between layers, arrows 10 apart. Not `postCompaction`: in 0.12.1 it can put two boxes of a small component on top of each other. Same text → same board (tested).
- **Labels:** centred on their arrow (`inline`), each in a layer of its own (ELK's label dummies), so a label never sits on a box; `route.label` is that centre, snapped onto the tidied route.
- **Routes:** rounded to integers from the board origin; jogs under 8 px straightened; an S-shaped arrow with a step under 24 px becomes straight by sliding one end along its side (≥ 4 px from the corners, ≥ 10 px from other arrows' ends). Ends on ellipses, diamonds, pills, cylinder caps and queue ends are moved from the bounding box onto the drawn outline (ShapeNode's paths), along the arrow's last run; on rect-like shapes they stay on the box border.
- **Zones:** top padding 40 (title band ≈ 28: 8 px, then one 13 px semibold line; then 12 px), sides and bottom 20; at least as wide as the title plus 10 px each side; content centred; an empty zone gets that minimum size.
- **Box sizes** (`measure.ts`): Arial-like character widths × 1.06 (never under-measure: the browser must not wrap a line we didn't). Width = clamp(text + padding, shape default, 240) on a 4 px grid, then wrap and grow taller. Padding per the CSS (ellipse 18 %, diamond 22 %, cylinder 22 %-of-width top, queue 9 % / 16 %, kind icon +22). **Stickies from the text form hug their text: 200 wide, at least 72 tall** (not 140; `h` is a minimum, so a longer note still grows).
- **Notes:** `note for box` is a dashed, arrowless, unlabelled arrow **from the box to the note**, so ELK puts the note next to its box (the next layer); a note without `for` is packed as its own component. A free-space pass that moves notes beside their box was tried and left out: on dense boards there is no free space, on sparse ones ELK's spot is already adjacent. Unnamed notes are `note1`, `note2`, … (never an id the text uses).
- **Zone membership** follows Mermaid: a box belongs to the innermost subgraph whose own lines name it (the first to close wins); lines outside every subgraph never move a box. 400s: an arrow between a zone and something inside it, a zone's arrow to itself, a note inside a zone that is "for" that zone (ELK can't draw them).
- **Text form beyond the list above:** ids may hold single inner dashes (`orders-db`; `a-->b` still reads as an arrow), so boards with such ids print and read back. `@{ shape: … }` takes Mermaid 11 names (`cyl`, `stadium`, `h-cyl`, `diam`, …); a Mermaid shape we can't draw is a box with a note, a name that is no shape is a 400. A plain `[box]` names no shape, so a kind picks it (`db[Postgres]@{ kind: database }` is a cylinder); other brackets and `@{ shape }` win over the kind; `@{ label }`/`@{ shape }` win over the bracket. `(((x)))` is a circle; `{{x}}`, `[/x/]`, `[\x\]`, `>x]` and `[/x\]` are boxes with a note; `[(…]`/`[/…]` that never close as a cylinder or slant are plain boxes (`api[/v1/users]`). Thick arrows (`==>`, `===`) and `--o`/`--x` are normal arrows with a note. `:::orange`/`amber` are yellow, `:::grey` gray, `:::purple`/`pink`/`brown` are drawn uncoloured with a note; another colour is a 400. A written `\n` is a line break like `<br>`; `#quot;` is a quote. `%%{init …}%%` is a comment; Mermaid front matter (`---` … `---`) is skipped with a note; a `%%` after a statement is a comment. `note right of x:` (sequence syntax) is a 400 that says to write `note for x:`. A box may be called `note`, `class` or `end` when an arrow follows it. `%% id` must be a canvas id (else a 400); in step 1 it is kept on the diagram, but a parsed fence still makes a new canvas.
- **Printing:** boxes keep the board's order, and a zone's block is printed where its first box comes, so a diagram read and sent back lays out the same (tested on the chat fixture: identical board). Stickies with a colour, kind or size print as boxes (`n1[text]@{ shape: sticky }:::yellow`: notes have no colour syntax). `note id for box` only when the sticky's only link is a plain dashed arrowless unlabelled line **from** that box (the parser's direction; a line from the note prints as an arrow, so the round trip is exact). The direction printed is the way most arrows run (RL and BT too). `@{ shape: rect }` is written when a rect box's kind would pick another shape. Ids the text form can't write become letters, digits and `_` (never two alike). `%% height` only when the block is not the height that fits the board. An arrow's `path` is not printed (laid-out arrows are `elbow`).
- **JSON form:** `normalizeBoard` takes `kind` (alias → kind; unknown → 400 listing the kinds; it gives the shape when none is named), `parent` (400 when it names no node, a node that is not a zone, or a loop) and `route` (dropped when it is not a list of 2–400 points). A JSON board with zones must place every node (the old layout knows no zones): 400 pointing at the text form. Reading stored records drops unknown kinds and parents that are not zones of the board (the node keeps its numbers), cuts parent loops (the first node read on a loop loses its link) and lists zones before what they hold (z values as stored). `fittedCanvasHeight` and bounds add zones' positions up. The JSON printer is `printCanvasJsonFence` (tests only).
- **Pending diagrams:** a text fence parses to `data: { pendingDiagram: <diagram> }`; `resolveDiagrams(json)` (in place) lays out every pending canvas and returns a report per canvas, JSON ones included. It runs in create_doc (after the subject check; canvas ids are then given before storing, so the report names them), append, replace-section, practice notes (through `createDocFromMarkdown`) and `POST /api/agent/markdown`. Absorbing a pending diagram throws `PendingDiagramError` (a 500, never wrapped as a 400).
- **Reports:** `canvases` is in the answer only when the Markdown made a canvas. `boxes` = nodes that are not zones (notes and text count); `zoom` = min(720 / (w·1.12), (frame − 48) / (h·1.12), 1) with the block's height; the advice to switch direction is only given when the agent chose the direction. MCP prints one line per canvas: `Canvas cv_…: 12 boxes, 14 arrows, 2 zones, 980×520, shows at 73% in a doc. Check: … .` (zones left out when 0).
- **Fixtures, as laid out:** url-shortener (the plan's §4.1 text, `flowchart LR` as written) 1403×289, **46 %**, lint `2 arrows cross (a2→cache × a1→db); shows at 46% in a doc (too wide): try flowchart TB, or split it`; the same with TB or no direction 617×757, **98 %**, only the crossing (two API servers to two stores: a crossing no 2-row drawing avoids). chat-system (18 boxes + 2 notes, 4 zones nested 2 deep, a loop back from the fan-out worker; no direction → TB) 1116×1428, **52 %**: 8 box layers, 5 label layers and stacked zone paddings make it too tall for an 880 px frame; lint says `7 arrows cross (…) ; shows at 52% in a doc (too tall): fewer steps in a row, or split it`. rate-limiter (decision flow, TB) 707×1045, **71 %**, no problems. So the plan's example should leave the direction out (the MCP guide's example does), and a 15–25 box system with a loop reads in full screen, not at doc width.

**Step 3 endpoints (stateless; the browser sends the board it shows, so its own Undo covers the result)**
- `POST /api/canvas/layout` `{ board, direction?: 'LR'|'TB' }` → `{ board, report }`: the same ELK layout as an agent's diagram, keeping every id, zone and arrow; positions, sizes of zones and routes are new. The browser's "Tidy up" writes the result in one transaction (Ctrl Z undoes it).
- `POST /api/canvas/render` `{ board, format: 'svg'|'png', theme: 'light'|'dark' }` → the image (Content-Type image/svg+xml or image/png): the server's own SVG writer (boxes, zones, icons, routed arrows, labels) and @resvg/resvg-js for PNG. The board's "Save as SVG/PNG" uses it.
- Both: cookie or Bearer auth, a board of at most 300 boxes, 400 with the reason otherwise.
- MCP `preview_diagram(docId, canvasId?)`: the PNG of a doc's board (the first canvas when no id), as image content, plus the same report as a write.

**As built (steps 2 and 3, 2026-11-14; worker 1, finished by the supervisor).** Code: `diagram/edit.ts`, `merge.ts`, `update.ts` (positions kept, `update_canvas`), `svg.ts`, `png.ts`, `icons.ts` (drawing, lucide paths, ISC), `canvasTools.service.ts` + `routers/canvas.routes.ts` (layout and render), `services/agent/agentCanvas.service.ts` (`POST /api/agent/docs/:id/canvas/:canvasId`, `GET /api/agent/docs/:id/preview`). `@resvg/resvg-js` 2.6.2 (MPL-2.0).
- Checked like a person (`step23.js`): an agent draws, Ramin drags two boxes, the agent adds a box with `update_canvas` and none of his boxes moves; Tidy up re-lays the board and Ctrl Z takes it back; Save as SVG / PNG download; the preview is a PNG.
- Fix by the supervisor: Tidy up first reads the board in its arrows' order (`flowOrder`: a depth-first order from the sources, ties by where boxes sit). Fed in stacking order (zones first), ELK's model-order cycle breaking turned forward arrows backward. Tested in `svg.test.ts`.
- replace_section with a fence that keeps `%% id` now updates that board in place (the old "makes a new canvas" test was changed to match).
