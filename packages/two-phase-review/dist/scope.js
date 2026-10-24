/**
 * The review scope.
 *
 * The scope of the review is the diff of the task: the changes since the
 * revision the task started at, including the uncommitted ones. It is never
 * the whole repository. A large scope is split into logical chunks so the
 * review can run per module.
 */
import { spawnSync } from "node:child_process";
/** Directories that never belong to a review scope. */
export const EXCLUDED_SCOPE_PREFIXES = [
    "node_modules",
    "dist",
    "build",
    "out",
    "coverage",
    ".next",
    ".turbo",
    ".cache",
    "vendor",
    "__pycache__",
];
/** Is the path part of a review scope? */
export function isReviewablePath(file) {
    const path = file.trim().replace(/^\.\//, "");
    if (!path)
        return false;
    // An excluded directory is excluded everywhere in the path, not only at
    // its root: "packages/foo/dist/index.js" is generated as well.
    const segments = path.split("/").filter(Boolean);
    return !segments.some((segment) => EXCLUDED_SCOPE_PREFIXES.includes(segment));
}
function runGit(root, args) {
    try {
        const result = spawnSync("git", ["-C", root, ...args], {
            encoding: "utf8",
            timeout: 20_000,
            shell: false,
            maxBuffer: 16 * 1024 * 1024,
        });
        if (result.error || result.status !== 0)
            return { ok: false, stdout: "" };
        return { ok: true, stdout: result.stdout ?? "" };
    }
    catch {
        return { ok: false, stdout: "" };
    }
}
/** Is the workspace a Git repository? */
export function isGitRepository(root) {
    const result = runGit(root, ["rev-parse", "--is-inside-work-tree"]);
    return result.ok && result.stdout.trim() === "true";
}
/** The current revision of the workspace. */
export function currentRevision(root) {
    const result = runGit(root, ["rev-parse", "HEAD"]);
    const revision = result.stdout.trim();
    return result.ok && revision ? revision : null;
}
/** Does the revision exist in the repository? */
export function revisionExists(root, revision) {
    return runGit(root, ["cat-file", "-e", `${revision}^{commit}`]).ok;
}
/** The module a file belongs to (the review chunk it is grouped in). */
export function moduleKey(file) {
    const parts = file.split("/").filter(Boolean);
    if (parts.length >= 2) {
        const root = parts[0];
        if (root === "packages" || root === "apps" || root === "services") {
            return `${root}/${parts[1]}`;
        }
        if (root === "harness") {
            return parts.length >= 3 ? `harness/${parts[1]}` : "harness";
        }
        return root;
    }
    return "root";
}
/** Count the modules a scope crosses. */
export function countModules(files) {
    return new Set(files.map((file) => moduleKey(file))).size;
}
/** Parse `git diff --numstat` into the changed line count. */
export function parseNumstat(output) {
    let lines = 0;
    for (const row of output.split("\n")) {
        const parts = row.split("\t");
        if (parts.length < 3)
            continue;
        const added = Number.parseInt(parts[0] ?? "", 10);
        const removed = Number.parseInt(parts[1] ?? "", 10);
        if (Number.isFinite(added))
            lines += added;
        if (Number.isFinite(removed))
            lines += removed;
    }
    return lines;
}
/**
 * Collect the files the review has to cover.
 *
 * The scope is the diff since the start revision (committed and uncommitted)
 * plus the untracked files. A workspace that is not a Git repository has no
 * honest scope, so nothing is reviewed.
 */
export function collectScope(root, startRevision) {
    const empty = {
        files: [],
        detected: false,
        reason: "the workspace is not a Git repository",
        metrics: { files: 0, modules: 0, changedLines: 0 },
    };
    if (!isGitRepository(root))
        return empty;
    let base = startRevision;
    if (base && !revisionExists(root, base)) {
        // A missing baseline would silently reduce the scope to the last
        // commit, so the scope is empty instead of incomplete.
        return {
            ...empty,
            reason: `the revision the task started at (${base.slice(0, 7)}) does not exist`,
        };
    }
    const revision = base ?? "HEAD";
    const diff = runGit(root, ["diff", "--name-only", revision]);
    if (!diff.ok) {
        return { ...empty, reason: `the diff against ${revision} could not be read` };
    }
    const files = new Set();
    for (const line of diff.stdout.split("\n")) {
        const file = line.trim();
        if (file)
            files.add(file);
    }
    const untracked = runGit(root, ["ls-files", "--others", "--exclude-standard"]);
    if (!untracked.ok) {
        // Without the untracked files the scope would miss new work.
        return { ...empty, reason: "the untracked files of the workspace could not be read" };
    }
    for (const line of untracked.stdout.split("\n")) {
        const file = line.trim();
        if (file)
            files.add(file);
    }
    const scopeFiles = [...files]
        .filter((file) => isReviewablePath(file))
        .sort((a, b) => a.localeCompare(b));
    const numstat = runGit(root, ["diff", "--numstat", revision]);
    return {
        files: scopeFiles,
        detected: true,
        reason: base ? `the diff since ${base.slice(0, 7)}` : "the diff since HEAD",
        metrics: {
            files: scopeFiles.length,
            modules: countModules(scopeFiles),
            changedLines: numstat.ok ? parseNumstat(numstat.stdout) : 0,
        },
    };
}
/** The default number of files one review chunk covers. */
export const DEFAULT_CHUNK_SIZE = 12;
/**
 * Split a scope into independent review chunks.
 *
 * The chunks follow the modules of the change, so a reviewer of one chunk
 * does not read the same files as a reviewer of another one.
 */
export function chunkScope(files, options = {}) {
    const maxFiles = Math.max(1, options.maxFilesPerChunk ?? DEFAULT_CHUNK_SIZE);
    const groups = new Map();
    for (const file of files) {
        const key = moduleKey(file);
        const group = groups.get(key) ?? [];
        group.push(file);
        groups.set(key, group);
    }
    const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const chunks = [];
    let index = 0;
    for (const [key, group] of ordered) {
        for (let start = 0; start < group.length; start += maxFiles) {
            const slice = group.slice(start, start + maxFiles);
            index += 1;
            chunks.push({
                id: `chunk-${index}`,
                label: `${key} (${slice.length} file${slice.length === 1 ? "" : "s"})`,
                files: slice,
                status: "pending",
            });
        }
    }
    return chunks;
}
/**
 * Is the scope large enough to be split?
 *
 * The threshold is measured, not assumed: a scope counts as large when it
 * crosses many modules or many files.
 */
export function shouldChunkScope(metrics, thresholds = {}) {
    const maxFiles = thresholds.maxFiles ?? 12;
    const maxModules = thresholds.maxModules ?? 3;
    return metrics.files > maxFiles || metrics.modules > maxModules;
}
//# sourceMappingURL=scope.js.map