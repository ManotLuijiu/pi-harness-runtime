/**
 * Background Review Fork
 *
 * Background review that analyzes trajectories and suggests:
 * - Memory entries to persist
 * - Skills to create/update
 * - User preferences to learn
 *
 * Based on Hermes Agent's closed learning loop.
 */
/**
 * Default background review configuration
 */
export const DEFAULT_REVIEW_CONFIG = {
    enabled: true,
    nudgeInterval: 5,
    reasoningEffort: "medium",
    routeToCheaperModel: true,
    writeApproval: false,
    deferWhenGpuBusy: true,
    deferMaxAgeSeconds: 1800,
};
/**
 * Background Review Fork
 */
export class BackgroundReviewFork {
    config;
    cycleCount = 0;
    queuedReview = null;
    handlers = new Set();
    pendingSuggestions = [];
    constructor(config) {
        this.config = { ...DEFAULT_REVIEW_CONFIG, ...config };
    }
    /**
     * Update configuration
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
    }
    /**
     * Register event handler
     */
    on(handler) {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }
    /**
     * Emit event to all handlers
     */
    emit(event) {
        for (const handler of this.handlers) {
            try {
                handler(event);
            }
            catch (err) {
                console.error("[BackgroundReviewFork] Handler error:", err);
            }
        }
    }
    /**
     * Process cycle end - check if review should run
     */
    onCycleEnd(trajectory) {
        if (!this.config.enabled)
            return;
        this.cycleCount++;
        // Check if we should run review now
        if (this.cycleCount >= this.config.nudgeInterval) {
            this.cycleCount = 0;
            this.runReview(trajectory);
        }
        else {
            // Queue for later
            this.queuedReview = trajectory;
        }
    }
    /**
     * Run review on trajectory
     */
    async runReview(trajectory) {
        this.emit({ type: "review.started", trajectoryId: trajectory.id });
        try {
            const result = await this.analyzeTrajectory(trajectory);
            // Emit completion
            this.emit({ type: "review.completed", result });
            // Create suggestions
            for (const suggestion of result.suggestions) {
                this.emit({ type: "suggestion.created", suggestion });
                this.pendingSuggestions.push(suggestion);
            }
            // Clear queued review
            this.queuedReview = null;
            return result;
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.emit({ type: "review.error", error: errorMsg, trajectoryId: trajectory.id });
            throw err;
        }
    }
    /**
     * Analyze trajectory and generate suggestions
     */
    async analyzeTrajectory(trajectory) {
        const suggestions = [];
        const patterns = [];
        const corrections = [];
        // Analyze verdict
        if (trajectory.verdict === "blocked") {
            // Blocked cycles might need memory about blockers
            suggestions.push({
                id: `mem_blocked_${Date.now()}`,
                type: "memory",
                priority: "high",
                content: `Blocked cycle: ${trajectory.taskRequest}. Reason: ${trajectory.reason}`,
                reason: "Remember what caused blocks to avoid them",
                trajectoryId: trajectory.id,
            });
        }
        // Analyze iterations
        if (trajectory.iterations > 5) {
            // High iteration count might indicate pattern to optimize
            suggestions.push({
                id: `pat_high_iter_${Date.now()}`,
                type: "pattern",
                priority: "medium",
                content: `High iteration pattern: ${trajectory.taskRequest.slice(0, 100)}...`,
                reason: "Investigate why this task took many iterations",
                trajectoryId: trajectory.id,
            });
        }
        // Analyze files
        if (trajectory.files.length > 0) {
            // Check for repeated files across iterations
            const fileCount = {};
            for (const file of trajectory.files) {
                fileCount[file] = (fileCount[file] || 0) + 1;
            }
            // Files with high counts might need conventions
            for (const [file, count] of Object.entries(fileCount)) {
                if (count > 3) {
                    suggestions.push({
                        id: `conv_${Date.now()}`,
                        type: "memory",
                        priority: "low",
                        content: `Conventions for ${file}: Review patterns established in recent cycles`,
                        reason: `File ${file} appears frequently (${count}x)`,
                        trajectoryId: trajectory.id,
                    });
                }
            }
        }
        // Analyze comments for patterns
        for (const comment of trajectory.comments) {
            // Detect corrections (repeated comments)
            const commentText = comment.comment.toLowerCase();
            if (commentText.includes("same") || commentText.includes("again") || commentText.includes("repeated")) {
                corrections.push(comment.comment);
            }
            // Detect severity patterns
            if (comment.severity === "major" || comment.severity === "critical") {
                patterns.push(`high-severity: ${comment.comment.slice(0, 100)}`);
            }
        }
        // Generate skill suggestion for complex tasks
        if (trajectory.iterations >= 3 && trajectory.verdict === "approved") {
            suggestions.push({
                id: `skill_${Date.now()}`,
                type: "skill_create",
                priority: "medium",
                content: this.generateSkillFromTrajectory(trajectory),
                reason: "Complex task that succeeded - capture the pattern",
                trajectoryId: trajectory.id,
            });
        }
        // Analyze for user preferences
        if (trajectory.summary) {
            const userPrefs = this.extractUserPreferences(trajectory.summary);
            for (const pref of userPrefs) {
                suggestions.push({
                    id: `user_${Date.now()}`,
                    type: "user_profile",
                    priority: "low",
                    content: pref,
                    reason: "Detected from cycle summary",
                    trajectoryId: trajectory.id,
                });
            }
        }
        return {
            trajectoryId: trajectory.id,
            suggestions,
            patterns,
            corrections,
            timestamp: Date.now(),
        };
    }
    /**
     * Generate skill content from trajectory
     */
    generateSkillFromTrajectory(trajectory) {
        const lines = [];
        // Extract task type from request
        const taskType = this.extractTaskType(trajectory.taskRequest);
        lines.push(`---\n`);
        lines.push(`name: ${taskType}-pattern\n`);
        lines.push(`description: ${trajectory.taskRequest.slice(0, 200)}\n`);
        lines.push(`author: curator\n`);
        lines.push(`confidence: 0.7\n`);
        lines.push(`triggers:\n`);
        lines.push(`  - "${taskType}"\n`);
        lines.push(`  - "${trajectory.taskRequest.slice(0, 50)}"\n`);
        lines.push(`---\n\n`);
        lines.push(`# ${taskType} Pattern\n\n`);
        lines.push(`## When to Use\n`);
        lines.push(`Task: ${trajectory.taskRequest}\n\n`);
        lines.push(`## Procedure\n`);
        lines.push(`1. ${trajectory.plan.split("\n")[0] || "Plan based on task analysis"}\n\n`);
        lines.push(`## Key Files\n`);
        for (const file of trajectory.files.slice(0, 5)) {
            lines.push(`- ${file}\n`);
        }
        lines.push(`\n`);
        lines.push(`## Notes\n`);
        lines.push(`Iterations: ${trajectory.iterations}\n`);
        lines.push(`Duration: ${Math.round(trajectory.durationMs / 1000 / 60)} minutes\n\n`);
        if (trajectory.comments.length > 0) {
            lines.push(`## Common Issues\n`);
            for (const comment of trajectory.comments.slice(0, 3)) {
                lines.push(`- ${comment.comment}\n`);
            }
        }
        return lines.join("");
    }
    /**
     * Extract task type from request
     */
    extractTaskType(request) {
        const lower = request.toLowerCase();
        if (lower.includes("test"))
            return "testing";
        if (lower.includes("fix") || lower.includes("bug"))
            return "bugfix";
        if (lower.includes("refactor"))
            return "refactoring";
        if (lower.includes("api"))
            return "api-development";
        if (lower.includes("config") || lower.includes("setup"))
            return "configuration";
        if (lower.includes("deploy"))
            return "deployment";
        return "general-task";
    }
    /**
     * Extract user preferences from summary
     */
    extractUserPreferences(summary) {
        const prefs = [];
        const lower = summary.toLowerCase();
        // Detection patterns
        if (lower.includes("prefer") || lower.includes("like") || lower.includes("want")) {
            prefs.push(`Prefers concise responses where possible`);
        }
        if (lower.includes("style") || lower.includes("format")) {
            prefs.push(`Has specific code style preferences`);
        }
        if (lower.includes("error") || lower.includes("fix")) {
            prefs.push(`Focuses on fixing issues thoroughly`);
        }
        return prefs;
    }
    /**
     * Get pending suggestions
     */
    getPendingSuggestions() {
        return [...this.pendingSuggestions];
    }
    /**
     * Approve suggestion
     */
    approveSuggestion(suggestionId) {
        const index = this.pendingSuggestions.findIndex((s) => s.id === suggestionId);
        if (index < 0)
            return null;
        const suggestion = this.pendingSuggestions[index];
        this.pendingSuggestions.splice(index, 1);
        this.emit({ type: "suggestion.approved", suggestion });
        return suggestion;
    }
    /**
     * Reject suggestion
     */
    rejectSuggestion(suggestionId) {
        const index = this.pendingSuggestions.findIndex((s) => s.id === suggestionId);
        if (index < 0)
            return null;
        const suggestion = this.pendingSuggestions[index];
        this.pendingSuggestions.splice(index, 1);
        this.emit({ type: "suggestion.rejected", suggestion });
        return suggestion;
    }
    /**
     * Clear all pending suggestions
     */
    clearSuggestions() {
        this.pendingSuggestions = [];
    }
    /**
     * Get review stats
     */
    getStats() {
        return {
            cycleCount: this.cycleCount,
            pendingCount: this.pendingSuggestions.length,
            enabled: this.config.enabled,
            nudgeInterval: this.config.nudgeInterval,
        };
    }
}
// Global instance
let globalReviewFork = null;
export function getGlobalReviewFork() {
    if (!globalReviewFork) {
        globalReviewFork = new BackgroundReviewFork();
    }
    return globalReviewFork;
}
export function createReviewFork(config) {
    return new BackgroundReviewFork(config);
}
//# sourceMappingURL=review-fork.js.map