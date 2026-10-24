/**
 * The persisted state of the two-phase workflow.
 *
 * The state survives a restart and a compaction, so the phase, the task start
 * revision, the review scope, the finished chunks and the open findings are
 * never lost.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
/** The directory the state files live in. */
export const TWO_PHASE_STATE_DIR = join(homedir(), ".pi-harness-runtime", "two-phase-review");
const PHASE_ORDER = {
    implementation: 0,
    review_pending: 1,
    review: 2,
    review_fixes: 3,
    complete: 4,
};
/** Makes the name of a temporary state file unique. */
let writeCounter = 0;
/** A fresh state for a task. */
export function createState(taskId, startRevision = null) {
    return {
        phase: "implementation",
        taskId,
        startRevision,
        scopeFiles: [],
        chunks: [],
        signals: [],
        findings: [],
        updatedAt: new Date().toISOString(),
    };
}
/** Make a file name safe for the file system. */
export function safeFileName(taskId) {
    return (taskId || "default").replace(/[^A-Za-z0-9._-]+/g, "_");
}
/** The entries of a directory, for a readable error message. */
function listDir(dir) {
    try {
        return readdirSync(dir).join(",");
    }
    catch {
        return "<unreadable>";
    }
}
function isPhase(value) {
    return (typeof value === "string" &&
        ["implementation", "review_pending", "review", "review_fixes", "complete"].includes(value));
}
/** Repair a state that was read from disk. */
export function normalizeState(value, taskId) {
    const raw = (value ?? {});
    return {
        phase: isPhase(raw.phase) ? raw.phase : "implementation",
        taskId: typeof raw.taskId === "string" && raw.taskId ? raw.taskId : taskId,
        startRevision: typeof raw.startRevision === "string" ? raw.startRevision : null,
        scopeFiles: Array.isArray(raw.scopeFiles) ? raw.scopeFiles.filter((f) => typeof f === "string") : [],
        chunks: Array.isArray(raw.chunks) ? raw.chunks.filter(isChunk) : [],
        signals: Array.isArray(raw.signals) ? raw.signals.filter(isSignal) : [],
        findings: Array.isArray(raw.findings) ? raw.findings.filter(isFinding) : [],
        reviewTodoSubject: typeof raw.reviewTodoSubject === "string" ? raw.reviewTodoSubject : undefined,
        reviewTodoDescription: typeof raw.reviewTodoDescription === "string" ? raw.reviewTodoDescription : undefined,
        updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    };
}
/** Is the chunk of a persisted state usable? */
function isChunk(value) {
    if (!value || typeof value !== "object")
        return false;
    const chunk = value;
    return (typeof chunk.id === "string" &&
        typeof chunk.label === "string" &&
        Array.isArray(chunk.files) &&
        chunk.files.every((file) => typeof file === "string") &&
        (chunk.status === "pending" || chunk.status === "done"));
}
/** Is the signal of a persisted state usable? */
function isSignal(value) {
    if (!value || typeof value !== "object")
        return false;
    const signal = value;
    return (typeof signal.source === "string" &&
        typeof signal.reason === "string" &&
        Array.isArray(signal.files) &&
        signal.files.every((file) => typeof file === "string"));
}
/** Is the finding of a persisted state usable? */
function isFinding(value) {
    if (!value || typeof value !== "object")
        return false;
    const finding = value;
    return typeof finding.id === "string" && typeof finding.summary === "string";
}
/** The state of one task on disk. */
export class TwoPhaseStateStore {
    dir;
    constructor(dir = TWO_PHASE_STATE_DIR) {
        this.dir = dir;
    }
    /** The file the state of the task lives in. */
    path(taskId) {
        return join(this.dir, `${safeFileName(taskId)}.json`);
    }
    /**
     * Read the state of the task.
     *
     * `null` means that there is no state. A state that exists but cannot be
     * read is an error: it must not be mistaken for a fresh task, because that
     * would lose the revision the task started at and the progress of the
     * review.
     */
    read(taskId) {
        const path = this.path(taskId);
        if (!existsSync(path))
            return null;
        let content;
        try {
            content = readFileSync(path, "utf8");
        }
        catch (error) {
            throw new Error(`the state file could not be read: ${error.message}; path=${path}`, { cause: error });
        }
        let parsed;
        try {
            parsed = JSON.parse(content);
        }
        catch (error) {
            throw new Error(`the state file is not valid JSON: ${error.message}; path=${path}`, { cause: error });
        }
        if (!parsed || typeof parsed !== "object") {
            throw new Error(`the state file does not contain a state: path=${path}`);
        }
        return normalizeState(parsed, taskId);
    }
    /**
     * Write the state of the task.
     *
     * A failing write is reported to the caller: the runtime decides whether
     * the session may continue without the state, the test sees the reason.
     */
    write(state) {
        const next = { ...state, updatedAt: new Date().toISOString() };
        mkdirSync(this.dir, { recursive: true });
        const path = this.path(next.taskId);
        // Every writer uses its own temporary file, so two writers cannot
        // rename the content of each other.
        const temporary = `${path}.${process.pid}.${writeCounter++}.tmp`;
        try {
            writeFileSync(temporary, JSON.stringify(next, null, 2), "utf8");
            renameSync(temporary, path);
        }
        catch (error) {
            throw new Error(`the state file could not be written: ${error.message}; dir=${this.dir}; entries=${listDir(this.dir)}`, { cause: error });
        }
        return next;
    }
    /** Remove the state of the task. */
    clear(taskId) {
        try {
            rmSync(this.path(taskId), { force: true });
        }
        catch {
            // Nothing to remove.
        }
    }
}
/** Move to a phase, never backwards. */
export function moveToPhase(state, phase) {
    if (PHASE_ORDER[phase] <= PHASE_ORDER[state.phase])
        return state;
    return { ...state, phase };
}
/** Record a review signal. The phase does not change. */
export function recordSignal(state, signal) {
    const key = `${signal.source}::${[...signal.files].sort().join(",")}::${signal.reason
        .trim()
        .toLowerCase()}`;
    if (state.signals.some((entry) => `${entry.source}::${[...entry.files]
        .sort()
        .join(",")}::${entry.reason.trim().toLowerCase()}` === key)) {
        return state;
    }
    return { ...state, signals: [...state.signals, signal] };
}
/** The implementation is done: the review waits for its scope. */
export function transitionToReviewPending(state, scopeFiles) {
    return { ...moveToPhase(state, "review_pending"), scopeFiles };
}
/** The review starts with the given chunks. */
export function startReview(state, chunks) {
    return { ...moveToPhase(state, "review"), chunks };
}
/** Mark a review chunk as finished. */
export function markChunkDone(state, chunkId) {
    const chunks = state.chunks.map((chunk) => chunk.id === chunkId ? { ...chunk, status: "done" } : chunk);
    return { ...state, chunks };
}
/** Record a confirmed finding. */
export function recordFinding(state, finding) {
    return { ...state, findings: [...state.findings, finding] };
}
/**
 * The review found something: the fixes are now the work.
 *
 * The fixes start when the review is finished: a fix phase before the review
 * ran would hide the work that is still open.
 */
export function transitionToReviewFixes(state) {
    if (state.phase !== "review")
        return state;
    if (!allChunksDone(state))
        return state;
    return moveToPhase(state, "review_fixes");
}
/** Every chunk is finished. */
export function allChunksDone(state) {
    return state.chunks.length > 0 && state.chunks.every((chunk) => chunk.status === "done");
}
/**
 * The work is finished.
 *
 * The task is only complete when the review ran over every chunk. The
 * implementation phase never completes the task on its own.
 */
export function markComplete(state) {
    if (state.phase === "implementation" || state.phase === "review_pending")
        return state;
    if (!allChunksDone(state))
        return state;
    return moveToPhase(state, "complete");
}
/** Is a review queued? */
export function hasQueuedReview(state) {
    return state.signals.length > 0;
}
//# sourceMappingURL=state.js.map