/**
 * Ntfy Adapter — RFC-0022
 *
 * Sends notifications via ntfy.sh (or self-hosted ntfy server).
 */
import { BaseChannelAdapter } from "../base-adapter.js";
export class NtfyAdapter extends BaseChannelAdapter {
    id = "ntfy";
    type = "ntfy";
    constructor(config) {
        super({ id: "ntfy", type: "ntfy", enabled: true, config });
    }
    async initialize() {
        // Ntfy doesn't require initialization; it's fire-and-forget
        return true;
    }
    async send(payload) {
        try {
            const cfg = this.config.config;
            const message = this.formatMessage(payload);
            const headers = {
                "Content-Type": "text/plain",
                Title: payload.title,
                Tags: this.getTags(payload.event),
            };
            // Add auth if configured
            if (cfg.authToken) {
                headers["Authorization"] = `Bearer ${cfg.authToken}`;
            }
            const response = await fetch(`${cfg.server}/${cfg.topic}`, {
                method: "POST",
                headers,
                body: message,
            });
            if (!response.ok) {
                const error = await response.text();
                return {
                    success: false,
                    channel: this.id,
                    error: `Ntfy error: ${error}`,
                };
            }
            return { success: true, channel: this.id };
        }
        catch (error) {
            return {
                success: false,
                channel: this.id,
                error: String(error),
            };
        }
    }
    formatMessage(payload) {
        const lines = [payload.message];
        if (payload.details?.taskTitle) {
            lines.push(`\nTask: ${payload.details.taskTitle}`);
        }
        if (payload.details?.jobId) {
            lines.push(`Job: ${payload.details.jobId}`);
        }
        if (payload.details?.error) {
            lines.push(`\nError: ${payload.details.error}`);
        }
        return lines.join("");
    }
    getTags(event) {
        const map = {
            JobStarted: "rocket",
            TaskCompleted: "white_check_mark",
            TaskFailed: "x",
            QuotaPaused: "pause_button",
            ResumeScheduled: "play_button",
            ContextCompacted: "package",
            OutputLimitContinued: "repeat",
            E2EFailed: "test_tube",
            HumanReviewNeeded: "bust_in_silhouette",
            ReadyForClient: "tada",
            JobCancelled: "no_entry",
            Error: "warning",
        };
        return map[event] ?? "bell";
    }
}
