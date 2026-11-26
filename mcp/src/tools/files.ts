// TOOL_ACCESS_PLAN §11.4 (11-27): files on a note (a note on a lesson or a subject: add_note, list_notes). Any file
// but a video, at most 10 MB, 20 a note. A coding tool attaches a file from the user's computer by its path (this
// process reads it); a web chat sends a file's text (md, csv, json…) or its bytes as base64 (at most 1 MB), since it
// can't pass on a file uploaded to it. Each attach and removal is undoable on Home.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ToolError } from '../errors.js';
import { quote, withUndo } from '../format.js';
import { zId } from '../schemas.js';
import { ADDS, CHANGES, READ_ONLY, defineTool, type ToolContext } from '../tool.js';

/** The API's limits (backend/src/services/learningDb/uploads.service.ts, agentNoteFiles.service.ts). */
export const FILE_MAX_BYTES = 10 * 1024 * 1024;
export const FILE_TEXT_MAX = 1_000_000;
export const FILE_BASE64_MAX = Math.ceil((1024 * 1024 * 4) / 3) + 64;
const VIDEO = /\.(mp4|mov|mkv|webm|avi|wmv|m4v|flv|mpg|mpeg|3gp)$/i;
export const PATH_ON_WEB = 'A path only works in a coding tool on their computer. Send the file’s text, or ask them to add the file in Kaaga.';

export interface NoteFile {
    n: number;
    name: string;
    type: string;
    size: number | null;
}

/** 48 KB, 3.1 MB, 812 B. */
export function sizeWords(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined) return 'size unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "2 files: budget.xlsx (48 KB), plan.md (3 KB)". */
export const filesLine = (files: readonly NoteFile[]): string => `${files.length} file${files.length === 1 ? '' : 's'}: ${files.map((f) => `${f.n}. ${f.name} (${sizeWords(f.size)})`).join(', ')}`;

const zNoteId = zId('note').describe('The note (list_notes shows its id).');

export function registerFileTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'attach_file',
        {
            title: 'Attach a file to a note',
            description:
                "Attach a file (an image, a sheet, a PDF, an md, any file but a video; at most 10 MB) to a note on a lesson or a subject. Send exactly one of: path (a file on the user's computer: coding tools only), text (the file's text, with name), base64 (its bytes, at most 1 MB, with name).",
            input: {
                noteId: zNoteId,
                path: z.string().trim().min(1).max(1000).optional().describe('A file on their computer (coding tools only).'),
                name: z.string().trim().min(1).max(200).optional().describe('The file name with its extension, e.g. "plan.md" (with text or base64).'),
                text: z.string().max(FILE_TEXT_MAX).optional(),
                base64: z.string().max(FILE_BASE64_MAX).optional(),
            },
            annotations: ADDS,
        },
        async ({ noteId, path: file, name, text, base64 }) => {
            const given = [file, text, base64].filter((x) => x !== undefined).length;
            if (given !== 1) throw new ToolError('Send exactly one of path, text or base64.');
            type Answer = { file: NoteFile; files: NoteFile[] };
            let r: Answer;
            if (file !== undefined) {
                if (ctx.set === 'web') throw new ToolError(PATH_ON_WEB);
                const full = path.resolve(file);
                let size: number;
                try {
                    const st = statSync(full);
                    if (!st.isFile()) throw new ToolError(`${full} is not a file.`);
                    size = st.size;
                } catch (err) {
                    if (err instanceof ToolError) throw err;
                    throw new ToolError(`Can't read ${full}: ${(err as NodeJS.ErrnoException).code ?? 'no such file'}.`);
                }
                if (VIDEO.test(full)) throw new ToolError("Videos can't be attached. Save the link instead.");
                if (size > FILE_MAX_BYTES) throw new ToolError(`Files can be at most 10 MB (this one is ${sizeWords(size)}).`);
                const form = new FormData();
                form.append('file', new Blob([readFileSync(full)]), name ?? path.basename(full));
                r = await api.postForm<Answer>(`/api/agent/notes/${encodeURIComponent(noteId)}/files`, form);
            } else {
                if (!name) throw new ToolError('Give the file a name with its extension (e.g. "plan.md").');
                r = await api.post<Answer>(`/api/agent/notes/${encodeURIComponent(noteId)}/files`, text !== undefined ? { name, text } : { name, base64 });
            }
            return withUndo(`Attached ${quote(r.file.name)} (${sizeWords(r.file.size)}) to note ${noteId}. Its ${filesLine(r.files)}.`);
        }
    );

    defineTool(
        server,
        ctx,
        'remove_file',
        {
            title: 'Take a file off a note',
            description: 'Take a file off a note, by its name or its number (list_notes shows them). Undo on Home puts it back.',
            input: { noteId: zNoteId, name: z.string().trim().min(1).max(200).optional(), n: z.number().int().min(1).max(100).optional().describe('Its number on the note.') },
            annotations: CHANGES,
        },
        async ({ noteId, name, n }) => {
            if ((name === undefined) === (n === undefined)) throw new ToolError('Name the file: name or n, one of them.');
            const r = await api.post<{ removed: string; files: NoteFile[] }>(`/api/agent/notes/${encodeURIComponent(noteId)}/files/remove`, name !== undefined ? { name } : { n });
            return withUndo(`Took ${quote(r.removed)} off note ${noteId}. ${r.files.length ? `Its ${filesLine(r.files)}.` : 'It has no files now.'}`);
        }
    );

    defineTool(
        server,
        ctx,
        'read_note_file',
        {
            title: 'Read a file on a note',
            description: 'Read a file attached to a note, by its number or name: a text file (md, csv, json, code…) answers its text; anything else its name, type, size and link.',
            input: { noteId: zNoteId, file: z.union([z.number().int().min(1).max(100), z.string().trim().min(1).max(200)]).describe('Its number on the note, or its name.') },
            annotations: READ_ONLY,
        },
        async ({ noteId, file }) => {
            const r = await api.get<{ n: number; name: string; type: string; size: number | null; url: string; text: string | null; cut: boolean }>(`/api/agent/notes/${encodeURIComponent(noteId)}/files/${encodeURIComponent(String(file))}`);
            const head = `${r.n}. ${r.name} · ${r.type} · ${sizeWords(r.size)}`;
            if (r.text === null) return `${head}\nNot a text file: its link is ${r.url}`;
            return `${head}${r.cut ? ' (the first 60,000 characters)' : ''}\n\n${r.text}`;
        }
    );
}
