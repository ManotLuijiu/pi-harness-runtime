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
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { INCIDENT_SCHEMA_VERSION, mergeIncident, } from "../incidents/schema.js";
import { safeSegment } from "./outbox.js";
function toIsoDay(value) {
    return value.toISOString().slice(0, 10);
}
export class IncidentStore {
    dir;
    maxScanDays;
    defaultLimit;
    maxLimit;
    constructor(options) {
        this.dir = options.dir;
        this.maxScanDays = Math.min(options.maxScanDays ?? 7, 31);
        this.defaultLimit = options.defaultLimit ?? 50;
        this.maxLimit = options.maxLimit ?? 200;
    }
    /**
     * Persist the incidents of one batch.
     *
     * The write is best effort: a failing store must never lose the batch
     * itself. The returned number is the number of incidents that were
     * written.
     */
    append(incidents) {
        if (!Array.isArray(incidents) || incidents.length === 0)
            return 0;
        const lines = incidents
            .filter((incident) => incident && incident.fingerprint)
            .map((incident) => JSON.stringify({ ...incident, schemaVersion: INCIDENT_SCHEMA_VERSION }));
        if (lines.length === 0)
            return 0;
        const day = toIsoDay(new Date());
        try {
            const dir = join(this.dir, safeSegment(incidents[0].tenantId));
            mkdirSync(dir, { recursive: true });
            appendFileSync(join(dir, `incidents-${day}.ndjson`), `${lines.join("\n")}\n`, {
                mode: 0o600,
            });
            return lines.length;
        }
        catch {
            return 0;
        }
    }
    /**
     * Query the incidents of one tenant.
     *
     * The incidents of the scanned files are merged by fingerprint, so a
     * failure that was seen in many batches is one incident with a summed
     * count, not many incidents.
     */
    query(params) {
        const limit = Math.min(params.limit ?? this.defaultLimit, this.maxLimit);
        const dir = join(this.dir, safeSegment(params.tenantId));
        const merged = new Map();
        let scannedFiles = 0;
        let truncated = false;
        for (const day of this.dayRange(params.since)) {
            const path = join(dir, `incidents-${day}.ndjson`);
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
                let incident;
                try {
                    incident = JSON.parse(line);
                }
                catch {
                    continue;
                }
                if (!incident.fingerprint)
                    continue;
                if (!this.matches(incident, params))
                    continue;
                const existing = merged.get(incident.fingerprint);
                merged.set(incident.fingerprint, existing ? mergeIncident(existing, incident) : incident);
            }
        }
        const incidents = [...merged.values()]
            .sort((a, b) => {
            if (a.severity !== b.severity)
                return a.severity === "error" ? -1 : 1;
            return b.lastSeen.localeCompare(a.lastSeen);
        })
            .slice(0, limit);
        return { incidents, truncated, scannedFiles };
    }
    /** The days a query may read, oldest first. */
    dayRange(since) {
        const days = [];
        const end = new Date();
        const start = new Date(end.getTime() - (this.maxScanDays - 1) * 86_400_000);
        if (since) {
            const parsed = new Date(since);
            if (!Number.isNaN(parsed.getTime()) && parsed > start)
                start.setTime(parsed.getTime());
        }
        for (let day = new Date(start); day <= end; day.setTime(day.getTime() + 86_400_000)) {
            days.push(toIsoDay(day));
        }
        return days;
    }
    /** Does the incident match the filters of the query? */
    matches(incident, params) {
        if (incident.tenantId !== params.tenantId)
            return false;
        if (params.severity && incident.severity !== params.severity)
            return false;
        if (params.source && incident.source !== params.source)
            return false;
        if (params.event && incident.event !== params.event)
            return false;
        if (params.since && incident.lastSeen < params.since)
            return false;
        if (params.until && incident.lastSeen >= params.until)
            return false;
        return true;
    }
    /** The tenant directories of the store. Used by the maintenance tests. */
    tenants() {
        if (!existsSync(this.dir))
            return [];
        try {
            return readdirSync(this.dir, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name);
        }
        catch {
            return [];
        }
    }
}
//# sourceMappingURL=incident-store.js.map