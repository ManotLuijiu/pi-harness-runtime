/**
 * Memory Engine Types (RFC-0060)
 *
 * Interfaces for OKF-based knowledge management.
 */
export interface OkfLink {
    href: string;
    title?: string;
    type?: string;
}
export interface OkfConcept {
    id: string;
    type: string;
    title?: string;
    description?: string;
    resource?: string;
    tags: string[];
    timestamp?: string;
    metadata: Record<string, unknown>;
    body: string;
    links: OkfLink[];
}
export interface OkfFrontmatter {
    type: string;
    title?: string;
    tags?: string[];
    timestamp?: string;
    authority?: "approved" | "generated" | "unverified";
    [key: string]: unknown;
}
export interface KnowledgeBundle {
    path: string;
    concepts: OkfConcept[];
    index: string;
    log: string;
    directories: KnowledgeDirectory[];
}
export interface KnowledgeDirectory {
    path: string;
    name: string;
    files: string[];
    subdirectories: KnowledgeDirectory[];
}
export interface ValidationError {
    path: string;
    message: string;
    line?: number;
    severity: "error" | "warning";
}
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
}
export interface KnowledgeQuery {
    text?: string;
    tags?: string[];
    types?: string[];
    authority?: ("approved" | "generated" | "unverified")[];
    framework?: string;
    taskType?: string;
    limit?: number;
}
export interface KnowledgeResult {
    concept: OkfConcept;
    relevance: number;
    matchedOn: ("title" | "tags" | "type" | "body" | "authority")[];
}
export interface WriteConceptRequest {
    type: string;
    title?: string;
    body: string;
    tags?: string[];
    authority?: "approved" | "generated" | "unverified";
    metadata?: Record<string, unknown>;
    links?: OkfLink[];
}
export interface KnowledgeIndex {
    concepts: Array<{
        id: string;
        type: string;
        title: string;
        tags: string[];
        path: string;
    }>;
    lastUpdated: string;
}
export declare const RESERVED_FILES: string[];
export declare function isReservedFile(filename: string): boolean;
export declare const SECRET_PATTERNS: RegExp[];
export declare function containsSecret(value: string): boolean;
export declare function filterSecrets(content: string): string;
export type Authority = "approved" | "generated" | "unverified";
export declare const AUTHORITY_PRIORITY: Record<Authority, number>;
//# sourceMappingURL=types.d.ts.map