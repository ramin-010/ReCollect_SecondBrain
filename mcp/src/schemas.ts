// Shared input schemas. Checked here so a bad id or date gets a clear message instead of a
// confusing API answer (an id with odd characters would not even match the API's token routes).
import { z } from 'zod';

const isCalendarDay = (value: string): boolean => {
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return false;
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

// Ids are checked with refine, not regex: the same check and message, but no `pattern` in every id
// field of the tool definitions each chat loads (the catalogue's size budget, catalogue.test.ts).
export const zDocId = z
    .string()
    .trim()
    .refine((v) => /^[A-Za-z0-9]{1,128}$/.test(v), 'must be a doc id as search_docs shows it (letters and digits)')
    .describe('Doc id (search_docs shows it)');

export const zId = (what: string) =>
    z
        .string()
        .trim()
        .refine((v) => /^[A-Za-z0-9_-]{1,128}$/.test(v), `must be a ${what} id (letters, digits, - and _)`);

export const zDay = z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date 'YYYY-MM-DD'")
    .refine(isCalendarDay, 'must be a real calendar date');

export const zSubjectName = z.string().trim().min(1, 'subject name is empty').max(100);

/** The API caps agent Markdown at 500 000 characters. */
export const zMarkdown = z.string().max(500_000, 'markdown is at most 500 000 characters');
