// The record and the brief (SYNC_SPINE_SPEC 1.3): a chat starts with get_brief (where the user
// stands, one call), checkpoints as it goes (one session under one key, written again and again:
// a closed tab loses nothing), and list_sessions answers "where did my week go".
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ToolError } from '../errors.js';
import { plural, quote, withUndo } from '../format.js';
import { zId, zSubjectName } from '../schemas.js';
import { resolveSubject } from '../subjects.js';
import { CHANGES, READ_ONLY, defineTool, type ToolContext } from '../tool.js';
import { nextUpLine } from './paths.js';
import { pictureItem, type PictureLine } from './buddy.js';
import { putWithKind } from './folders.js';
import type { NextUp, PathStatus } from '../types.js';

type Kind = 'study' | 'practice' | 'build' | 'review';

interface BriefSession {
    day: string;
    kind: Kind;
    minutes: number | null;
    title: string;
    subject: string | null;
    project: string | null;
    score: { done: number; total: number } | null;
}

export interface Brief {
    now: { day: string; weekday: string; time: string; timezone: string };
    profile: string | null;
    goals: Array<{
        _id: string;
        title: string;
        deadline: string;
        daysLeft: number;
        progress: { done: number; total: number };
        forecast: { status: string; behindDays?: number | null } | null;
        nextMilestone: { _id: string; title: string; dueDay: string | null } | null;
        paths?: Array<{ subject: string; done: number; total: number; perWeek: number; requiredPerWeek: number | null; landsOn: string | null; status: string }>;
    }>;
    tasks?: { dueToday: number; overdue: number; titles: string[] };
    decisions?: { due: Array<{ _id: string; title: string }>; project: Array<{ title: string; why: string; day: string }> };
    week?: { weekStart: string; targets: Array<{ _id: string; text: string; done: boolean; progress: { done: number; total: number } | null }>; reviewDue: boolean } | null;
    today: { revisions: { planned: number; estMinutes: number; done: number; waiting: number }; focus: Array<{ _id: string; text: string; done: boolean }> };
    next: Array<NextUp & { lastSession: BriefSession | null; weakSpots: Array<{ _id: string; text: string }> }>;
    recent: BriefSession[];
    recall: { days: number; finished: number; weakTopics: Array<{ title: string; weak: number }> };
    project: { key: string; name: string; kind?: 'personal' | 'study' | 'work'; nextStep: string | null; lastSession: { day: string; minutes: number | null; title: string } | null } | null;
    /** The buddy (BUDDY_MEMORY_PLAN §3.4): its portrait of the user, the memories this chat starts with, a note. */
    buddy?: {
        who: string | null;
        heading: string | null;
        now: string | null;
        memories: Array<{ kind: string; text: string; pinned: boolean }>;
        note: string | null;
        followUp: string | null;
        /** The note's id as GET /api/buddy/note gives it, and its day (the hooks mark it shown). */
        noteId?: string | null;
        noteDay?: string | null;
    };
    /** The work log (B9): their own chats get yesterday's lines; a work folder's chat, its project's last days. */
    work?: { days: Array<{ day: string; projects: Array<{ project: string; minutes: number; lines: string[] }> }> } | null;
    /** The buddy's open questions for the user (a server before stage 4 has none). */
    asks?: Array<{ _id: string; text: string; answers: string[]; until: string; threadId?: string | null }>;
    /** The words endpoint's protocol (2: message numbers); absent on an older server. */
    capture?: number;
    /** What is on their mind: the threads their buddy follows (a server before stage 5 has none). */
    onMind?: Array<{ title: string; stage: string }>;
    session: { key: string };
}

interface SessionJson {
    _id: string;
    key: string | null;
    kind: Kind;
    day: string;
    minutes: number | null;
    title: string;
    subject: { _id: string; name: string } | null;
    topic: { _id: string; title: string } | null;
    project: { key: string; name: string } | null;
    score: { done: number; total: number } | null;
    outcome: string | null;
    nextStep: string | null;
    source: string;
    agentName: string | null;
}

interface SessionWrite {
    session: SessionJson;
    topic: { _id: string; title: string; status: PathStatus; position: number; nextStep: string | null } | null;
    weakSpots: Array<{ _id: string; text: string }>;
    topicEditId: string | null;
    learned?: { saved: number; seen: number; skipped: number; paused: boolean } | null;
}

