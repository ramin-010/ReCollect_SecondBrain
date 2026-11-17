// Block tools (DOCS_EDITOR_V2_PLAN §5, phase 3): a doc's outline and its blocks changed by id, on the
// new editor. Listed with the docs since the switch (2026-11-15: every doc is on the new editor);
// move_blocks is on more_tools.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { plural, quote, withUndo } from '../format.js';
import { zDocId } from '../schemas.js';
import { ADDS, CHANGES, READ_ONLY, defineTool, type ToolContext } from '../tool.js';

interface OutlineBlock {
    id: string;
    type: string;
    depth: number;
    text: string;
    props?: Record<string, unknown>;
}

interface Outline {
    id: string;
    title: string;
    blocks: OutlineBlock[];
    canEdit: boolean;
}

interface Inserted {
    id: string;
    ids: string[];
    inserted: number;
    editId: string;
    canvases?: { canvasId?: string; problems?: string[] }[];
}

const zBlockId = z.string().trim().min(1).max(100).describe('A block id from get_outline.');
const zMarkdown = z.string().max(500_000, 'markdown is at most 500 000 characters');
const zWhere = z
    .object({
        after: zBlockId.optional(),
        before: zBlockId.optional(),
        under: zBlockId.optional().describe('Put them inside this block, as its last children (a sub-point of a list item, the body of a toggle).'),
        at: z.enum(['start', 'end']).optional(),
    })
    .describe('Exactly one of after, before, under (a block id) or at ("start" / "end" of the doc).');

const KIND: Record<string, string> = {
    paragraph: 'text',
    heading: 'heading',
    bulletListItem: 'bullet',
    numberedListItem: 'numbered',
    checkListItem: 'to-do',
    toggleListItem: 'toggle',
    quote: 'quote',
    codeBlock: 'code',
    diagram: 'diagram',
    canvas: 'canvas',
    callout: 'callout',
    image: 'image',
    table: 'table',
    divider: 'divider',
};

/** One outline line: indent, id, kind (with its level / kind / tick), first words. */
function outlineLine(b: OutlineBlock): string {
    const extra = b.props ? Object.entries(b.props).map(([k, v]) => (k === 'level' ? `h${String(v)}` : k === 'checked' ? (v ? 'done' : 'open') : String(v))) : [];
    const kind = [KIND[b.type] ?? b.type, ...extra].join(' ');
    return `${'  '.repeat(b.depth)}${b.id} · ${kind}${b.text ? ` · ${b.text}` : ''}`;
}

export function registerBlockTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'get_outline',
        {
            title: "A doc's blocks with their ids",
            description:
                'The blocks of a doc on the new editor, one line each: id · kind · first words, children indented under their parent. ' +
                'Use the ids with insert_blocks, update_block, move_blocks and delete_blocks to change one block without rewriting a section. ' +
                'read_doc gives the full text.',
            input: { docId: zDocId },
            annotations: READ_ONLY,
        },
        async ({ docId }) => {
            const o = await api.get<Outline>(`/api/agent/docs/${docId}/outline`);
            return [`${quote(o.title)} (doc ${o.id}), ${plural(o.blocks.length, 'block')}${o.canEdit ? '' : ', read only'}:`, ...o.blocks.map(outlineLine)].join('\n');
        }
    );

    defineTool(
        server,
        ctx,
        'insert_blocks',
        {
            title: 'Insert blocks',
            description:
                "Markdown (create_doc's dialect: callouts, toggles, ```mermaid and ```canvas fences, tables) as new blocks at an exact place: after, before or under a block id from get_outline, or at the start or end. " +
                'Live in an open doc; the user can undo it.',
            input: { docId: zDocId, markdown: zMarkdown.min(1, 'markdown is empty').describe('The blocks to add, in Markdown.'), where: zWhere },
            annotations: ADDS,
        },
        async ({ docId, markdown, where }) => {
            const r = await api.post<Inserted>(`/api/agent/docs/${docId}/blocks`, { markdown, where });
            const problems = (r.canvases ?? []).flatMap((c) => c.problems ?? []);
            return withUndo([`Inserted ${plural(r.inserted, 'block')} in doc ${r.id}: ${r.ids.join(', ')}.`, ...problems.map((p) => `Canvas: ${p}`)].join('\n'));
        }
    );

    defineTool(
        server,
        ctx,
        'update_block',
        {
            title: 'Change one block',
            description:
                'Change one block in place by its id: markdown (exactly one block: its kind and text replace the old ones, e.g. "## New title" or "- [x] done"), or props alone ' +
                '(level for a heading, checked for a to-do, kind for a callout: note, tip, important, warning, caution). Its children stay. A canvas changes with update_canvas.',
            input: {
                docId: zDocId,
                blockId: zBlockId,
                markdown: zMarkdown.optional().describe('One block of Markdown.'),
                props: z.record(z.string().max(40), z.union([z.string().max(500), z.number(), z.boolean()])).optional().describe('Props to set, e.g. {"level": 3} or {"checked": true}.'),
            },
            annotations: CHANGES,
        },
        async ({ docId, blockId, markdown, props }) => {
            const r = await api.patch<{ id: string; block: { id: string; type: string; markdown: string } | null }>(`/api/agent/docs/${docId}/blocks/${encodeURIComponent(blockId)}`, { markdown, props });
            return withUndo(`Changed block ${blockId} in doc ${r.id}${r.block ? `: ${r.block.markdown.split('\n')[0]?.slice(0, 120)}` : ''}.`);
        }
    );

    defineTool(
        server,
        ctx,
        'move_blocks',
        {
            title: 'Move blocks',
            description: 'Move blocks (with their children) by id to after, before or under another block, or to the start or end. They keep their ids.',
            input: { docId: zDocId, ids: z.array(zBlockId).min(1).max(200).describe('Block ids, in the order they should land.'), where: zWhere },
            annotations: CHANGES,
        },
        async ({ docId, ids, where }) => {
            const r = await api.post<{ id: string; moved: number }>(`/api/agent/docs/${docId}/blocks/move`, { ids, where });
            return withUndo(`Moved ${plural(r.moved, 'block')} in doc ${r.id}.`);
        }
    );

    defineTool(
        server,
        ctx,
        'delete_blocks',
        {
            title: 'Delete blocks',
            description: 'Delete blocks (with their children) by id. The user can undo it from Home.',
            input: { docId: zDocId, ids: z.array(zBlockId).min(1).max(200) },
            annotations: CHANGES,
        },
        async ({ docId, ids }) => {
            const r = await api.post<{ id: string; deleted: number }>(`/api/agent/docs/${docId}/blocks/delete`, { ids });
            return withUndo(`Deleted ${plural(r.deleted, 'block')} from doc ${r.id}.`);
        }
    );
}
