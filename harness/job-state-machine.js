/**
 * Job State Machine — RFC-0015
 *
 * Manages job lifecycle states with:
 * - Defined state transitions
 * - Event emission on every transition
 * - Automatic checkpointing
 * - Transition guards (validity checks)
 *
 * States:
 * created -> planning -> queued -> running -> testing -> e2e_testing ->
 * reviewing -> repairing -> paused_quota -> waiting_human -> ready_for_client -> archived
 */
// Valid transitions map
const VALID_TRANSITIONS = {
    created: ["planning"],
    planning: ["queued", "cancelled"],
    queued: ["running", "cancelled", "waiting_human"],
    running: [
        "testing",
        "reviewing",
        "repairing",
        "paused_quota",
        "blocked",
        "waiting_human",
        "cancelled",
    ],
    testing: [
        "reviewing",
        "running",
        "repairing",
        "paused_quota",
        "waiting_human",
        "cancelled",
    ],
    e2e_testing: [
        "reviewing",
        "repairing",
        "paused_quota",
        "waiting_human",
        "cancelled",
    ],
    reviewing: [
        "repairing",
        "running",
        "ready_for_client",
        "paused_quota",
        "waiting_human",
        "cancelled",
    ],
    repairing: [
        "running",
        "testing",
        "reviewing",
        "paused_quota",
        "waiting_human",
        "cancelled",
    ],
    paused_quota: ["running", "waiting_human", "cancelled"],
    waiting_human: ["running", "planning", "cancelled"],
    blocked: ["running", "waiting_human", "cancelled"],
    ready_for_client: ["archived", "repairing"],
    cancelled: [],
    archived: [],
};
export class JobStateMachine {
    options;
    currentCheckpoint = null;
    eventLog = [];
    constructor(options) {
        this.options = options;
    }
    /**
     * Initialize a new job with a requirement
     */
    async createJob(jobId, requirement) {
        const now = new Date().toISOString();
        const checkpoint = {
            version: 1,
            jobId,
            status: "created",
            requirement,
            createdAt: now,
            updatedAt: now,
        };
        const event = this.createEvent(jobId, "JobCreated", `Job ${jobId} created with requirement`, { requirement });
        try {
            await this.options.checkpointManager.save(checkpoint);
            await this.options.checkpointManager.appendEvent(jobId, event);
            this.currentCheckpoint = checkpoint;
            this.eventLog.push(event);
            return { success: true, checkpoint };
        }
        catch (error) {
            return { success: false, error: String(error) };
        }
    }
    /**
     * Resume a job from checkpoint
     */
    async resumeJob(jobId) {
        const checkpoint = await this.options.checkpointManager.load(jobId);
        if (!checkpoint) {
            return { success: false, error: `No checkpoint found for job ${jobId}` };
        }
        this.currentCheckpoint = checkpoint;
        return { success: true, checkpoint };
    }
    /**
     * Transition to a new state
     */
    async transition(to, data) {
        if (!this.currentCheckpoint) {
            return {
                success: false,
                error: "No active job. Call createJob() or resumeJob() first.",
            };
        }
        const from = this.currentCheckpoint.status;
        // Validate transition
        if (!this.isValidTransition(from, to)) {
            return {
                success: false,
                error: `Invalid transition: ${from} -> ${to}. Valid transitions: ${VALID_TRANSITIONS[from].join(", ") || "none"}`,
            };
        }
        // Create updated checkpoint
        const updated = {
            ...this.currentCheckpoint,
            status: to,
            updatedAt: new Date().toISOString(),
            ...data,
        };
        // Create event
        const event = this.createEvent(this.currentCheckpoint.jobId, `StateTransition:${from}->${to}`, `Transitioned from ${from} to ${to}`, { from, to, ...data });
        try {
            await this.options.checkpointManager.save(updated);
            await this.options.checkpointManager.appendEvent(this.currentCheckpoint.jobId, event);
            this.currentCheckpoint = updated;
            this.eventLog.push(event);
            return { success: true, checkpoint: updated };
        }
        catch (error) {
            return { success: false, error: String(error) };
        }
    }
    /**
     * Check if a transition is valid
     */
    isValidTransition(from, to) {
        return VALID_TRANSITIONS[from]?.includes(to) ?? false;
    }
    /**
     * Get available next states from current state
     */
    getAvailableTransitions() {
        if (!this.currentCheckpoint)
            return [];
        return VALID_TRANSITIONS[this.currentCheckpoint.status] ?? [];
    }
    /**
     * Get current checkpoint
     */
    getCheckpoint() {
        return this.currentCheckpoint;
    }
    /**
     * Get event log
     */
    getEventLog() {
        return [...this.eventLog];
    }
    /**
     * Set current task
     */
    async setCurrentTask(taskId) {
        return this.transition(this.currentCheckpoint.status, {
            currentTaskId: taskId,
        });
    }
    /**
     * Set provider
     */
    async setProvider(provider) {
        return this.transition(this.currentCheckpoint.status, { provider });
    }
    /**
     * Set resume time (for quota pause)
     */
    async setResumeTime(resumeAt) {
        if (!this.currentCheckpoint) {
            return { success: false, error: "No active job" };
        }
        this.currentCheckpoint.resumeAt = resumeAt;
        this.currentCheckpoint.updatedAt = new Date().toISOString();
        try {
            await this.options.checkpointManager.save(this.currentCheckpoint);
            return { success: true, checkpoint: this.currentCheckpoint };
        }
        catch (error) {
            return { success: false, error: String(error) };
        }
    }
    /**
     * Record an error
     */
    async recordError(error) {
        if (!this.currentCheckpoint) {
            return { success: false, error: "No active job" };
        }
        this.currentCheckpoint.lastError = error;
        this.currentCheckpoint.updatedAt = new Date().toISOString();
        try {
            await this.options.checkpointManager.save(this.currentCheckpoint);
            return { success: true, checkpoint: this.currentCheckpoint };
        }
        catch (error) {
            return { success: false, error: String(error) };
        }
    }
    /**
     * Check if job is in a terminal state
     */
    isTerminal() {
        if (!this.currentCheckpoint)
            return false;
        return ["ready_for_client", "cancelled", "archived"].includes(this.currentCheckpoint.status);
    }
    /**
     * Check if job can be resumed
     */
    canResume() {
        if (!this.currentCheckpoint)
            return false;
        return (this.currentCheckpoint.status === "paused_quota" ||
            this.currentCheckpoint.status === "blocked");
    }
    /**
     * Get job status summary
     */
    getStatusSummary() {
        if (!this.currentCheckpoint)
            return null;
        return {
            jobId: this.currentCheckpoint.jobId,
            status: this.currentCheckpoint.status,
            isTerminal: this.isTerminal(),
            canResume: this.canResume(),
        };
    }
    createEvent(jobId, type, message, data) {
        return {
            ts: new Date().toISOString(),
            jobId,
            type,
            message,
            data,
        };
    }
}
/**
 * Factory to create a state machine with a JsonCheckpointManager
 */
export async function createJobStateMachine(rootDir, jobId) {
    const { JsonCheckpointManager } = await import("../packages/checkpoint/src/checkpoint-manager.ts");
    const manager = new JsonCheckpointManager(rootDir);
    if (jobId) {
        const checkpoint = await manager.load(jobId);
        const machine = new JobStateMachine({ checkpointManager: manager });
        if (checkpoint) {
            machine.resumeJob(jobId);
        }
        return { machine, checkpoint };
    }
    const machine = new JobStateMachine({ checkpointManager: manager });
    return { machine, checkpoint: null };
}