interface SessionList {
    sessions: SessionJson[];
    days: Array<{ day: string; minutes: Record<Kind, number>; count: number }>;
}

const mins = (m: number): string => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
const shortDay = (day: string): string => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');

function sessionLine(s: BriefSession): string {
    return [shortDay(s.day), s.minutes ? `${mins(s.minutes)} ${s.kind}` : s.kind, quote(s.title, 70), s.subject ?? s.project, s.score ? `quiz ${s.score.done}/${s.score.total}` : null].filter(Boolean).join(' · ');
}

/** The brief as compact text (about 1,600 characters on a normal day). */
export function briefText(b: Brief): string {
    const lines = [`Brief · ${b.now.weekday} ${b.now.day} ${b.now.time} (${b.now.timezone})`];
    if (b.profile) lines.push(`About the user: ${b.profile}`);
    const buddy = b.buddy;
    if (buddy?.who) lines.push(`Who they are: ${buddy.who}`);
    if (buddy?.heading) lines.push(`Where they are heading: ${buddy.heading}`);
    if (buddy?.now) lines.push(`Right now: ${buddy.now}`);
    if (buddy?.memories.length) lines.push(`Their buddy knows: ${buddy.memories.map((m) => `${m.text} (${m.kind})`).join('; ')}`);
    if (buddy?.note) lines.push(`From their buddy (pass it on in a sentence at a natural pause): ${buddy.note}`);
    if (b.onMind?.length) lines.push(`On their mind (their buddy follows these): ${b.onMind.map((t) => quote(t.title, 80)).join('; ')}`);
    if (buddy?.followUp && !b.asks?.length) lines.push(`Ask them at a good moment: ${buddy.followUp}`);
    for (const a of b.asks ?? []) {
        const quick = a.answers.length ? ` (their quick answers: ${a.answers.join(' / ')})` : '';
        const passOn = a.threadId ? `pass the answer on with update_memory, on ${a.threadId}` : 'pass it on with remember, kind thread, naming the question';
        lines.push(`Their buddy's question for them (ask it once, in your words, at a natural pause; if they answer, ${passOn}): ${quote(a.text, 200)}${quick}`);
    }
    for (const g of b.goals) {
        const pace = g.forecast?.status ? ` · ${g.forecast.status.replace('_', ' ')}${g.forecast.behindDays ? ` by ${g.forecast.behindDays} days` : ''}` : '';
        const next = g.nextMilestone ? ` · next: ${quote(g.nextMilestone.title, 60)}${g.nextMilestone.dueDay ? ` (due ${g.nextMilestone.dueDay})` : ''}` : '';
        lines.push(`Goal: ${quote(g.title, 80)} · due ${g.deadline} (${plural(g.daysLeft, 'day')} left) · ${g.progress.done}/${g.progress.total} milestones${pace}${next}`);
        for (const p of g.paths ?? []) {
            const need = p.requiredPerWeek !== null && p.status !== 'done' ? `, needs ${p.requiredPerWeek}/wk` : '';
            const lands = p.landsOn && p.status !== 'done' ? ` (lands ${p.landsOn})` : '';
            lines.push(`  ${p.subject}: ${p.done}/${p.total} topics · ${p.perWeek}/wk${need}${lands} · ${p.status.replace('_', ' ')}`);
        }
    }
    if (b.week?.targets.length) {
        const done = b.week.targets.filter((t) => t.done).length;
        const items = b.week.targets.map((t) => `${t.done ? '[x]' : '[ ]'} ${quote(t.text, 60)}${t.progress && !t.done ? ` (${t.progress.done}/${t.progress.total})` : ''}`);
        lines.push(`Week: ${done}/${b.week.targets.length} done · ${items.join(' · ')}`);
    } else if (b.week?.reviewDue) {
        lines.push("Week: no targets yet (their weekly review waits on Home; plan it with them if they ask)");
    }
    if (b.tasks && (b.tasks.dueToday || b.tasks.overdue)) {
        lines.push(`Tasks: ${b.tasks.dueToday} due today${b.tasks.overdue ? `, ${b.tasks.overdue} overdue` : ''} · ${b.tasks.titles.map((t) => quote(t, 50)).join('; ')}`);
    }
    if (b.decisions?.due.length) lines.push(`Look again today (their decisions): ${b.decisions.due.map((d) => `${quote(d.title, 60)} [${d._id}]`).join('; ')}`);
    const r = b.today.revisions;
    const focus = b.today.focus.length ? ` · focus: ${b.today.focus.map((f) => `${f.done ? '[x]' : '[ ]'} ${f.text}`).join('; ')}` : '';
    lines.push(`Today: ${plural(r.planned, 'revision')} planned (~${r.estMinutes} min), ${r.done} done${r.waiting ? `, ${r.waiting} waiting` : ''}${focus}`);
    if (b.next.length) {
        lines.push('Next up:');
        for (const n of b.next) {
            const extra = [n.lastSession ? `last: ${sessionLine(n.lastSession)}` : null, n.weakSpots.length ? `weak spots: ${n.weakSpots.map((w) => w.text).join('; ')}` : null].filter(Boolean);
            lines.push(`- ${nextUpLine(n)}${extra.length ? `\n  ${extra.join(' · ')}` : ''}`);
        }
    }
    if (b.recent.length) lines.push(`Recent: ${b.recent.slice(0, 3).map(sessionLine).join('; ')}`);
    if (b.recall.finished || b.recall.weakTopics.length) {
        const weak = b.recall.weakTopics.length ? ` · weakest: ${b.recall.weakTopics.map((t) => `${t.title} (${t.weak} weak)`).join(', ')}` : '';
        lines.push(`Recall, last ${b.recall.days} days: ${plural(b.recall.finished, 'review')} finished${weak}`);
    }
    if (b.project) {
        const last = b.project.lastSession ? ` · last: ${shortDay(b.project.lastSession.day)}${b.project.lastSession.minutes ? ` ${mins(b.project.lastSession.minutes)}` : ''} ${quote(b.project.lastSession.title, 60)}` : '';
        // PERSONAL_OFFICE_PLAN: a study or work folder says so (a work folder's time is logged, not counted as progress).
        const kind = b.project.kind === 'study' ? ' (a study folder)' : b.project.kind === 'work' ? ' (work: its time is logged, not counted as progress)' : '';
        lines.push(`Project ${b.project.name}${kind}${b.project.nextStep ? ` · next: ${b.project.nextStep}` : ''}${last}`);
    }
    for (const d of b.decisions?.project ?? []) lines.push(`Decided ${d.day}: ${quote(d.title, 70)} because ${quote(d.why, 90)}`);
    // The work log (B9): what they did, in their words for a standup.
    if (b.work?.days.length) {
        const one = b.work.days.length === 1 && b.work.days[0]!.day !== b.now.day;
        lines.push(one ? 'Their work yesterday:' : 'Their work here lately:');
        for (const d of b.work.days) {
            for (const p of d.projects) lines.push(`- ${one ? '' : `${d.day} · `}${p.project}${p.minutes ? ` (${p.minutes} min)` : ''}: ${p.lines.map((l) => quote(l, 120)).join('; ')}`);
        }
    }
    lines.push(`Session key: ${b.session.key} (pass it to checkpoint)`);
    return lines.join('\n');
}

