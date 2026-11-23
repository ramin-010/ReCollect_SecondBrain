// Docs: search, read (Markdown), create, append, replace a section, add a canvas board. Writes go
// live into an open editor (the API applies them through Hocuspocus) and keep a snapshot for Undo.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApiError } from '../api.js';
import { ToolError } from '../errors.js';
import { dayOf, plural, quote, withUndo } from '../format.js';
import { userTimeZone } from '../timezone.js';
import { zDocId, zId, zMarkdown, zSubjectName } from '../schemas.js';
import { afterSubject, resolveSubject } from '../subjects.js';
import { ADDS, CHANGES, READ_ONLY, defineTool, type ToolContext } from '../tool.js';
import type { CanvasPreview, CanvasReport, CanvasUpdated, DocAppended, DocCreated, DocListItem, DocRead, DocUpdated, NoteAdded, SectionReplaced } from '../types.js';

/** What a box can be (backend/src/services/docs/canvas.ts CANVAS_KINDS): an icon, and its default shape. */
export const CANVAS_KINDS = [
    'client', 'user', 'mobile', 'service', 'worker', 'function', 'database', 'cache', 'queue', 'stream', 'storage',
    'search', 'cdn', 'dns', 'gateway', 'lb', 'auth', 'external', 'monitor', 'scheduler', 'notify', 'model',
] as const;

/** The canvas text form in brief (backend/src/services/docs/diagram/parse.ts has all of it). */
export const CANVAS_GUIDE = [
    '```canvas holds a diagram in Mermaid flowchart syntax. Recollect lays it out (never give positions): zones, right-angle arrows, labels. Example:',
    '    flowchart',
    '    user([User]) -->|HTTPS| lb[Load balancer]',
    '    subgraph api [API tier]',
    '      a1[API server 1]',
    '      a2[API server 2]',
    '    end',
    '    lb --> a1 & a2',
    '    a1 & a2 -->|SQL| db[(Postgres)]:::blue',
    '    db -.->|CDC| q[[Outbox]]@{ kind: queue }',
    '    note for db: Primary + 2 replicas',
    '  Direction: best left out (a bare flowchart line, or none): Recollect picks the one that shows bigger in a doc; flowchart LR or flowchart TB forces one. Shapes: [box] (rounded) ([pill]) [(database)] ((circle)) {decision} [[queue]].',
    '  Arrows --> , --- (no head), -.-> (dashed: async), <--> (both ways), a label as -->|text|; a --> b & c fans out; chains a --> b --> c.',
    '  subgraph id [Title] … end makes a zone (nestable; an arrow may point at the zone). Colours :::blue :::green :::yellow :::red :::gray.',
    "  Notes: note: text, or note for box: text (beside that box). Kinds give an icon (and a shape when the bracket is a plain [box]): id@{ kind: cache }, kinds " +
        `${CANVAS_KINDS.join(', ')}.`,
    '  No classDef, style or click. 5–15 boxes read best. Every write answers with a line per canvas: its size, the zoom it shows at in a doc, and problems to fix.',
].join('\n');

export const MARKDOWN_GUIDE = [
    'Markdown: GitHub style, plus Recollect extras.',
    '- Headings # to ######. A toggle heading folds its section: <details><summary>## Title</summary>…</details>.',
    '- **bold**, *italic*, ~~strike~~, `code`, ==highlight==, [links](https://…), images ![alt](https://…).',
    '- Lists, numbered lists and task lists (- [ ] todo / - [x] done), nested.',
    '- Fenced code with a language (```ts).',
    '- Diagrams: a ```canvas fence for architecture, request flows, data flows and concept maps (a board the user can rearrange); a ```mermaid fence for sequence, ER, state, class, timeline and mind-map diagrams.',
    `- ${CANVAS_GUIDE}`,
    '- Each ```mermaid block is checked with Mermaid 11 before anything is stored: a block it can\'t parse makes the whole call fail with 400 ("Mermaid block N (type), line L: <Mermaid\'s message>") and nothing is written, so fix that block and send the same call again.',
    '- Callouts: a quote whose first line is [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] or [!CAUTION], e.g. "> [!TIP]\\n> Use a heap here."',
    '- Toggles: <details><summary>Question?</summary>\\n\\nAnswer\\n\\n</details>. Ideal for self-test questions: the answer stays folded until the user opens it.',
    '- > quotes and --- dividers.',
    '- GFM tables (| a | b |) for comparisons.',
    '- One newline inside a paragraph is a space: leave a blank line between paragraphs.',
].join('\n');

