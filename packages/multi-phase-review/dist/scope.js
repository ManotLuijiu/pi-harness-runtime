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
export function hashOfFiles(root, files, options = {}) {
    const hashes = new Map();
    const args = options.write
        ? ["hash-object", "-w", "--"]
        : ["hash-object", "--"];
    const chunkSize = 100;
    for (let start = 0; start < files.length; start += chunkSize) {
        const chunk = files.slice(start, start + chunkSize);
        if (chunk.length === 0)
            continue;
        const result = runGit(root, [...args, ...chunk]);
        const lines = result.ok
            ? result.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
            : [];
        if (lines.length === chunk.length) {
            chunk.forEach((file, index) => {
                const hash = lines[index] ?? "";
                if (hash)
                    hashes.set(file, hash);
            });
            continue;
        }
        // A file that cannot be read takes a line of the output with it, so
        // the hashes of the batch no longer belong to the files of the
        // batch. The files are hashed one by one then: the hash of another
        // file would describe the wrong file.
        for (const file of chunk) {
            const single = runGit(root, [...args, file]);
            if (!single.ok)
                continue;
            const hash = single.stdout.trim();
            if (hash)
                hashes.set(file, hash);
        }
    }
    return hashes;
}
/**
 * The files that are changed in the workspace.
 *
 * The changes against the revision cover the committed and the uncommitted
 * ones; the untracked files are the new ones.
 */