/** MCP_MEMORY_PLAN §4.6: the small buddy brief (the web's get_brief). */
export interface BuddyView {
    now: { day: string; weekday: string; time: string; timezone: string };
    who: string | null;
    inMotion: Array<{ _id: string; type: 'thread' | 'memory'; text: string; stage?: string; kind?: string; last: { day: string; kind: string; text: string } | null; now?: { day: string; text: string } | null }>;
    savedLately: Array<{ text: string; day: string; app: string; update: string | null }>;
    asks: Array<{ _id: string; threadId: string | null; text: string; answers: string[] }>;
    howTo: string[];
    /** ECOSYSTEM_V2_PLAN stage 12 (newer servers): their work as this chat sees it; null while the work log is off. */
    work?: { open: PictureLine[]; today: PictureLine[]; projects: string[] } | null;
}

/** The brief's Work part (stage 12): what is open, what was logged today (ids), the project names to reuse. */
export function workPartText(w: NonNullable<BuddyView['work']>): string[] {
    const lines = ['Work (their log, from every chat and app):'];
    if (w.open.length) lines.push(...w.open.map((l) => `- open: ${pictureItem(l)}`));
    if (w.today.length) lines.push(...w.today.map((l) => `- today: ${pictureItem(l)}`));
    if (!w.open.length && !w.today.length) lines.push('- nothing open, nothing logged today');
    if (w.projects.length) lines.push(`Their projects: ${w.projects.join(', ')}`);
    return lines;
}

