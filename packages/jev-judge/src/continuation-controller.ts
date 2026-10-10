/**
 * Todo-Driven Continuation Controller
 *
 * Executes authorized todo items without repeated prompts.
 * Uses deterministic rules + optional Jev for ambiguous cases.
 *
 * Architecture:
 * A. Read real todo state (not bd)
 * B. Deterministic continuation on agent_settled
 * C. Jev for ambiguous classification only
 * D. Single continuation controller
 * E. Update prompts/Telegram/status together
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createTodoProvider, type TodoItem, type TodoSnapshot } from "./todo-provider.js";
import { AutoContinueJudge } from "./auto-continue.js";
import type { AutoContinueDecision } from "./auto-continue.js";

/**
 * Continuation state
 */
interface ContinuationState {
	sessionId: string;
	generation: number; // Incremented on edits/cancellation/switch
	todoRevision: number;
	currentItemId: number | null;
	nextItemId: number | null;
	lastMessageId: string | null;
	continuationQueued: boolean;
	userPaused: boolean;
	lastSteerMessage: string | null;
	steerAttempts: number;
}

/**
 * Continuation result
 */
interface ContinuationResult {
	action: "continue" | "stop" | "ask" | "blocked";
	nextItemId?: number;
	question?: string;
	reason?: string;
}

/**
 * Continuation controller configuration
 */
interface ContinuationConfig {
	/** Minimum wait time before Jev fallback (ms) */
jevFallbackMinWaitMs?: number;
	/** Jev probability threshold for routine continuation */
	routineThreshold?: number;
	/** Max steer attempts before reporting blocker */
	maxSteerAttempts?: number;
	/** Enable Jev classification for ambiguous cases */
	enableJev?: boolean;
}

/**
 * Todo-Driven Continuation Controller
 *
 * Evaluates todo state on agent_settled and determines next action.
 */
export class TodoContinuationController {
	private pi: ExtensionAPI;
	private config: Required<ContinuationConfig>;
	private todoProvider = createTodoProvider();
	private jevJudge?: AutoContinueJudge;

	private state: ContinuationState = {
		sessionId: "",
		generation: 0,
		todoRevision: 0,
		currentItemId: null,
		nextItemId: null,
		lastMessageId: null,
		continuationQueued: false,
		userPaused: false,
		lastSteerMessage: null,
		steerAttempts: 0,
	};

	constructor(pi: ExtensionAPI, config?: ContinuationConfig) {
		this.pi = pi;
		this.config = {
			jevFallbackMinWaitMs: 5 * 60 * 1000, // 5 minutes
			routineThreshold: 0.7,
			maxSteerAttempts: 3,
			enableJev: true,
			...config,
		} as Required<ContinuationConfig>;

		// Initialize Jev judge if enabled
		if (this.config.enableJev) {
			// Jev will be initialized with API key from environment
		}
	}

	/**
	 * Register lifecycle hooks
	 */
	register(): void {
		console.log("[TodoContinuation] Registering lifecycle hooks...");

		// Session start - reset state
		this.pi.on("session_start", () => {
			this.reset();
			console.log("[TodoContinuation] Session started");
		});

		// Agent settled - evaluate continuation
		this.pi.on("agent_settled", () => {
			this.evaluateContinuation().catch((err) =>
				console.error("[TodoContinuation] Evaluation failed:", err)
			);
		});

		// User input - reset pause state
		this.pi.on("message_start", (event) => {
			const msg = event.message as { role?: string };
			if (msg?.role === "user") {
				this.state.userPaused = false;
				this.state.lastSteerMessage = null;
			}
		});

		// Session shutdown - cleanup
		this.pi.on("session_shutdown", () => {
			this.cleanup();
		});

		// Tool call - track mutations that might invalidate state
		this.pi.on("tool_call", (event) => {
			// Increment generation on edits
			if (["write", "edit", "bash"].includes(event.toolName)) {
				this.state.generation++;
				this.state.continuationQueued = false;
			}
		});

		console.log("[TodoContinuation] Lifecycle hooks registered");
	}

