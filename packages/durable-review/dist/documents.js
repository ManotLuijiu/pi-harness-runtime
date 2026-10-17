/**
 * Durable Review Documents
 *
 * Versioned durable documents for review/job index using pi-durable's defineDoc.
 * Uses chord's JsonValue for JSON-compatible types.
 */
import { defineDoc } from "@earendil-works/pi-durable";
/**
 * Schema version for migration support
 */
export const SCHEMA_VERSION = 1;
/**
 * Review job index document - task-scoped
 */
export const ReviewJobDoc = defineDoc({
    kind: "moocoding.durable-review.jobs",
    version: 1,
    scope: "task",
    initial: () => ({
        schemaVersion: SCHEMA_VERSION,
        jobs: {},
    }),
});
/**
 * Worker ownership document - task-scoped
 */
export const WorkerOwnerDoc = defineDoc({
    kind: "moocoding.durable-review.owner",
    version: 1,
    scope: "task",
    initial: () => ({
        ownerId: "",
        pid: 0,
        startedAt: "",
        lastHeartbeat: "",
    }),
});
/**
 * Get job from document
 */
export function getJobFromDoc(doc, jobId) {
    const job = doc?.jobs?.[jobId];
    if (!job || typeof job !== "object")
        return undefined;
    try {
        return JSON.parse(JSON.stringify(job));
    }
    catch {
        return undefined;
    }
}
/**
 * Update job in document
 */
export function updateJobInDoc(doc, jobId, job) {
    return {
        schemaVersion: doc.schemaVersion,
        jobs: {
            ...doc.jobs,
            // SAFETY: job is already JSON-compatible
            [jobId]: job,
        },
    };
}
//# sourceMappingURL=documents.js.map