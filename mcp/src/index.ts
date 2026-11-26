#!/usr/bin/env node
// Kaaga for agents: a local MCP server on stdio. `npx kaaga-setup` registers it (it reads its url and token
// from ~/.kaaga/config.json); by hand:
//   claude mcp add kaaga -e KAAGA_URL=http://localhost:8002 -e KAAGA_TOKEN=rcl_… -- node …/mcp/dist/index.js
// stdout carries the MCP messages only; logs go to stderr and never contain the token.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { KaagaApi } from './api.js';
import { envOf, loadConfig } from './config.js';
import { refreshRules } from './folders.js';
import { stderrLogger as log } from './log.js';
import { createKaagaServer, groupsFrom } from './server.js';
import { loadHookConfig, resolveRule } from './hook.js';

async function main(): Promise<void> {
    const config = loadConfig();
    const api = new KaagaApi({
        baseUrl: config.baseUrl,
        token: config.token,
        agentName: config.agentName,
        timeoutMs: config.timeoutMs,
        log,
        debug: config.debug,
    });
    // The folder this chat runs in (Claude Code starts its servers there): its rule from the PC's hooks.json, or the
    // server's rules (EASY_SETUP_PLAN; fetched when older than 10 minutes). A tool that starts its servers elsewhere
    // (Antigravity, Cursor) sets KAAGA_FOLDERS=off: no folder is assumed there.
    // A work folder: the user's brief stays personal here too. MCP_MEMORY_PLAN §4.9 (R13): a folder whose rule is
    // "off" is excluded everywhere: no tools, not only no hooks.
    const hooks = /^(off|0|false|no)$/i.test(envOf('KAAGA_FOLDERS') ?? '') ? null : loadHookConfig();
    const rules = hooks && !config.problem ? await refreshRules(new KaagaApi({ baseUrl: hooks.url, token: hooks.token, agentName: config.agentName, timeoutMs: 2500 }), hooks.url) : null;
    const rule = hooks ? resolveRule(process.cwd(), hooks, rules) : null;
    const excluded = rule?.mode === 'off';
    const workMode = !excluded && !!rule && !rule.ask && (rule.office || !rule.brief);
    const workProject = workMode && rule ? rule.key : undefined;
    // B10: where the hooks act, log_work reads their clock for this folder's project.
    const clockProject = rule && rule.mode !== 'off' ? rule.key : undefined;
    // §4.9: saves carry the folder's project (the digest's "already saved" hint, the memory's tags).
    const project = rule?.key;
    const server = createKaagaServer({
        api,
        agentName: config.agentName,
        problem: config.problem,
        groups: groupsFrom(config.tools),
        workMode,
        ...(excluded ? { set: 'excluded' as const } : {}),
        ...(project ? { project } : {}),
        ...(workProject ? { workProject } : {}),
        ...(clockProject ? { clockProject } : {}),
        // EASY_SETUP_PLAN §3.5: the folder (set_folder's default); a new one the account asks about (the start hook says to ask).
        ...(rule ? { folder: { key: rule.key, name: rule.name, ...(rule.ask ? { isNew: true } : {}) } } : {}),
    });

    let closing = false;
    const shutdown = () => {
        if (closing) return;
        closing = true;
        server.close().finally(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    // The client went away (stdin closed): nothing more can arrive.
    process.stdin.on('end', shutdown);
    process.stdin.on('close', shutdown);

    await server.connect(new StdioServerTransport());
    if (config.problem) log(`started, but every tool will answer: ${config.problem}`);
    else log(`ready · API ${config.baseUrl} · agent "${config.agentName}"`);
}

main().catch((err: unknown) => {
    log(`could not start: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
