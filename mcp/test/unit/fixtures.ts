// API payloads shaped like backend/src/db/serializers/learning.ts and the agent services.
import type { Goal, Milestone, RevisionItem, Subject, Today, TopicStatus } from '../../src/types.js';

export const DSA = { _id: 'subjDsa1', name: 'DSA', color: '#007acc' };
export const SYS = { _id: 'subjSys2', name: 'System Design', color: '#aa00cc' };

export const subjects = (): Subject[] => [
    { _id: DSA._id, name: DSA.name, description: null, topics: [{ _id: 't1', title: 'Two pointers', docId: 'docA' }, { _id: 't2', title: 'Heaps', docId: 'docB' }] },
    { _id: SYS._id, name: SYS.name, description: null, topics: [] },
];

export function revisionItem(over: Partial<RevisionItem> = {}): RevisionItem {
    return {
        _id: 'rev1',
        kind: 'topic',
        itemId: 't1',
        title: 'Two pointers',
        subject: DSA,
        cycleNumber: 2,
        intervalDays: 3,
        scheduledFor: '2026-11-14',
        status: 'pending',
        docId: 'docA',
        ...over,
    };
}

export function milestone(over: Partial<Milestone> = {}): Milestone {
    return { _id: 'ms1', goalId: 'goal1', title: 'Finish arrays', dueDay: '2026-12-01', done: false, doneAt: null, ...over };
}

export function goal(over: Partial<Goal> = {}): Goal {
    const milestones = over.milestones ?? [milestone({ _id: 'ms0', title: 'Pick a sheet', done: true, dueDay: null }), milestone()];
    const done = milestones.filter((m) => m.done).length;
    return {
        _id: 'goal1',
        title: 'Product-company SDE role',
        why: 'A role where I build products',
        deadline: '2027-06-30',
        status: 'active',
        subjects: [DSA],
        milestones,
        daysLeft: 228,
        progress: { done, total: milestones.length },
        forecast: { daysLeft: 228, progress: { done, total: milestones.length }, status: 'on_track', behindDays: 0, suggestion: '1 more milestone a week keeps you on track.' },
        nextMilestone: milestones.find((m) => !m.done) ?? null,
        ...over,
    };
}

export function today(over: Partial<Today> = {}): Today {
    const planned = [revisionItem({ _id: 'rev1', daysLate: 3, scheduledFor: '2026-11-11', minutes: 5 }), revisionItem({ _id: 'rev2', itemId: 't2', title: 'Heaps', cycleNumber: 1, docId: 'docB', minutes: 8 })];
    return {
        today: '2026-11-14',
        timezone: 'Asia/Kolkata',
        stats: { streak: 5 },
        revisions: {
            totalDue: 3,
            overdue: [planned[0]!],
            dueToday: [planned[1]!, revisionItem({ _id: 'rev3', itemId: 't3', title: 'Tries', cycleNumber: 3, docId: 'docC' })],
            doneToday: [],
        },
        plan: { mode: 'normal', budgetMin: 25, estMinutes: 13, planned, waitingCount: 1, doneToday: [] },
        focus: { items: [{ _id: 'f1', day: '2026-11-14', text: 'Finish 2 graph problems', done: false }], carryOver: [] },
        goals: [
            {
                _id: 'goal1',
                title: 'Product-company SDE role',
                deadline: '2027-06-30',
                daysLeft: 228,
                progress: { done: 1, total: 2 },
                forecast: { daysLeft: 228, progress: { done: 1, total: 2 }, status: 'behind', behindDays: 12, suggestion: '' },
                nextMilestone: milestone(),
            },
        ],
        ...over,
    };
}

export function status(over: Partial<TopicStatus> = {}): TopicStatus {
    return { topicId: 't1', docId: 'docA', subjectId: DSA._id, title: 'Two pointers', state: 'due', inDays: 0, next: null, done: 1, total: 4, ...over };
}
