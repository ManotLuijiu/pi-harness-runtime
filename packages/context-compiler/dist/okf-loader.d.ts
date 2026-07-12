/**
 * OKF Loader - Loads user knowledge from ~/.pi/okf/
 *
 * This module provides optional knowledge loading for context compilation.
 * If the OKF directory doesn't exist, compilation proceeds without error.
 */
export interface OkfConcept {
    id: string;
    kind: "okf_concept";
    source: string;
    content: string;
    required: false;
    priority: 1;
    updatedAt: string;
    trust: "authoritative" | "generated" | "unverified";
}
/**
 * Load OKF concepts from ~/.pi/okf/ directory.
 *
 * Each .md file becomes one OKF concept.
 * If directory doesn't exist, returns empty array (graceful degradation).
 */
export declare function loadOkfConcepts(okfPath?: string): OkfConcept[];
/**
 * Check if OKF directory exists (for informational purposes).
 */
export declare function okfDirectoryExists(okfPath?: string): boolean;
/**
 * Get the default OKF path.
 */
export declare function getOkfPath(): string;
//# sourceMappingURL=okf-loader.d.ts.map