/** The buddy brief as text: about 1,400 characters at most (the threads, then the habits and aims kept as memories), plus the Work part while their work log is on. */
export function buddyViewText(v: BuddyView): string {
    const lines = [`Today: ${v.now.weekday} ${v.now.day} ${v.now.time} (${v.now.timezone})`];
    if (v.who) lines.push(`Who they are: ${v.who}`);
    if (v.inMotion.length) {
        lines.push('In motion (their buddy follows these; ids for update_memory):');
        for (const x of v.inMotion) lines.push(`- ${quote(x.text, 80)}${x.now ? ` (now, since ${x.now.day}: ${quote(x.now.text, 90)})` : ''} · id ${x._id}${x.last ? ` · ${x.last.day} ${x.last.kind}` : ''}`);
    }
    if (v.savedLately.length) lines.push(`Saved lately: ${v.savedLately.map((s) => `${quote(s.text, 70)} (${s.day}, ${s.app})`).join('; ')}`);
    for (const a of v.asks) lines.push(`Their buddy's question (ask once at a natural pause; pass the answer with update_memory${a.threadId ? ` on ${a.threadId}` : ''}): ${quote(a.text, 140)}${a.answers.length ? ` (${a.answers.join(' / ')})` : ''}`);
    if (v.work) lines.push(...workPartText(v.work));
    lines.push(...v.howTo);
    return lines.join('\n');
}

