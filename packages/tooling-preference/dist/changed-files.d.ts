/**
 * The JavaScript/TypeScript files a session changed.
 *
 * The harness has no list of "the files Pi changed": the worktree is the
 * only honest source. The detection reads the git status of the workspace
 * (modified, staged and untracked files) and keeps the JavaScript and
 * TypeScript ones. A workspace that is not a git repository yields nothing
 * - the harness never guesses which files belong to the session.
 */
/** The extensions the quality check looks at. */
export declare const JS_TS_EXTENSIONS: readonly [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
export interface ChangedFilesResult {
    /** The changed JS/TS files, relative to the workspace root. */
    files: string[];
    /** Was the worktree read at all? */
    detected: boolean;
    /** Why the result is what it is - a human wording. */
    reason: string;
}
/**
 * Is this path a JavaScript or TypeScript source file?
 */
export declare function isJsTsFile(path: string): boolean;
/**
 * Is this path inside a directory the check must not read?
 */
export declare function isIgnoredPath(path: string): boolean;
/**
 * Parse the output of `git status --porcelain -z`.
 *
 * Every record is "XY <path>"; a rename or a copy carries the original
 * path in the next record, which is not a change of its own.
 */
export declare function parseGitStatus(output: string): string[];
/**
 * The JavaScript/TypeScript files that changed in the workspace.
 *
 * The detection never fails the session: a workspace without git (or
 * without a repository) simply has no changed files.
 */
export declare function detectChangedJsTsFiles(workspaceRoot: string, options?: {
    timeoutMs?: number;
    gitBin?: string;
}): ChangedFilesResult;
//# sourceMappingURL=changed-files.d.ts.map