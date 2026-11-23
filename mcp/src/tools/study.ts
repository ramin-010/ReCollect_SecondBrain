// The study flow (STUDY_FLOW_PLAN, 11-23), in the manage group (the study skill calls more_tools first): a lesson's
// revision card, and the notes and links on a lesson or a subject (the app's own notes: the doc's right sidebar shows
// a lesson's, its subject page a subject's). Every write is logged with an Undo on Home.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ToolError } from '../errors.js';
import { dayOf, plural, quote, withUndo } from '../format.js';
import { userTimeZone } from '../timezone.js';
import { zDocId, zId, zMarkdown, zSubjectName } from '../schemas.js';
import { ADDS, CHANGES, READ_ONLY, defineTool, type ToolContext } from '../tool.js';
import { canvasLine } from './docs.js';
import type { CanvasReport } from '../types.js';

/** The API's limits (backend/src/services/agent/agentNotes.service.ts, docCard.ts). */
export const NOTE_TITLE_MAX = 120;
export const NOTE_TEXT_MAX = 8000;
export const CARD_MAX = 12_000;

interface CardWritten {
    id: string;
    heading: string;
    replaced: boolean;
    blocks: number;
    editId: string;
    canvases?: CanvasReport[];
}

interface Lesson {
    docId: string | null;
    title: string | null;
}

interface NoteItem {
    id: string;
    kind: 'note' | 'link';
    title: string;
    url: string | null;
    text: string;
    day: string;
    by: string;
    lesson: Lesson | null;
    subject: string | null;
}

interface NoteAdded {
    id: string;
    kind: 'note' | 'link';
    title: string;
    lesson: Lesson | null;
    subject: string;
    already?: true;
    editId: string | null;
}

interface NotesList {
    place: { lesson: Lesson | null; subject: string | null } | null;
    notes: NoteItem[];
    more: number | null;
    message?: string;
}

interface NoteChanged extends NoteItem {
    editId: string;
}

interface NoteRemoved {
    id: string;
    removed: true;
    into: string | null;
    editId: string;
}

const zNoteId = zId('note').describe('The note id (list_notes shows it).');
const zTitle = z.string().trim().min(1, 'A note needs a title').max(NOTE_TITLE_MAX);
const zUrl = z.string().trim().url('url must be a web address').max(2048);

const where = (lesson: Lesson | null, subject: string | null | undefined): string =>
    lesson?.docId ? `the lesson ${quote(lesson.title ?? 'its doc', 80)} (doc ${lesson.docId})` : `the subject ${subject ?? '?'}`;

