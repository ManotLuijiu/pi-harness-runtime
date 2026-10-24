/**
 * Deterministic object keys for the log archive.
 *
 * The server generates the keys - never the client - and they contain no
 * user controlled path segment beyond an already sanitized tenant and batch
 * id. The key is derived from the batch itself, so the same batch always
 * lands under the same key and the metadata index can compute it without
 * waiting for the upload.
 */
export interface ObjectKeyInput {
    tenantId: string;
    batchId: string;
    /** ISO timestamp used for the date partition. */
    sentAt: string;
}
/**
 * Build the archive key of a batch:
 *
 *   logs/<tenant>/2026/10/24/09/<batchId>.ndjson
 */
export declare function serverObjectKey(input: ObjectKeyInput): string;
//# sourceMappingURL=keys.d.ts.map