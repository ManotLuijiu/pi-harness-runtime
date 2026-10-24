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
import { validateBatch } from "../ingest/schema.js";
import { extractIncidents } from "../incidents/schema.js";
import { LOG_READ_SCOPE, LOG_WRITE_SCOPE, } from "./credentials.js";
import { serverObjectKey } from "./keys.js";
export class LogIngestService {
    credentials;
    outbox;
    index;
    incidents;
    incidentIndex;
    limits;
    constructor(options) {
        this.credentials = options.credentials;
        this.outbox = options.outbox;
        this.index = options.index;
        this.incidents = options.incidents;
        this.incidentIndex = options.incidentIndex;
        this.limits = options.limits ?? {};
    }
    /** True when the ingest endpoint has at least one usable credential. */
    get configured() {
        return this.credentials.configured;
    }
    /**
     * Authenticate a presented bearer token.
     *
     * The HTTP layer uses it to reject a request before the body is read.
     */
    authenticate(token) {
        return this.credentials.authenticate(token);
    }
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
    ingest(body, bearerToken) {
        if (!this.credentials.configured) {
            return {
                status: 503,
                body: { error: "log ingest is not configured", code: "ingest_unconfigured" },
            };
        }
        const auth = this.credentials.authenticate(bearerToken);
        if (!auth) {
            return { status: 401, body: { error: "unauthorized", code: "unauthorized" } };
        }
        if (!auth.scopes.includes(LOG_WRITE_SCOPE)) {
            return { status: 403, body: { error: "forbidden", code: "forbidden" } };
        }
        const validation = validateBatch(body, { limits: this.limits });
        if (!validation.ok) {
            return {
                status: 400,
                body: { error: validation.error.message, code: validation.error.code },
            };
        }
        const incoming = validation.batch;
        const batch = {
            tenantId: auth.tenantId,
            installationId: incoming.installationId,
            batchId: incoming.batchId,
            app: incoming.app,
            sentAt: incoming.sentAt,
            records: incoming.records,
        };
        if (incoming.appVersion)
            batch.appVersion = incoming.appVersion;
        if (incoming.hostLabel)
            batch.hostLabel = incoming.hostLabel;
        if (incoming.sessionId)
            batch.sessionId = incoming.sessionId;
        try {
            const result = this.outbox.enqueue(batch);
            // The metadata index is best effort: a failing index never loses
            // the batch itself.
            this.index.append(batch, serverObjectKey(batch));
            // The same holds for the derived incidents: they are a view of
            // the batch, never a precondition for accepting it.
            this.recordIncidents(batch);
            return {
                status: 202,
                body: {
                    accepted: batch.records.length,
                    batchId: batch.batchId,
                    duplicate: result.duplicate,
                    tenantId: batch.tenantId,
                    queued: true,
                },
            };
        }
        catch (error) {
            return {
                status: 503,
                body: {
                    error: `log queue unavailable: ${error instanceof Error ? error.message : String(error)}`,
                    code: "queue_unavailable",
                },
            };
        }
    }
    /**
     * Query the metadata index for the tenant of the caller.
     *
     * The `tenantId` of the request is ignored on purpose - only the
     * credential decides whose records are visible.
     */
    query(params, bearerToken) {
        if (!this.credentials.configured) {
            return {
                status: 503,
                body: { error: "log ingest is not configured", code: "ingest_unconfigured" },
            };
        }
        const auth = this.credentials.authenticate(bearerToken);
        if (!auth) {
            return { status: 401, body: { error: "unauthorized", code: "unauthorized" } };
        }
        if (!auth.scopes.includes(LOG_READ_SCOPE)) {
            return { status: 403, body: { error: "forbidden", code: "forbidden" } };
        }
        const result = this.index.query({ ...params, tenantId: auth.tenantId });
        const body = {
            entries: result.entries,
            hasMore: result.hasMore,
            scannedFiles: result.scannedFiles,
            truncated: result.truncated,
            tenantId: auth.tenantId,
        };
        if (result.nextCursor)
            body.nextCursor = result.nextCursor;
        return { status: 200, body };
    }
    /**
     * Derive the incidents of a batch and store them.
     *
     * The tenant comes from the credential that was authenticated, never
     * from the batch itself. A failing store or a failing Qdrant never
     * affects the acceptance of the batch.
     */
    recordIncidents(batch) {
        if (!this.incidents && !this.incidentIndex)
            return;
        const derived = extractIncidents(batch.records, batch.tenantId, batch.installationId);
        if (derived.length === 0)
            return;
        if (this.incidents)
            this.incidents.append(derived);
        if (this.incidentIndex)
            void this.incidentIndex.upsert(derived);
    }
    /**
     * Query the incidents of the tenant of the caller.
     *
     * The `tenantId` of the request is ignored on purpose - only the
     * credential decides whose incidents are visible.
     */
    queryIncidents(params, bearerToken) {
        if (!this.credentials.configured) {
            return {
                status: 503,
                body: { error: "log ingest is not configured", code: "ingest_unconfigured" },
            };
        }
        const auth = this.credentials.authenticate(bearerToken);
        if (!auth) {
            return { status: 401, body: { error: "unauthorized", code: "unauthorized" } };
        }
        if (!auth.scopes.includes(LOG_READ_SCOPE)) {
            return { status: 403, body: { error: "forbidden", code: "forbidden" } };
        }
        if (!this.incidents) {
            return {
                status: 503,
                body: { error: "incident storage is not configured", code: "incidents_unconfigured" },
            };
        }
        const result = this.incidents.query({ ...params, tenantId: auth.tenantId });
        return {
            status: 200,
            body: {
                incidents: result.incidents,
                truncated: result.truncated,
                scannedFiles: result.scannedFiles,
                tenantId: auth.tenantId,
            },
        };
    }
}
//# sourceMappingURL=service.js.map