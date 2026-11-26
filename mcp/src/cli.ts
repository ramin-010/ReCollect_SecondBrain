#!/usr/bin/env node
// kaaga-setup: Kaaga for your AI coding tools (EASY_SETUP_PLAN §3; KAAGA_REBRAND_PLAN D7: recollect-setup before).
//
//   npx kaaga-setup            sign this computer in (approve in the browser) and add Kaaga to Claude Code,
//                              Antigravity and Cursor; safe to run again (also `npx kaaga-setup setup`)
//   npx kaaga-setup status     what is set up here
//   npx kaaga-setup remove     take it all out again
//   npx kaaga-setup@latest update   the newest version, set up again
//   npx kaaga-setup mcp        run the MCP server (the tools start dist/index.js, the hooks dist/hook.js, directly)
//
// Options: --url <server> (default https://api.kaaga.in), --login (sign in again), --tools claude,antigravity,cursor,
// --no-open (print the link, don't open the browser), --keep-token (remove: leave the sign-in), --from <dir|.tgz> and
// --here (developers: install a local build, or use this checkout in place), --home <dir> (everything under another
// home folder: tests).
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_SERVER, packageVersion, realIo, runRemove, runSetup, runStatus } from './setup.js';

const HELP = `kaaga-setup ${packageVersion()}: Kaaga for your AI coding tools.

  npx kaaga-setup            Sign this computer in (you approve it in your browser) and add
                             Kaaga to Claude Code, Antigravity and Cursor. Safe to run again.
  npx kaaga-setup status     What is set up here.
  npx kaaga-setup remove     Take it all out again.
  npx kaaga-setup@latest update   Get the newest version and set up again (@latest, or npx
                                  may run the copy it kept from before).
  npx kaaga-setup help       This.

Options: --url <server> (default ${DEFAULT_SERVER})  --login  --tools claude,antigravity,cursor  --no-open  --keep-token
Folders: each new folder asks once (building, learning or work); change them in Kaaga › Settings › Tracking.`;

function flag(args: string[], name: string): string | undefined {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1] : undefined;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
    const [command, args] = !argv[0] || argv[0].startsWith('--') ? ['setup', argv] : [argv[0], argv.slice(1)];
    const io = realIo();
    const home = path.resolve(flag(args, '--home') ?? os.homedir());
    const tools = flag(args, '--tools')?.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    try {
        switch (command) {
            case 'setup':
            case 'update': {
                const url = flag(args, '--url');
                const from = flag(args, '--from');
                await runSetup(
                    {
                        home,
                        ...(url ? { url } : {}),
                        ...(tools ? { tools } : {}),
                        ...(from ? { from } : {}),
                        ...(command === 'update' && !from ? { version: 'latest' } : {}),
                        login: args.includes('--login'),
                        noOpen: args.includes('--no-open'),
                        here: args.includes('--here'),
                    },
                    io
                );
                return 0;
            }
            case 'status':
                await runStatus({ home }, io);
                return 0;
            case 'remove':
            case 'uninstall':
                await runRemove({ home, keepToken: args.includes('--keep-token') }, io);
                return 0;
            case 'mcp':
                await import('./index.js');
                return -1; // the server keeps running
            case 'version':
            case '--version':
            case '-v':
                io.log(packageVersion());
                return 0;
            default:
                io.log(HELP);
                return command === 'help' || command === '--help' || command === '-h' ? 0 : 1;
        }
    } catch (err) {
        io.log(`✗ ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    void main().then((code) => {
        if (code >= 0) process.exit(code);
    });
}
