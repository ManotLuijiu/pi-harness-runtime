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
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { NotificationCenter } from "./notification-center.js";
/**
 * Configuration for the conversation bridge
 */
export interface ConversationBridgeConfig {
    /** Whether to send assistant final responses */
    sendAssistantResponses: boolean;
    /** Whether to send tool summaries */
    sendToolSummaries: boolean;
    /** Max message length before chunking */
    maxMessageLength: number;
    /** Minimum confidence to send a message */
    minConfidence: number;
}
/**
 * Conversation Bridge
 *
 * Bridges Pi conversation events to Telegram notifications.
 */
export declare class ConversationBridge {
    private pi;
    private center;
    private config;
    private pendingMessages;
    private deliveredMessageIds;
    private sessionStartTime;
    constructor(pi: ExtensionAPI, center: NotificationCenter, config?: Partial<ConversationBridgeConfig>);
    /**
     * Register all lifecycle hooks
     */
    register(): void;
    /**
     * Extract text content from a message
     */
    private extractMessageContent;
    /**
     * Finalize and send pending messages (called on agent_settled)
     */
    private finalizePendingMessages;
    /**
     * Flush pending messages (on compaction) - send before clearing
     */
    private flushPendingMessages;
    /**
     * Send an assistant response to Telegram
     */
    private sendAssistantResponse;
    /**
     * Chunk a message into smaller parts
     */
    private chunkMessage;
    /**
     * Reset state for new session
     */
    private reset;
    /**
     * Stop the bridge (cleanup)
     */
    stop(): void;
}
/**
 * Create and register a conversation bridge
 */
export declare function createConversationBridge(pi: ExtensionAPI, center: NotificationCenter, config?: Partial<ConversationBridgeConfig>): ConversationBridge;
//# sourceMappingURL=conversation-bridge.d.ts.map