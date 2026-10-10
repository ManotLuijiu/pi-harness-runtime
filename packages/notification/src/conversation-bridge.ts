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
import type { NotificationPayload } from "./types.js";

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
 * Pending message to prevent duplicate sends
 */
interface PendingMessage {
	messageId: string;
	content: string;
	timestamp: number;
	events: Set<string>; // Events that triggered this message
}

/**
 * Conversation Bridge
 *
 * Bridges Pi conversation events to Telegram notifications.
 */
export class ConversationBridge {
	private pi: ExtensionAPI;
	private center: NotificationCenter;
	private config: ConversationBridgeConfig;
	private pendingMessages: Map<string, PendingMessage> = new Map();
	private deliveredMessageIds: Set<string> = new Set();
	private sessionStartTime: number = Date.now();
	private lastMessageId: string | null = null;

	constructor(
		pi: ExtensionAPI,
		center: NotificationCenter,
		config: Partial<ConversationBridgeConfig> = {},
	) {
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
	register(): void {
		console.log("[ConversationBridge] Registering lifecycle hooks...");

		// Session start - reset state
		this.pi.on("session_start", () => {
			this.reset();
			console.log("[ConversationBridge] Session started");
		});

		// Session compact - flush pending messages
		this.pi.on("session_compact", (event) => {
			console.log(
				`[ConversationBridge] Compaction: ${event.reason} (willRetry=${event.willRetry})`,
			);
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
			const msg = event.message as { id?: string; role?: string };
			if (msg?.role === "assistant" && msg?.id) {
				this.lastMessageId = msg.id;
			}
		});

		// Message end - capture final assistant response
		this.pi.on("message_end", (event) => {
			const msg = event.message as { id?: string; role?: string; content?: unknown };
			if (msg?.role !== "assistant") return;

			const content = this.extractMessageContent(msg);
			if (!content || content.length < 10) return; // Skip empty/too short

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

			console.log(
				`[ConversationBridge] Assistant message captured: ${messageId.substring(0, 20)}...`,
			);
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
	private extractMessageContent(
		msg: { content?: unknown },
	): string | null {
		if (!msg.content) return null;

		// Array of content parts
		if (Array.isArray(msg.content)) {
			const texts: string[] = [];
			for (const part of msg.content) {
				if (
					part &&
					typeof part === "object" &&
					"type" in part &&
					part.type === "text" &&
					"text" in part
				) {
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
	private formatToolSummary(event: {
		toolName: string;
		result?: unknown;
		isError: boolean;
	}): string {
		const status = event.isError ? "FAILED" : "DONE";
		const resultPreview = this.truncate(
			JSON.stringify(event.result ?? ""),
			100,
		);
		return `[Tool] ${event.toolName}: ${status}${resultPreview ? ` - ${resultPreview}` : ""}`;
	}

	/**
	 * Send a tool summary to Telegram
	 */
	private async sendToolSummary(summary: string): Promise<void> {
		if (!this.center.hasHealthyChannels()) return;

		const payload: NotificationPayload = {
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
				} else {
					console.warn(`[ConversationBridge] Tool summary failed: ${result.error}`);
				}
			}
		} catch (err) {
			console.error("[ConversationBridge] Failed to send tool summary:", err);
		}
	}

	/**
	 * Finalize and send pending messages (called on agent_settled)
	 */
	private async finalizePendingMessages(): Promise<void> {
		for (const [messageId, pending] of this.pendingMessages) {
			if (this.deliveredMessageIds.has(messageId)) continue;

			// Send the message - only mark delivered if successful
			const success = await this.sendAssistantResponse(pending.content, messageId);
			if (success) {
				this.deliveredMessageIds.add(messageId);
				this.pendingMessages.delete(messageId);
			} else {
				console.log(`[ConversationBridge] Failed to send ${messageId}, will retry`);
			}
		}
	}

	/**
	 * Flush pending messages (on compaction) - send before clearing
	 */
	private async flushPendingMessages(): Promise<void> {
		console.log(
			`[ConversationBridge] Flushing ${this.pendingMessages.size} pending messages`,
		);
		// Send all pending messages before clearing
		await this.finalizePendingMessages();
	}

	/**
	 * Send an assistant response to Telegram
	 */
	private async sendAssistantResponse(
		content: string,
		messageId: string,
	): Promise<boolean> {
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
						console.log(
							`[ConversationBridge] Response chunk ${i + 1}/${chunks.length} sent`,
						);
					} else {
						console.warn(
							`[ConversationBridge] Response chunk failed: ${result.error}`,
						);
						allSent = false;
					}
				}
			} catch (err) {
				console.error("[ConversationBridge] Failed to send response:", err);
				allSent = false;
			}
		}

		return allSent;
	}

	/**
	 * Chunk a message into smaller parts
	 */
	private chunkMessage(message: string): string[] {
		if (message.length <= this.config.maxMessageLength) {
			return [message];
		}

		const chunks: string[] = [];
		const maxLen = this.config.maxMessageLength;

		// Split by sentence boundaries, keeping the punctuation
		// Also split on newlines and other natural breaks
		const parts = message.split(/(?<=[.!?])\s+|(?<=\n)\s*|(?<=[,;:])\s+/);
		let currentChunk = "";

		for (const part of parts) {
			const trimmed = part.trim();
			if (!trimmed) continue;

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
						} else {
							wordChunk = testChunk;
						}
					}
					if (wordChunk) {
						currentChunk = wordChunk;
					}
				} else {
					currentChunk = trimmed;
				}
			} else {
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
	 * Truncate a string
	 */
	private truncate(str: string, maxLen: number): string {
		if (str.length <= maxLen) return str;
		return str.substring(0, maxLen - 3) + "...";
	}

	/**
	 * Reset state for new session
	 */
	private reset(): void {
		this.pendingMessages.clear();
		this.deliveredMessageIds.clear();
		this.lastMessageId = null;
		this.sessionStartTime = Date.now();
	}

	/**
	 * Stop the bridge (cleanup)
	 */
	stop(): void {
		console.log("[ConversationBridge] Stopped");
		// Cleanup will happen on shutdown
	}
}

/**
 * Create and register a conversation bridge
 */
export function createConversationBridge(
	pi: ExtensionAPI,
	center: NotificationCenter,
	config?: Partial<ConversationBridgeConfig>,
): ConversationBridge {
	const bridge = new ConversationBridge(pi, center, config);
	bridge.register();
	return bridge;
}
