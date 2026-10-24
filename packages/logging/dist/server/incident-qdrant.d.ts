/**
 * The Qdrant writer for incidents.
 *
 * The local incident store is the durable source of truth; Qdrant is the
 * searchable view. The writer keeps two rules:
 *
 *   1. The tenant is server derived. It is written into the payload and it
 *      is the filter of every query, so an incident of one tenant is never
 *      visible to another tenant.
 *   2. The collection is versioned (`log_incidents_v1`). A schema change
 *      means a new collection, so a reader always knows which shape it gets.
 *
 * The point id is derived from the tenant and the fingerprint, so an
 * incident that occurs again updates its point instead of creating a second
 * one.
 */
import { type LogIncident } from "../incidents/schema.js";
/** The payload of an incident point. */
export interface IncidentPayload {
    schema_version: number;
    fingerprint: string;
    tenant_id: string;
    source: string;
    event: string;
    severity: "warn" | "error";
    title: string;
    message: string;
    error_kind: string;
    count: number;
    first_seen: string;
    last_seen: string;
    installation_ids: string[];
}
/** A Qdrant point, as the REST API expects it. */
export interface IncidentPoint {
    id: string;
    vector: number[];
    payload: IncidentPayload;
}
/** The minimal Qdrant client surface the writer needs. */
export interface QdrantLike {
    upsert(collection: string, points: IncidentPoint[]): Promise<void>;
    search(collection: string, filter: Record<string, unknown>, limit: number): Promise<IncidentPayload[]>;
}
/**
 * The deterministic point id of an incident.
 *
 * UUID shaped, because Qdrant accepts UUIDs and unsigned integers only.
 */
export declare function incidentPointId(tenantId: string, fingerprint: string): string;
/**
 * A deterministic vector for an incident.
 *
 * The writer does not need an embedding model: the vector only has to be
 * stable, so the same incident always lands on the same point. It is a
 * hashed bag of the title and the message.
 */
export declare function incidentVector(incident: LogIncident, dimensions?: number): number[];
/** Convert an incident into the Qdrant payload. */
export declare function toIncidentPayload(incident: LogIncident): IncidentPayload;
/** The filter that scopes a search to one tenant. */
export declare function tenantFilter(tenantId: string): Record<string, unknown>;
/** The collection the incidents live in. */
export declare const INCIDENT_COLLECTION_NAME = "log_incidents_v1";
/**
 * The writer that mirrors incidents into Qdrant.
 *
 * Every method is best effort: a Qdrant outage must not break the ingest
 * path, so the failures are reported and swallowed.
 */
export declare class IncidentQdrantWriter {
    private readonly client;
    private readonly collection;
    private lastError;
    constructor(client: QdrantLike, collection?: string);
    /** The last error of a failed write or query. */
    get error(): string | undefined;
    /** Upsert the incidents of a tenant. */
    upsert(incidents: LogIncident[]): Promise<number>;
    /** Search the incidents of one tenant. */
    search(tenantId: string, limit?: number): Promise<IncidentPayload[]>;
}
//# sourceMappingURL=incident-qdrant.d.ts.map