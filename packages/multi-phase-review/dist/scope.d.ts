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
/**
 * The baseline of a task.
 *
 * The baseline answers "what was already there when this task started".
 * The revision names the commits that came before, and the content hash of
 * the files that were already changed names the work that was not committed
 * yet. A task that comes after another one therefore reviews its own
 * changes and not the changes of the task before it.
 */
export interface TaskBaseline {
    /** The revision the task started at. */
    revision: string | null;
    /** The content hash of the files that were already changed. */
    dirty: Record<string, string>;
}
/**
 * The content hash of the files of the workspace.
 *
 * The hash is the Git blob hash, so it is the same for the same content. A
 * file that cannot be hashed has no hash: it changed in a way that the
 * baseline cannot describe.
 *
 * With `write` the blobs are stored in the object database of the
 * repository (the way `git stash` stores its content). The content of the
 * task that starts then stays readable, so the diff of the task can be shown
 * against the state it started from.
 */
export declare function hashOfFiles(root: string, files: string[], options?: {
    write?: boolean;
}): Map<string, string>;
/**
 * The baseline of a task in the workspace.
 *
 * The baseline is captured once, when the task starts: it names the revision
 * the task started at and the changes that were already there.
 *
 * The content of the files that were already changed is stored in the object
 * database of the repository, so the baseline stays a real snapshot of the
 * workspace: a task that restores a file to the committed content or
 * deletes it can still be compared with the state it started from.
 */
export declare function captureBaseline(root: string): TaskBaseline;
/** The scope of the review. */
export interface ScopeResult {
    files: string[];
    detected: boolean;
    reason: string;
    metrics: ScopeMetrics;
    /** The command that shows the change of a file of the scope. */
    evidence?: Record<string, string>;
    /** The files the task deleted. */
    deletedFiles?: string[];
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
 * The scope is the change of the task: the diff since the start revision
 * (committed and uncommitted) plus the untracked files. A workspace that is
 * not a Git repository has no honest scope, so nothing is reviewed.
 *
 * The files that were already changed when the task started are not the work
 * of this task: they leave the scope unless the work of the task changed them
 * further. The change of the task is therefore the scope, not the history of
 * the session.
 *
 * The files of the baseline are candidates as well. A task that restores a
 * file to the committed content, or that deletes it, changed the file - even
 * though the diff against the revision shows no patch for it. The scope is
 * compared with the snapshot the task started from, so such a change stays in
 * the scope and the reviewer sees its patch.
 */
export declare function collectScope(root: string, startRevision: string | null, baselineFiles?: Record<string, string>): ScopeResult;
/** The default number of files one review chunk covers. */
export declare const DEFAULT_CHUNK_SIZE = 12;
/**
 * Split a scope into independent review chunks.
 *
 * The chunks follow the modules of the change, so a reviewer of one chunk
 * does not read the same files as a reviewer of another one.
 *
 * The evidence of the scope (the command that shows the change of a file)
 * and the files that the task deleted ride on the chunk, so the reviewer
 * sees the patch of the task and not only the names of the files.
 */
export declare function chunkScope(files: string[], options?: {
    maxFilesPerChunk?: number;
    evidence?: Record<string, string>;
    deletedFiles?: string[];
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