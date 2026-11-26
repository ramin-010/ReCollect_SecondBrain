// TOOL_ACCESS_PLAN §3: three small tools open the whole catalogue, with no memory between calls, so they work on the
// stateless web door and on any MCP client.
//   find_tools     the tools (and the steps) for a job in plain words; without a query, the catalogue by area
//   use_read_tool  runs a tool that only reads (readOnlyHint: true, so ChatGPT doesn't ask approval for a read)
//   use_tool       runs any other tool (it adds or changes something, or only asks for their tap)
// A runner's call goes the way a direct call goes (the door's checks, the tool's own inputs, levels, the edit log,
// Undo), through ctx.callTool.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { renderCard, LEVEL_WORDS } from '../card.js';
import { AREAS, CARDS, WEB_CARDS } from '../cards.js';
import { buildIndex, search, words, type FindEntry, type FindIndex } from '../find.js';
import { PLAYBOOKS, type Playbook } from '../playbooks.js';
import { READ_ONLY, defineTool, errorResult, type CatalogueEntry, type ToolContext, type Via } from '../tool.js';
import type { ToolName } from '../server.js';

/** The runners themselves are never search results. */
const RUNNER_NAMES = new Set(['find_tools', 'use_read_tool', 'use_tool']);
/** How long the catalogue without a query may run. */
const CATALOGUE_MAX = 6000;

export const FIND_TOOLS_DESCRIPTION =
    'Kaaga has many more tools than are listed: goals, the week, reviews, doc editing and diagrams, lesson notes, the trash, sharing, settings. Say the job in plain words ("delete a doc", "move a review to Friday"): it answers the tools that fit, with inputs and an example, and the steps of a job with steps. No query: the catalogue by area.';

const card = (name: string, set: ToolContext['set']) => (set === 'web' ? WEB_CARDS[name as ToolName] : undefined) ?? CARDS[name as ToolName];

interface DoorIndex {
    entries: Map<string, CatalogueEntry>;
    tools: FindIndex;
}
const INDEXES = new Map<string, Promise<DoorIndex>>();
const PLAYBOOK_INDEX = buildIndex(PLAYBOOKS.map((p) => ({ name: p.id, title: p.title, description: '', use: p.triggers.join('. '), keywords: p.triggers, params: [], level: 0 as const })));

/** The door's search index: built once per process per door from the tools it can reach. */
function indexFor(ctx: ToolContext): Promise<DoorIndex> {
    const key = ctx.set ?? 'code';
    let built = INDEXES.get(key);
    if (!built) {
        built = (ctx.catalogue?.() ?? Promise.resolve([])).then((list) => {
            const tools = list.filter((t) => !RUNNER_NAMES.has(t.name));
            const entries: FindEntry[] = tools.map((t) => {
                const c = card(t.name, ctx.set);
                const props = (t.inputSchema['properties'] ?? {}) as Record<string, unknown>;
                return { name: t.name, title: t.title, description: t.description, use: c?.use ?? '', keywords: c?.keywords ?? [], params: Object.keys(props), level: t.level };
            });
            return { entries: new Map(tools.map((t) => [t.name, t])), tools: buildIndex(entries) };
        });
        built.catch(() => INDEXES.delete(key));
        INDEXES.set(key, built);
    }
    return built;
}

