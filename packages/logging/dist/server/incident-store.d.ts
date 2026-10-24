/**
 * Durable incident storage.
 *
 * The log index answers "which records exist"; the incident store answers
 * "what is actually broken". It keeps the derived incidents of a tenant in
 * plain NDJSON files, one per tenant and day:
 *
 *   <dir>/<tenant>/incidents-<day>.ndjson
 *
 * The store is tenant scoped by construction: the tenant is a parameter of
 * every method and the server fills it from the authenticated credential.
 * A caller can therefore never read or write another tenant's incidents.
 */
import { type LogIncident } from "../incidents/schema.js";
export interface IncidentQueryParams {
    /** Tenant of the authenticated caller. Required. */
    tenantId: string;
    /** Only incidents of this severity. */
    severity?: "warn" | "error";
    /** Only incidents of this component. */
    source?: string;
    /** Only incidents of this event. */
    event?: string;
    /** ISO timestamp, inclusive lower bound on `lastSeen`. */
    since?: string;
    /** ISO timestamp, exclusive upper bound on `lastSeen`. */
    until?: string;
    /** Maximum number of incidents. Default 50, hard maximum 200. */
    limit?: number;
}
export interface IncidentQueryResult {
    incidents: LogIncident[];
    /** True when the scan hit its day budget. */
    truncated: boolean;
    /** Number of day files that were read. */
    scannedFiles: number;
}
export interface IncidentStoreOptions {
    dir: string;
    /** Days a query may scan back. Default 7, hard maximum 31. */
    maxScanDays?: number;
    /** Incidents per page by default. */
    defaultLimit?: number;
    /** Hard maximum of incidents per page. */
    maxLimit?: number;
}
export declare class IncidentStore {
    private readonly dir;
    private readonly maxScanDays;
    private readonly defaultLimit;
    private readonly maxLimit;
    constructor(options: IncidentStoreOptions);
    /**
     * Persist the incidents of one batch.
     *
     * The write is best effort: a failing store must never lose the batch
     * itself. The returned number is the number of incidents that were
     * written.
     */
    append(incidents: LogIncident[]): number;
    /**
     * Query the incidents of one tenant.
     *
     * The incidents of the scanned files are merged by fingerprint, so a
     * failure that was seen in many batches is one incident with a summed
     * count, not many incidents.
     */
    query(params: IncidentQueryParams): IncidentQueryResult;
    /** The days a query may read, oldest first. */
    private dayRange;
    /** Does the incident match the filters of the query? */
    private matches;
    /** The tenant directories of the store. Used by the maintenance tests. */
    tenants(): string[];
}
//# sourceMappingURL=incident-store.d.ts.map