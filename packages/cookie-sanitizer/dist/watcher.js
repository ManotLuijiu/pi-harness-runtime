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
import chokidar from "chokidar";
import { join } from "node:path";
import { sync } from "./sync.js";
const DEFAULT_DEBOUNCE_MS = 250;
/** Wraps a chokidar watcher for the drop folder. */
export class CookieWatcher {
    watcher = null;
    debounceMs;
    debounceTimer = null;
    log;
    cfg;
    running = false;
    constructor(config) {
        this.cfg = config;
        this.debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
        this.log = config.logger ?? ((m) => console.log(`[cookie-sanitizer] ${m}`));
    }
    /** Start watching. Idempotent — calling twice is a no-op. */
    start() {
        if (this.running)
            return;
        this.running = true;
        this.watcher = chokidar.watch(this.cfg.dropDir, {
            ignored: (targetPath) => {
                const base = targetPath.split("/").pop() ?? "";
                if (base.startsWith("."))
                    return true;
                if (base.endsWith("~") || base.endsWith(".swp"))
                    return true;
                if (base.endsWith(".tmp"))
                    return true;
                // Exclude the canonical cache file (if specified) so the
                // sanitizer's own write doesn't trigger a re-sync.
                if (this.cfg.syncOptions?.cachePath &&
                    targetPath === this.cfg.syncOptions.cachePath) {
                    return true;
                }
                return false;
            },
            ignoreInitial: true,
            persistent: true,
            depth: 2,
            atomic: 100,
            awaitWriteFinish: {
                stabilityThreshold: 200,
                pollInterval: 50,
            },
        });
        this.watcher.on("add", () => this.schedule());
        this.watcher.on("change", () => this.schedule());
        this.watcher.on("unlink", () => this.schedule());
        this.watcher.on("error", (err) => {
            this.log(`watcher error: ${err instanceof Error ? err.message : String(err)}`);
            this.cfg.onEvent({
                kind: "watcher-error",
                message: err instanceof Error ? err.message : String(err),
            });
        });
        this.log(`watching ${this.cfg.dropDir}`);
    }
    /** Stop watching. Idempotent. */
    async stop() {
        if (!this.running)
            return;
        this.running = false;
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
        }
        this.log("stopped");
    }
    /** Trigger a sync immediately (bypass debounce). */
    triggerNow() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.runSync();
    }
    schedule() {
        if (this.debounceTimer)
            clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            this.runSync();
        }, this.debounceMs);
    }
    runSync() {
        try {
            const result = sync(this.cfg.syncOptions ?? {});
            if (result.errors.length > 0) {
                for (const err of result.errors) {
                    this.cfg.onEvent({
                        kind: "sync-error",
                        message: `${err.basename}: ${err.message}`,
                    });
                }
            }
            if (result.provider && result.wrote) {
                this.cfg.onEvent({
                    kind: "sync-ok",
                    provider: result.provider,
                    cachePath: result.cachePath,
                    cookies: result.totalCookies,
                });
            }
            else if (result.processedFiles.length === 0 &&
                result.provider === null) {
                this.cfg.onEvent({
                    kind: "sync-skip",
                    reason: "no usable cookies found",
                });
            }
        }
        catch (e) {
            this.cfg.onEvent({
                kind: "sync-error",
                message: e instanceof Error ? e.message : String(e),
            });
        }
    }
}
/** Factory: a watcher that writes to a default no-op logger. */
export function createWatcher(dropDir, syncOptions, onEvent) {
    return new CookieWatcher({ dropDir, syncOptions, onEvent });
}
/** Compute a sensible dropDir for a given HOME override (test seam). */
export function defaultDropDir(home = process.env.HOME ?? "/tmp") {
    return join(home, ".pi-harness-runtime", "cookies");
}
//# sourceMappingURL=watcher.js.map