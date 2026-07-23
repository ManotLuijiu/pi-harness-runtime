/**
 * Live cookie-folder watcher.
 *
 * Wraps chokidar v5 with the project-specific options:
 *  - `atomic: 100`           — EditThisCookie / browser exporters use atomic write
 *  - `awaitWriteFinish`      — wait for size to settle before triggering
 *  - `ignoreInitial: true`   — startup is handled by sync.ts separately
 *  - `depth: 2`              — one level + one subfolder
 *  - editor temp ignored
 *
 * Sec-001: Cookie values are NEVER logged. Diagnostics use only
 * basenames, file paths, and event kinds.
 */
import { type SyncOptions } from "./sync.js";
import type { WatcherEvent } from "./types.js";
/** Public watcher config. */
export interface CookieWatcherConfig {
    /** Folder to watch. Default: ~/.pi-harness-runtime/cookies/ */
    dropDir: string;
    /** Sync options passed through to the sync orchestrator. */
    syncOptions?: SyncOptions;
    /** Event sink. Required. */
    onEvent: (event: WatcherEvent) => void;
    /** Override the debounce window (ms). Default 250. */
    debounceMs?: number;
    /** Optional logger (defaults to console). */
    logger?: (msg: string) => void;
}
/** Wraps a chokidar watcher for the drop folder. */
export declare class CookieWatcher {
    private watcher;
    private debounceMs;
    private debounceTimer;
    private log;
    private cfg;
    private running;
    constructor(config: CookieWatcherConfig);
    /** Start watching. Idempotent — calling twice is a no-op. */
    start(): void;
    /** Stop watching. Idempotent. */
    stop(): Promise<void>;
    /** Trigger a sync immediately (bypass debounce). */
    triggerNow(): void;
    private schedule;
    private runSync;
}
/** Factory: a watcher that writes to a default no-op logger. */
export declare function createWatcher(dropDir: string, syncOptions: SyncOptions, onEvent: (event: WatcherEvent) => void): CookieWatcher;
/** Compute a sensible dropDir for a given HOME override (test seam). */
export declare function defaultDropDir(home?: string): string;
//# sourceMappingURL=watcher.d.ts.map