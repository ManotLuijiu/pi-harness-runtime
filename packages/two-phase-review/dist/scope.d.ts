/**
 * The review scope.
 *
 * The scope of the review is the diff of the task: the changes since the
 * revision the task started at, including the uncommitted ones. It is never
 * the whole repository. A large scope is split into logical chunks so the
 * review can run per module.
 */
import type { ReviewChunk } from "./types.js";
/** Directories that never belong to a review scope. */
export declare const EXCLUDED_SCOPE_PREFIXES: string[];
/** Is the path part of a review scope? */
export declare function isReviewablePath(file: string): boolean;
/** Is the workspace a Git repository? */
export declare function isGitRepository(root: string): boolean;
/** The current revision of the workspace. */
export declare function currentRevision(root: string): string | null;
/** Does the revision exist in the repository? */
export declare function revisionExists(root: string, revision: string): boolean;
/** The measured size of a scope. */
export interface ScopeMetrics {
    files: number;
    modules: number;
    changedLines: number;
}
/** The scope of the review. */
export interface ScopeResult {
    files: string[];
    detected: boolean;
    reason: string;
    metrics: ScopeMetrics;
}
/** The module a file belongs to (the review chunk it is grouped in). */
export declare function moduleKey(file: string): string;
/** Count the modules a scope crosses. */
export declare function countModules(files: string[]): number;
/** Parse `git diff --numstat` into the changed line count. */
export declare function parseNumstat(output: string): number;
/**
 * Collect the files the review has to cover.
 *
 * The scope is the diff since the start revision (committed and uncommitted)
 * plus the untracked files. A workspace that is not a Git repository has no
 * honest scope, so nothing is reviewed.
 */
export declare function collectScope(root: string, startRevision: string | null): ScopeResult;
/** The default number of files one review chunk covers. */
export declare const DEFAULT_CHUNK_SIZE = 12;
/**
 * Split a scope into independent review chunks.
 *
 * The chunks follow the modules of the change, so a reviewer of one chunk
 * does not read the same files as a reviewer of another one.
 */
export declare function chunkScope(files: string[], options?: {
    maxFilesPerChunk?: number;
}): ReviewChunk[];
/**
 * Is the scope large enough to be split?
 *
 * The threshold is measured, not assumed: a scope counts as large when it
 * crosses many modules or many files.
 */
export declare function shouldChunkScope(metrics: ScopeMetrics, thresholds?: {
    maxFiles?: number;
    maxModules?: number;
}): boolean;
//# sourceMappingURL=scope.d.ts.map