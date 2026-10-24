/**
 * The JavaScript/TypeScript files a session changed.
 *
 * The harness has no list of "the files Pi changed": the worktree is the
 * only honest source. The detection reads the git status of the workspace
 * (modified, staged and untracked files) and keeps the JavaScript and
 * TypeScript ones. A workspace that is not a git repository yields nothing
 * - the harness never guesses which files belong to the session.
 */
import { spawnSync } from "node:child_process";
/** The extensions the quality check looks at. */
export const JS_TS_EXTENSIONS = [
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
];
/** Directories that never hold source the check should read. */
const IGNORED_PATH_PARTS = new Set([
    "node_modules",
    "dist",
    "build",
    "out",
    "coverage",
    ".next",
    ".turbo",
]);
/**
 * Is this path a JavaScript or TypeScript source file?
 */
export function isJsTsFile(path) {
    const lower = path.toLowerCase();
    return JS_TS_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
/**
 * Is this path inside a directory the check must not read?
 */
export function isIgnoredPath(path) {
    return path
        .split("/")
        .filter((part) => part.length > 0)
        .some((part) => IGNORED_PATH_PARTS.has(part));
}
/**
 * Parse the output of `git status --porcelain -z`.
 *
 * Every record is "XY <path>"; a rename or a copy carries the original
 * path in the next record, which is not a change of its own.
 */
export function parseGitStatus(output) {
    const paths = [];
    const records = output.split("\0").filter((record) => record.length > 0);
    for (let index = 0; index < records.length; index++) {
        const record = records[index];
        if (!record || record.length < 4)
            continue;
        const status = record.slice(0, 2);
        const path = record.slice(3).trim();
        if (!path)
            continue;
        paths.push(path);
        // A rename or a copy is followed by the original path.
        if (status.includes("R") || status.includes("C"))
            index++;
    }
    return paths;
}
/**
 * The JavaScript/TypeScript files that changed in the workspace.
 *
 * The detection never fails the session: a workspace without git (or
 * without a repository) simply has no changed files.
 */
export function detectChangedJsTsFiles(workspaceRoot, options = {}) {
    const timeoutMs = options.timeoutMs ?? 5000;
    const gitBin = options.gitBin ?? "git";
    let output = "";
    try {
        const result = spawnSync(gitBin, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
            cwd: workspaceRoot,
            encoding: "utf8",
            timeout: timeoutMs,
            maxBuffer: 8 * 1024 * 1024,
        });
        if (result.error || result.status !== 0) {
            return {
                files: [],
                detected: false,
                reason: result.error
                    ? "git could not be run"
                    : "the workspace is not a git repository",
            };
        }
        output = result.stdout ?? "";
    }
    catch {
        return { files: [], detected: false, reason: "git could not be run" };
    }
    const seen = new Set();
    const files = [];
    for (const path of parseGitStatus(output)) {
        const normalized = path.replace(/\\/g, "/");
        if (seen.has(normalized))
            continue;
        if (!isJsTsFile(normalized) || isIgnoredPath(normalized))
            continue;
        seen.add(normalized);
        files.push(normalized);
    }
    files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    let reason = "no changed file";
    if (files.length > 0) {
        reason = `${files.length} changed file(s)`;
    }
    return {
        files,
        detected: true,
        reason,
    };
}
//# sourceMappingURL=changed-files.js.map