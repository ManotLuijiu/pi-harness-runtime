/**
 * UsageTracker — append-only JSONL log of every assistant message.
 *
 * Stores one record per assistant message with: timestamp, model id,
 * input/output tokens, cache read/write tokens, total cost USD.
 *
 * File: ~/.pi/usage-status/usage.jsonl (one JSON object per line)
 *
 * No locking — single-process pi uses single-writer. Multi-process safety
 * is not a goal; SQLite would be needed for that.
 */
import { appendJsonl, ensureUsageDir, getUsageLogPath, readJsonl, } from "./cli.ts";
import { unlinkSync } from "node:fs";
export class UsageTracker {
    path;
    constructor(path = getUsageLogPath()) {
        this.path = path;
        ensureUsageDir();
    }
    /** Append one usage record. */
    append(record) {
        appendJsonl(this.path, record);
    }
    /** Read all records (newest last). Returns [] if file missing. */
    all() {
        return readJsonl(this.path);
    }
    /** Filter records newer than `sinceMs` (inclusive). */
    since(sinceMs) {
        return this.all().filter((r) => r.ts >= sinceMs);
    }
    /** Filter records within [fromMs, toMs). */
    between(fromMs, toMs) {
        return this.all().filter((r) => r.ts >= fromMs && r.ts < toMs);
    }
    /** Clear all records (testing only). */
    clear() {
        try {
            unlinkSync(this.path);
        }
        catch {
            // ignore
        }
    }
    /** Total record count. */
    count() {
        return this.all().length;
    }
}
