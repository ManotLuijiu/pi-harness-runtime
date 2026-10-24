/**
 * The log ingest service.
 *
 * The HTTP handler is a thin adapter around this class, so the whole ingest
 * and query policy is testable without a socket:
 *
 *   - authentication happens BEFORE the body is parsed,
 *   - the tenant comes from the credential, never from the request body,
 *   - a batch is only acknowledged after it is durably queued,
 *   - a query is always scoped to the tenant of the caller.
 */
import { type BatchValidationLimits } from "../ingest/schema.js";
import { type LogIncident } from "../incidents/schema.js";
import { type AuthenticatedCredential, type LogCredentialStore } from "./credentials.js";
import type { LogIndexStore, LogQueryParams, LogQueryResult } from "./index-store.js";
import type { IncidentQueryParams, IncidentStore } from "./incident-store.js";
import type { IncidentQdrantWriter } from "./incident-qdrant.js";
import type { LogOutbox } from "./outbox.js";
export interface IngestSuccess {
    accepted: number;
    batchId: string;
    duplicate: boolean;
    tenantId: string;
    queued: true;
}
export interface IngestFailure {
    error: string;
    code: string;
}
export interface IngestResult {
    status: number;
    body: IngestSuccess | IngestFailure;
}
export interface QuerySuccess {
    entries: LogQueryResult["entries"];
    nextCursor?: string;
    hasMore: boolean;
    scannedFiles: number;
    truncated: boolean;
    tenantId: string;
}
export interface LogIngestServiceOptions {
    credentials: LogCredentialStore;
    outbox: LogOutbox;
    index: LogIndexStore;
    /** Durable storage of the derived incidents. Optional. */
    incidents?: IncidentStore;
    /** Searchable view of the incidents. Optional. */
    incidentIndex?: IncidentQdrantWriter;
    /** Validation limits for an inbound batch. */
    limits?: Partial<BatchValidationLimits>;
}
export interface IncidentQuerySuccess {
    incidents: LogIncident[];
    truncated: boolean;
    scannedFiles: number;
    tenantId: string;
}
export declare class LogIngestService {
    private readonly credentials;
    private readonly outbox;
    private readonly index;
    private readonly incidents;
    private readonly incidentIndex;
    private readonly limits;
    constructor(options: LogIngestServiceOptions);
    /** True when the ingest endpoint has at least one usable credential. */
    get configured(): boolean;
    /**
     * Authenticate a presented bearer token.
     *
     * The HTTP layer uses it to reject a request before the body is read.
     */
    authenticate(token: string | undefined): AuthenticatedCredential | null;
    /**
     * Accept a batch.
     *
     * The status codes matter:
     *   503 - no credential is configured (fail closed) or the queue is
     *         unavailable. The client keeps the batch in its spool.
     *   401 - the credential is missing or unknown.
     *   403 - the credential may not write.
     *   400 - the batch does not match the schema.
     *   202 - the batch is durably queued.
     */
    ingest(body: unknown, bearerToken: string | undefined): IngestResult;
    /**
     * Query the metadata index for the tenant of the caller.
     *
     * The `tenantId` of the request is ignored on purpose - only the
     * credential decides whose records are visible.
     */
    query(params: Omit<LogQueryParams, "tenantId">, bearerToken: string | undefined): {
        status: number;
        body: QuerySuccess | IngestFailure;
    };
    /**
     * Derive the incidents of a batch and store them.
     *
     * The tenant comes from the credential that was authenticated, never
     * from the batch itself. A failing store or a failing Qdrant never
     * affects the acceptance of the batch.
     */
    private recordIncidents;
    /**
     * Query the incidents of the tenant of the caller.
     *
     * The `tenantId` of the request is ignored on purpose - only the
     * credential decides whose incidents are visible.
     */
    queryIncidents(params: Omit<IncidentQueryParams, "tenantId">, bearerToken: string | undefined): {
        status: number;
        body: IncidentQuerySuccess | IngestFailure;
    };
}
//# sourceMappingURL=service.d.ts.map