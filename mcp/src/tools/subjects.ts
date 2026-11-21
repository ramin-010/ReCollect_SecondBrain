// Subjects: the library's left-hand grouping (DSA, System Design, Backend, AI, Work …).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { plural, quote, withUndo } from '../format.js';
import { zSubjectName } from '../schemas.js';
import { findSubject, listSubjects } from '../subjects.js';
import { ADDS, READ_ONLY, defineTool, type ToolContext } from '../tool.js';
import type { Subject } from '../types.js';

export function registerSubjectTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'list_subjects',
        {
            title: 'List subjects',
            description: "The user's subjects (how their docs are grouped for revision), oldest first, with their ids and how many docs (topics) each holds.",
            input: {},
            annotations: READ_ONLY,
        },
        async () => {
            const subjects = await listSubjects(api);
            if (subjects.length === 0) return 'No subjects yet (create_subject adds one).';
            return [
                `${plural(subjects.length, 'subject')}:`,
                ...subjects.map((s) => `- ${s.name} · ${plural(s.topics?.length ?? 0, 'topic')} · id ${s._id}`),
            ].join('\n');
        }
    );

    defineTool(
        server,
        ctx,
        'create_subject',
        {
            title: 'Create a subject',
            description:
                'Add a subject to group docs under (e.g. "System Design"). If a subject with that name exists already (case-insensitive), nothing is created and its id is returned.',
            input: { name: zSubjectName.describe('The subject name, e.g. "System Design".') },
            annotations: ADDS,
        },
        async ({ name }) => {
            const existing = findSubject(await listSubjects(api), name);
            if (existing) return `Subject ${quote(existing.name, 60)} already exists (id ${existing._id}). Nothing created.`;
            const subject = await api.post<Subject>('/api/subjects', { name: name.replace(/\s+/g, ' ') });
            return withUndo(`Created subject ${quote(subject.name, 60)} · id ${subject._id}.`);
        }
    );
}
