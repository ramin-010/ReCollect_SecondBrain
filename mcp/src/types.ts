// The parts of the Recollect API responses these tools read (the `data` of `{ success, data }`).
// Shapes follow backend/src/db/serializers/learning.ts and backend/src/services/agent/*.

export type DayString = string; // 'YYYY-MM-DD'

// ─── Agent docs (/api/agent/docs) ──────────────────────────────────────

export interface DocListItem {
    id: string;
    title: string;
    subject: string | null;
    updatedAt: string;
    snippet: string;
}

export interface DocRead {
    id: string;
    title: string;
    markdown: string;
    subject: { id: string; name: string } | null;
    topicId: string | null;
    updatedAt: string;
    canEdit: boolean;
}

/** What the API says about a canvas a write made (backend/src/services/docs/diagram/resolve.ts). */
export interface CanvasReport {
    canvasId: string | null;
    /** Nodes that are not zones (notes count). */
    boxes: number;
    arrows: number;
    zones: number;
    /** The laid-out size. */
    width: number;
    height: number;
    /** The zoom it shows at in a doc (0–1). */
    zoom: number;
    /** Lint lines: crossing arrows, a box with no arrows, too wide, … */
    warnings: string[];
}

export interface DocCreated {
    id: string;
    title: string;
    subject: { id: string; name: string } | null;
    topicId: string | null;
    nextRevision: DayString | null;
    /** With topicId: the topic's status now. */
    topicStatus?: string;
    editId: string;
    /** One per canvas in the Markdown (absent when it had none). */
    canvases?: CanvasReport[];
}

/** PATCH /api/agent/docs/:id */
export interface DocUpdated {
    id: string;
    title: string;
    subject: { id: string; name: string } | null;
    topicId: string | null;
    /** What changed, in words ("renamed it …", "filed it under …"); empty when nothing did. */
    changes: string[];
    editId: string | null;
}

export interface DocAppended {
    id: string;
    appended: number;
    editId: string;
    canvases?: CanvasReport[];
}

/** POST /api/agent/docs/:id/canvas/:canvasId */
export interface CanvasUpdated {
    id: string;
    canvasId: string;
    /** Null when the change gave the board it already had (nothing logged). */
    editId: string | null;
    canvases: CanvasReport[];
}

/** GET /api/agent/docs/:id/preview */
export interface CanvasPreview {
    canvasId: string;
    /** PNG size in px. */
    width: number;
    height: number;
    /** Base64 PNG. */
    png: string;
    report: CanvasReport;
}

export interface SectionReplaced {
    id: string;
    heading: string;
    removed: number;
    inserted: number;
    editId: string;
    canvases?: CanvasReport[];
}

export interface AgentEdit {
    id: string;
    kind: string;
    agentName: string;
    summary: string;
    docId: string | null;
    entityId: string | null;
    createdAt: string;
    seenAt: string | null;
    undoneAt: string | null;
    canUndo: boolean;
}

// ─── Subjects, topics, revisions ───────────────────────────────────────

export interface SubjectRef {
    _id: string;
    name: string;
    color: string | null;
}

export interface Subject {
    _id: string;
    name: string;
    description: string | null;
    topics?: Array<{ _id: string; title: string; docId: string | null }>;
}

export interface ChainRevision {
    _id: string;
    cycleNumber: number;
    intervalDays: number;
    scheduledFor: DayString;
    status: 'pending' | 'done';
    completedAt: string | null;
}

export interface Topic {
    _id: string;
    subjectId: string;
    docId: string | null;
    title: string;
}

export type NextRevisionAction =
    | { kind: 'start' }
    | { kind: 'completed' }
    | { kind: 'wait'; inDays: number; next: ChainRevision }
    | { kind: 'early'; next: ChainRevision }
    | { kind: 'due'; next: ChainRevision };

export interface TopicByDoc {
    topic: Topic | null;
    chain: ChainRevision[];
    nextAction: NextRevisionAction;
}

export interface TopicCreated {
    topic: Topic;
    chain: ChainRevision[];
}

export interface TopicStatus {
    topicId: string;
    docId: string | null;
    subjectId: string;
    title: string;
    state: 'start' | 'wait' | 'early' | 'due' | 'completed';
    inDays: number | null;
    next: ChainRevision | null;
    done: number;
    total: number;
}

/** A due / done revision on Home (RevisionItem). */
export interface RevisionItem {
    _id: string;
    kind: 'topic' | 'capture';
    itemId: string;
    title: string;
    subject: SubjectRef | null;
    cycleNumber: number;
    intervalDays: number;
    scheduledFor: DayString;
    status: 'pending' | 'done';
    daysLate?: number;
    minutes?: number;
    docId?: string | null;
}

// ─── Goals ─────────────────────────────────────────────────────────────

export interface Milestone {
    _id: string;
    goalId: string;
    title: string;
    dueDay: DayString | null;
    done: boolean;
    doneAt: string | null;
}

export interface GoalForecast {
    daysLeft: number;
    progress: { done: number; total: number };
    status: 'on_track' | 'ahead' | 'behind' | 'no_data' | 'overdue' | 'done';
    behindDays: number | null;
    suggestion: string;
}

export interface Goal {
    _id: string;
    title: string;
    why: string | null;
    deadline: DayString;
    status: 'active' | 'done' | 'archived';
    subjects: SubjectRef[];
    milestones: Milestone[];
    daysLeft: number;
    progress: { done: number; total: number };
    forecast: GoalForecast;
    nextMilestone: Milestone | null;
}

/** GET /api/today goals[] */
export interface TodayGoal {
    _id: string;
    title: string;
    deadline: DayString;
    daysLeft: number;
    progress: { done: number; total: number };
    forecast: GoalForecast;
    nextMilestone: Milestone | null;
}

export interface MilestoneResult {
    milestone: Milestone;
    goal: Goal;
}

// ─── Today, focus, settings ────────────────────────────────────────────

export interface FocusItem {
    _id: string;
    day: DayString;
    text: string;
    done: boolean;
}

export interface Today {
    today: DayString;
    timezone: string;
    stats?: { streak?: number };
    revisions: {
        totalDue: number;
        dueToday: RevisionItem[];
        overdue: RevisionItem[];
        doneToday: RevisionItem[];
    };
    plan: {
        mode: 'normal' | 'busy' | 'comeback';
        budgetMin: number;
        estMinutes: number;
        planned: RevisionItem[];
        waitingCount: number;
        doneToday: RevisionItem[];
    };
    focus: { items: FocusItem[]; carryOver: FocusItem[] };
    goals: TodayGoal[];
    /** Up to 3 paths' next topics, goal-linked first (older servers leave it out). */
    next?: NextUp[];
}

export type PathStatus = 'planned' | 'in_progress' | 'done' | 'skipped';

/** One subject's next topic on its path (GET /api/today `next`). */
export interface NextUp {
    subject: { _id: string; name: string };
    topic: { _id: string; title: string; position: number; status: PathStatus };
    done: number;
    total: number;
    nextStep: string | null;
}

export interface LearningSettings {
    dailyBudgetMin: number;
    busyUntil: DayString | null;
    timezone: string;
}

export interface QuickNote {
    _id: string;
    isPinned: boolean;
}
