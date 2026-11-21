// MCP prompts (AGENT_DIAGRAMS_PLAN step 5). `catch_up` (ECOSYSTEM_V2_PLAN stage 8, E4): a chat with no
// hooks (claude.ai, the phone) passes on what the user said about themselves and logs the session.
// `note_recipe` is how a good Recollect note is built,
// with real diagrams. Its text IS the Claude Code skill (skills/recollect-notes/SKILL.md), read
// from disk, so the prompt and the skill never drift apart. In Claude Code it shows as
// /mcp__recollect__note_recipe; other MCP clients list it as a prompt.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/** src/ in tests, dist/ when built: the skill sits beside both, in ../skills. */
export const SKILL_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/recollect-notes/SKILL.md');

/** The recipe: the skill without its front matter (name and description are for Claude Code). */
export function noteRecipe(skillPath = SKILL_PATH): string {
    const text = readFileSync(skillPath, 'utf8').replace(/\r\n/g, '\n');
    return text.replace(/^---\n[\s\S]*?\n---\n+/, '').trim();
}

/** E4: what a chat with no hooks does when the user says "catch up" (or at its end). */
export const CATCH_UP = [
    'Catch Recollect up on this chat:',
    '1. If this chat has no session key yet, call get_brief once.',
    '2. Look back over the whole chat for what the user said about their own life that will still matter: a plan or a habit they mean to keep, how something went, a change of plan, how they feel about it. For each (at most 3): something new goes to remember; progress, a change or an end on something their buddy already knows goes to update_memory with its id. Use their own words, with said_on for the day they said it when that was not today; skip anything already saved in this chat. Never work details, code, clients or other people’s private things.',
    '3. If we worked on something, call checkpoint with the key: what was done, the kind (study, practice, build, review) and the next step.',
    'Then say in one short line what you saved, or that there was nothing to save.',
].join('\n');

/**
 * ECOSYSTEM_V2_PLAN stage 12: "Log my work" in claude.ai's connector menu (ChatGPT shows no prompts: typed), for a chat
 * that forgot to log as it went. Claude Code has the /log-work skill (its log_work takes the day's list).
 */
export const LOG_MY_WORK = [
    'Log my work from this chat in Recollect:',
    '1. If you have not called get_brief in this chat, call it once: its Work part shows what my log already has today and what is open, with ids.',
    '2. Look back over the chat for what I finished (fixed, shipped, sent, checked), decided (with why) or left open, in my own words or a report I pasted. One plain past-tense line each, at most 5. Skip what the log already has; something that moves a line shown to you on (an open problem now fixed, a decision changed) goes with its id in on.',
    '3. Call log_work once for each line. Then say in one short line what you logged, or that there was nothing to log.',
].join('\n');

export function registerPrompts(server: McpServer, set?: string): void {
    if (set === 'web') {
        server.registerPrompt(
            'log_my_work',
            {
                title: 'Log my work',
                description: 'Log what this chat finished, decided or left open into my Recollect work log (log_work), without repeating what is already there.',
            },
            () => ({ messages: [{ role: 'user', content: { type: 'text', text: LOG_MY_WORK } }] })
        );
    }
    server.registerPrompt(
        'catch_up',
        {
            title: 'Catch Recollect up on this chat',
            description: 'For a chat without hooks (claude.ai, the phone): pass on what the user said about themselves here (remember, update_memory) and log the session (checkpoint).',
        },
        () => ({ messages: [{ role: 'user', content: { type: 'text', text: CATCH_UP } }] })
    );
    server.registerPrompt(
        'note_recipe',
        {
            title: 'Write a learning note',
            description:
                'How to write a complete Recollect note with real diagrams, in one create_doc call: the point, requirements and an estimate, a canvas of the design, the data (erDiagram), one flow (sequenceDiagram), trade-offs, and self-test toggles. With two worked examples.',
            argsSchema: {
                topic: z.string().max(200).optional().describe('What the note is about, e.g. "consistent hashing" or "a URL shortener".'),
            },
        },
        ({ topic }) => ({
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `${noteRecipe()}\n\n---\n\n${
                            topic?.trim()
                                ? `Write a Recollect note on: ${topic.trim()}. Follow the recipe above: one create_doc call, then fix anything its answer reports, once.`
                                : 'Follow the recipe above for the note I ask for next.'
                        }`,
                    },
                },
            ],
        })
    );
}
