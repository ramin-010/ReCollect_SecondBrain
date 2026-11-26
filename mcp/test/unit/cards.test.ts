// TOOL_ACCESS_PLAN §4.1-§4.2, §8: every tool has a card; its example is valid for the tool's own schema (on the door
// whose card it is); its `not` names real tools; every tool is in exactly one area; the signature printer reads the
// shapes the tools use.
import { describe, expect, it } from 'vitest';
import { signatureOf } from '../../src/card.js';
import { AREAS, CARDS, WEB_CARDS } from '../../src/cards.js';
import { KaagaApi } from '../../src/api.js';
import { createKaagaServer, TOOL_NAMES, type ToolName } from '../../src/server.js';

type Schema = { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } };

describe('the cards', () => {
    it('every tool has one, with use, returns and keywords', () => {
        for (const name of TOOL_NAMES) {
            const c = CARDS[name];
            expect(c, name).toBeDefined();
            expect(c.use.length, name).toBeGreaterThan(10);
            expect(c.returns.length, name).toBeGreaterThan(5);
            expect(c.keywords.length, name).toBeGreaterThan(0);
        }
    });

    it("its `not` names only real tools, and never the tool itself", () => {
        const names = new Set<string>(TOOL_NAMES);
        for (const [name, c] of [...Object.entries(CARDS), ...Object.entries(WEB_CARDS)]) {
            for (const word of (c?.not ?? '').match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []) {
                expect(names.has(word), `${name}: "${word}"`).toBe(true);
                expect(word, name).not.toBe(name);
            }
        }
    });

    it("every example is valid for the tool's own schema (the code door's; the web's own cards on the web)", () => {
        const api = new KaagaApi({ baseUrl: 'http://kaaga.test', token: `rcl_${'a'.repeat(43)}`, agentName: 'test', log: () => {} });
        for (const set of ['code', 'web'] as const) {
            const server = createKaagaServer({ api, agentName: 'test', set });
            const tools = (server as unknown as { _registeredTools: Record<string, { inputSchema?: Schema }> })._registeredTools;
            for (const [name, tool] of Object.entries(tools)) {
                const card = (set === 'web' ? WEB_CARDS[name as ToolName] : undefined) ?? CARDS[name as ToolName];
                if (!card || !tool.inputSchema) continue;
                const r = tool.inputSchema.safeParse(card.example);
                expect(r.success, `${set} ${name}: ${JSON.stringify(r.error?.issues ?? [])}`).toBe(true);
            }
        }
    });

    it('every tool is in exactly one area', () => {
        const seen = new Map<string, string>();
        for (const [area, names] of Object.entries(AREAS)) {
            for (const n of names) {
                expect(seen.has(n), `${n} in ${seen.get(n)} and ${area}`).toBe(false);
                seen.set(n, area);
            }
        }
        expect([...seen.keys()].sort()).toEqual([...TOOL_NAMES].sort());
    });
});

describe('signatureOf', () => {
    it('prints a tool’s inputs in one line: optional marks, enums, days, arrays, one level of objects', () => {
        expect(
            signatureOf({
                type: 'object',
                properties: {
                    at: { type: 'string' },
                    taskId: { type: 'string' },
                    ring: { type: 'boolean' },
                    repeat: { type: 'string', enum: ['daily', 'weekdays', 'weekly'] },
                    day: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
                    ids: { type: 'array', items: { type: 'string' } },
                    due: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                    score: { type: 'object', properties: { done: { type: 'integer' }, total: { type: 'integer' } }, required: ['done', 'total'] },
                },
                required: ['at'],
            })
        ).toBe('{ at: string, taskId?: string, ring?: boolean, repeat?: "daily" | "weekdays" | "weekly", day?: "YYYY-MM-DD", ids?: string[], due?: string | null, score?: { done: number, total: number } }');
        expect(signatureOf({ type: 'object', properties: {} })).toBe('{}');
    });
});
