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
        // Track message start for assistant messages
        this.pi.on("message_start", (_event) => {
            // Message tracking is handled in message_end
        });
        // Message end - capture final assistant response
        this.pi.on("message_end", (event) => {
            const msg = event.message;
            if (msg?.role !== "assistant")
                return;
            const content = this.extractMessageContent(msg);
            if (!content || content.length < 10)
                return; // Skip empty/too short
            const messageId = msg.id ?? `msg-${this.sessionStartTime}`;
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
        // Tool execution end - DISABLED by default (too noisy)
        // Tool summaries spam Telegram with every tool call
        // Enable only if explicitly configured and user wants verbose output
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
     * Finalize and send pending messages (called on agent_settled)
     */
    async finalizePendingMessages() {
        for (const [messageId, pending] of this.pendingMessages) {
            if (this.deliveredMessageIds.has(messageId))
                continue;
            // Send the message - only mark delivered if successful
            const success = await this.sendAssistantResponse(pending.content, messageId);
            if (success) {
                this.deliveredMessageIds.add(messageId);
                this.pendingMessages.delete(messageId);
            }
            else {
                console.log(`[ConversationBridge] Failed to send ${messageId}, will retry`);
            }
        }
    }
    /**
     * Flush pending messages (on compaction) - send before clearing
     */
    async flushPendingMessages() {
        console.log(`[ConversationBridge] Flushing ${this.pendingMessages.size} pending messages`);
        // Send all pending messages before clearing
        await this.finalizePendingMessages();
    }
    /**
     * Send an assistant response to Telegram
     */
    async sendAssistantResponse(content, messageId) {
        if (!this.center.hasHealthyChannels()) {
            console.log("[ConversationBridge] No healthy channels, skipping");
            return false;
        }
        // Chunk if too long
        const chunks = this.chunkMessage(content);
        let allSent = true;
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const chunkSuffix = chunks.length > 1 ? ` [${i + 1}/${chunks.length}]` : "";
            try {
                const results = await this.center.notify("AssistantResponse", {
                    jobId: `msg-${messageId}`,
                    requirement: chunk + chunkSuffix,
                });
                for (const result of results) {
                    if (result.success) {
                        console.log(`[ConversationBridge] Response chunk ${i + 1}/${chunks.length} sent`);
                    }
                    else {
                        console.warn(`[ConversationBridge] Response chunk failed: ${result.error}`);
                        allSent = false;
                    }
                }
            }
            catch (err) {
                console.error("[ConversationBridge] Failed to send response:", err);
                allSent = false;
            }
        }
        return allSent;
    }
    /**
     * Chunk a message into smaller parts
     */
    chunkMessage(message) {
        if (message.length <= this.config.maxMessageLength) {
            return [message];
        }
        const chunks = [];
        const maxLen = this.config.maxMessageLength;
        // Split by sentence boundaries, keeping the punctuation
        // Also split on newlines and other natural breaks
        const parts = message.split(/(?<=[.!?])\s+|(?<=\n)\s*|(?<=[,;:])\s+/);
        let currentChunk = "";
        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed)
                continue;
            const potential = currentChunk ? currentChunk + " " + trimmed : trimmed;
            // If single part exceeds max, split it further
            if (potential.length > maxLen) {
                // If we have current content, push it first
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                    currentChunk = "";
                }
                // Split the oversized part into smaller chunks
                if (trimmed.length > maxLen) {
                    // Split by words for long parts
                    const words = trimmed.split(/\s+/);
                    let wordChunk = "";
                    for (const word of words) {
                        const testChunk = wordChunk ? wordChunk + " " + word : word;
                        if (testChunk.length > maxLen) {
                            if (wordChunk) {
                                chunks.push(wordChunk.trim());
                            }
                            wordChunk = word;
                        }
                        else {
                            wordChunk = testChunk;
                        }
                    }
                    if (wordChunk) {
                        currentChunk = wordChunk;
                    }
                }
                else {
                    currentChunk = trimmed;
                }
            }
            else {
                currentChunk = potential;
            }
        }
        // Don't forget the last chunk
        if (currentChunk) {
            chunks.push(currentChunk.trim());
        }
        return chunks;
    }
    /**
     * Reset state for new session
     */
    reset() {
        this.pendingMessages.clear();
        this.deliveredMessageIds.clear();
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