/**
 * The persisted state of the exploration.
 *
 * The state survives a restart and a compaction, so the counters of a
 * request are never silently reset and a new request never inherits the
 * counters of another one.
 *
 * The state holds summaries and references. It never holds the content of a
 * file, and it never holds a credential: the subject of a finding and the
 * path of a file are the only things that are kept, and a path that names a
 * credential store is dropped.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
/** The directory the exploration states live in. */
export const EXPLORATION_STATE_DIR = join(homedir(), ".pi-harness-runtime", "exploration-guard");
/** The number of files the record keeps. Older entries are pruned. */
export const MAX_TRACKED_FILES = 200;
/** The number of searches the record keeps. */
export const MAX_TRACKED_SEARCHES = 100;
/** The number of findings the record keeps. */
export const MAX_TRACKED_FINDINGS = 100;
/** The number of hypotheses the record keeps. */
export const MAX_TRACKED_HYPOTHESES = 100;
/** The number of open questions the record keeps. */
export const MAX_TRACKED_QUESTIONS = 50;
/**
 * A credential in free text: the name of the secret and its value.
 */
const CREDENTIAL_PATTERN = /\b(api[_-]?key|apikey|secret|token|password|passwd|credential|authorization|bearer)\b(\s*[:=]\s*)(\S+)/gi;
/**
 * A path that names a place where a credential lives.
 *
 * The path of a file is worth keeping, because it says what was read. A path
 * that names a key store is not.
 */
const SECRET_PATH_PATTERN = /(^|\/)(keys?|secrets?|credentials?|\.env)(\/|$|\.)/i;
/**
 * Remove what must not be persisted: a credential and a path that names a
 * credential store.
 */
export function sanitizeText(value) {
    return value
        .replace(/\s+/g, " ")
        .trim()
        .replace(CREDENTIAL_PATTERN, "$1$2<redacted>")
        .slice(0, 500);
}
/**
 * Remove a path that names a credential store.
 *
 * The path itself is not a secret, but a path that names the place where
 * the secrets of the machine live tells a reader where to look.
 */
export function sanitizePath(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return undefined;
    if (SECRET_PATH_PATTERN.test(trimmed))
        return undefined;
    return trimmed.slice(0, 500);
}
/**
 * The key of a state file.
 *
 * Every part of the identity is in the name, so a state of another
 * workspace, of another session or of another generation is a different
 * file. Two senders never overwrite each other.
 */
export function stateFileName(key) {
    const parts = [
        key.workspace,
        key.sessionId,
        key.generation,
        key.phase,
        key.todoId === undefined ? "no-todo" : `todo-${key.todoId}`,
    ];
    return `${parts.map((part) => sanitizePart(part)).join("__")}.json`;
}
/** Make a part of a file name safe for the file system. */
function sanitizePart(value) {
    return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
}
/** A fresh checkpoint of the agent. */
export function emptyCheckpoint() {
    return {
        findings: [],
        hypotheses: [],
        openQuestions: [],
        revision: 0,
    };
}
/**
 * A fresh state for a request.
 */
export function createState(key, now = Date.now()) {
    return {
        workspace: key.workspace,
        sessionId: key.sessionId,
        generation: key.generation,
        phase: key.phase,
        todoId: key.todoId,
        files: [],
        searches: [],
        readCount: 0,
        repeatCount: 0,
        estimatedTokens: 0,
        estimatedTokensApproximate: true,
        explorationTimeMs: 0,
        checkpoint: emptyCheckpoint(),
        checkpointRevision: 0,
        previousCheckpointConsumed: false,
        updatedAt: now,
    };
}
/**
 * The coverage of one file, or undefined when the path was dropped.
 */
export function findCoverage(files, path) {
    return files.find((entry) => entry.path === path);
}
/**
 * The coverage of a file, created when it does not exist yet.
 */
export function ensureCoverage(files, path) {
    const existing = findCoverage(files, path);
    if (existing)
        return existing;
    const created = {
        path,
        ranges: [],
        readCount: 0,
        repeatCount: 0,
        searchOnly: true,
        searchQueries: [],
    };
    files.push(created);
    return created;
}
/**
 * The coverage of a search, created when it does not exist yet.
 */
export function ensureSearch(searches, query, scope) {
    const existing = searches.find((entry) => entry.query === query && (entry.scope ?? "") === (scope ?? ""));
    if (existing)
        return existing;
    const created = { query, scope, count: 0 };
    searches.push(created);
    return created;
}
/**
 * Keep the record bounded.
 *
 * The oldest entries go first: the recent exploration is the one that
 * matters, and a long investigation must not grow the file without a limit.
 */
