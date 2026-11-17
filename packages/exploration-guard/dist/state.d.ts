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
import type { ExplorationCheckpoint, ExplorationKey, ExplorationState, FileCoverage, SearchCoverage } from "./types.js";
/** The directory the exploration states live in. */
export declare const EXPLORATION_STATE_DIR: string;
/** The number of files the record keeps. Older entries are pruned. */
export declare const MAX_TRACKED_FILES = 200;
/** The number of searches the record keeps. */
export declare const MAX_TRACKED_SEARCHES = 100;
/** The number of findings the record keeps. */
export declare const MAX_TRACKED_FINDINGS = 100;
/** The number of hypotheses the record keeps. */
export declare const MAX_TRACKED_HYPOTHESES = 100;
/** The number of open questions the record keeps. */
export declare const MAX_TRACKED_QUESTIONS = 50;
/**
 * Remove what must not be persisted: a credential and a path that names a
 * credential store.
 */
export declare function sanitizeText(value: string): string;
/**
 * Remove a path that names a credential store.
 *
 * The path itself is not a secret, but a path that names the place where
 * the secrets of the machine live tells a reader where to look.
 */
export declare function sanitizePath(value: string): string | undefined;
/**
 * The key of a state file.
 *
 * Every part of the identity is in the name, so a state of another
 * workspace, of another session or of another generation is a different
 * file. Two senders never overwrite each other.
 */
export declare function stateFileName(key: ExplorationKey): string;
/** A fresh checkpoint of the agent. */
export declare function emptyCheckpoint(): ExplorationCheckpoint;
/**
 * A fresh state for a request.
 */
export declare function createState(key: ExplorationKey, now?: number): ExplorationState;
/**
 * The coverage of one file, or undefined when the path was dropped.
 */
export declare function findCoverage(files: FileCoverage[], path: string): FileCoverage | undefined;
/**
 * The coverage of a file, created when it does not exist yet.
 */
export declare function ensureCoverage(files: FileCoverage[], path: string): FileCoverage;
/**
 * The coverage of a search, created when it does not exist yet.
 */
export declare function ensureSearch(searches: SearchCoverage[], query: string, scope?: string): SearchCoverage;
/**
 * Keep the record bounded.
 *
 * The oldest entries go first: the recent exploration is the one that
 * matters, and a long investigation must not grow the file without a limit.
 */
export declare function pruneState(state: ExplorationState): ExplorationState;
/**
 * Read a state from a value of unknown shape.
 *
 * A state that cannot be read is an error, not a fresh state: a fresh state
 * would reset the counters of the request and hide the repetition that the
 * guard exists to find.
 */
export declare function normalizeState(value: unknown, key: ExplorationKey): ExplorationState;
/**
 * The store of the exploration states.
 *
 * Every state owns one file, so two sessions never overwrite each other.
 * The write of a file is atomic.
 */
export declare class ExplorationStateStore {
    private readonly dir;
    constructor(dir?: string);
    /** The file the state of a request lives in. */
    path(key: ExplorationKey): string;
    /**
     * Read the state of a request.
     *
     * `null` means that there is no state. A state that exists but cannot
     * be read throws: it must not be mistaken for a fresh request.
     */
    read(key: ExplorationKey): ExplorationState | null;
    /**
     * Write the state of a request.
     *
     * A failing write is reported to the caller: the caller decides whether
     * the session may continue without the state.
     */
    write(state: ExplorationState): ExplorationState;
    /** Remove the state of a request. */
    clear(key: ExplorationKey): void;
}
//# sourceMappingURL=state.d.ts.map