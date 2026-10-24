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
import type { LogLevel } from "../types.js";
import { type OutboxBatch } from "./outbox.js";
export interface LogIndexEntry {
    tenantId: string;
    installationId: string;
    sessionId?: string;
    ts: string;
    level: LogLevel;
    source: string;
    event: string;
    batchId: string;
    /** Object key of the archived batch, when it was uploaded. */
    r2Key?: string;
}
export interface LogQueryParams {
    /** Tenant of the authenticated caller. Required. */
    tenantId: string;
    installationId?: string;
    sessionId?: string;
    /** ISO timestamp, inclusive lower bound. */
    since?: string;
    /** ISO timestamp, exclusive upper bound. */
    until?: string;
    levels?: LogLevel[];
    source?: string;
    event?: string;
    /** Maximum number of entries. Default 100, hard maximum 500. */
    limit?: number;
    /** Opaque cursor of the previous page. */
    cursor?: string;
}
export interface LogQueryResult {
    entries: LogIndexEntry[];
    /** Cursor of the next page, when there is one. */
    nextCursor?: string;
    hasMore: boolean;
    /** Number of day files that were read. */
    scannedFiles: number;
    /** True when the scan hit its day budget. */
    truncated: boolean;
}
export interface LogIndexStoreOptions {
    dir: string;
    /** Days a query may scan back. Default 7, hard maximum 31. */
    maxScanDays?: number;
    /** Entries per page by default. */
    defaultLimit?: number;
    /** Hard maximum of entries per page. */
    maxLimit?: number;
}
export declare class LogIndexStore {
    private readonly dir;
    private readonly maxScanDays;
    private readonly defaultLimit;
    private readonly maxLimit;
    constructor(options: LogIndexStoreOptions);
    /**
     * Index the metadata of a batch.
     *
     * Returns the number of entries that were written. The write is best
     * effort: a failing index must not lose the batch itself.
     */
    append(batch: OutboxBatch, r2Key?: string): number;
    /**
     * Query the index for one tenant.
     *
     * The result is bounded by the page limit and by the day budget, and the
     * caller is always a tenant: there is no way to query another tenant
     * because the tenant comes from the parameter, which the server fills
     * from the authenticated credential.
     */
    query(params: LogQueryParams): LogQueryResult;
    private matches;
    private dayRange;
}
//# sourceMappingURL=index-store.d.ts.map