// Installs Recollect's Claude Code hooks (SYNC_SPINE_SPEC 1.4): coding sessions in allowed folders
// log themselves, and a session starts with the brief.
//   npm run install:hooks                         asks for the token once (Settings → Agents: read + sessions:write)
//   npm run install:hooks -- --token rcl_… --allow "E:/PERSONAL_PROJECTS/" --url http://localhost:8002
//   npm run install:hooks -- --remove             takes the hooks out of settings.json (hooks.json stays)
//   --personal <path>  --study <path>  --work <path>   (repeatable; PERSONAL_OFFICE_PLAN) the folders and what they
//                      are: personal and study folders are read in full and briefed; a work folder is logged for time
//                      only (no brief, no commit subjects, the reminder to save). They replace the folders in hooks.json.
//                      A folder none of them names is not heard. The app's Settings › Tracking can change a folder later.
//   --settings <file>  another settings file (tests: a throwaway one)   --home <dir>  instead of ~/.recollect
// Writes ~/.recollect/hooks.json, and merges four hooks into ~/.claude/settings.json after saving a
// backup beside it (settings.json.bak-<time>). Our hooks are the ones whose command runs mcp/dist/hook.js;
// nothing else in the file is touched.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};
const remove = args.includes('--remove');
/** Every value of a flag that may repeat. */
const flagsOf = (name) => args.flatMap((a, i) => (a === name && args[i + 1] && !args[i + 1].startsWith('--') ? [args[i + 1]] : []));
const kindRules = [
    ...flagsOf('--personal').map((p) => ({ path: p, kind: 'personal' })),
    ...flagsOf('--study').map((p) => ({ path: p, kind: 'study' })),
    ...flagsOf('--work').map((p) => ({ path: p, kind: 'work' })),
];
const here = path.dirname(fileURLToPath(import.meta.url));
const hookJs = path.resolve(here, '../dist/hook.js').replace(/\\/g, '/');
const settingsFile = path.resolve(flag('--settings') ?? path.join(os.homedir(), '.claude', 'settings.json'));
const home = path.resolve(flag('--home') ?? process.env.RECOLLECT_HOOKS_HOME ?? path.join(os.homedir(), '.recollect'));
const MARK = 'mcp/dist/hook.js';
/** Ours: this checkout's hook.js, or the one `re-collect setup` installed (EASY_SETUP_PLAN). */
const isOurs = (command) => {
    const c = String(command ?? '').replace(/\\/g, '/');
    return c.includes(MARK) || (/dist\/hook\.js/.test(c) && /re-collect|recollect/i.test(c));
};

/** [event, hook.js argument, extra group fields, timeout in seconds] */
const EVENTS = [
    ['SessionStart', 'start', { matcher: 'startup|resume|clear|compact' }, 10],
    ['UserPromptSubmit', 'prompt', {}, 5],
    ['Stop', 'stop', {}, 5],
    ['SessionEnd', 'end', {}, 10],
];

if (!remove && !existsSync(hookJs)) {
    console.error(`${hookJs} is missing: run npm run build in mcp/ first.`);
    process.exit(1);
}

// ── ~/.recollect/hooks.json ─────────────────────────────────────────────
if (!remove) {
    const configFile = path.join(home, 'hooks.json');
    const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {};
    config.url = flag('--url') ?? config.url ?? 'http://localhost:8002';
    config.allow =
        kindRules.length > 0 || flag('--allow')
            ? [...(flag('--allow') ? [flag('--allow')] : []), ...kindRules]
            : (config.allow ?? ['E:/PERSONAL_PROJECTS/']);
    config.brief = config.brief ?? true;
    let token = flag('--token') ?? config.token;
    if (!token) {
        if (!process.stdin.isTTY) {
            console.error('No token yet: make one in Recollect (Settings → Agents) with read and sessions:write, then run again with --token rcl_…');
            process.exit(1);
        }
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        token = (await rl.question('Recollect token for the hooks (Settings → Agents, scopes read + sessions:write): ')).trim();
        rl.close();
    }
    if (!token.startsWith('rcl_')) {
        console.error('That does not look like a Recollect token (they start with rcl_).');
        process.exit(1);
    }
    config.token = token;
    mkdirSync(home, { recursive: true });
    writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
    const named = config.allow.map((e) => (typeof e === 'string' ? e : `${e.path}${e.kind ? ` (${e.kind})` : e.mode === 'off' ? ' (off)' : ''}`));
    console.log(`Wrote ${configFile} (url ${config.url}; folders: ${named.join(', ')})`);
}

// ── settings.json ───────────────────────────────────────────────────────
const settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {};
if (existsSync(settingsFile)) {
    const backup = `${settingsFile}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    copyFileSync(settingsFile, backup);
    console.log(`Saved a backup: ${backup}`);
}
settings.hooks ??= {};
for (const [event] of EVENTS) {
    const groups = (settings.hooks[event] ?? [])
        .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h.command)) }))
        .filter((g) => g.hooks.length > 0);
    if (groups.length) settings.hooks[event] = groups;
    else delete settings.hooks[event];
}
if (!remove) {
    for (const [event, arg, extra, timeout] of EVENTS) {
        (settings.hooks[event] ??= []).push({ ...extra, hooks: [{ type: 'command', command: `node "${hookJs}" ${arg}`, timeout }] });
    }
}
if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
mkdirSync(path.dirname(settingsFile), { recursive: true });
writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
console.log(
    remove
        ? `Removed Recollect's hooks from ${settingsFile}.`
        : `Added Recollect's hooks to ${settingsFile}: SessionStart (the brief), UserPromptSubmit and Stop (active minutes), SessionEnd (logs the session). Turn them off for one run with RECOLLECT_HOOKS=off.`
);
