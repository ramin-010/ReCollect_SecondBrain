// Subjects by NAME (agents think in names, the API in ids): case-insensitive, spaces ignored.
import type { RecollectApi } from './api.js';
import { ToolError, describeError } from './errors.js';
import { nameList, quote } from './format.js';
import type { Subject } from './types.js';

export interface ResolvedSubject {
    id: string;
    name: string;
    /** Made by this call (create_subject_if_missing). */
    created: boolean;
}

const key = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

export function listSubjects(api: RecollectApi): Promise<Subject[]> {
    return api.get<Subject[]>('/api/subjects');
}

/** The first (oldest) subject with this name. */
export function findSubject(subjects: readonly Subject[], name: string): Subject | undefined {
    const wanted = key(name);
    return subjects.find((s) => key(s.name) === wanted);
}

export async function resolveSubject(api: RecollectApi, name: string, options: { createIfMissing?: boolean | undefined } = {}): Promise<ResolvedSubject> {
    const subjects = await listSubjects(api);
    const found = findSubject(subjects, name);
    if (found) return { id: found._id, name: found.name, created: false };
    if (!options.createIfMissing) {
        throw new ToolError(
            `No subject named ${quote(name, 60)}. Subjects: ${nameList(subjects.map((s) => s.name))}. ` +
                'Call create_subject first, or pass create_subject_if_missing: true.'
        );
    }
    const created = await api.post<Subject>('/api/subjects', { name: name.trim().replace(/\s+/g, ' ') });
    return { id: created._id, name: created.name, created: true };
}

/**
 * The write that follows resolveSubject. If create_subject_if_missing made the subject and this
 * write then fails, the error says the subject exists now (so the agent's picture stays true).
 */
export async function afterSubject<T>(api: RecollectApi, subject: ResolvedSubject | null, write: Promise<T>): Promise<T> {
    try {
        return await write;
    } catch (err) {
        if (!subject?.created) throw err;
        throw new ToolError(`${describeError(err, api.baseUrl)} (The subject ${quote(subject.name, 60)} was created first and stays: id ${subject.id}.)`);
    }
}

/** Every name must exist (goals link only existing subjects). */
export async function resolveSubjects(api: RecollectApi, names: readonly string[]): Promise<ResolvedSubject[]> {
    if (names.length === 0) return [];
    const subjects = await listSubjects(api);
    const found: ResolvedSubject[] = [];
    const missing: string[] = [];
    for (const name of names) {
        const subject = findSubject(subjects, name);
        if (!subject) missing.push(name);
        else if (!found.some((s) => s.id === subject._id)) found.push({ id: subject._id, name: subject.name, created: false });
    }
    if (missing.length > 0) {
        throw new ToolError(
            `No subject named ${nameList(missing)}. Subjects: ${nameList(subjects.map((s) => s.name))}. Call create_subject first.`
        );
    }
    return found;
}
