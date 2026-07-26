/**
 * Workspace Scanner — Git State Detection
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
export function isGitRepo(rootPath) {
    return existsSync(join(rootPath, ".git"));
}
export function getGitState(rootPath) {
    if (!isGitRepo(rootPath))
        return null;
    try {
        const branch = execSync("git rev-parse --abbrev-ref HEAD", {
            cwd: rootPath,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        const status = execSync("git status --porcelain", {
            cwd: rootPath,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        const lines = status.split("\n").filter(Boolean);
        const modified = [];
        const untracked = [];
        for (const line of lines) {
            if (line.startsWith("?? ")) {
                untracked.push(line.slice(3));
            }
            else if (line.length >= 3) {
                modified.push(line.slice(3));
            }
        }
        let ahead = 0;
        let behind = 0;
        try {
            const revlist = execSync("git rev-list --left-right --count HEAD@{upstream}...HEAD", {
                cwd: rootPath,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            }).trim();
            const [a, b] = revlist.split("\t");
            ahead = parseInt(a, 10) || 0;
            behind = parseInt(b, 10) || 0;
        }
        catch {
            // upstream not configured
        }
        let lastCommitAt;
        try {
            lastCommitAt = execSync("git log -1 --format=%aI", {
                cwd: rootPath,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            }).trim();
        }
        catch {
            // no commits
        }
        return {
            branch,
            isDirty: modified.length > 0 || untracked.length > 0,
            modified,
            untracked,
            ahead,
            behind,
            lastCommitAt,
        };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=git.js.map