/**
 * Write-Review Blackboard
 *
 * File-based coordination between writer and reviewer agents.
 * Location: {project}/.write-review/status.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
const DEFAULT_DIR = ".write-review";
const STATUS_FILE = "status.json";
export class WriteReviewBlackboard {
    projectPath;
    dir;
    status = null;
    constructor(projectPath, dir = DEFAULT_DIR) {
        this.projectPath = projectPath;
        this.dir = join(projectPath, dir);
    }
    /**
     * Initialize a new write-review session
     */
    init() {
        mkdirSync(this.dir, { recursive: true });
        this.status = {
            projectPath: this.projectPath,
            phase: "idle",
            writerDone: false,
            iteration: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        this.save();
    }
    /**
     * Load status from disk
     */
    load() {
        const path = join(this.dir, STATUS_FILE);
        if (!existsSync(path)) {
            return null;
        }
        try {
            this.status = JSON.parse(readFileSync(path, "utf-8"));
            return this.status;
        }
        catch {
            return null;
        }
    }
    /**
     * Save status to disk
     */
    save() {
        if (!this.status)
            return;
        this.status.updatedAt = new Date().toISOString();
        mkdirSync(this.dir, { recursive: true });
        const path = join(this.dir, STATUS_FILE);
        writeFileSync(path, JSON.stringify(this.status, null, 2));
    }
    /**
     * Get current status
     */
    getStatus() {
        return this.status;
    }
    /**
     * Start a new write session
     */
    startWriting() {
        if (!this.status)
            this.init();
        this.status.phase = "writing";
        this.status.writerDone = false;
        this.status.iteration++;
        this.save();
    }
    /**
     * Mark writer as done
     */
    writerDone(message) {
        if (!this.status)
            return;
        this.status.writerDone = true;
        this.status.writerMessage = message;
        this.status.phase = "pending_review";
        this.save();
    }
    /**
     * Start reviewing
     */
    startReview() {
        if (!this.status)
            return;
        this.status.phase = "reviewing";
        this.status.reviewerStarted = new Date().toISOString();
        this.save();
    }
    /**
     * Record verdict
     */
    setVerdict(verdict, message) {
        if (!this.status)
            return;
        this.status.verdict = verdict;
        this.status.verdictMessage = message;
        switch (verdict) {
            case "approved":
                this.status.phase = "approved";
                this.status.approvedAt = new Date().toISOString();
                break;
            case "blocked":
                this.status.phase = "blocked";
                this.status.blockedAt = new Date().toISOString();
                break;
            case "changes_requested":
                this.status.phase = "changes_requested";
                break;
        }
        this.save();
    }
    /**
     * Record code files written
     */
    setCodeFiles(files) {
        if (!this.status)
            return;
        this.status.codeFiles = files;
        this.save();
    }
    /**
     * Record requested changes
     */
    setChangesRequested(changes) {
        if (!this.status)
            return;
        this.status.changesRequested = changes;
        this.save();
    }
    /**
     * Get current phase
     */
    getPhase() {
        return this.status?.phase ?? "idle";
    }
    /**
     * Get iteration number
     */
    getIteration() {
        return this.status?.iteration ?? 0;
    }
    /**
     * Check if build is allowed
     */
    canBuild() {
        return this.status?.phase === "approved";
    }
    /**
     * Get blackboard directory path
     */
    getPath() {
        return this.dir;
    }
    /**
     * Reset to idle
     */
    reset() {
        if (!this.status)
            return;
        this.status.phase = "idle";
        this.status.writerDone = false;
        this.status.verdict = undefined;
        this.status.verdictMessage = undefined;
        this.status.reviewerStarted = undefined;
        this.status.approvedAt = undefined;
        this.status.blockedAt = undefined;
        this.status.codeFiles = undefined;
        this.status.changesRequested = undefined;
        this.save();
    }
    /**
     * Check if a review session exists for this project
     */
    exists() {
        const path = join(this.dir, STATUS_FILE);
        return existsSync(path);
    }
    /**
     * Export status as markdown for display
     */
    toMarkdown() {
        if (!this.status)
            return "No active write-review session.";
        const { phase, iteration, verdict, verdictMessage, codeFiles } = this.status;
        const lines = [
            `## Write-Review Status`,
            ``,
            `| Field | Value |`,
            `|-------|-------|`,
            `| Phase | ${phase} |`,
            `| Iteration | ${iteration} |`,
            `| Verdict | ${verdict ?? "pending"} |`,
        ];
        if (verdictMessage) {
            lines.push(`| Message | ${verdictMessage} |`);
        }
        if (codeFiles && codeFiles.length > 0) {
            lines.push(``, `### Code Files`);
            for (const file of codeFiles) {
                lines.push(`- ${file}`);
            }
        }
        return lines.join("\n");
    }
}
/**
 * Create or get blackboard for project
 */
export function createBlackboard(projectPath, dir) {
    const bb = new WriteReviewBlackboard(projectPath, dir);
    if (!bb.exists()) {
        bb.init();
    }
    else {
        bb.load();
    }
    return bb;
}
