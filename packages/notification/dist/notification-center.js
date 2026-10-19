/**
 * Notification Center — RFC-0022
 *
 * Main orchestration class for sending notifications across multiple channels.
 *
 * Security Rules (RFC-0022):
 * - Do not send raw cookies, passwords, provider tokens
 * - Redact sensitive data before sending
 * - Notification failure does not crash runtime
 */
import { logError, logWarn } from "./file-logger.js";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { DatabaseSync } from "node:sqlite";
import { TelegramAdapter } from "./adapters/telegram-adapter.js";
import { buildCallbackData, CallbackActions } from "./telegram-webhook-handler.js";
import { LineAdapter } from "./adapters/line-adapter.js";
import { NtfyAdapter } from "./adapters/ntfy-adapter.js";
import { EmailAdapter } from "./adapters/email-adapter.js";
import { WebhookAdapter } from "./adapters/webhook-adapter.js";
export class NotificationCenter {
    adapters = new Map();
    channelEnabled = new Map();
    redactPatterns;
    db = null;
    /** Pending approval requests keyed by jobId */
    pendingApprovals = new Map();
    /**
     * Get SQLite database path
     */
    static getDatabasePath() {
        const home = process.env.HOME || process.env.USERPROFILE || "/home/frappe";
        const dir = join(home, ".pi-harness-runtime");
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        return join(dir, "notification-settings.sqlite");
    }
    /**
     * Initialize SQLite database
     */
    initDatabase() {
        try {
            const dbPath = NotificationCenter.getDatabasePath();
            this.db = new DatabaseSync(dbPath);
            // Create tables
            this.db.exec(`
				CREATE TABLE IF NOT EXISTS channel_settings (
					channel_id TEXT PRIMARY KEY,
					enabled INTEGER NOT NULL DEFAULT 1,
					updated_at TEXT DEFAULT CURRENT_TIMESTAMP
				);
			`);
            // Load existing settings
            const stmt = this.db.prepare("SELECT channel_id, enabled FROM channel_settings");
            const rows = stmt.all();
            for (const row of rows) {
                this.channelEnabled.set(row.channel_id, row.enabled === 1);
            }
            logWarn("[NotificationCenter]", `Loaded ${rows.length} channel settings from SQLite`);
        }
        catch (e) {
            logError("[NotificationCenter]", `Failed to init database: ${e}`);
        }
    }
    /**
     * Save channel settings to SQLite
     */
    saveChannelSettings() {
        if (!this.db)
            return;
        try {
            const stmt = this.db.prepare(`
				INSERT OR REPLACE INTO channel_settings (channel_id, enabled, updated_at)
				VALUES (?, ?, CURRENT_TIMESTAMP)
			`);
            for (const [id, enabled] of this.channelEnabled.entries()) {
                stmt.run(id, enabled ? 1 : 0);
            }
        }
        catch (e) {
            logError("[NotificationCenter]", `Failed to save settings: ${e}`);
        }
    }
    /**
     * Track a new pending approval request
     */
    trackPendingApproval(jobId, event, context) {
        this.pendingApprovals.set(jobId, {
            jobId,
            event,
            context,
            createdAt: new Date(),
            resolved: false,
        });
    }
    /**
     * Resolve a pending approval request
     * @returns true if the request was found and resolved, false otherwise
     */
    resolvePendingApproval(jobId, result) {
        const pending = this.pendingApprovals.get(jobId);
        if (!pending || pending.resolved) {
            return false;
        }
        pending.resolved = true;
        pending.result = result;
        return true;
    }
    /**
     * Get a pending approval request
     */
    getPendingApproval(jobId) {
        return this.pendingApprovals.get(jobId);
    }
    /**
     * Check if a pending approval exists and is unresolved
     */
    isPendingApproval(jobId) {
        const pending = this.pendingApprovals.get(jobId);
        return !!pending && !pending.resolved;
    }
    /**
     * Clear resolved pending approvals older than maxAgeMs
     */
    cleanupResolvedApprovals(maxAgeMs = 60000) {
        const now = Date.now();
        for (const [jobId, pending] of this.pendingApprovals.entries()) {
            if (pending.resolved &&
                now - pending.createdAt.getTime() > maxAgeMs) {
                this.pendingApprovals.delete(jobId);
            }
        }
    }
    constructor(config) {
        this.redactPatterns =
            config?.redactPatterns ?? this.getDefaultRedactPatterns();
        // Initialize SQLite database and load settings
        this.initDatabase();
        if (config?.channels) {
            for (const channelConfig of config.channels) {
                if (channelConfig.enabled) {
                    this.registerAdapter(channelConfig);
                    // Set default enabled state (will be overridden by loaded settings)
                    if (!this.channelEnabled.has(channelConfig.id)) {
                        this.channelEnabled.set(channelConfig.id, true);
                    }
                }
            }
        }
    }
    /**
     * Register a new adapter
     */
    registerAdapter(config) {
        try {
            const adapter = this.createAdapter(config);
            if (adapter && adapter.isConfigured()) {
                this.adapters.set(config.id, adapter);
                return true;
            }
        }
        catch (error) {
            logError("[NotificationCenter]", `Failed to register adapter: ${error}`);
        }
        return false;
    }
    /**
     * Initialize all registered adapters
     */
    async initialize() {
        const adapterEntries = Array.from(this.adapters.entries());
        for (const [id, adapter] of adapterEntries) {
            // Initialize channel enabled state
            this.channelEnabled.set(id, true);
            try {
                const ok = await adapter.initialize();
                if (!ok) {
                    logWarn("[NotificationCenter]", `Adapter ${id} initialization failed`);
                }
            }
            catch (error) {
                logWarn("[NotificationCenter]", `Adapter ${id} initialization error: ${error}`);
            }
        }
    }
    /**
     * Check if a channel is enabled
     */
    isChannelEnabled(channelId) {
        return this.channelEnabled.get(channelId) ?? false;
    }
    /**
     * Set channel enabled/disabled state
     */
    setChannelEnabled(channelId, enabled) {
        this.channelEnabled.set(channelId, enabled);
        this.saveChannelSettings();
        logWarn("[NotificationCenter]", `Channel ${channelId} ${enabled ? "enabled" : "disabled"}`);
    }
    /**
     * Toggle a channel's enabled state
     */
    toggleChannel(channelId) {
        const current = this.isChannelEnabled(channelId);
        this.setChannelEnabled(channelId, !current);
        return !current;
    }
    /**
     * Build channel toggle buttons for inline keyboard
     */
    buildToggleButtons() {
        const buttons = [];
        // Add Telegram toggle if adapter exists
        if (this.adapters.has("telegram")) {
            const isEnabled = this.isChannelEnabled("telegram");
            const icon = isEnabled ? "\u2705" : "\u2744";
            buttons.push({
                text: `${icon} Telegram: ${isEnabled ? "ON" : "OFF"}`,
                callbackData: buildCallbackData("toggle_telegram", "settings"),
            });
        }
        // Add LINE toggle if adapter exists
        if (this.adapters.has("line")) {
            const isEnabled = this.isChannelEnabled("line");
            const icon = isEnabled ? "\u2705" : "\u2744";
            buttons.push({
                text: `${icon} LINE: ${isEnabled ? "ON" : "OFF"}`,
                callbackData: buildCallbackData("toggle_line", "settings"),
            });
        }
        return buttons;
    }
    /**
     * Set callback handler for Telegram adapters
     * Enables handling of inline keyboard button clicks (approve/reject)
     */
    setCallbackHandler(handler) {
        for (const [, adapter] of this.adapters) {
            if (adapter instanceof TelegramAdapter) {
                adapter.setCallbackHandler(handler);
            }
        }
    }
    /**
     * Set message handler for inbound Telegram messages (forwarded to Pi)
     */
    setMessageHandler(handler) {
        for (const [, adapter] of this.adapters) {
            if (adapter instanceof TelegramAdapter) {
                adapter.setMessageHandler(handler);
            }
        }
    }
    /**
     * Send a notification to all configured channels
     */
    async notify(event, context, options) {
        const includeToggles = options?.includeToggles ?? true;
        // Build payload
        const payload = this.buildPayload(event, context);
        // Add toggle buttons if enabled
        if (includeToggles && (this.adapters.size > 1 || this.adapters.has("telegram"))) {
            payload.actionButtons = this.buildToggleButtons();
            payload.enableInlineKeyboard = true;
        }
        const results = [];
        // Send to all adapters in parallel
        const adapterEntries = Array.from(this.adapters.entries());
        await Promise.all(adapterEntries.map(async ([id, adapter]) => {
            try {
                // Check if channel is enabled
                if (!this.isChannelEnabled(id)) {
                    return { success: true, channel: id, skipped: true };
                }
                // Redact sensitive data
                const redactedPayload = this.redact(payload);
                const result = await adapter.send(redactedPayload);
                return { success: true, channel: id, result };
            }
            catch (error) {
                // Never crash the runtime due to notification failure
                return {
                    success: false,
                    channel: id,
                    error: String(error),
                };
            }
        })).then((adapterResults) => {
            results.push(...adapterResults);
        });
        return results;
    }
    /**
     * Send notification to a specific channel
     */
    async notifyChannel(channelId, event, context) {
        const adapter = this.adapters.get(channelId);
        if (!adapter) {
            return { success: false, channel: channelId, error: "Adapter not found" };
        }
        try {
            const payload = this.redact(this.buildPayload(event, context));
            return await adapter.send(payload);
        }
        catch (error) {
            return { success: false, channel: channelId, error: String(error) };
        }
    }
    /**
     * Check if any notifications are configured
     */
    hasChannels() {
        return this.adapters.size > 0;
    }
    /**
     * Check if any adapter is healthy (initialized and working)
     * Unlike hasChannels(), this verifies actual health, not just config
     */
    hasHealthyChannels() {
        for (const [, adapter] of this.adapters) {
            if (adapter.isHealthy()) {
                return true;
            }
        }
        return false;
    }
    /**
     * List all configured channels
     */
    listChannels() {
        return Array.from(this.adapters.keys());
    }
    /**
     * Get Telegram bot username if configured
     */
    getTelegramBotUsername() {
        const adapter = this.adapters.get("telegram");
        if (adapter instanceof TelegramAdapter) {
            return adapter.botUsername;
        }
        return undefined;
    }
    /**
     * Get Telegram adapter for advanced operations (webhook setup, etc.)
     */
    getTelegramAdapter() {
        const adapter = this.adapters.get("telegram");
        if (adapter instanceof TelegramAdapter) {
            return adapter;
        }
        return undefined;
    }
    /**
     * Set callback handler for Telegram inline keyboard button clicks
     */
    setTelegramCallbackHandler(handler) {
        const adapter = this.adapters.get("telegram");
        if (adapter instanceof TelegramAdapter) {
            adapter.setCallbackHandler(handler);
        }
    }
    /**
     * Set webhook secret for Telegram updates verification
     */
    setTelegramWebhookSecret(secret) {
        const adapter = this.adapters.get("telegram");
        if (adapter instanceof TelegramAdapter) {
            adapter.setWebhookSecret(secret);
        }
    }
    /**
     * Setup Telegram webhook for receiving updates
     */
    async setupTelegramWebhook(webhookUrl) {
        const adapter = this.adapters.get("telegram");
        if (adapter instanceof TelegramAdapter) {
            const result = await adapter.setupWebhook(webhookUrl);
            if (result) {
                adapter.setWebhookActive(true);
            }
            return result;
        }
        return false;
    }
    /**
     * Send notification with interactive Yes/No buttons
     */
    async notifyWithApproval(event, context, options) {
        const approveLabel = options?.approveLabel ?? "Yes";
        const rejectLabel = options?.rejectLabel ?? "No";
        // Build buttons
        const buttons = [
            { text: `\u2705 ${approveLabel}`, callbackData: buildCallbackData(CallbackActions.APPROVE, context.jobId) },
            { text: `\u274C ${rejectLabel}`, callbackData: buildCallbackData(CallbackActions.REJECT, context.jobId) },
        ];
        // Track this pending approval so callback can resolve it
        this.trackPendingApproval(context.jobId, event, context);
        // Send to each channel with buttons (respecting enabled state)
        const results = [];
        for (const [id, adapter] of this.adapters.entries()) {
            // Check if this channel is enabled
            if (!this.isChannelEnabled(id)) {
                logWarn("[NotificationCenter]", `Channel ${id} is disabled, skipping approval notification`);
                continue;
            }
            if (adapter instanceof TelegramAdapter) {
                try {
                    const payload = this.buildPayload(event, context, {
                        enableInlineKeyboard: true,
                        actionButtons: buttons,
                        ...(options?.additionalDetails && { additionalDetails: options.additionalDetails }),
                    });
                    const result = await adapter.send(payload);
                    results.push(result);
                }
                catch (error) {
                    results.push({ success: false, channel: id, error: String(error) });
                }
            }
            else if (adapter instanceof LineAdapter) {
                // LINE: Send approval request with text fallback directing user to answer via Telegram or Pi
                try {
                    const linePayload = {
                        jobId: context.jobId,
                        timestamp: new Date().toISOString(),
                        event,
                        title: "Approval Required",
                        message: (context.requirement || "A decision is needed.") + "\n\nReply via Telegram or type answer in Pi.",
                        details: {
                            jobId: context.jobId,
                            ...options?.additionalDetails,
                        },
                    };
                    const result = await adapter.send(linePayload);
                    results.push(result);
                    logWarn("[NotificationCenter]", `LINE approval sent to ${id}`);
                }
                catch (error) {
                    results.push({ success: false, channel: id, error: String(error) });
                }
            }
        }
        return results;
    }
    /**
     * Send a question that expects a text response from the user.
     * Unlike notifyWithApproval (Yes/No buttons), this sends a plain message
     * and waits for the user to type their response.
     */
    async notifyWithQuestion(event, context, options) {
        const question = options?.question ?? `Question for task ${context.jobId}`;
        const hint = options?.expectedFormat
            ? `\n\nPlease reply with: ${options.expectedFormat}`
            : "\n\nPlease type your response below.";
        const fullMessage = `${question}${hint}`;
        const results = [];
        for (const [id, adapter] of this.adapters.entries()) {
            if (adapter instanceof TelegramAdapter) {
                try {
                    const payload = {
                        event,
                        jobId: context.jobId,
                        timestamp: new Date().toISOString(),
                        title: `Question from ${context.jobId}`,
                        message: fullMessage,
                        details: {
                            waitForResponse: true,
                            expectedFormat: options?.expectedFormat,
                        },
                    };
                    const result = await adapter.sendQuestion(payload, options?.responseDir);
                    results.push(result);
                }
                catch (error) {
                    results.push({ success: false, channel: id, error: String(error) });
                }
            }
        }
        return results;
    }
    /**
     * Send interactive notification with custom buttons
     */
    async notifyWithButtons(event, context, buttons, options) {
        const results = [];
        for (const [id, adapter] of this.adapters.entries()) {
            if (adapter instanceof TelegramAdapter) {
                try {
                    const formattedButtons = buttons.map((b) => ({
                        text: b.text,
                        callbackData: buildCallbackData(b.action, b.targetId),
                        url: b.url,
                    }));
                    const payload = this.buildPayload(event, context, {
                        enableInlineKeyboard: true,
                        actionButtons: formattedButtons,
                        ...(options?.additionalDetails && { additionalDetails: options.additionalDetails }),
                    });
                    const result = await adapter.send(payload);
                    results.push(result);
                }
                catch (error) {
                    results.push({ success: false, channel: id, error: String(error) });
                }
            }
        }
        return results;
    }
    // --- Private Methods ------------------------------------------------
    createAdapter(config) {
        switch (config.type) {
            case "telegram":
                return new TelegramAdapter(config.config);
            case "ntfy":
                return new NtfyAdapter(config.config);
            case "email":
                return new EmailAdapter(config.config);
            case "webhook":
                return new WebhookAdapter(config.config);
            case "line":
                return new LineAdapter(config.config);
            default:
                return null;
        }
    }
    buildPayload(event, context, options) {
        const { title, message } = this.getEventContent(event, context);
        return {
            event,
            jobId: context.jobId,
            timestamp: new Date().toISOString(),
            title,
            message,
            details: {
                jobId: context.jobId,
                requirement: context.requirement,
                ...(context.taskId && { taskId: context.taskId }),
                ...(context.taskTitle && { taskTitle: context.taskTitle }),
                ...(context.error && { error: context.error }),
                // Pass inline keyboard options to Telegram adapter
                ...(options?.enableInlineKeyboard && { _enableInlineKeyboard: true }),
                ...(options?.actionButtons && { _actionButtons: options.actionButtons }),
                ...(options?.additionalDetails && options.additionalDetails),
            },
        };
    }
    getEventContent(event, context) {
        const req = context.requirement ?? "";
        const requirement = req.length > 50 ? req.slice(0, 50) + "..." : req;
        const map = {
            JobStarted: {
                title: "Job Started",
                message: `Harness job started for: "${requirement}"`,
            },
            TaskCompleted: {
                title: "Task Completed",
                message: `Task "${context.taskTitle ?? "Unknown"}" completed successfully`,
            },
            TaskFailed: {
                title: "Task Failed",
                message: `Task "${context.taskTitle ?? "Unknown"}" failed${context.error ? `: ${context.error}` : ""}`,
            },
            QuotaPaused: {
                title: "Quota Paused",
                message: `Job paused due to quota limit. Will auto-resume when quota resets.`,
            },
            ResumeScheduled: {
                title: "Resume Scheduled",
                message: `Job will resume work on: "${requirement}"`,
            },
            ContextCompacted: {
                title: "Context Compacted",
                message: `Session context was compacted to continue work on: "${requirement}"`,
            },
            OutputLimitContinued: {
                title: "Output Limit Continued",
                message: `Response was continued after hitting output token limit`,
            },
            E2EFailed: {
                title: "E2E Test Failed",
                message: `End-to-end tests failed for job: "${requirement}"`,
            },
            HumanReviewNeeded: {
                title: "Human Review Needed",
                message: `Job blocked. Please review and take action.`,
            },
            ReadyForClient: {
                title: "Ready for Review",
                message: `${requirement}\n\nStatus: Completed ✓`,
            },
            JobCancelled: {
                title: "Job Cancelled",
                message: `Job was cancelled: "${requirement}"`,
            },
            WaitingForUserInput: {
                title: "Your Input Needed",
                message: `Agent needs your input: "${requirement}"${context.error ? ` (${context.error})` : ""}`,
            },
            AssistantResponse: {
                title: "Assistant",
                message: requirement,
            },
            ToolSummary: {
                title: "Tool",
                message: requirement,
            },
            CodexSessionStarted: {
                title: "Codex Session Started",
                message: `Codex CLI session "${context.taskTitle ?? "new session"}" is now active`,
            },
            CodexPlanDetected: {
                title: "[PLAN] Codex Plan",
                message: context.requirement ?? "(no plan content)",
            },
            CodexReviewDetected: {
                title: "[REVIEW] Codex Review",
                message: context.requirement ?? "(no review content)",
            },
            Error: {
                title: "Runtime Error",
                message: `An error occurred${context.error ? `: ${context.error}` : ""}`,
            },
            Info: {
                title: "Info",
                message: context.requirement ?? "",
            },
        };
        return map[event] ?? { title: event, message: `Event: ${event}` };
    }
    redact(payload) {
        const details = payload.details ? { ...payload.details } : {};
        // Redact sensitive patterns
        for (const pattern of this.redactPatterns) {
            for (const [key, value] of Object.entries(details)) {
                if (typeof value === "string" && pattern.test(value)) {
                    details[key] = "[REDACTED]";
                }
            }
        }
        return { ...payload, details };
    }
    getDefaultRedactPatterns() {
        return [
            /Bearer\s+[\w-]+/gi, // Bearer tokens
            /channel[_-]?access[_-]?token["\s:=]+[^\s,}]+/gi, // LINE channel access token
            /password["\s:=]+[^\s,}]+/gi, // passwords
            /cookie["\s:=]+[^\s,}]+/gi, // cookies
            /secret["\s:=]+[^\s,}]+/gi, // secrets
            /api[_-]?key["\s:=]+[^\s,}]+/gi, // API keys
            /auth["\s:=]+[^\s,}]+/gi, // auth tokens
        ];
    }
}
//# sourceMappingURL=notification-center.js.map