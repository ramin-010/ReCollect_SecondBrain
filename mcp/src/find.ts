// TOOL_ACCESS_PLAN §3.1: the search behind find_tools. Pure and deterministic: no network, no embeddings, no clock.
// Each tool is indexed by its name (split on _), title, card keywords, card `use`, its listed description and its
// parameter names; a query's words are matched against those fields with weights, rarer words counting for more.
// Misses are fixed in the cards (keywords, use), never by special cases here (plan §7.1).

/** One searchable thing: a tool, or a playbook (a job with steps). */
export interface FindEntry {
    name: string;
    title: string;
    description: string;
    /** card.use: the user's words that mean it. */
    use: string;
    keywords: readonly string[];
    params: readonly string[];
    /** 1 reads, 2 changes, 3 asks for their tap; a playbook is 0. */
    level: 0 | 1 | 2 | 3;
}

export interface FindHit {
    entry: FindEntry;
    score: number;
    /** The share of the query's words this entry holds. */
    coverage: number;
}

type Field = 'name' | 'title' | 'keywords' | 'use' | 'description' | 'params';
const WEIGHTS: Readonly<Record<Field, number>> = { name: 5, title: 4, keywords: 4, use: 3, description: 2, params: 1 };

/** Words that say nothing about which tool fits. */
const STOP = new Set(
    (
        'a an the and or but of to in on at by for from with without into onto over under is are was were be been being am do does did done ' +
        'i me my mine we our you your yours they them their it its this that these those there here what which who whom whose when where why how ' +
        'can could would should will shall may might must please just also too very so then than not no yes all any some each every ' +
        'kaaga tool tools use using want need let lets get got make made thing things something one ones about up out off as if'
    ).split(/\s+/)
);

/** Light stemming: plural, -ing, -ed, -es (enough to match "reviews" with "review", "moving" with "move"). */
export function stem(word: string): string {
    let w = word;
    if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
    else if (w.length > 4 && /(ches|shes|sses|xes|zes)$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1);
    if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
    // "move"/"mov", "schedule"/"schedul": one form for both.
    if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
    return w;
}

/** A text's words, lower-cased, without stop words, stemmed. Names split on _ and -. */
export function words(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[’']/g, '')
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 1 && !STOP.has(w))
        .map(stem);
}

interface Indexed {
    entry: FindEntry;
    fields: Record<Field, Map<string, number>>;
    nameWords: string;
}

export interface FindIndex {
    items: Indexed[];
    /** How many entries hold each word (any field). */
    df: Map<string, number>;
}

const counts = (list: string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const w of list) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
};

export function buildIndex(entries: readonly FindEntry[]): FindIndex {
    const df = new Map<string, number>();
    const items = entries.map((entry) => {
        const fields: Record<Field, Map<string, number>> = {
            name: counts(words(entry.name.replace(/_/g, ' '))),
            title: counts(words(entry.title)),
            keywords: counts(entry.keywords.flatMap(words)),
            use: counts(words(entry.use)),
            description: counts(words(entry.description)),
            params: counts(entry.params.flatMap((p) => words(p.replace(/([a-z])([A-Z])/g, '$1 $2')))),
        };
        const seen = new Set<string>();
        for (const f of Object.values(fields)) for (const w of f.keys()) seen.add(w);
        for (const w of seen) df.set(w, (df.get(w) ?? 0) + 1);
        return { entry, fields, nameWords: words(entry.name.replace(/_/g, ' ')).join(' ') };
    });
    return { items, df };
}

/**
 * The entries that fit a query, best first. A query that is a tool's exact name puts that tool first. Ties: reads
 * before changes (a playbook first of all), then the name.
 */
export function search(index: FindIndex, query: string, limit = 5, opts: { countAll?: boolean } = {}): FindHit[] {
    const q = query.trim().toLowerCase();
    const terms = [...new Set(words(q))];
    if (!terms.length && !q) return [];
    const n = index.items.length;
    const known = opts.countAll ? terms.length : terms.filter((t) => index.df.has(t)).length;
    const hits: FindHit[] = [];
    for (const item of index.items) {
        let score = 0;
        let matched = 0;
        for (const t of terms) {
            const idf = Math.log(1 + n / (index.df.get(t) ?? n));
            // A word counts by the strongest field that holds it; more fields add a little (a word in a tool's name
            // and title and keywords is one word, not three).
            let best = 0;
            let rest = 0;
            for (const [field, weight] of Object.entries(WEIGHTS) as Array<[Field, number]>) {
                if (!item.fields[field].has(t)) continue;
                if (weight > best) {
                    rest += best;
                    best = weight;
                } else rest += weight;
            }
            if (best > 0) {
                matched += 1;
                score += (best + 0.2 * rest) * idf;
            }
        }
        if (!matched) {
            if (item.entry.name === q) hits.push({ entry: item.entry, score: 1e6, coverage: 0 });
            continue;
        }
        // More of the query's words matched beats one word matched strongly. Words no tool holds (a doc's name,
        // "kafka", "Pune") don't count against anyone.
        const coverage = matched / Math.max(1, known);
        score *= 0.25 + coverage * coverage;
        if (item.entry.name === q || item.entry.name === q.replace(/\s+/g, '_')) score += 1e6;
        hits.push({ entry: item.entry, score, coverage });
    }
    hits.sort((a, b) => b.score - a.score || a.entry.level - b.entry.level || a.entry.name.localeCompare(b.entry.name));
    return hits.slice(0, Math.max(1, limit));
}

/** Names close to a mistaken one (shared words, or one inside the other): for "No tool named X". */
export function closestNames(names: readonly string[], wrong: string, limit = 3): string[] {
    const w = new Set(words(wrong.replace(/_/g, ' ')));
    const scored = names
        .map((name) => {
            const parts = words(name.replace(/_/g, ' '));
            const shared = parts.filter((p) => w.has(p)).length;
            const inside = name.includes(wrong.toLowerCase()) || wrong.toLowerCase().includes(name) ? 1 : 0;
            return { name, score: shared * 2 + inside };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return scored.slice(0, limit).map((s) => s.name);
}
