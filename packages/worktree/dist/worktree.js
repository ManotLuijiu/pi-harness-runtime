/**
 * Git Worktree Manager — RFC-0005
 *
 * Creates isolated workspaces for parallel or recoverable coding tasks.
 *
 * Goals:
 * - avoid branch conflicts
 * - preserve partial work
 * - allow reviewer agent to inspect diffs
 * - allow separate models to work on separate tasks
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
export class WorktreeManager {
    rootDir;
    baseBranch;
    metaPath;
    constructor(options) {
        this.rootDir = options.rootDir;
        this.baseBranch = options.baseBranch ?? "main";
        this.metaPath = join(this.rootDir, ".worktrees.json");
    }
    /**
     * Create a new worktree
     */
    async create(options) {
        const name = options.name.replace(/[^a-zA-Z0-9-_]/g, "-");
        const branch = options.branch ?? `worktree/${name}`;
        const path = join(this.rootDir, "worktrees", name);
        // Ensure directory exists
        mkdirSync(dirname(path), { recursive: true });
        // Create git worktree
        const startPoint = options.startPoint ?? this.baseBranch;
        const worktreePath = this.execGit([
            "worktree",
            "add",
            "-b",
            branch,
            path,
            startPoint,
        ]);
        // Record metadata
        const worktree = {
            name,
            path: worktreePath,
            branch,
            jobId: options.jobId,
            taskId: options.taskId,
            createdAt: new Date().toISOString(),
            status: "active",
        };
        this.saveWorktree(worktree);
        return worktree;
    }
    /**
     * List all worktrees
     */
    async list() {
        if (!existsSync(this.metaPath)) {
            return [];
        }
        try {
            const content = readFileSync(this.metaPath, "utf-8");
            return JSON.parse(content);
        }
        catch {
            return [];
        }
    }
    /**
     * Get worktree by name
     */
    async get(name) {
        const worktrees = await this.list();
        return worktrees.find((w) => w.name === name) ?? null;
    }
    /**
     * Get worktree by job ID
     */
    async getByJob(jobId) {
        const worktrees = await this.list();
        return worktrees.find((w) => w.jobId === jobId) ?? null;
    }
    /**
     * Remove a worktree
     */
    async remove(name, force = false) {
        const worktree = await this.get(name);
        if (!worktree) {
            throw new Error(`Worktree ${name} not found`);
        }
        // Remove git worktree
        this.execGit(["worktree", "remove", worktree.path, force ? "--force" : ""]);
        // Remove from metadata
        const worktrees = await this.list();
        const updated = worktrees.filter((w) => w.name !== name);
        this.saveAllWorktrees(updated);
    }
    /**
     * Prune stale worktrees
     */
    async prune() {
        const output = this.execGit(["worktree", "list", "--porcelain"]);
        const lines = output.split("\n");
        const pruned = [];
        // Parse git worktree list
        const worktreePaths = [];
        for (const line of lines) {
            if (line.startsWith("worktree ")) {
                worktreePaths.push(line.replace("worktree ", "").trim());
            }
        }
        // Check our tracked worktrees
        const tracked = await this.list();
        for (const worktree of tracked) {
            if (!worktreePaths.includes(worktree.path)) {
                // Git worktree no longer exists
                worktree.status = "abandoned";
                pruned.push(worktree.name);
            }
        }
        this.saveAllWorktrees(tracked);
        return pruned;
    }
    /**
     * Get diff between worktree and base
     */
    async getDiff(worktreePath) {
        const output = this.execGit(["diff", "--stat", `main...${worktreePath}`], {
            cwd: worktreePath,
        });
        const diffs = [];
        const lines = output.split("\n");
        for (const line of lines) {
            if (!line.includes("|"))
                continue;
            const [file, stats] = line.split("|").map((s) => s.trim());
            if (!file || !stats)
                continue;
            let status = "modified";
            if (stats.startsWith("+"))
                status = "added";
            else if (stats.startsWith("-"))
                status = "deleted";
            const match = stats.match(/\+(\d+)/);
            const insertions = match ? parseInt(match[1], 10) : undefined;
            const delMatch = stats.match(/-(\d+)/);
            const deletions = delMatch ? parseInt(delMatch[1], 10) : undefined;
            diffs.push({ file, status, insertions, deletions });
        }
        return diffs;
    }
    /**
     * Get uncommitted changes
     */
    async getUncommitted(worktreePath) {
        const output = this.execGit(["diff", "--numstat"], { cwd: worktreePath });
        const diffs = [];
        const lines = output.split("\n");
        for (const line of lines) {
            const parts = line.split("\t");
            if (parts.length < 3)
                continue;
            const [ins, del, file] = parts;
            diffs.push({
                file,
                status: "modified",
                insertions: parseInt(ins, 10) || 0,
                deletions: parseInt(del, 10) || 0,
            });
        }
        return diffs;
    }
    /**
     * Mark worktree as merged
     */
    async markMerged(name) {
        const worktrees = await this.list();
        const worktree = worktrees.find((w) => w.name === name);
        if (worktree) {
            worktree.status = "merged";
            this.saveAllWorktrees(worktrees);
        }
    }
    /**
     * Execute git command
     */
    execGit(args, options) {
        try {
            const cwd = options?.cwd ?? this.rootDir;
            return execSync(["git", ...args].join(" "), {
                cwd,
                encoding: "utf-8",
                stdio: ["pipe", "pipe", "pipe"],
            }).trim();
        }
        catch (error) {
            const e = error;
            throw new Error(`Git command failed: ${e.message ?? error}`);
        }
    }
    /**
     * Save worktree to metadata
     */
    saveWorktree(worktree) {
        const current = this.listSync();
        const idx = current.findIndex((w) => w.name === worktree.name);
        if (idx >= 0) {
            current[idx] = worktree;
        }
        else {
            current.push(worktree);
        }
        this.saveAllWorktrees(current);
    }
    /**
     * Save all worktrees
     */
    saveAllWorktrees(worktrees) {
        mkdirSync(dirname(this.metaPath), { recursive: true });
        writeFileSync(this.metaPath, JSON.stringify(worktrees, null, 2), "utf-8");
    }
    /**
     * List worktrees synchronously
     */
    listSync() {
        if (!existsSync(this.metaPath)) {
            return [];
        }
        try {
            return JSON.parse(readFileSync(this.metaPath, "utf-8"));
        }
        catch {
            return [];
        }
    }
}
//# sourceMappingURL=worktree.js.map