export function registerStudyTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'set_revision_card',
        {
            title: 'Write the revision card',
            description:
                "When a lesson is complete: write its revision card (5-10 key points, the one diagram that carries it, 4-8 check-yourself toggles) as the doc's last section. " +
                "Each review shows it first. Call again to replace it. It doesn't start reviews: ask, then schedule_revision.",
            input: {
                docId: zDocId,
                markdown: zMarkdown.min(1, 'The card is empty').max(CARD_MAX).describe('The card in Markdown (no title: the tool writes the heading).'),
            },
            annotations: CHANGES,
        },
        async ({ docId, markdown }) => {
            const card = await api.put<CardWritten>(`/api/agent/docs/${docId}/card`, { markdown });
            const lines = [`${card.replaced ? 'Replaced' : 'Wrote'} the revision card (${plural(card.blocks, 'block')}) under ${quote(card.heading, 60)} at the end of doc ${card.id}. Each review opens it first.`];
            lines.push(...(card.canvases ?? []).map(canvasLine));
            return withUndo(lines.join('\n'));
        }
    );

    defineTool(
        server,
        ctx,
        'add_note',
        {
            title: 'Add a note or a link',
            description:
                "Save a note (or, with url, a link) on a lesson (docId) or a whole subject (subject): something worth keeping that doesn't belong in the lesson's text. Their word is enough; say where it went.",
            input: {
                docId: zDocId.optional().describe('The lesson: its doc id.'),
                subject: zSubjectName.optional().describe('Or the subject, by name.'),
                title: zTitle.describe('A short title.'),
                markdown: z.string().max(NOTE_TEXT_MAX).optional().describe('The note (Markdown: headings, lists, code).'),
                url: zUrl.optional().describe('A link to keep (a video, a page).'),
            },
            annotations: ADDS,
        },
        async ({ docId, subject, title, markdown, url }) => {
            if (!!docId === !!subject) throw new ToolError('Give docId (a lesson) or subject (its name), one of them.');
            if (!markdown?.trim() && !url) throw new ToolError('Send the note (markdown) or a link (url).');
            const note = await api.post<NoteAdded>('/api/agent/notes', { ...(docId ? { docId } : { subject }), title, ...(markdown ? { markdown } : {}), ...(url ? { url } : {}) });
            if (note.already) return `Already saved on ${where(note.lesson, note.subject)}: ${quote(note.title, 80)} · id ${note.id}. Nothing added.`;
            return withUndo(`Saved ${note.kind === 'link' ? 'the link' : 'the note'} ${quote(note.title, 80)} on ${where(note.lesson, note.subject)} · id ${note.id}.`);
        }
    );

    defineTool(
        server,
        ctx,
        'list_notes',
        {
            title: 'Read notes',
            description: "The notes and links of a lesson (docId) or a subject (subject; lessons: true adds its lessons'), or the ones named (ids), with their full text.",
            input: {
                docId: zDocId.optional().describe('A lesson: its doc id.'),
                subject: zSubjectName.optional().describe('A subject, by name.'),
                lessons: z.boolean().optional().describe("With subject: its lessons' notes too."),
                ids: z.array(zId('note')).max(100).optional().describe('These notes.'),
                cursor: z.number().int().min(0).optional().describe('From an earlier answer: the rest.'),
            },
            annotations: READ_ONLY,
        },
        async ({ docId, subject, lessons, ids, cursor }) => {
            if (!docId && !subject && !ids?.length) throw new ToolError('Say which notes: docId (a lesson), subject, or ids.');
            const params = new URLSearchParams();
            if (ids?.length) params.set('ids', ids.join(','));
            else if (docId) params.set('docId', docId);
            else if (subject) params.set('subject', subject);
            if (lessons) params.set('lessons', '1');
            if (cursor) params.set('cursor', String(cursor));
            const [list, zone] = await Promise.all([api.get<NotesList>(`/api/agent/notes?${params.toString()}`), userTimeZone(api)]);
            if (!list.place && !ids?.length) return "That doc isn't on a subject's path yet, so it has no notes.";
            const head = ids?.length ? `${plural(list.notes.length, 'note')} of the ${ids.length} asked for` : `${plural(list.notes.length, 'note')} on ${where(list.place?.lesson ?? null, list.place?.subject)}`;
            if (!list.notes.length) return `${head}.`;
            const blocks = list.notes.map((n) => {
                const meta = [`id ${n.id}`, n.kind, dayOf(n.day, zone), n.by === 'the user' ? 'theirs' : `by ${n.by}`];
                if (n.lesson && !docId) meta.push(`lesson ${quote(n.lesson.title ?? '', 60)}`);
                const body = [n.url ? `<${n.url}>` : '', n.text.trim()].filter(Boolean).join('\n');
                return `### ${n.title}\n(${meta.join(' · ')})${body ? `\n${body}` : ''}`;
            });
            const more = list.more !== null ? `\n\nMore: call again with cursor ${list.more}.` : '';
            return `${head}:\n\n${blocks.join('\n\n')}${more}`;
        }
    );

    defineTool(
        server,
        ctx,
        'update_note',
        {
            title: 'Change a note',
            description: "Change a note's title, text or link, or move it to another lesson or subject.",
            input: {
                id: zNoteId,
                title: zTitle.optional(),
                markdown: z.string().max(NOTE_TEXT_MAX).optional().describe('Its whole new text.'),
                url: zUrl.optional(),
                docId: zDocId.optional().describe('Move it to this lesson.'),
                subject: zSubjectName.optional().describe('Or to this subject.'),
            },
            annotations: CHANGES,
        },
        async ({ id, title, markdown, url, docId, subject }) => {
            if (docId && subject) throw new ToolError('Move it to a lesson (docId) or a subject, not both.');
            if (title === undefined && markdown === undefined && url === undefined && !docId && !subject) throw new ToolError('Send what changes: title, markdown, url, docId or subject.');
            // The API's 404 names what is missing (the note, the lesson or the subject).
            const note = await api.patch<NoteChanged>(`/api/agent/notes/${id}`, {
                ...(title !== undefined ? { title } : {}),
                ...(markdown !== undefined ? { markdown } : {}),
                ...(url !== undefined ? { url } : {}),
                ...(docId ? { docId } : {}),
                ...(subject ? { subject } : {}),
            });
            return withUndo(`Changed the note ${quote(note.title, 80)} on ${where(note.lesson, note.subject)} · id ${note.id}.`);
        }
    );

    defineTool(
        server,
        ctx,
        'remove_note',
        {
            title: 'Remove a note',
            description: 'Remove a note; into names the note it was merged into (write the merged text there first with update_note). Undoable from Home.',
            input: {
                id: zNoteId,
                into: zId('note').optional().describe('The note that now holds its text.'),
            },
            annotations: CHANGES,
        },
        async ({ id, into }) => {
            const done = await api.post<NoteRemoved>(`/api/agent/notes/${id}/remove`, into ? { into } : {});
            return withUndo(done.into ? `Merged note ${done.id} into ${done.into}.` : `Removed note ${done.id}.`);
        }
    );
}
