/**
 * Telegram Conversation Bridge
 *
 * Sends assistant responses to Telegram.
 * Hooks into Pi lifecycle events to capture:
 * - message_end: Final assistant responses
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
 * Simple debug logger that writes to file, not stdout
 */
const DEBUG_LOG_FILE = "/tmp/pi-harness-debug.log";
function debugLog(component: string, ...args: unknown[]): void {
	try {
		const timestamp = new Date().toISOString();
		const msg = `[${timestamp}] [${component}] ${args.map(a => String(a)).join(" ")}\n`;
		import("node:fs").then(({ appendFileSync }) => {
			appendFileSync(DEBUG_LOG_FILE, msg);
		}).catch(() => {});
	} catch {
		// Silently fail
	}
}

/**
 * Configuration for the conversation bridge
 */
export interface ConversationBridgeConfig {
	/** Whether to send assistant final responses */
	sendAssistantResponses: boolean;
	/** Max message length before chunking */
	maxMessageLength: number;
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

	constructor(
		pi: ExtensionAPI,
		center: NotificationCenter,
		config: Partial<ConversationBridgeConfig> = {},
	) {
		this.pi = pi;
		this.center = center;
		this.config = {
			sendAssistantResponses: true,
			maxMessageLength: 4000,
			...config,
		};
	}

	/**
	 * Register all lifecycle hooks
	 */
	register(): void {
		debugLog("ConversationBridge", "Registering hooks");

		// Session start - reset state
		this.pi.on("session_start", () => {
			this.reset();
			debugLog("ConversationBridge", "Session started");
		});

		// Session compact - flush pending messages
		this.pi.on("session_compact", (_event) => {
			this.flushPendingMessages();
		});

		// Session shutdown - cleanup
		this.pi.on("session_shutdown", () => {
			this.flushPendingMessages();
			this.stop();
		});

		// Message end - capture final assistant response
		this.pi.on("message_end", (event) => {
			const msg = event.message as { id?: string; role?: string; content?: unknown };
			if (msg?.role !== "assistant") return;

			const content = this.extractMessageContent(msg);
			if (!content || content.length < 10) return; // Skip empty/too short

			const messageId = msg.id ?? `msg-${this.sessionStartTime}`;

			// Deduplicate
			if (this.deliveredMessageIds.has(messageId)) {
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
		});

		// Agent settled - finalize and send pending messages
		this.pi.on("agent_settled", () => {
			this.finalizePendingMessages();
		});

		debugLog("ConversationBridge", "Lifecycle hooks registered");
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
			}
		}
	}

	/**
	 * Flush pending messages (on compaction) - send before clearing
	 */
	private async flushPendingMessages(): Promise<void> {
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
					if (!result.success) {
						allSent = false;
					}
				}
			} catch {
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
	 * Reset state for new session
	 */
	private reset(): void {
		this.pendingMessages.clear();
		this.deliveredMessageIds.clear();
		this.sessionStartTime = Date.now();
	}

	/**
	 * Stop the bridge (cleanup)
	 */
	stop(): void {
		// Cleanup happens on shutdown
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
