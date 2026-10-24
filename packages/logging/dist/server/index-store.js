/**
 * Metadata index for the log query service.
 *
 * R2 is an archive, not a search API, so the server keeps a small metadata
 * index next to it: tenant, machine, session, timestamp, severity,
 * source/event, batch id and the object key of the archived batch.
 *
 * The index deliberately holds NO message text. Prompts, responses and
 * command output never enter it, and an agent asking "which errors happened
 * in this session" gets metadata, not content.
 *
 * Storage is one NDJSON file per tenant and day:
 *
 *   <dir>/<tenant>/2026-10-24.ndjson
 *
 * The index is tenant scoped by construction: every query is filtered by the
 * tenant of the authenticated caller, and the tenant of the request body is
 * never used.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { safeSegment } from "./outbox.js";
function toIsoDay(value) {
    return value.toISOString().slice(0, 10);
}
function encodeCursor(value) {
    return Buffer.from(value, "utf8").toString("base64url");
}
function decodeCursor(value) {
    try {
        return Buffer.from(value, "base64url").toString("utf8");
    }
    catch {
        return undefined;
    }
}
export class LogIndexStore {
    dir;
    maxScanDays;
    defaultLimit;
    maxLimit;
    constructor(options) {
        this.dir = options.dir;
        this.maxScanDays = Math.min(options.maxScanDays ?? 7, 31);
        this.defaultLimit = options.defaultLimit ?? 100;
        this.maxLimit = options.maxLimit ?? 500;
    }
    /**
     * Index the metadata of a batch.
     *
     * Returns the number of entries that were written. The write is best
     * effort: a failing index must not lose the batch itself.
     */
    append(batch, r2Key) {
        if (!Array.isArray(batch.records) || batch.records.length === 0)
            return 0;
        const lines = [];
        for (const record of batch.records) {
            const entry = {
                tenantId: batch.tenantId,
                installationId: batch.installationId,
                ts: record.ts,
                level: record.level,
                source: record.source,
                event: record.event,
                batchId: batch.batchId,
            };
            if (batch.sessionId)
                entry.sessionId = batch.sessionId;
            else if (record.sessionId)
                entry.sessionId = record.sessionId;
            if (r2Key)
                entry.r2Key = r2Key;
            lines.push(JSON.stringify(entry));
        }
        try {
            const day = toIsoDay(new Date(batch.sentAt));
            const dir = join(this.dir, safeSegment(batch.tenantId));
            mkdirSync(dir, { recursive: true });
            appendFileSync(join(dir, `${day}.ndjson`), `${lines.join("\n")}\n`, { mode: 0o600 });
            return lines.length;
        }
        catch {
            return 0;
        }
    }
    /**
     * Query the index for one tenant.
     *
     * The result is bounded by the page limit and by the day budget, and the
     * caller is always a tenant: there is no way to query another tenant
     * because the tenant comes from the parameter, which the server fills
     * from the authenticated credential.
     */
    query(params) {
        const limit = Math.min(params.limit ?? this.defaultLimit, this.maxLimit);
        const days = this.dayRange(params);
        const dir = join(this.dir, safeSegment(params.tenantId));
        const matches = [];
        let scannedFiles = 0;
        let truncated = days.truncated;
        for (const day of days.days) {
            const path = join(dir, `${day}.ndjson`);
            if (!existsSync(path))
                continue;
            scannedFiles++;
            let content;
            try {
                content = readFileSync(path, "utf8");
            }
            catch {
                continue;
            }
            for (const line of content.split("\n")) {
                if (!line.trim())
                    continue;
                let entry;
                try {
                    entry = JSON.parse(line);
                }
                catch {
                    continue;
                }
                if (!this.matches(entry, params))
                    continue;
                matches.push(entry);
            }
        }
        matches.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
        const cursor = params.cursor ? decodeCursor(params.cursor) : undefined;
        let start = 0;
        if (cursor) {
            const index = matches.findIndex((entry) => `${entry.ts}|${entry.batchId}` === cursor);
            start = index >= 0 ? index + 1 : 0;
        }
        const page = matches.slice(start, start + limit);
        const hasMore = start + limit < matches.length;
        const result = {
            entries: page,
            hasMore,
            scannedFiles,
            truncated,
        };
        if (hasMore && page.length > 0) {
            const last = page[page.length - 1];
            result.nextCursor = encodeCursor(`${last.ts}|${last.batchId}`);
        }
        return result;
    }
    matches(entry, params) {
        if (entry.tenantId !== params.tenantId)
            return false;
        if (params.installationId && entry.installationId !== params.installationId)
            return false;
        if (params.sessionId && entry.sessionId !== params.sessionId)
            return false;
        if (params.levels && params.levels.length > 0 && !params.levels.includes(entry.level)) {
            return false;
        }
        if (params.source && entry.source !== params.source)
            return false;
        if (params.event && entry.event !== params.event)
            return false;
        if (params.since && entry.ts < params.since)
            return false;
        if (params.until && entry.ts >= params.until)
            return false;
        return true;
    }
    dayRange(params) {
        const now = new Date();
        const until = params.until ? new Date(params.until) : now;
        // The budget counts the scanned days, so the default window covers
        // exactly `maxScanDays` days including the day of `until`.
        const since = params.since
            ? new Date(params.since)
            : new Date(until.getTime() - (this.maxScanDays - 1) * 86_400_000);
        const days = [];
        const cursor = new Date(since);
        let truncated = false;
        while (cursor <= until && days.length < this.maxScanDays) {
            days.push(toIsoDay(cursor));
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        if (cursor <= until)
            truncated = true;
        return { days, truncated };
    }
}
//# sourceMappingURL=index-store.js.map