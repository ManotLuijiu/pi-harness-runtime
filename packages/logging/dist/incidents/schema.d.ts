/**
 * The versioned incident schema.
 *
 * A log record is a moment; an incident is a recurring problem. The server
 * derives incidents from the records it accepts, so every tenant gets a
 * deduplicated, countable view of what is actually going wrong.
 *
 * Three rules shape the schema:
 *
 *   1. The version is explicit. A reader that does not know the version can
 *      tell that it does not know it (`schemaVersion` is always present).
 *   2. The tenant is server derived. It comes from the ingest credential,
 *      never from the request body, so a client cannot write into another
 *      tenant's incidents.
 *   3. The fingerprint is stable. The same failure produces the same
 *      fingerprint, even when the message carries a timestamp, an id, a
 *      path or a number that changes every time.
 */
/** The current incident schema version. Bump on every breaking change. */
export declare const INCIDENT_SCHEMA_VERSION = 1;
/** The Qdrant collection that holds the incidents. */
export declare const INCIDENT_COLLECTION = "log_incidents_v1";
/** The severity levels an incident can have. */
export type IncidentSeverity = "warn" | "error";
/**
 * One recurring problem of one tenant.
 *
 * The field names are the ones the query endpoint returns, so they are part
 * of the wire format.
 */
export interface LogIncident {
    /** The schema version this incident was written with. */
    schemaVersion: number;
    /** Stable identity of the failure. Same problem, same fingerprint. */
    fingerprint: string;
    /** The tenant the incident belongs to. Always server derived. */
    tenantId: string;
    /** The component that reported the problem (the log source). */
    source: string;
    /** The dotted event name. */
    event: string;
    /** How bad it is. */
    severity: IncidentSeverity;
    /** A short, sanitized headline. */
    title: string;
    /** The sanitized detail of one occurrence. */
    message: string;
    /** The class of the failure, for example `TypeError`. */
    errorKind: string;
    /** How often the failure was seen. */
    count: number;
    /** ISO timestamp of the first occurrence. */
    firstSeen: string;
    /** ISO timestamp of the most recent occurrence. */
    lastSeen: string;
    /** The installations that reported the failure. */
    installationIds: string[];
}
/** A log record as the server sees it after validation. */
export interface IncidentSourceRecord {
    ts: string;
    level: string;
    source: string;
    event: string;
    message?: string;
    error?: {
        name?: string;
        message?: string;
    };
    fields?: Record<string, unknown>;
}
/**
 * Normalize a message so that the volatile parts do not change the
 * fingerprint: numbers, hex ids, uuids, paths and timestamps are replaced by
 * a placeholder.
 */
export declare function normalizeForFingerprint(text: string): string;
/**
 * The stable fingerprint of a failure.
 *
 * The parts are the identity of the problem: the component, the event, the
 * class of the error and the normalized message. Everything else is
 * presentation.
 */
export declare function incidentFingerprint(parts: {
    source: string;
    event: string;
    errorKind: string;
    message: string;
}): string;
/**
 * Derive the incidents of a batch of records.
 *
 * Only `warn` and `error` records become incidents: an `info` record is
 * noise for this purpose. Records are grouped by their fingerprint, so the
 * same failure is one incident with a count, not many incidents.
 *
 * The tenant is a parameter and not read from the record: the caller passes
 * the tenant of the credential that was authenticated.
 */
export declare function extractIncidents(records: IncidentSourceRecord[], tenantId: string, installationId?: string): LogIncident[];
/**
 * Merge an incoming incident into the stored one.
 *
 * The stored incident keeps the earliest firstSeen, the latest lastSeen and
 * the summed count, so a repeated incident accumulates instead of replacing.
 */
export declare function mergeIncident(stored: LogIncident, incoming: LogIncident): LogIncident;
/** Is this incident written with a schema the reader understands? */
export declare function isKnownIncidentSchema(version: number): boolean;
//# sourceMappingURL=schema.d.ts.map