export function registerRecordTools(server: McpServer, ctx: ToolContext): void {
    const { api } = ctx;

    defineTool(
        server,
        ctx,
        'get_brief',
        {
            title: 'Brief: where the user stands',
            // The web's brief is the small buddy brief (MCP_MEMORY_PLAN §4.6), with its Work part since stage 12.
            description:
                ctx.set === 'web'
                    ? 'Call first in every chat: who the user is, what their buddy follows (ids for update_memory) and, while their work log is on, its Work part: what is open and logged today (ids for log_work).'
                    : 'Call first in every chat: who the user is and what their buddy follows (ids). Their profile, goals, today, each path’s next topic and weak spots, recent sessions, what their buddy follows (with ids for update_memory), and a session key for checkpoint.',
            input: {
                project: z.string().trim().min(1).max(200).optional().describe('The project (repo folder) this chat is in.'),
                key: z.string().trim().max(80).optional().describe('A session key you have (Claude Code’s cc_…); else a new one.'),
            },
            annotations: READ_ONLY,
        },
        // MCP_MEMORY_PLAN §4.2: the brief only reads (its `about` wrote, so it went; the API still takes it from older builds).
        async ({ project, key }) => {
            // The web (claude.ai, ChatGPT): the small buddy brief (§4.6). An older server answers the full brief: printed as before.
            if (ctx.set === 'web') {
                const v = await api.get<BuddyView | Brief>('/api/brief', { view: 'buddy' });
                return 'inMotion' in v ? buddyViewText(v) : briefText(v);
            }
            return briefText(await api.get<Brief>('/api/brief', { project, key, ...(ctx.workMode ? { work: '1' } : {}) }));
        }
    );

    defineTool(
        server,
        ctx,
        'checkpoint',
        {
            title: 'Checkpoint the session',
            description:
                'Write this chat’s session record (the key from get_brief), after each part of the work: the same key updates the same session. ' +
                'Send what is new: a score, weak spots found or cleared, the topic’s status, the next step (a problem they stop before solving: no outcome, and where they got to in nextStep). Minutes are counted. What they say about their own life goes to remember or update_memory.',
            input: {
                key: z.string().trim().min(1).max(80).describe('The session key get_brief gave.'),
                title: z.string().trim().min(1).max(200).optional().describe('What was done.'),
                kind: z.enum(['study', 'practice', 'build', 'review']).optional().describe('Default study.'),
                subject: zSubjectName.optional(),
                topicId: zId('topic').optional().describe('The path topic (get_brief, get_path).'),
                project: z.string().trim().max(200).optional(),
                minutes: z.number().int().min(0).max(600).optional(),
                score: z.object({ done: z.number().int().min(0), total: z.number().int().min(1).max(100) }).optional().describe('Quiz result.'),
                outcome: z.enum(['alone', 'hints', 'after_answer']).optional().describe('practice: how the problem was solved.'),
                problem: z.string().trim().max(200).optional().describe('practice: the problem’s name.'),
                url: z.string().trim().max(500).optional(),
                weakSpots: z.array(z.string().trim().min(1).max(160)).max(10).optional().describe('What they got wrong or found shaky.'),
                cleared: z.array(z.string().trim().min(1).max(160)).max(20).optional().describe('Weak spots they now get right.'),
                topicStatus: z.enum(['planned', 'in_progress', 'done', 'skipped']).optional(),
                nextStep: z.string().trim().max(300).optional().describe('What to do next on the topic (or the project).'),
            },
            annotations: CHANGES,
        },
        // MCP_MEMORY_PLAN §4.2: one way in for what they say about themselves (remember, update_memory): `said` and
        // `learned` went from here (the API still takes them from older builds for one release).
        async ({ key: asked, subject, ...rest }) => {
            const resolved = subject ? await resolveSubject(api, subject) : null;
            const body = { ...rest, ...(resolved ? { subjectId: resolved.id } : {}) };
            if (Object.keys(body).length === 0) throw new ToolError('Send at least a title, or what changed (score, weakSpots, topicStatus, nextStep…).');
            // EASY_SETUP_PLAN §7: a chat that said what it is (set_chat, no hooks) carries it; from now, under its new key.
            const chats = ctx.chats;
            const key = chats?.alias.get(asked) ?? asked;
            const mark = chats?.pending.get(key) ?? chats?.pending.get('*');
            const w = await putWithKind<SessionWrite>(api, key, body, mark);
            if (chats) {
                chats.pending.delete(key);
                chats.pending.delete('*');
                chats.lastKey = asked;
            }
            const s = w.session;
            const where = [s.topic?.title ?? s.subject?.name, s.project?.name].filter(Boolean).join(' · ');
            const lines = [
                `Checkpoint saved: ${quote(s.title, 100)} · ${s.minutes ? `${mins(s.minutes)} ` : ''}${s.kind}${where ? ` · ${where}` : ''}${s.score ? ` · quiz ${s.score.done}/${s.score.total}` : ''}.`,
            ];
            if (w.topic) lines.push(`Topic: ${w.topic.position}. ${w.topic.title} · ${w.topic.status.replace('_', ' ')}${w.topic.nextStep ? ` · next step: ${w.topic.nextStep}` : ''}`);
            if (w.weakSpots.length) lines.push(`Open weak spots: ${w.weakSpots.map((x) => x.text).join('; ')}`);
            const text = lines.join('\n');
            return w.topicEditId ? withUndo(text) : text;
        }
    );

    defineTool(
        server,
        ctx,
        'list_sessions',
        {
            title: 'Sessions',
            description: 'What the user did, day by day: minutes per kind and each session. For "where did my week go" or before planning.',
            input: {
                days: z.number().int().min(1).max(90).optional().describe('How many days back, today included (default 7).'),
                kind: z.enum(['study', 'practice', 'build', 'review']).optional(),
                subject: zSubjectName.optional(),
                project: z.string().trim().max(200).optional(),
            },
            annotations: READ_ONLY,
        },
        async ({ days, kind, subject, project }) => {
            const resolved = subject ? await resolveSubject(api, subject) : null;
            const list = await api.get<SessionList>('/api/sessions', { days: days ?? 7, kind, project, subject: resolved?.id });
            if (list.sessions.length === 0) return `No sessions in the last ${plural(days ?? 7, 'day')}.`;
            const lines: string[] = [];
            for (const d of list.days) {
                const total = Object.values(d.minutes).reduce((a, b) => a + b, 0);
                const kinds = (Object.entries(d.minutes) as [Kind, number][]).filter(([, m]) => m > 0).map(([k, m]) => `${k} ${mins(m)}`).join(', ');
                lines.push(`${shortDay(d.day)} · ${total ? mins(total) : plural(d.count, 'session')}${kinds ? `: ${kinds}` : ''}`);
                for (const s of list.sessions.filter((x) => x.day === d.day)) {
                    const by = s.source === 'user' ? 'by hand' : s.source === 'hook' ? 'hook' : s.agentName ?? 'agent';
                    lines.push(`- ${quote(s.title, 80)} · ${s.minutes ? `${mins(s.minutes)} ` : ''}${s.kind}${s.topic ? ` · ${s.topic.title}` : s.subject ? ` · ${s.subject.name}` : ''}${s.project ? ` · ${s.project.name}` : ''}${s.score ? ` · quiz ${s.score.done}/${s.score.total}` : ''} · ${by}`);
                }
            }
            return lines.join('\n');
        }
    );
}
