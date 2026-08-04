/**
 * Harness Notification Events — RFC-0022
 *
 * Integrates NotificationCenter with the harness runtime.
 * Sends mobile alerts for all runtime events.
 *
 * Events:
 *   JobStarted, TaskCompleted, TaskFailed, QuotaPaused,
 *   ResumeScheduled, ContextCompacted, OutputLimitContinued,
 *   E2EFailed, HumanReviewNeeded, ReadyForClient, JobCancelled, Error
 */
import { NotificationCenter } from "../packages/notification/notification-center.js";
export class HarnessNotificationEvents {
    center;
    config;
    machine = null;
    graph = null;
    constructor(config) {
        this.config = config;
        this.center = new NotificationCenter(config.notificationConfig);
    }
    /**
     * Initialize the notification center
     */
    async initialize() {
        await this.center.initialize();
    }
    /**
     * Attach to job state machine to receive events
     */
    attachToMachine(machine) {
        this.machine = machine;
    }
    /**
     * Attach to task graph to get task info
     */
    attachToGraph(graph) {
        this.graph = graph;
    }
    /**
     * Check if notifications are configured
     */
    hasChannels() {
        return this.center.hasChannels();
    }
    /**
     * List configured channels
     */
    listChannels() {
        return this.center.listChannels();
    }
    // --- Event Emitters ------------------------------------------------
    /**
     * Emit JobStarted event
     */
    async emitJobStarted() {
        await this.emit("JobStarted");
    }
    /**
     * Emit TaskCompleted event
     */
    async emitTaskCompleted(taskId, taskTitle) {
        await this.emit("TaskCompleted", { taskId, taskTitle });
    }
    /**
     * Emit TaskFailed event
     */
    async emitTaskFailed(taskId, taskTitle, error) {
        await this.emit("TaskFailed", { taskId, taskTitle, error });
    }
    /**
     * Emit QuotaPaused event
     */
    async emitQuotaPaused(resumeAt) {
        await this.emit("QuotaPaused", {
            error: resumeAt ? `Resumes at ${resumeAt}` : undefined,
        });
    }
    /**
     * Emit ResumeScheduled event
     */
    async emitResumeScheduled(resumeAt) {
        await this.emit("ResumeScheduled", { error: resumeAt });
    }
    /**
     * Emit ContextCompacted event
     */
    async emitContextCompacted(tokensCompacted) {
        await this.emit("ContextCompacted", {
            error: tokensCompacted
                ? `Compacted ${tokensCompacted.toLocaleString()} tokens`
                : undefined,
        });
    }
    /**
     * Emit OutputLimitContinued event
     */
    async emitOutputLimitContinued(attempt) {
        await this.emit("OutputLimitContinued", {
            error: `Attempt ${attempt}`,
        });
    }
    /**
     * Emit E2EFailed event
     */
    async emitE2EFailed(scenarioId) {
        await this.emit("E2EFailed", {
            error: scenarioId ? `Scenario: ${scenarioId}` : undefined,
        });
    }
    /**
     * Emit HumanReviewNeeded event
     */
    async emitHumanReviewNeeded(taskId, reason) {
        await this.emit("HumanReviewNeeded", { taskId, error: reason });
    }
    /**
     * Emit ReadyForClient event
     */
    async emitReadyForClient() {
        await this.emit("ReadyForClient");
    }
    /**
     * Emit JobCancelled event
     */
    async emitJobCancelled(reason) {
        await this.emit("JobCancelled", { error: reason });
    }
    /**
     * Emit Error event
     */
    async emitError(error) {
        await this.emit("Error", { error });
    }
    // --- State Machine Event Listeners ---------------------------------
    /**
     * Wire up with JobStateMachine to emit events on transitions
     */
    wireWithStateMachine(machine) {
        this.machine = machine;
        // Listen to state machine events via polling or callback
        // This would need the state machine to emit events
    }
    /**
     * Check current state and emit appropriate events
     */
    async checkAndEmitStateChange(oldState, newState) {
        // Map state machine states to notification events
        const stateEventMap = {
            paused_quota: "QuotaPaused",
            waiting_human: "HumanReviewNeeded",
            ready_for_client: "ReadyForClient",
            cancelled: "JobCancelled",
            planning: "JobStarted",
        };
        const event = stateEventMap[newState];
        if (event) {
            await this.emit(event);
        }
    }
    // --- Private Methods -----------------------------------------------
    async emit(event, extra) {
        if (!this.center.hasChannels()) {
            return; // No channels configured, skip
        }
        const context = {
            jobId: this.config.jobId,
            requirement: this.config.requirement,
            ...extra,
        };
        try {
            const results = await this.center.notify(event, context);
            // Log results (but don't fail if notification fails)
            for (const result of results) {
                if (!result.success) {
                    console.warn(`[NotificationEvents] Failed to send ${event} to ${result.channel}: ${result.error}`);
                }
            }
        }
        catch (error) {
            // Never crash the runtime due to notification failure
            console.error(`[NotificationEvents] Notification error: ${error}`);
        }
    }
}
/**
 * Create notification config from environment variables
 */
export function createNotificationConfigFromEnv() {
    const channels = [];
    // Telegram
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        channels.push({
            id: "telegram",
            type: "telegram",
            enabled: true,
            config: {
                botToken: process.env.TELEGRAM_BOT_TOKEN,
                chatId: process.env.TELEGRAM_CHAT_ID,
            },
        });
    }
    // Ntfy
    if (process.env.NTFY_TOPIC) {
        channels.push({
            id: "ntfy",
            type: "ntfy",
            enabled: true,
            config: {
                server: process.env.NTFY_SERVER ?? "https://ntfy.sh",
                topic: process.env.NTFY_TOPIC,
                authToken: process.env.NTFY_TOKEN,
            },
        });
    }
    // Webhook
    if (process.env.NOTIFICATION_WEBHOOK_URL) {
        channels.push({
            id: "webhook",
            type: "webhook",
            enabled: true,
            config: {
                url: process.env.NOTIFICATION_WEBHOOK_URL,
                method: process.env.NOTIFICATION_WEBHOOK_METHOD ?? "POST",
                authToken: process.env.NOTIFICATION_WEBHOOK_TOKEN,
            },
        });
    }
    if (channels.length === 0) {
        return undefined;
    }
    return { channels, enabled: true };
}