function changedFiles(root, revision) {
    const files = new Set();
    const diff = runGit(root, ["diff", "--name-only", revision ?? "HEAD"]);
    if (diff.ok) {
        for (const line of diff.stdout.split("\n")) {
            const file = line.trim();
            if (file)
                files.add(file);
        }
    }
    const untracked = runGit(root, ["ls-files", "--others", "--exclude-standard"]);
    if (untracked.ok) {
        for (const line of untracked.stdout.split("\n")) {
            const file = line.trim();
            if (file)
                files.add(file);
        }
    }
    return [...files];
}
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
export function captureBaseline(root) {
    if (!isGitRepository(root))
        return { revision: null, dirty: {} };
    const revision = currentRevision(root);
    const dirty = {};
    const hashes = hashOfFiles(root, changedFiles(root, revision), { write: true });
    for (const [file, hash] of hashes)
        dirty[file] = hash;
    return { revision, dirty };
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
export function collectScope(root, startRevision, baselineFiles) {
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
    const candidates = candidateFiles(root, revision, baselineFiles);
    if (candidates.reason)
        return { ...empty, reason: candidates.reason };
    // The current content of the files the baseline knew.
    const currentHashes = hashOfFiles(root, Object.keys(baselineFiles ?? {}));
    const scopeFiles = candidates.files
        .filter((file) => isReviewablePath(file))
        .filter((file) => changedSinceSnapshot(file, baselineFiles, currentHashes))
        .sort((a, b) => a.localeCompare(b));
    const deletedFiles = scopeFiles.filter((file) => !currentHashes.has(file));
    const evidence = {};
    for (const file of scopeFiles) {
        evidence[file] = evidenceOf(file, revision, baselineFiles, currentHashes);
    }
    return {
        files: scopeFiles,
        detected: true,
        reason: base
            ? `the change of the task since ${base.slice(0, 7)}`
            : "the change of the task since HEAD",
        metrics: {
            files: scopeFiles.length,
            modules: countModules(scopeFiles),
            changedLines: changedLinesOfTask(root, scopeFiles, revision, baselineFiles),
        },
        evidence,
        deletedFiles,
    };
}
/**
 * The files that can be part of the scope of the task.
 *
 * They are the files of the diff against the revision, the untracked files
 * and the files of the baseline. A file of the baseline is a candidate even
 * when the diff does not show it: a task that restores a file to the
 * committed content or that deletes it changed the file.
 */
function candidateFiles(root, revision, baselineFiles) {
    const files = new Set();
    const diff = runGit(root, ["diff", "--name-only", revision]);
    if (!diff.ok) {
        return { files: [], reason: `the diff against ${revision} could not be read` };
    }
    for (const line of diff.stdout.split("\n")) {
        const file = line.trim();
        if (file)
            files.add(file);
    }
    const untracked = runGit(root, ["ls-files", "--others", "--exclude-standard"]);
    if (!untracked.ok) {
        // Without the untracked files the scope would miss new work.
        return { files: [], reason: "the untracked files of the workspace could not be read" };
    }
    for (const line of untracked.stdout.split("\n")) {
        const file = line.trim();
        if (file)
            files.add(file);
    }
    for (const file of Object.keys(baselineFiles ?? {}))
        files.add(file);
    return { files: [...files] };
}
/**
 * Did the task change the file since the baseline of the task?
 *
 * A file that was already changed when the task started is the work of the
 * task only when its content differs from the snapshot now: the task
 * restored it to the committed content, changed it further or deleted it.
 * A file the baseline did not know is a change of the task, because it came
 * from the diff or from the untracked files.
 */
function changedSinceSnapshot(file, baselineFiles, currentHashes) {
    const baselineHash = baselineFiles?.[file];
    if (!baselineHash)
        return true;
    // A file that is gone has no hash: the task deleted it.
    return currentHashes.get(file) !== baselineHash;
}
/**
 * The command that shows the change of a file of the task.
 *
 * The reviewer needs the patch of the task, not the patch of the session: a
 * file that was already changed is shown against the snapshot it started
 * from, and a file that the task deleted is shown with its deleted content.
 */
function evidenceOf(file, revision, baselineFiles, currentHashes) {
    const blob = baselineFiles?.[file];
    if (!blob)
        return `git diff ${revision} -- ${file}`;
    if (!currentHashes.has(file)) {
        return `git show ${blob}  # the file was deleted by the task`;
    }
    return `git diff ${blob} -- ${file}`;
}
/**
 * The changed lines of the task, measured against the snapshot.
 *
 * The files the baseline did not know are measured against the revision the
 * task started at. The files that were already changed are measured against
 * the snapshot: the change of the task is the difference between the content
 * of the snapshot and the content now, not the whole history of the file.
 */
function changedLinesOfTask(root, files, revision, baselineFiles) {
    const snapshotFiles = files.filter((file) => baselineFiles?.[file]);
    const plainFiles = files.filter((file) => !baselineFiles?.[file]);
    let lines = 0;
    if (plainFiles.length > 0) {
        const numstat = runGit(root, ["diff", "--numstat", revision, "--", ...plainFiles]);
        if (numstat.ok)
            lines += parseNumstat(numstat.stdout);
    }
    for (const file of snapshotFiles) {
        const blob = baselineFiles?.[file];
        if (!blob)
            continue;
        const numstat = runGit(root, ["diff", "--numstat", blob, "--", file]);
        if (numstat.ok && numstat.stdout.trim()) {
            lines += parseNumstat(numstat.stdout);
            continue;
        }
        // The file is gone: the task deleted it, so every line of the
        // snapshot is gone with it.
        lines += blobLineCount(root, blob);
    }
    return lines;
}
/** The number of lines of a stored blob. */
function blobLineCount(root, blob) {
    const content = runGit(root, ["cat-file", "blob", blob]);
    if (!content.ok || !content.stdout)
        return 0;
    const lines = content.stdout.split("\n").length;
    return content.stdout.endsWith("\n") ? Math.max(0, lines - 1) : lines;
}
/** The default number of files one review chunk covers. */
export const DEFAULT_CHUNK_SIZE = 12;
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
            const chunk = {
                id: `chunk-${index}`,
                label: `${key} (${slice.length} file${slice.length === 1 ? "" : "s"})`,
                files: slice,
                status: "pending",
            };
            const evidence = evidenceOfChunk(slice, options.evidence);
            if (evidence)
                chunk.evidence = evidence;
            const deleted = slice.filter((file) => options.deletedFiles?.includes(file));
            if (deleted.length > 0)
                chunk.deletedFiles = deleted;
            chunks.push(chunk);
        }
    }
    return chunks;
}
/** The evidence of the files of a chunk. */
function evidenceOfChunk(files, evidence) {
    if (!evidence)
        return undefined;
    const own = {};
    for (const file of files) {
        const command = evidence[file];
        if (command)
            own[file] = command;
    }
    return Object.keys(own).length > 0 ? own : undefined;
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