/**
 * Repair Engine — RFC-0018
 *
 * Converts failures into repair tasks with retry policy and escalation.
 */
import { appendJsonl } from "../cli.ts";
// @ts-expect-error - Bun has built-in Node.js types
import { join, dirname } from "node:path";
// @ts-expect-error - Bun has built-in Node.js types
import { mkdirSync } from "node:fs";
const DEFAULT_RETRY_POLICY = {
    maxRetries: 3,
    backoffMs: 5000,
    backoffMultiplier: 2,
    escalationAfter: 2,
};
const FAILURE_PATTERNS = {
    "test failed": "test_failure",
    "assertion failed": "test_failure",
    TypeError: "type_error",
    SyntaxError: "build_error",
    ESLint: "lint_error",
    "build failed": "build_error",
    "compilation error": "build_error",
    quota: "quota_exhausted",
    "rate limit": "quota_exhausted",
    "429": "quota_exhausted",
    "500": "provider_error",
    "502": "provider_error",
    "503": "provider_error",
    connection: "provider_error",
    timeout: "provider_error",
};
export class RepairEngine {
    repairTasks = new Map();
    rootDir;
    constructor(rootDir) {
        this.rootDir = rootDir;
    }
    /**
     * Classify a failure type from error message
     */
    classifyFailure(errorMessage) {
        const lower = errorMessage.toLowerCase();
        for (const [pattern, type] of Object.entries(FAILURE_PATTERNS)) {
            if (lower.includes(pattern.toLowerCase())) {
                return type;
            }
        }
        return "unknown";
    }
    /**
     * Create a repair task from a failed task
     */
    createRepairTask(originalTaskId, failureType, errorMessage, options) {
        const id = `repair-${originalTaskId}-${Date.now()}`;
        const retryPolicy = {
            ...DEFAULT_RETRY_POLICY,
            ...options?.retryPolicy,
        };
        const task = {
            id,
            originalTaskId,
            failureType,
            description: `Fix failure in task ${originalTaskId}: ${errorMessage}`,
            attemptedFixes: [],
            status: "pending",
            retryPolicy,
            createdAt: new Date().toISOString(),
        };
        this.repairTasks.set(id, task);
        return task;
    }
    /**
     * Record an attempted fix
     */
    recordAttempt(repairTaskId, description, success, output) {
        const task = this.repairTasks.get(repairTaskId);
        if (!task)
            return;
        const attempt = {
            attempt: task.attemptedFixes.length + 1,
            description,
            success,
            output,
            timestamp: new Date().toISOString(),
        };
        task.attemptedFixes.push(attempt);
        if (success) {
            task.status = "resolved";
            task.resolvedAt = new Date().toISOString();
        }
        else if (attempt.attempt >= task.retryPolicy.maxRetries) {
            // Check if should escalate
            if (task.retryPolicy.escalationAfter &&
                attempt.attempt >= task.retryPolicy.escalationAfter) {
                task.status = "escalated";
            }
        }
        this.repairTasks.set(repairTaskId, task);
        this.saveRepairTask(task);
    }
    /**
     * Get the next retry delay in milliseconds
     */
    getNextRetryDelay(repairTaskId) {
        const task = this.repairTasks.get(repairTaskId);
        if (!task)
            return null;
        const attempt = task.attemptedFixes.length;
        if (attempt >= task.retryPolicy.maxRetries)
            return null;
        const { backoffMs, backoffMultiplier } = task.retryPolicy;
        return backoffMs * backoffMultiplier ** attempt;
    }
    /**
     * Check if repair task should escalate to human
     */
    shouldEscalate(repairTaskId) {
        const task = this.repairTasks.get(repairTaskId);
        if (!task)
            return false;
        return task.status === "escalated";
    }
    /**
     * Get all repair tasks for a job
     */
    getRepairTasks(jobId) {
        // const path = join(this.rootDir, "jobs", jobId, "repair-tasks.jsonl");
        // In practice, this would read from file. For now, return in-memory.
        return Array.from(this.repairTasks.values()).filter((t) => t.originalTaskId.startsWith(`task-${jobId}`));
    }
    /**
     * Get repair summary
     */
    getSummary(jobId) {
        const tasks = this.getRepairTasks(jobId);
        return {
            total: tasks.length,
            pending: tasks.filter((t) => t.status === "pending" || t.status === "in_progress").length,
            resolved: tasks.filter((t) => t.status === "resolved").length,
            escalated: tasks.filter((t) => t.status === "escalated").length,
        };
    }
    /**
     * Analyze a failure and create repair task with guidance
     */
    analyzeAndRepair(originalTaskId, errorMessage, options) {
        const failureType = this.classifyFailure(errorMessage);
        const repairTask = this.createRepairTask(originalTaskId, failureType, errorMessage, options);
        const guidance = this.generateGuidance(repairTask);
        return { repairTask, guidance };
    }
    /**
     * Generate repair guidance based on failure type
     */
    generateGuidance(repairTask) {
        switch (repairTask.failureType) {
            case "test_failure":
                return `Analyze the failing test. Check:
1. Is the test correct? (Does it test what it claims?)
2. Is the implementation correct? (Does it match the expected behavior?)
3. Are there any recent changes that broke the test?
4. Are there any environment-specific issues?`;
            case "build_error":
                return `Check the build error details:
1. Look at the exact error message and line number
2. Check for missing imports or type mismatches
3. Verify all dependencies are installed
4. Check for circular dependencies`;
            case "type_error":
                return `Fix TypeScript/JavaScript type errors:
1. Check the type of each variable
2. Ensure type assertions are correct
3. Verify interface/type definitions match usage
4. Consider adding type guards if needed`;
            case "lint_error":
                return `Fix linting errors:
1. Review the linting rules being violated
2. Check if code style matches project conventions
3. Run linter with --fix if available
4. Update eslint/prettier config if needed`;
            case "quota_exhausted":
                return `Quota exhausted. Options:
1. Wait for quota reset
2. Switch to an alternative provider
3. Optimize prompts to use fewer tokens
4. Reduce task scope to fit within quota`;
            case "provider_error":
                return `Provider error. Actions:
1. Retry with exponential backoff
2. Check provider status page
3. Switch to fallback provider if available
4. Log error details for debugging`;
            case "e2e_failure":
                return `E2E test failed. Check:
1. Is the page/app in the expected state?
2. Are selectors still valid?
3. Is there a timing issue (need to wait longer)?
4. Is the test assertion correct?`;
            default:
                return `Unknown failure. Gather more information:
1. Collect full error stack trace
2. Check system logs
3. Reproduce the issue locally
4. Consider asking for human assistance`;
        }
    }
    /**
     * Save repair task to file
     */
    saveRepairTask(task) {
        const path = join(this.rootDir, "jobs", task.originalTaskId.split("-")[1] ?? "unknown", "repair-tasks.jsonl");
        mkdirSync(dirname(path), { recursive: true });
        appendJsonl(path, task);
    }
    /**
     * Load repair tasks from file
     */
    loadRepairTasks(_jobId) {
        // const path = join(this.rootDir, "jobs", _jobId, "repair-tasks.jsonl");
        // In practice, this would read from file and populate the map
    }
    /**
     * Export repair report
     */
    exportReport(jobId) {
        const tasks = this.getRepairTasks(jobId);
        const summary = this.getSummary(jobId);
        const lines = [
            `Repair Report for Job ${jobId}`,
            "=".repeat(50),
            `Total: ${summary.total}`,
            `Pending: ${summary.pending}`,
            `Resolved: ${summary.resolved}`,
            `Escalated: ${summary.escalated}`,
            "",
            "Details:",
            "-".repeat(50),
        ];
        for (const task of tasks) {
            lines.push(`\n[${task.status.toUpperCase()}] ${task.id}`);
            lines.push(`  Original: ${task.originalTaskId}`);
            lines.push(`  Type: ${task.failureType}`);
            lines.push(`  Description: ${task.description}`);
            lines.push(`  Attempts: ${task.attemptedFixes.length}/${task.retryPolicy.maxRetries}`);
            if (task.attemptedFixes.length > 0) {
                lines.push("  Attempt History:");
                for (const fix of task.attemptedFixes) {
                    lines.push(`    - [${fix.success ? "✓" : "✗"}] ${fix.description}`);
                }
            }
        }
        return lines.join("\n");
    }
}
