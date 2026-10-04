/**
 * Write Approval Gate
 *
 * Stage writes (memory, skills) for human review before they land.
 * Based on Hermes Agent's consent-aware learning loop.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
/**
 * Default configuration
 */
export const DEFAULT_APPROVAL_CONFIG = {
    enabled: false,
    pendingDir: "~/.pi-harness/pending",
    maxPending: 50,
};
/**
 * Expand path with ~
 */
function expandPath(path) {
    if (path.startsWith("~/")) {
        return join(homedir(), path.slice(2));
    }
    return path;
}
/**
 * Write Approval Gate
 */
export class WriteApprovalGate {
    config;
    pending = [];
    constructor(config) {
        this.config = { ...DEFAULT_APPROVAL_CONFIG, ...config };
        this.config.pendingDir = expandPath(this.config.pendingDir);
        this.load();
    }
    /**
     * Load pending writes from disk
     */
    load() {
        const pendingFile = join(this.config.pendingDir, "writes.json");
        if (!existsSync(pendingFile)) {
            this.pending = [];
            return;
        }
        try {
            const content = readFileSync(pendingFile, "utf-8");
            this.pending = JSON.parse(content);
        }
        catch (err) {
            console.error("[WriteApprovalGate] Failed to load:", err);
            this.pending = [];
        }
    }
    /**
     * Save pending writes to disk
     */
    save() {
        mkdirSync(this.config.pendingDir, { recursive: true });
        const pendingFile = join(this.config.pendingDir, "writes.json");
        writeFileSync(pendingFile, JSON.stringify(this.pending, null, 2), "utf-8");
    }
    /**
     * Stage a write for approval
     */
    stage(action, author) {
        // Generate ID
        const id = `pw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        // Generate summary
        const summary = this.generateSummary(action);
        // Generate details (diff)
        const details = this.generateDetails(action);
        const pending = {
            id,
            action,
            author,
            timestamp: Date.now(),
            summary,
            details,
        };
        this.pending.push(pending);
        this.save();
        return pending;
    }
    /**
     * Generate one-line summary for action
     */
    generateSummary(action) {
        switch (action.type) {
            case "memory_add":
                return `Add memory: "${action.content?.slice(0, 50)}..."`;
            case "memory_replace":
                return `Replace memory`;
            case "memory_remove":
                return `Remove memory`;
            case "skill_create":
                return `Create skill: ${action.target}`;
            case "skill_patch":
                return `Patch skill: ${action.target}`;
            case "skill_delete":
                return `Delete skill: ${action.target}`;
            case "skill_file_write":
                return `Write file to skill ${action.target}: ${action.metadata?.file}`;
            case "skill_file_remove":
                return `Remove file from skill ${action.target}: ${action.metadata?.file}`;
            case "user_profile_add":
                return `Add user preference: "${action.content?.slice(0, 50)}..."`;
            default:
                return `Unknown action: ${action.type}`;
        }
    }
    /**
     * Generate details (diff) for action
     */
    generateDetails(action) {
        switch (action.type) {
            case "memory_add":
            case "user_profile_add":
                return action.content;
            case "memory_replace":
                return `OLD:\n${action.oldContent}\n\nNEW:\n${action.content}`;
            case "skill_create":
            case "skill_patch":
                return action.content;
            default:
                return undefined;
        }
    }
    /**
     * Approve a pending write
     */
    approve(writeId) {
        const index = this.pending.findIndex((w) => w.id === writeId);
        if (index < 0)
            return null;
        const write = this.pending[index];
        this.pending.splice(index, 1);
        this.save();
        return write;
    }
    /**
     * Approve all pending writes
     */
    approveAll() {
        const approved = [...this.pending];
        this.pending = [];
        this.save();
        return approved;
    }
    /**
     * Reject a pending write
     */
    reject(writeId) {
        const index = this.pending.findIndex((w) => w.id === writeId);
        if (index < 0)
            return null;
        const write = this.pending[index];
        this.pending.splice(index, 1);
        this.save();
        return write;
    }
    /**
     * Reject all pending writes
     */
    rejectAll() {
        const rejected = [...this.pending];
        this.pending = [];
        this.save();
        return rejected;
    }
    /**
     * Get all pending writes
     */
    list() {
        return [...this.pending];
    }
    /**
     * Get pending writes by type
     */
    listByType(type) {
        return this.pending.filter((w) => w.action.type === type);
    }
    /**
     * Get pending writes by author
     */
    listByAuthor(author) {
        return this.pending.filter((w) => w.author === author);
    }
    /**
     * Get pending count
     */
    count() {
        return this.pending.length;
    }
    /**
     * Check if approval is required
     */
    requiresApproval() {
        return this.config.enabled;
    }
    /**
     * Update configuration
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
        if (config.pendingDir) {
            this.config.pendingDir = expandPath(config.pendingDir);
        }
    }
    /**
     * Get configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Format pending writes for display
     */
    formatList() {
        if (this.pending.length === 0) {
            return "No pending writes.";
        }
        const lines = [];
        for (const write of this.pending) {
            const age = this.getAgeString(write.timestamp);
            lines.push(`[${write.id}] ${age} ${write.author}: ${write.summary}`);
        }
        return lines.join("\n");
    }
    /**
     * Get age string for timestamp
     */
    getAgeString(timestamp) {
        const age = Date.now() - timestamp;
        const minutes = Math.floor(age / 60000);
        if (minutes < 1)
            return "<1m";
        if (minutes < 60)
            return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24)
            return `${hours}h`;
        const days = Math.floor(hours / 24);
        return `${days}d`;
    }
}
// Global instance
let globalGate = null;
export function getGlobalApprovalGate() {
    if (!globalGate) {
        globalGate = new WriteApprovalGate();
    }
    return globalGate;
}
export function createApprovalGate(config) {
    return new WriteApprovalGate(config);
}
/**
 * Helper to stage write with auto-approval if disabled
 */
export function stageWrite(action, author, autoApprove = false) {
    const gate = getGlobalApprovalGate();
    if (!gate.requiresApproval() || autoApprove) {
        // Return action directly for execution
        return {
            staged: false,
            write: {
                id: "auto",
                action,
                author,
                timestamp: Date.now(),
                summary: `Auto-approved: ${action.type}`,
            },
        };
    }
    // Stage for approval
    const write = gate.stage(action, author);
    return { staged: true, write };
}
//# sourceMappingURL=write-approval.js.map