const SAME_MARKDOWN = 'Same Markdown as create_doc: ## headings, callouts (> [!TIP]), <details> toggles, ```mermaid diagrams (checked on write: a broken one is a 400 naming its line), ```canvas diagrams (Mermaid flowchart syntax), task lists.';

// ─── Canvas boards ─────────────────────────────────────────────────────

/** A diagram as a ```canvas fence: a fence the API reads, longer than any backtick run inside. */
export function canvasFence(diagram: string, height?: number): string {
    // An agent may send the fence itself: keep only what is inside.
    const body = canvasBody(diagram);
    const longest = (body.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
    const fence = '`'.repeat(Math.max(3, longest + 1));
    const lines = height !== undefined ? [`%% height: ${height}`, body] : [body];
    return [`${fence}canvas`, ...lines, fence].join('\n');
}

/** "Canvas cv_…: 12 boxes, 14 arrows, 2 zones, 980×520, shows at 73% in a doc. Check: …" */
export function canvasLine(report: CanvasReport): string {
    const parts = [plural(report.boxes, 'box', 'boxes'), plural(report.arrows, 'arrow')];
    if (report.zones > 0) parts.push(plural(report.zones, 'zone'));
    parts.push(`${report.width}×${report.height}`, `shows at ${Math.round(report.zoom * 100)}% in a doc`);
    const check = report.warnings.length > 0 ? `Check: ${report.warnings.join('; ')}.` : 'No problems found.';
    return `Canvas ${report.canvasId ?? '(new)'}: ${parts.join(', ')}. ${check}`;
}

const canvasLines = (reports: readonly CanvasReport[] | undefined): string[] => (reports ?? []).map(canvasLine);

/**
 * The web door's shorter words for the docs tools (ECOSYSTEM_V2_PLAN stage 12: room for the work log in its 24,000
 * characters). The canvas and block tools are not listed there, so their mentions go; guide: true still answers the
 * full writing guide.
 */
const WEB_DOC_WORDS = {
    search_docs: 'Find their docs by words (every word must match; best first), or the most recent without a query: id, subject, last update, a snippet. Search before creating a doc.',
    read_doc: 'Read one doc as Markdown, after a header with its id, title, subject and last update.',
    create_doc:
        'Create a doc from Markdown (GitHub style, > [!TIP] callouts, <details> toggles, ```mermaid diagrams), optionally under a subject with spaced revision (revise: true). search_docs first: append_to_doc beats a duplicate. guide: true answers the full guide and creates nothing.',
    append_to_doc: 'Add Markdown to a doc: at its end, or with heading inside that section (after: a few words of the paragraph it follows). Their own text is never touched.',
} as const;

/**
 * Stage 14 (ECOSYSTEM_V2_PLAN, "Docs that keep what helped"): the moment to offer is while they study the doc, so the
 * rule rides at the end of read_doc's answer (no tool-budget cost), for a doc they can edit.
 */
export const STUDY_NOTE_LINE =
    // Tuning round 1 (the manager's set, 11-20): "ascending, right?" drew an offer to add "sorted ascending".
    'Studying this with them? When explaining a part of it took real work in this chat (a new explanation, an example that made it click, a step or a term the doc lacks, a correction) and it would help their next revision, offer once to add it under its heading (append_to_doc with heading and after); add only on their yes. A question answered in a sentence or two, or anything the doc already says or implies, needs no offer.';

export function registerDocTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;
    const web = ctx.set === 'web';

    defineTool(
        server,
        ctx,
        'search_docs',
        {
            title: 'Search docs',
            description: web
                ? WEB_DOC_WORDS.search_docs
                : "Find docs by words in the title or text (every word must match, in any form or as a word's start; best match first). " +
                  'Without a query: the most recently updated docs. Each: id, subject, last update, a snippet. Search before creating a doc, to extend one instead of duplicating it.',
            input: {
                query: z.string().trim().max(200).optional().describe('Words to look for. Leave out for the most recently updated docs.'),
                limit: z.number().int().min(1).max(50).optional().describe('How many docs, 1–50 (default 10).'),
            },
            annotations: READ_ONLY,
        },
        async ({ query, limit }) => {
            const [docs, zone] = await Promise.all([api.get<DocListItem[]>('/api/agent/docs', { query, limit }), userTimeZone(api)]);
            if (docs.length === 0) return query ? `No docs match ${quote(query)}.` : 'No docs yet.';
            const header = query ? `${plural(docs.length, 'doc')} matching ${quote(query)}, best first:` : `${plural(docs.length, 'doc')}, most recently updated first:`;
            const lines = docs.map((d) => {
                const line = `- ${quote(d.title, 100)} · ${d.subject ?? 'no subject'} · updated ${dayOf(d.updatedAt, zone)} · id ${d.id}`;
                return d.snippet ? `${line}\n  ${d.snippet}` : line;
            });
            return [header, ...lines].join('\n');
        }
    );

    defineTool(
        server,
        ctx,
        'read_doc',
        {
            title: 'Read a doc',
            description: web
                ? WEB_DOC_WORDS.read_doc
                : 'Read one doc as Markdown (the live version if it is open), after a header line (id, title, subject, last update, whether you can edit it). ' +
                  'Read before replace_section, to see the exact headings. A canvas shows as a ```canvas fence in Mermaid flowchart text, its id on the first line (%% id: cv_…): ' +
                  'change it with update_canvas (small changes, or a whole new diagram) and see it with preview_diagram; positions are not in the text, Recollect keeps them.',
            input: { docId: zDocId },
            annotations: READ_ONLY,
        },
        async ({ docId }) => {
            const [doc, zone] = await Promise.all([api.get<DocRead>(`/api/agent/docs/${docId}`), userTimeZone(api)]);
            const header = [
                `Doc ${doc.id}`,
                quote(doc.title, 120),
                doc.subject ? `subject ${doc.subject.name}` : 'no subject',
                `updated ${dayOf(doc.updatedAt, zone)}`,
                doc.canEdit ? 'editable' : 'read-only (shared with the user as a viewer)',
                // STUDY_FLOW_PLAN: a lesson's card and its notes (list_notes reads them).
                ...(doc.card ? ['has its revision card'] : []),
                ...(doc.topicId && doc.notes ? [`${plural(doc.notes, 'note')} on this lesson`] : []),
            ].join(' · ');
            const body = doc.markdown.trim() ? doc.markdown : '(empty doc)';
            return `${header}\n\n${body}${doc.canEdit && doc.markdown.trim() ? `\n\n---\n${STUDY_NOTE_LINE}` : ''}`;
        }
    );

    defineTool(
        server,
        ctx,
        'create_doc',
        {
            title: 'Create a doc',
            description: web
                ? WEB_DOC_WORDS.create_doc
                : "Create a new doc from Markdown. Optionally file it under a subject (by name) and schedule spaced revision " +
                  '(revise: true → reviews 1, 3, 7 and 21 days from today; needs a subject). ' +
                  'A good learning doc: a 2–3 line summary, sections under ## headings, a worked example or code, a diagram where structure helps, ' +
                  'pitfalls in a > [!WARNING] callout, and 3–5 self-test questions as <details> toggles at the end. ' +
                  'search_docs first: extending an existing doc (append_to_doc) beats a duplicate. ' +
                  'Markdown: GitHub style plus callouts (> [!TIP]), <details> toggles, ```mermaid diagrams (checked on write: a broken one is a 400 naming its line, nothing stored) and ```canvas boards (Mermaid flowchart text). ' +
                  'Before your first doc, call it with only guide: true: it answers the full Markdown and diagram guide and creates nothing.',
            input: {
                guide: z.boolean().optional().describe('true: answer the writing guide and create nothing (send nothing else).'),
                title: z.string().trim().min(1, 'A doc needs a title').max(200).optional().describe('The doc title (shown above the body). Needed unless guide.'),
                markdown: zMarkdown.optional().describe("The body in Markdown. Don't repeat the title as a heading at the top. Needed unless guide."),
                subject: zSubjectName.optional().describe('Subject name to file it under, e.g. "DSA" (case-insensitive; see list_subjects).'),
                topicId: zId('topic')
                    .optional()
                    .describe("A planned topic on a path (get_path, get_today show ids): the doc becomes that topic's note, in its subject. With revise the topic is done, else in progress."),
                revise: z.boolean().optional().describe('Schedule spaced revision (1, 3, 7, 21 days). Needs subject or topicId.'),
                create_subject_if_missing: z.boolean().optional().describe('Create the subject if no subject has that name.'),
            },
            annotations: ADDS,
        },
        async ({ guide, title, markdown, subject, topicId, revise, create_subject_if_missing }) => {
            // The full guide on request (MCP_MEMORY_PLAN §4.10): a host with tools only (no prompts) can still read it.
            if (guide) return `${MARKDOWN_GUIDE}\n\nThe whole note recipe, with worked examples, is the note_recipe prompt where the app shows prompts.`;
            if (!title || !markdown) throw new ToolError('Send title and markdown (or only guide: true for the writing guide).');
            if (revise && !subject && !topicId) throw new ToolError('revise needs a subject or a topicId: pass subject (a name from list_subjects) or the planned topic it is the note of.');
            const resolved = subject ? await resolveSubject(api, subject, { createIfMissing: create_subject_if_missing }) : null;
            const doc = await afterSubject(
                api,
                resolved,
                api.post<DocCreated>('/api/agent/docs', {
                    title,
                    markdown,
                    ...(resolved ? { subjectId: resolved.id } : {}),
                    ...(topicId ? { topicId } : {}),
                    ...(revise ? { revise: true } : {}),
                })
            );
            const lines: string[] = [];
            if (resolved?.created) lines.push(`Created subject ${quote(resolved.name, 60)} (id ${resolved.id}).`);
            const where = doc.subject ? ` in ${doc.subject.name}` : '';
            const onPath = topicId && doc.topicStatus ? `, the note of topic ${topicId} (now ${doc.topicStatus.replace('_', ' ')})` : '';
            lines.push(`Created doc ${quote(doc.title, 100)}${where}${onPath} · id ${doc.id}.`);
            if (doc.nextRevision) lines.push(`Revision scheduled: first review ${doc.nextRevision} (cycles at 1, 3, 7 and 21 days).`);
            else if (doc.subject) lines.push('Not scheduled for revision (schedule_revision starts it).');
            lines.push(...canvasLines(doc.canvases));
            return withUndo(lines.join('\n'));
        }
    );

    defineTool(
        server,
        ctx,
        'update_doc',
        {
            title: "Change a doc's title or filing",
            description:
                'Rename a doc (live if it is open), file it under a subject, or make it the note of a planned topic on a path (topicId: the topic is then in progress). ' +
                'A doc is on one path once. The user can undo it.',
            input: {
                docId: zDocId,
                title: z.string().trim().min(1, 'title is empty').max(200).optional().describe('The new title.'),
                subject: zSubjectName.optional().describe('A subject name to file it under (its topic moves there if it has one).'),
                topicId: zId('topic').optional().describe('A planned topic (get_path shows ids) whose note this doc is.'),
            },
            annotations: CHANGES,
        },
        async ({ docId, title, subject, topicId }) => {
            if (title === undefined && subject === undefined && topicId === undefined) throw new ToolError('Send title, subject or topicId.');
            const resolved = subject ? await resolveSubject(api, subject) : null;
            const result = await api.patch<DocUpdated>(`/api/agent/docs/${docId}`, {
                ...(title !== undefined ? { title } : {}),
                ...(resolved ? { subjectId: resolved.id } : {}),
                ...(topicId ? { topicId } : {}),
            });
            const filing = [result.subject ? `in ${result.subject.name}` : 'no subject', ...(result.topicId ? [`topic ${result.topicId}`] : [])].join(' · ');
            if (!result.editId) return `Nothing to change: doc ${result.id} is ${quote(result.title, 100)} · ${filing}.`;
            return withUndo(`Updated doc ${result.id}: ${result.changes.join(', ')}.\nNow ${quote(result.title, 100)} · ${filing}.`);
        }
    );

    defineTool(
        server,
        ctx,
        'append_to_doc',
        {
            title: 'Append to a doc',
            description: web
                ? WEB_DOC_WORDS.append_to_doc
                : 'Add Markdown to an existing doc: at its end (a new section, self-test questions), or with heading inside that section, after the paragraph whose words you quote in after (a note that helped them, on their yes). It appears live if the doc is open; the user’s own text is never touched. ' +
                  SAME_MARKDOWN,
            input: {
                docId: zDocId,
                markdown: zMarkdown.min(1, 'markdown is empty').describe('What to add, in Markdown.'),
                // Stage 14: a note inside one section (the server places it, adds the day and the app, refuses a repeat).
                heading: z.string().trim().min(1).max(300).optional(),
                after: z.string().trim().max(300).optional(),
            },
            annotations: ADDS,
        },
        async ({ docId, markdown, heading, after }) => {
            if (!heading) {
                if (after) throw new ToolError('after needs heading: the section the note goes in.');
                const result = await api.post<DocAppended>(`/api/agent/docs/${docId}/append`, { markdown });
                return withUndo([`Appended ${plural(result.appended, 'block')} to the end of doc ${result.id}.`, ...canvasLines(result.canvases)].join('\n'));
            }
            let note: NoteAdded | DocAppended;
            try {
                note = await api.post<NoteAdded | DocAppended>(`/api/agent/docs/${docId}/append`, { markdown, heading, ...(after ? { after } : {}) });
            } catch (err) {
                if (err instanceof ApiError && err.status === 400 && /unrecognized key/i.test(err.message)) {
                    return 'This Recollect server is older: it adds notes inside a section from its next release. Nothing was added.';
                }
                throw err;
            }
            // An older Recollect server (before the deploy) ignores the two fields and appends at the doc's end.
            if (!('heading' in note)) return withUndo(`Appended ${plural(note.appended, 'block')} to the end of doc ${note.id} (this Recollect server is older: notes go inside a section from its next release).`);
            if ('already' in note) return `Already in that section (${quote(note.heading, 80)}): not added again.`;
            const where = note.placed === 'after' ? 'right after the paragraph you quoted' : 'at the end of that section';
            return withUndo([`Added a note under ${quote(note.heading, 80)} in doc ${note.id}, ${where}, with the day and your app under it.`, ...canvasLines(note.canvases)].join('\n'));
        }
    );

    defineTool(
        server,
        ctx,
        'replace_section',
        {
            title: 'Replace a section',
            description:
                'Rewrite one section of a doc: everything under the first heading with this text (any case, no #s) up to the next heading of the same or a higher level. ' +
                'Markdown starting with such a heading replaces the old one too (a rename); else only the body is replaced. ' +
                "An unknown heading fails with the doc's headings. Read the doc first (read_doc). " +
                'A ```canvas fence sent back with its %% id line (from read_doc) updates that board in place, keeping the boxes the user arranged (update_canvas does it without rewriting the section). ' +
                SAME_MARKDOWN,
            input: {
                docId: zDocId,
                heading: z.string().trim().min(1, 'heading is empty').max(300).describe('The text of the heading whose section to replace, e.g. "Complexity".'),
                markdown: zMarkdown.min(1, 'markdown is empty').describe('The new section content in Markdown.'),
            },
            annotations: CHANGES,
        },
        async ({ docId, heading, markdown }) => {
            const result = await api.post<SectionReplaced>(`/api/agent/docs/${docId}/replace-section`, { heading, markdown });
            return withUndo(
                [
                    `Replaced section ${quote(result.heading, 100)} in doc ${result.id}: removed ${plural(result.removed, 'block')}, inserted ${plural(result.inserted, 'block')}.`,
                    ...canvasLines(result.canvases),
                ].join('\n')
            );
        }
    );

    defineTool(
        server,
        ctx,
        'add_canvas',
        {
            title: 'Add a canvas (a diagram of boxes and arrows)',
            description:
                'Draw a diagram at the end of a doc that the user can drag, connect and edit: a system-design sketch, a request or data flow, a decision flow, a concept map. ' +
                'For sequence, ER, state, class or timeline diagrams use a ```mermaid fence with append_to_doc. ' +
                'It answers with what it drew and problems to fix (crossing arrows, a box with no arrows, too wide): fix them with update_canvas, look with preview_diagram. ' +
                'read_doc shows the board as a ```canvas fence with its id; update_canvas changes it in place (Undo takes it back), keeping what the user arranged. ' +
                'To put it under a heading, append the heading first, or write a ```canvas fence in any Markdown. ' +
                "The text form (shapes, arrows, zones, colours, kinds, notes) is in create_doc's Markdown guide, without the fence.",
            input: {
                docId: zDocId,
                diagram: z
                    .string()
                    .trim()
                    .min(1, 'diagram is empty')
                    .max(20_000, 'a diagram is at most 20 000 characters')
                    .describe('The diagram in Mermaid flowchart syntax, without the ``` fence, e.g. "flowchart LR\\n  web([Web]) -->|HTTPS| api[API]\\n  api --> db[(Postgres)]".'),
                height: z.number().int().min(240).max(1400).optional().describe('Height of the board in the doc, in pixels. Leave out: Recollect fits the board.'),
            },
            annotations: ADDS,
        },
        async ({ docId, diagram, height }) => {
            const result = await api.post<DocAppended>(`/api/agent/docs/${docId}/append`, { markdown: canvasFence(diagram, height) });
            return withUndo([`Added a canvas to doc ${result.id}.`, ...canvasLines(result.canvases)].join('\n'));
        }
    );

    defineTool(
        server,
        ctx,
        'update_canvas',
        {
            title: 'Change a canvas in place',
            description:
                "Change one canvas board of a doc by its id (read_doc shows it on the fence's first line: %% id: cv_…), keeping what the user arranged: boxes and arrows that stay keep their places and routes, " +
                'new boxes go next to what they connect to, zones grow to hold them. ' +
                'Either send small changes: add (lines in the canvas text form, e.g. "api --> cache[(Redis)]"; a box written again changes its label, shape, colour or kind; ' +
                '"subgraph tier … end" with an existing zone id puts new boxes in that zone), remove (box ids, their arrows go too; or arrows like "a --> b"), rename (box id → new label). ' +
                'Or send diagram: the whole new text (as read_doc printed it, edited). It answers like a write (size, zoom, problems to fix); the user can undo it.',
            input: {
                docId: zDocId,
                canvasId: z
                    .string()
                    .trim()
                    .regex(/^cv_[A-Za-z0-9_-]{12}$/, 'must be a canvas id like cv_Ab3dE6gH9jK0 (read_doc shows it on the fence’s first line)')
                    .describe('The canvas to change: the id on its fence’s first line in read_doc (%% id: cv_…).'),
                diagram: z.string().trim().min(1, 'diagram is empty').max(20_000, 'a diagram is at most 20 000 characters').optional().describe('The whole new diagram (text form, without the ``` fence). Not with add / remove / rename.'),
                add: z.string().trim().min(1, 'add is empty').max(20_000, 'add is at most 20 000 characters').optional().describe('Lines to add, in the canvas text form, e.g. "api --> q[[Jobs]]@{ kind: queue }\\nq --> w[Worker]".'),
                remove: z.array(z.string().trim().min(1).max(300)).min(1).max(300).optional().describe('Box ids to remove (with their arrows), or arrows written as "a --> b".'),
                rename: z.record(z.string().max(40), z.string().max(1000)).optional().describe('Box id → its new label, e.g. {"lb": "L7 load balancer"}.'),
                relayout: z
                    .boolean()
                    .optional()
                    .describe(
                        'true: lay the whole board out again instead of keeping every box where it is: needed for a new direction (flowchart TB / LR) or a board that reads badly. Boxes the user moved lose their places (they can undo). Leave out to keep the user’s arrangement.'
                    ),
            },
            annotations: CHANGES,
        },
        async ({ docId, canvasId, diagram, add, remove, rename, relayout }) => {
            const edits = add !== undefined || remove !== undefined || (rename !== undefined && Object.keys(rename).length > 0);
            if (diagram === undefined && !edits) throw new ToolError('Send diagram (the whole new text), or add, remove or rename.');
            if (diagram !== undefined && edits) throw new ToolError('Send diagram on its own, or add / remove / rename without it.');
            const body = {
                ...(diagram !== undefined ? { diagram: canvasBody(diagram) } : { ...(add !== undefined ? { add } : {}), ...(remove ? { remove } : {}), ...(rename ? { rename } : {}) }),
                ...(relayout ? { relayout: true } : {}),
            };
            const result = await api.post<CanvasUpdated>(`/api/agent/docs/${docId}/canvas/${canvasId}`, body);
            const lines = canvasLines(result.canvases);
            if (!result.editId) return [`Canvas ${result.canvasId} in doc ${result.id} is unchanged: the change gives the board it already has.`, ...lines].join('\n');
            return withUndo([`Updated canvas ${result.canvasId} in doc ${result.id}.`, ...lines].join('\n'));
        }
    );

    defineTool(
        server,
        ctx,
        'preview_diagram',
        {
            title: 'See a canvas',
            description:
                "A PNG of a doc's canvas board as the user sees it (boxes, zones, routed arrows, labels), with its report (size, zoom in a doc, problems to fix). " +
                'Use it to check a board after drawing or changing it. The first canvas of the doc without a canvasId. ' +
                'Mermaid blocks are drawn by the browser only: the server does not draw them yet.',
            input: {
                docId: zDocId,
                canvasId: z
                    .string()
                    .trim()
                    .regex(/^cv_[A-Za-z0-9_-]{12}$/, 'must be a canvas id like cv_Ab3dE6gH9jK0')
                    .optional()
                    .describe('The canvas (read_doc shows its id as %% id: cv_…); leave out for the first canvas of the doc.'),
                theme: z.enum(['light', 'dark']).optional().describe('light (default) or dark.'),
            },
            annotations: READ_ONLY,
        },
        async ({ docId, canvasId, theme }) => {
            const preview = await api.get<CanvasPreview>(`/api/agent/docs/${docId}/preview`, { canvasId, theme });
            return {
                content: [
                    { type: 'image', data: preview.png, mimeType: 'image/png' },
                    { type: 'text', text: `${canvasLine(preview.report)} (PNG ${preview.width}×${preview.height})` },
                ],
            };
        }
    );
}

/** The text form inside a fence the agent may have wrapped around it. */
function canvasBody(diagram: string): string {
    return diagram.replace(/^\s*(`{3,}|~{3,})\s*canvas[^\n]*\n([\s\S]*?)\n?\s*\1\s*$/i, '$2').replace(/\s+$/, '');
}
