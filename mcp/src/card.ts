// TOOL_ACCESS_PLAN §4.1-§4.2: a tool's card (what find_tools answers about it) and the signature printer. Nothing
// of a card enters tools/list: an unlisted tool's card costs no budget, so it can be complete.

export interface ToolCard {
    /** When to reach for it: the user's words that mean it, in quotes. */
    use: string;
    /** What it is not for, naming the tool that is. */
    not?: string;
    /** A note per input the schema does not explain. */
    params?: Readonly<Record<string, string>>;
    /** What the answer holds, and the ids it gives for which next call. */
    returns: string;
    /** One valid args object (a test parses it with the tool's schema). */
    example: Readonly<Record<string, unknown>>;
    /** Words people say that the description lacks ("delete", "course", "standup"). */
    keywords: readonly string[];
}

type Json = Record<string, unknown>;

const DAY = /^\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$$/;
const DAY_TIME = /\\d\{4\}-\\d\{2\}-\\d\{2\}\(T/;

/** One schema as a short type: string, "a" | "b", T[], "YYYY-MM-DD", { a: string }… */
function typeOf(s: Json | undefined, depth: number): string {
    if (!s || typeof s !== 'object') return 'any';
    if (Array.isArray(s['anyOf'])) return [...new Set((s['anyOf'] as Json[]).map((x) => typeOf(x, depth)))].join(' | ');
    if (Array.isArray(s['enum'])) return (s['enum'] as unknown[]).map((v) => JSON.stringify(v)).join(' | ');
    const t = s['type'];
    if (Array.isArray(t)) return t.map((x) => typeOf({ ...s, type: x }, depth)).join(' | ');
    if (t === 'string') {
        const p = typeof s['pattern'] === 'string' ? s['pattern'] : '';
        if (DAY.test(p)) return '"YYYY-MM-DD"';
        if (DAY_TIME.test(p)) return '"YYYY-MM-DD" | "YYYY-MM-DDTHH:mm"';
        if (/^\^cv_/.test(p)) return '"cv_…"';
        if (/\\d\{1,2\}:\\d\{2\}/.test(p)) return '"HH:mm"';
        return 'string';
    }
    if (t === 'integer' || t === 'number') return 'number';
    if (t === 'boolean') return 'boolean';
    if (t === 'null') return 'null';
    if (t === 'array') {
        const inner = typeOf(s['items'] as Json | undefined, depth);
        return inner.includes(' | ') ? `(${inner})[]` : `${inner}[]`;
    }
    if (t === 'object') {
        const props = s['properties'] as Record<string, Json> | undefined;
        if (!props || depth >= 1) return 'object';
        return shapeOf(s, depth + 1);
    }
    return 'any';
}

function shapeOf(schema: Json, depth: number): string {
    const props = (schema['properties'] ?? {}) as Record<string, Json>;
    const required = new Set((schema['required'] ?? []) as string[]);
    const parts = Object.entries(props).map(([k, v]) => `${k}${required.has(k) ? '' : '?'}: ${typeOf(v, depth)}`);
    return parts.length ? `{ ${parts.join(', ')} }` : '{}';
}

/** A tool's inputs in one line: `{ at: string, taskId?: string, ring?: boolean, repeat?: "daily" | "weekdays" }`. */
export function signatureOf(inputSchema: Json | undefined): string {
    return shapeOf(inputSchema ?? {}, 0);
}

export const LEVEL_WORDS: Readonly<Record<1 | 2 | 3, string>> = { 1: 'reads', 2: 'changes (Undo)', 3: 'asks for their tap' };

export interface CardFacts {
    name: string;
    title: string;
    level: 1 | 2 | 3;
    inputSchema: Json | undefined;
    card: ToolCard;
    /** listed: call it directly. found: through a runner (the web), or turned on for this chat (code). */
    how: 'listed' | 'runner' | 'turned_on';
    /** The runner that runs it on this door (use_read_tool for a read on the web, else use_tool). */
    runner: 'use_tool' | 'use_read_tool';
}

/** The card as find_tools answers it (TOOL_ACCESS_PLAN §3.1). */
export function renderCard(f: CardFacts): string {
    const how = f.how === 'listed' ? 'listed: call it directly' : f.how === 'turned_on' ? 'in your list now' : `run with ${f.runner}`;
    const lines = [`${f.name} · ${f.title} · ${LEVEL_WORDS[f.level]} · ${how}`, `Use when: ${f.card.use}`];
    if (f.card.not) lines.push(`Not for: ${f.card.not}`);
    const notes = Object.entries(f.card.params ?? {}).map(([k, v]) => `${k}: ${v}`);
    lines.push(`Args: ${signatureOf(f.inputSchema)}${notes.length ? `   ${notes.join('; ')}` : ''}`);
    const args = JSON.stringify(f.card.example);
    lines.push(`Example: ${f.how === 'runner' ? `${f.runner} {"name":"${f.name}","args":${args}}` : `${f.name} ${args}`}`);
    lines.push(`Answers: ${f.card.returns}`);
    return lines.join('\n');
}
