#!/usr/bin/env node
// Recollect for agents: a local MCP server on stdio. Claude Code starts it with
//   claude mcp add recollect -e RECOLLECT_URL=http://localhost:8002 -e RECOLLECT_TOKEN=rcl_… -- node …/mcp/dist/index.js
// stdout carries the MCP messages only; logs go to stderr and never contain the token.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RecollectApi } from './api.js';
import { loadConfig } from './config.js';
import { stderrLogger as log } from './log.js';
import { createRecollectServer, groupsFrom } from './server.js';
import { folderRule, isAllowed, loadHookConfig, projectOf } from './hook.js';

async function main(): Promise<void> {
    const config = loadConfig();
    const api = new RecollectApi({
        baseUrl: config.baseUrl,
        token: config.token,
        agentName: config.agentName,
        timeoutMs: config.timeoutMs,
        log,
        debug: config.debug,
    });
    // A work folder (the hooks' config says brief: false for it): the user's brief stays personal here too.
    // MCP_MEMORY_PLAN §4.9 (R13): a folder whose rule is "off" is excluded everywhere: no tools, not only no hooks.
    const hooks = loadHookConfig();
    const rule = hooks ? folderRule(process.cwd(), hooks.allow) : null;
    const excluded = rule?.mode === 'off';
    const workMode = !excluded && rule?.brief === false;
    const workProject = workMode && hooks ? projectOf(process.cwd(), hooks.allow) : undefined;
    // B10: where the hooks act, log_work reads their clock for this folder's project.
    const clockProject = hooks && isAllowed(process.cwd(), hooks.allow) ? projectOf(process.cwd(), hooks.allow) : undefined;
    // §4.9: saves carry the folder's project (the digest's "already saved" hint, the memory's tags).
    const project = hooks ? projectOf(process.cwd(), hooks.allow) : undefined;
    const server = createRecollectServer({
        api,
        agentName: config.agentName,
        problem: config.problem,
        groups: groupsFrom(config.tools),
        workMode,
        ...(excluded ? { set: 'excluded' as const } : {}),
        ...(project ? { project } : {}),
        ...(workProject ? { workProject } : {}),
        ...(clockProject ? { clockProject } : {}),
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
