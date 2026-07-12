/**
 * Prompt Compiler - Request Normalization
 *
 * Normalizes a PromptCompileRequest to ensure deterministic, stable output.
 * Stable array ordering is critical for reproducible prompt hashes.
 */
import type { PromptCompileRequest } from "./types.js";
/**
 * Normalized compile request with stable ordering.
 */
export interface NormalizedRequest {
    taskId: string;
    requirementId: string;
    provider: string;
    attempt: number;
    objective: string;
    acceptanceCriteria: string[];
    contextEntries: NormalizedContextEntry[];
    constraints: string[];
    filesInScope: string[];
    expectedOutputs: string[];
    toolPermissions: string[];
    continuation: NormalizedContinuation | undefined;
}
/**
 * Normalized context entry with stable string representation.
 */
export interface NormalizedContextEntry {
    id: string;
    content: string;
    priority: number;
    source: string;
}
/**
 * Normalized continuation context.
 */
export interface NormalizedContinuation {
    previousResponsePath: string;
    completedItems: string[];
    incompleteItems: string[];
}
/**
 * Normalize a PromptCompileRequest for deterministic processing.
 *
 * - Arrays are sorted lexicographically by ID
 * - Strings are trimmed
 * - Empty values are removed
 * - Duplicates are eliminated (stable unique)
 */
export declare function normalizeRequest(request: PromptCompileRequest): NormalizedRequest;
//# sourceMappingURL=normalize.d.ts.map