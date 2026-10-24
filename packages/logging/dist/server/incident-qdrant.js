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
import { createHash } from "node:crypto";
import { INCIDENT_COLLECTION, INCIDENT_SCHEMA_VERSION, } from "../incidents/schema.js";
/**
 * The deterministic point id of an incident.
 *
 * UUID shaped, because Qdrant accepts UUIDs and unsigned integers only.
 */
export function incidentPointId(tenantId, fingerprint) {
    const hash = createHash("sha256").update(`${tenantId}|${fingerprint}`).digest("hex");
    return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        hash.slice(12, 16),
        hash.slice(16, 20),
        hash.slice(20, 32),
    ].join("-");
}
/**
 * A deterministic vector for an incident.
 *
 * The writer does not need an embedding model: the vector only has to be
 * stable, so the same incident always lands on the same point. It is a
 * hashed bag of the title and the message.
 */
export function incidentVector(incident, dimensions = 64) {
    const vector = new Array(dimensions).fill(0);
    const text = `${incident.title} ${incident.message} ${incident.errorKind}`.toLowerCase();
    for (const token of text.split(/[^a-z0-9]+/).filter(Boolean)) {
        const hash = createHash("sha256").update(token).digest();
        const index = hash.readUInt16BE(0) % dimensions;
        const sign = hash[2] % 2 === 0 ? 1 : -1;
        vector[index] += sign;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (norm === 0)
        return vector;
    return vector.map((value) => value / norm);
}
/** Convert an incident into the Qdrant payload. */
export function toIncidentPayload(incident) {
    return {
        schema_version: INCIDENT_SCHEMA_VERSION,
        fingerprint: incident.fingerprint,
        tenant_id: incident.tenantId,
        source: incident.source,
        event: incident.event,
        severity: incident.severity,
        title: incident.title,
        message: incident.message,
        error_kind: incident.errorKind,
        count: incident.count,
        first_seen: incident.firstSeen,
        last_seen: incident.lastSeen,
        installation_ids: incident.installationIds,
    };
}
/** The filter that scopes a search to one tenant. */
export function tenantFilter(tenantId) {
    return { must: [{ key: "tenant_id", match: { value: tenantId } }] };
}
/** The collection the incidents live in. */
export const INCIDENT_COLLECTION_NAME = INCIDENT_COLLECTION;
/**
 * The writer that mirrors incidents into Qdrant.
 *
 * Every method is best effort: a Qdrant outage must not break the ingest
 * path, so the failures are reported and swallowed.
 */
export class IncidentQdrantWriter {
    client;
    collection;
    lastError;
    constructor(client, collection = INCIDENT_COLLECTION) {
        this.client = client;
        this.collection = collection;
    }
    /** The last error of a failed write or query. */
    get error() {
        return this.lastError;
    }
    /** Upsert the incidents of a tenant. */
    async upsert(incidents) {
        if (!Array.isArray(incidents) || incidents.length === 0)
            return 0;
        const points = incidents.map((incident) => ({
            id: incidentPointId(incident.tenantId, incident.fingerprint),
            vector: incidentVector(incident),
            payload: toIncidentPayload(incident),
        }));
        try {
            await this.client.upsert(this.collection, points);
            this.lastError = undefined;
            return points.length;
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            return 0;
        }
    }
    /** Search the incidents of one tenant. */
    async search(tenantId, limit = 20) {
        try {
            const results = await this.client.search(this.collection, tenantFilter(tenantId), Math.min(Math.max(limit, 1), 100));
            this.lastError = undefined;
            return results.filter((payload) => payload.tenant_id === tenantId);
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            return [];
        }
    }
}
//# sourceMappingURL=incident-qdrant.js.map