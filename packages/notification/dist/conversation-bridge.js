/**
 * Telegram Conversation Bridge
 *
 * Sends assistant responses and tool activity to Telegram.
 * Hooks into Pi lifecycle events to capture:
 * - message_end: Final assistant responses
 * - agent_end: When agent finishes a turn
 * - agent_settled: When agent fully settles
 *
 * Features:
 * - Deduplication across events
 * - Safe formatting
 * - Delivery status tracking
 */
/**
 * Conversation Bridge
 *
 * Bridges Pi conversation events to Telegram notifications.
 */
export class ConversationBridge {
    pi;
    center;
    config;
    pendingMessages = new Map();
    deliveredMessageIds = new Set();
    sessionStartTime = Date.now();
    lastMessageId = null;
    constructor(pi, center, config = {}) {
        this.pi = pi;
        this.center = center;
        this.config = {
            sendAssistantResponses: true,
            sendToolSummaries: true,
            maxMessageLength: 4000,
            minConfidence: 0.5,
            ...config,
        };
    }
    /**
     * Register all lifecycle hooks
     */
    register() {
        console.log("[ConversationBridge] Registering lifecycle hooks...");
        // Session start - reset state
        this.pi.on("session_start", () => {
            this.reset();
            console.log("[ConversationBridge] Session started");
        });
        // Session compact - flush pending messages
        this.pi.on("session_compact", (event) => {
            console.log(`[ConversationBridge] Compaction: ${event.reason} (willRetry=${event.willRetry})`);
            this.flushPendingMessages();
        });
        // Session shutdown - cleanup
        this.pi.on("session_shutdown", () => {
            console.log("[ConversationBridge] Session shutting down");
            this.flushPendingMessages();
            this.stop();
        });
        // Message start - track new message
        this.pi.on("message_start", (event) => {
            const msg = event.message;
            if (msg?.role === "assistant" && msg?.id) {
                this.lastMessageId = msg.id;
            }
        });
        // Message end - capture final assistant response
        this.pi.on("message_end", (event) => {
            const msg = event.message;
            if (msg?.role !== "assistant")
                return;
            const content = this.extractMessageContent(msg);
            if (!content || content.length < 10)
                return; // Skip empty/too short
            const messageId = msg.id ?? `msg-${Date.now()}`;
            // Deduplicate
            if (this.deliveredMessageIds.has(messageId)) {
                console.log(`[ConversationBridge] Skipping duplicate: ${messageId}`);
                return;
            }
            // Check if already pending
            let pending = this.pendingMessages.get(messageId);
            if (!pending) {
                pending = {
                    messageId,
                    content,
                    timestamp: Date.now(),
                    events: new Set(),
                };
                this.pendingMessages.set(messageId, pending);
            }
            pending.events.add("message_end");
            console.log(`[ConversationBridge] Assistant message captured: ${messageId.substring(0, 20)}...`);
        });
        // Tool execution end - capture tool summaries
        if (this.config.sendToolSummaries) {
            this.pi.on("tool_execution_end", (event) => {
                const summary = this.formatToolSummary(event);
                if (summary) {
                    this.sendToolSummary(summary);
                }
            });
        }
        // Agent settled - finalize and send pending messages
        this.pi.on("agent_settled", () => {
            console.log("[ConversationBridge] Agent settled, finalizing messages...");
            this.finalizePendingMessages();
        });
        console.log("[ConversationBridge] Lifecycle hooks registered");
    }
    /**
     * Extract text content from a message
     */
    extractMessageContent(msg) {
        if (!msg.content)
            return null;
        // Array of content parts
        if (Array.isArray(msg.content)) {
            const texts = [];
            for (const part of msg.content) {
                if (part &&
                    typeof part === "object" &&
                    "type" in part &&
                    part.type === "text" &&
                    "text" in part) {
                    texts.push(String(part.text));
                }
            }
            return texts.join("\n\n");
        }
        // Simple string
        if (typeof msg.content === "string") {
            return msg.content;
        }
        return null;
    }
    /**
     * Format a tool execution summary
     */
    formatToolSummary(event) {
        const status = event.isError ? "FAILED" : "DONE";
        const resultPreview = this.truncate(JSON.stringify(event.result ?? ""), 100);
        return `[Tool] ${event.toolName}: ${status}${resultPreview ? ` - ${resultPreview}` : ""}`;
    }
    /**
     * Send a tool summary to Telegram
     */
    async sendToolSummary(summary) {
        if (!this.center.hasHealthyChannels())
            return;
        const payload = {
            event: "CodexSessionStarted", // Reusing existing event
            jobId: `tool-${Date.now()}`,
            timestamp: new Date().toISOString(),
            title: "Tool Executed",
            message: summary,
        };
        try {
            const results = await this.center.notify("CodexSessionStarted", {
                jobId: payload.jobId,
                requirement: payload.message,
            });
            for (const result of results) {
                if (result.success) {
                    console.log(`[ConversationBridge] Tool summary sent`);
                }
                else {
                    console.warn(`[ConversationBridge] Tool summary failed: ${result.error}`);
                }
            }
        }
        catch (err) {
            console.error("[ConversationBridge] Failed to send tool summary:", err);
        }
    }
    /**
     * Finalize and send pending messages (called on agent_settled)
     */
    async finalizePendingMessages() {
        for (const [messageId, pending] of this.pendingMessages) {
            if (this.deliveredMessageIds.has(messageId))
                continue;
            // Send the message
            await this.sendAssistantResponse(pending.content, messageId);
            this.deliveredMessageIds.add(messageId);
            this.pendingMessages.delete(messageId);
        }
    }
    /**
     * Flush pending messages without sending (on compaction)
     */
    flushPendingMessages() {
        console.log(`[ConversationBridge] Flushing ${this.pendingMessages.size} pending messages`);
        this.pendingMessages.clear();
    }
    /**
     * Send an assistant response to Telegram
     */
    async sendAssistantResponse(content, messageId) {
        if (!this.center.hasHealthyChannels()) {
            console.log("[ConversationBridge] No healthy channels, skipping");
            return;
        }
        // Chunk if too long
        const chunks = this.chunkMessage(content);
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const chunkSuffix = chunks.length > 1 ? ` [${i + 1}/${chunks.length}]` : "";
            const payload = {
                event: "CodexSessionStarted", // Reusing event type
                jobId: `msg-${messageId}`,
                timestamp: new Date().toISOString(),
                title: "Assistant Response",
                message: chunk + chunkSuffix,
            };
            try {
                const results = await this.center.notify("CodexSessionStarted", {
                    jobId: payload.jobId,
                    requirement: payload.message,
                });
                for (const result of results) {
                    if (result.success) {
                        console.log(`[ConversationBridge] Response chunk ${i + 1}/${chunks.length} sent`);
                    }
                    else {
                        console.warn(`[ConversationBridge] Response chunk failed: ${result.error}`);
                    }
                }
            }
            catch (err) {
                console.error("[ConversationBridge] Failed to send response:", err);
            }
        }
    }
    /**
     * Chunk a message into smaller parts
     */
    chunkMessage(message) {
        if (message.length <= this.config.maxMessageLength) {
            return [message];
        }
        const chunks = [];
        const sentences = message.match(/[^.!?]+[.!?]+/g) || [message];
        let currentChunk = "";
        for (const sentence of sentences) {
            if ((currentChunk + sentence).length > this.config.maxMessageLength) {
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                }
                currentChunk = sentence;
            }
            else {
                currentChunk += sentence;
            }
        }
        if (currentChunk) {
            chunks.push(currentChunk.trim());
        }
        return chunks;
    }
    /**
     * Truncate a string
     */
    truncate(str, maxLen) {
        if (str.length <= maxLen)
            return str;
        return str.substring(0, maxLen - 3) + "...";
    }
    /**
     * Reset state for new session
     */
    reset() {
        this.pendingMessages.clear();
        this.deliveredMessageIds.clear();
        this.lastMessageId = null;
        this.sessionStartTime = Date.now();
    }
    /**
     * Stop the bridge (cleanup)
     */
    stop() {
        console.log("[ConversationBridge] Stopped");
        // Cleanup will happen on shutdown
    }
}
/**
 * Create and register a conversation bridge
 */
export function createConversationBridge(pi, center, config) {
    const bridge = new ConversationBridge(pi, center, config);
    bridge.register();
    return bridge;
}
//# sourceMappingURL=conversation-bridge.js.map