	/**
	 * Evaluate continuation decision
	 */
	private async evaluateContinuation(): Promise<ContinuationResult> {
		// 1. Check user pause
		if (this.state.userPaused) {
			return { action: "stop", reason: "User paused" };
		}

		// 2. Get current todo snapshot
		const availability = await this.todoProvider.availability();
		if (!availability.available) {
			console.log("[TodoContinuation] Todo provider unavailable:", availability.error);
			return { action: "stop", reason: "Todo provider unavailable" };
		}

		const snapshot = await this.todoProvider.getSnapshot();

		// 3. Check if state changed significantly
		if (snapshot.revision === this.state.todoRevision && this.state.nextItemId) {
			// Same todo state, try to continue next item
		} else {
			// Todo state changed, recalculate
			this.state.todoRevision = snapshot.revision;
			this.state.currentItemId = null;
			this.state.nextItemId = null;
		}

		// 4. Get ready items
		const readyItems = await this.todoProvider.getReady();
		const completedItems = await this.todoProvider.getCompleted();
		const pendingItems = await this.todoProvider.getPending();

		// 5. Determine action
		if (readyItems.length === 0 && pendingItems.length === 0) {
			console.log("[TodoContinuation] All items complete");
			return { action: "stop", reason: "All todos complete" };
		}

		if (readyItems.length === 0 && pendingItems.length > 0) {
			// Items exist but all blocked
			const blockedItems = await this.todoProvider.getBlocked();
			const blocker = blockedItems[0];
			console.log("[TodoContinuation] Items blocked:", blocker?.subject);
			return {
				action: "blocked",
				question: `Task "${blocker?.subject}" is blocked. What is needed to unblock it?`,
				reason: `Blocked by dependencies`,
			};
		}

		// 6. Select next ready item
		const nextItem = this.state.nextItemId
			? readyItems.find((i) => i.id === this.state.nextItemId) ?? readyItems[0]
			: readyItems[0];

		if (!nextItem) {
			return { action: "stop", reason: "No ready items" };
		}

		// 7. Check if current item should be marked complete
		if (this.state.currentItemId && this.state.currentItemId !== nextItem.id) {
			// Item changed, mark previous complete
			console.log(`[TodoContinuation] Item ${this.state.currentItemId} complete`);
		}

		// 8. Update state
		this.state.currentItemId = nextItem.id;
		this.state.nextItemId = readyItems.length > 1 ? readyItems[1].id : null;

		// 9. Determine if we should continue or ask
		const shouldContinue = await this.shouldAutoContinue(nextItem);

		if (shouldContinue.continue) {
			console.log(
				`[TodoContinuation] Continuing item ${nextItem.id}: ${nextItem.subject}`
			);
			return { action: "continue", nextItemId: nextItem.id };
		}

		// 10. Jev says ask user
		return {
			action: "ask",
			nextItemId: nextItem.id,
			question: shouldContinue.question,
			reason: shouldContinue.reason,
		};
	}

	/**
	 * Determine if we should auto-continue
	 */
	private async shouldAutoContinue(
		item: TodoItem
	): Promise<{ continue: boolean; question?: string; reason?: string }> {
		// If no current work, continue is routine
		if (!this.state.currentItemId) {
			return { continue: true };
		}

		// If completing current item and next is ready, continue is routine
		if (this.state.currentItemId !== item.id && this.state.nextItemId === item.id) {
			return { continue: true };
		}

		// Check if we're mid-item
		if (this.state.currentItemId === item.id) {
			// Already working on this item, continue
			return { continue: true };
		}

		// For ambiguous cases, use Jev
		if (this.config.enableJev && this.jevJudge) {
			const decision = await this.jevJudge.decide({
				completedTasks: [],
				remainingTasks: [item.subject],
				totalTasks: 1,
				waitTimeMinutes: 0,
				userResponded: false,
				sessionStartTime: new Date(),
			});

			if (decision.action === "proceed") {
				return { continue: true };
			}

			return {
				continue: false,
				question: `Ready to continue: "${item.subject}"?`,
				reason: decision.reasoning,
			};
		}

		// Default: continue for ready items
		return { continue: true };
	}

	/**
	 * Steer to continue a todo item
	 */
	async steerToContinue(itemId: number): Promise<void> {
		if (this.state.steerAttempts >= this.config.maxSteerAttempts) {
			console.warn("[TodoContinuation] Max steer attempts reached");
			return;
		}

		this.state.steerAttempts++;
		this.state.continuationQueued = true;

		const snapshot = await this.todoProvider.getSnapshot();
		const item = snapshot.items.find((i) => i.id === itemId);

		const message = item
			? `Continue todo item: "${item.subject}". ${item.description ?? ""}`
			: `Continue work on the next ready task.`;

		this.state.lastSteerMessage = message;
		this.state.todoRevision = snapshot.revision;

		console.log(`[TodoContinuation] Steering to continue item ${itemId}`);
	}

	/**
	 * Mark a todo item as complete
	 */
	async markComplete(itemId: number): Promise<void> {
		console.log(`[TodoContinuation] Marking item ${itemId} complete`);
		this.state.currentItemId = null;
		this.state.generation++;
	}

	/**
	 * User paused
	 */
	pause(): void {
		this.state.userPaused = true;
		this.state.continuationQueued = false;
		console.log("[TodoContinuation] User paused");
	}

	/**
	 * Reset state for new session
	 */
	private reset(): void {
		this.state = {
			sessionId: `session-${Date.now()}`,
			generation: 0,
			todoRevision: 0,
			currentItemId: null,
			nextItemId: null,
			lastMessageId: null,
			continuationQueued: false,
			userPaused: false,
			lastSteerMessage: null,
			steerAttempts: 0,
		};
	}

	/**
	 * Cleanup on shutdown
	 */
	private cleanup(): void {
		console.log("[TodoContinuation] Cleaning up");
		this.state.continuationQueued = false;
		this.state.generation++;
	}

	/**
	 * Get current state summary
	 */
	getState(): { current: TodoItem | null; next: TodoItem | null; ready: number } {
		return {
			current: null, // Would need to fetch
			next: null,
			ready: 0,
		};
	}
}

/**
 * Create and register a todo continuation controller
 */
export function createTodoContinuation(
	pi: ExtensionAPI,
	config?: ContinuationConfig
): TodoContinuationController {
	const controller = new TodoContinuationController(pi, config);
	controller.register();
	return controller;
}