/** Each playbook's triggers as words (stop words out, stemmed), and as plain text. */
const TRIGGERS = PLAYBOOKS.map((p) => ({ p, phrases: p.triggers.map((t) => ({ text: t.toLowerCase().replace(/[’']/g, ''), words: words(t) })) }));

/**
 * The playbook a query asks for, when one clearly fits: a trigger said as it is ("quiz me"), or every word of a
 * trigger of two words or more ("targets … week"), or half the query's words and at least two of them.
 */
export function playbookFor(query: string): Playbook | null {
    const raw = query.toLowerCase().replace(/[’']/g, '');
    const q = new Set(words(query));
    let best: Playbook | null = null;
    let bestLen = 0;
    for (const { p, phrases } of TRIGGERS) {
        for (const t of phrases) {
            const said = raw.includes(t.text);
            const all = t.words.length >= 2 && t.words.every((w) => q.has(w));
            const len = said ? t.words.length + 1 : all ? t.words.length : 0;
            if (len > bestLen) {
                best = p;
                bestLen = len;
            }
        }
    }
    if (best) return best;
    const [hit] = search(PLAYBOOK_INDEX, query, 1, { countAll: true });
    if (!hit || hit.coverage < 0.5 || hit.coverage * q.size < 2) return null;
    return PLAYBOOKS.find((p) => p.id === hit.entry.name) ?? null;
}

function areaLines(names: ReadonlySet<string>, entries: Map<string, CatalogueEntry>, full: boolean): string[] {
    const lines: string[] = [];
    for (const [area, tools] of Object.entries(AREAS)) {
        const here = tools.filter((n) => names.has(n));
        if (!here.length) continue;
        if (!full) {
            lines.push(`${area}: ${here.join(', ')}`);
            continue;
        }
        lines.push(`${area}:`);
        for (const n of here) {
            const e = entries.get(n);
            lines.push(`  ${n} · ${e?.title ?? n} · ${LEVEL_WORDS[e?.level ?? 2]}`);
        }
    }
    return lines;
}

export function registerFindTools(server: McpServer, ctx: ToolContext): void {
    defineTool(
        server,
        ctx,
        'find_tools',
        {
            title: 'Find the Kaaga tool for a job',
            description: FIND_TOOLS_DESCRIPTION,
            input: {
                query: z.string().trim().max(200).optional().describe('The job, in plain words.'),
                limit: z.number().int().min(1).max(8).optional().describe('Default 5.'),
            },
            annotations: READ_ONLY,
        },
        async ({ query, limit }) => {
            const { entries, tools } = await indexFor(ctx);
            const reachable = new Set([...entries.keys()].filter((n) => ctx.policy?.reachable.has(n)));
            const listed = ctx.policy?.listed ?? new Set<string>();
            const runnerFor = (level: 1 | 2 | 3): 'use_tool' | 'use_read_tool' => (level === 1 && ctx.set === 'web' ? 'use_read_tool' : 'use_tool');
            if (!query) {
                const lines = [`Kaaga's tools by area (${reachable.size}). Listed ones you can call directly; the others run with ${ctx.set === 'web' ? 'use_tool (use_read_tool for one that only reads)' : 'use_tool'}. find_tools with a job in plain words shows a tool's inputs and an example.`, ...areaLines(reachable, entries, true)];
                let text = lines.join('\n');
                if (text.length > CATALOGUE_MAX) text = [lines[0], ...areaLines(reachable, entries, false)].join('\n');
                return text;
            }
            const hits = search(tools, query, limit ?? 5).filter((h) => reachable.has(h.entry.name));
            const playbook = playbookFor(query);
            if (!hits.length && !playbook) return [`Nothing matches ${JSON.stringify(query)}. The tools by area:`, ...areaLines(reachable, entries, false)].join('\n');
            // The coding door turns what it found on for this chat (the client is told the list changed).
            const added = new Set<string>();
            if (ctx.set === 'code') {
                for (const h of hits) {
                    if (!listed.has(h.entry.name)) {
                        listed.add(h.entry.name);
                        added.add(h.entry.name);
                    }
                }
                if (added.size) ctx.listChanged?.();
            }
            const parts: string[] = [];
            if (playbook) parts.push(`How to do it: ${playbook.title}\n${playbook.steps}`);
            const cards = hits.map((h) => {
                const e = entries.get(h.entry.name)!;
                const c = card(e.name, ctx.set);
                if (!c) return `${e.name} · ${e.title}`;
                const how = added.has(e.name) ? 'turned_on' : listed.has(e.name) ? 'listed' : 'runner';
                return renderCard({ name: e.name, title: e.title, level: e.level, inputSchema: e.inputSchema, card: c, how, runner: runnerFor(e.level) });
            });
            if (cards.length) parts.push(cards.join('\n\n'));
            return parts.join('\n\n');
        }
    );

    const runner = (via: Exclude<Via, 'direct'>) => async ({ name, args }: { name: string; args?: Record<string, unknown> | undefined }, extra: unknown): Promise<CallToolResult> => {
        if (ctx.problem) return errorResult(ctx.problem);
        const target = name.trim();
        if (RUNNER_NAMES.has(target)) return errorResult(`${target} is called directly, not through ${via}.`);
        const entry = (await indexFor(ctx)).entries.get(target);
        if (via === 'use_read_tool' && entry && entry.level !== 1) return errorResult(`${target} changes something: call use_tool with the same name and args.`);
        if (!ctx.callTool) return errorResult('This server can’t run tools by name.');
        return ctx.callTool(target, args ?? {}, extra, via);
    };
    // A host may send args as a JSON string: it is read once; the listed schema says object.
    const argsSchema = z
        .preprocess((v) => {
            if (typeof v !== 'string') return v;
            try {
                return JSON.parse(v) as unknown;
            } catch {
                return v;
            }
        }, z.record(z.string(), z.unknown()))
        .optional()
        .describe('Its inputs, as its card shows.');
    const nameSchema = z.string().trim().min(1).max(80).describe('A tool name from find_tools.');

    const read = server.registerTool(
        'use_read_tool',
        {
            title: 'Run a Kaaga tool that only reads',
            description: 'Run a Kaaga tool that only reads, by the name find_tools (or an answer) gave. args: its inputs. One that changes something runs with use_tool.',
            inputSchema: { name: nameSchema, args: argsSchema },
            annotations: { ...READ_ONLY },
        },
        runner('use_read_tool')
    );
    ctx.registry?.set('use_read_tool', read);
    const write = server.registerTool(
        'use_tool',
        {
            title: 'Run any Kaaga tool',
            description: 'Run a Kaaga tool that adds or changes something (the user can undo it on Home) or only asks for their tap, by the name find_tools (or an answer) gave. args: its inputs.',
            inputSchema: { name: nameSchema, args: argsSchema },
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        },
        runner('use_tool')
    );
    ctx.registry?.set('use_tool', write);
}