export function pruneState(state) {
    const files = state.files.slice(-MAX_TRACKED_FILES);
    const searches = state.searches.slice(-MAX_TRACKED_SEARCHES);
    const checkpoint = state.checkpoint;
    return {
        ...state,
        files,
        searches,
        checkpoint: {
            ...checkpoint,
            findings: checkpoint.findings.slice(-MAX_TRACKED_FINDINGS),
            hypotheses: checkpoint.hypotheses.slice(-MAX_TRACKED_HYPOTHESES),
            openQuestions: checkpoint.openQuestions.slice(0, MAX_TRACKED_QUESTIONS),
        },
    };
}
/**
 * Read a state from a value of unknown shape.
 *
 * A state that cannot be read is an error, not a fresh state: a fresh state
 * would reset the counters of the request and hide the repetition that the
 * guard exists to find.
 */
export function normalizeState(value, key) {
    if (!value || typeof value !== "object") {
        throw new Error("the exploration state is not an object");
    }
    const raw = value;
    if (raw.workspace !== key.workspace) {
        throw new Error("the exploration state belongs to another workspace");
    }
    if (raw.sessionId !== key.sessionId) {
        throw new Error("the exploration state belongs to another session");
    }
    if (raw.generation !== key.generation) {
        throw new Error("the exploration state belongs to another generation");
    }
    const base = createState(key, typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now());
    return {
        ...base,
        phase: typeof raw.phase === "string" ? raw.phase : key.phase,
        todoId: typeof raw.todoId === "number" ? raw.todoId : key.todoId,
        files: Array.isArray(raw.files) ? raw.files : [],
        searches: Array.isArray(raw.searches) ? raw.searches : [],
        readCount: typeof raw.readCount === "number" ? raw.readCount : 0,
        repeatCount: typeof raw.repeatCount === "number" ? raw.repeatCount : 0,
        estimatedTokens: typeof raw.estimatedTokens === "number" ? raw.estimatedTokens : 0,
        estimatedTokensApproximate: typeof raw.estimatedTokensApproximate === "boolean"
            ? raw.estimatedTokensApproximate
            : true,
        explorationTimeMs: typeof raw.explorationTimeMs === "number" ? raw.explorationTimeMs : 0,
        checkpoint: raw.checkpoint && typeof raw.checkpoint === "object"
            ? raw.checkpoint
            : emptyCheckpoint(),
        checkpointRevision: typeof raw.checkpointRevision === "number" ? raw.checkpointRevision : 0,
        spokenRevision: typeof raw.spokenRevision === "number" ? raw.spokenRevision : undefined,
        spokenSeverity: typeof raw.spokenSeverity === "number" ? raw.spokenSeverity : undefined,
        lastWarning: raw.lastWarning && typeof raw.lastWarning === "object"
            ? raw.lastWarning
            : undefined,
        lastRereadReason: typeof raw.lastRereadReason === "string"
            ? raw.lastRereadReason
            : undefined,
        previousCheckpointConsumed: typeof raw.previousCheckpointConsumed === "boolean"
            ? raw.previousCheckpointConsumed
            : false,
        updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : base.updatedAt,
    };
}
/** Makes the name of a temporary file unique. */
let writeCounter = 0;
/**
 * The store of the exploration states.
 *
 * Every state owns one file, so two sessions never overwrite each other.
 * The write of a file is atomic.
 */
export class ExplorationStateStore {
    dir;
    constructor(dir = EXPLORATION_STATE_DIR) {
        this.dir = dir;
    }
    /** The file the state of a request lives in. */
    path(key) {
        return join(this.dir, stateFileName(key));
    }
    /**
     * Read the state of a request.
     *
     * `null` means that there is no state. A state that exists but cannot
     * be read throws: it must not be mistaken for a fresh request.
     */
    read(key) {
        const path = this.path(key);
        if (!existsSync(path))
            return null;
        let content;
        try {
            content = readFileSync(path, "utf8");
        }
        catch (error) {
            throw new Error(`the exploration state could not be read: ${error.message}`, { cause: error });
        }
        let parsed;
        try {
            parsed = JSON.parse(content);
        }
        catch (error) {
            throw new Error(`the exploration state is not valid JSON: ${error.message}`, { cause: error });
        }
        return normalizeState(parsed, key);
    }
    /**
     * Write the state of a request.
     *
     * A failing write is reported to the caller: the caller decides whether
     * the session may continue without the state.
     */
    write(state) {
        const next = pruneState({ ...state, updatedAt: Date.now() });
        mkdirSync(this.dir, { recursive: true });
        const path = this.path(next);
        // Every writer uses its own temporary file, so two writers cannot
        // rename the content of each other.
        const temporary = `${path}.${process.pid}.${writeCounter++}.tmp`;
        try {
            writeFileSync(temporary, JSON.stringify(next, null, 2), "utf8");
            renameSync(temporary, path);
        }
        catch (error) {
            throw new Error(`the exploration state could not be written: ${error.message}`, { cause: error });
        }
        return next;
    }
    /** Remove the state of a request. */
    clear(key) {
        try {
            rmSync(this.path(key), { force: true });
        }
        catch {
            // Nothing to remove.
        }
    }
}
//# sourceMappingURL=state.js.map