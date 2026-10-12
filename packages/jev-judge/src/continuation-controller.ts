import type { TodoItem, TodoContext } from "./todo-provider.js";
import { createTodoProvider } from "./todo-provider.js";

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
 * Continuation configuration
 */
export interface ContinuationConfig {
	/** Minimum wait before Jev fallback (ms) */
	jevFallbackMinWaitMs?: number;
	/** Threshold for routine continuation */
	routineThreshold?: number;
	/** Max steer attempts per session */
	maxSteerAttempts?: number;
	/** Enable Jev for ambiguous cases */
	enableJev?: boolean;
}

/**
 * Continuation state
 */
export interface ContinuationState {
	sessionId: string;
	generation: number;
	todoRevision: number;
	currentItemId: number | null;
	nextItemId: number | null;
	lastMessageId: string | null;
	continuationQueued: boolean;
	userPaused: boolean;
	lastSteerMessage: string | null;
	steerAttemptsForCurrentItem: number;
	lastItemContinued: number | null;
	lastEvaluationResult: string | null;
}

/**
 * Continuation result
 */
export interface ContinuationResult {
	action: "continue" | "stop" | "blocked" | "ask";
	nextItemId?: number;
	question?: string;
	reason?: string;
}

/**
 * Todo-Driven Continuation Controller
 *
 * Evaluates todo state on agent_settled and determines next action.
 */
export class TodoContinuationController {
	private ctx: TodoContext;
	private config: Required<ContinuationConfig>;
	private todoProvider: ReturnType<typeof createTodoProvider>;

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
		steerAttemptsForCurrentItem: 0,
		lastItemContinued: null,
		lastEvaluationResult: null,
	};

	constructor(ctx: TodoContext, config?: ContinuationConfig) {
		this.ctx = ctx;
		this.todoProvider = createTodoProvider(ctx);
		this.config = {
			jevFallbackMinWaitMs: 5 * 60 * 1000, // 5 minutes
			routineThreshold: 0.7,
			maxSteerAttempts: 3,
			enableJev: true,
			...config,
		} as Required<ContinuationConfig>;
	}

	/**
	 * Check if continuation is allowed (not paused, session idle)
	 */
	private canContinue(): boolean {
		if (this.state.userPaused) {
			debugLog("TodoContinuation", "User paused, not continuing");
			return false;
		}
		if (this.ctx.isIdle?.() === false) {
			debugLog("TodoContinuation", "Session not idle, not continuing");
			return false;
		}
		if (this.ctx.hasPendingMessages?.()) {
			debugLog("TodoContinuation", "Pending messages, not continuing");
			return false;
		}
		return true;
	}

	/**
	 * Public method to evaluate and execute continuation
	 * Called by external handlers (e.g., agent_settled)
	 * Checks blockers and pause BEFORE selecting a task
	 */
	async decide(): Promise<ContinuationResult> {
		// 1. Check if continuation is allowed
		if (!this.canContinue()) {
			return { action: "stop", reason: "paused or session not idle" };
		}

		// 2. Check provider availability
		const availability = await this.todoProvider.availability();
		if (!availability.available) {
			debugLog("TodoContinuation", "Provider unavailable:", availability.error);
			return { action: "stop", reason: availability.error ?? "provider unavailable" };
		}

		// 3. Get todo state (throws on branch read failure)
		let inProgress: TodoItem[];
		let pending: TodoItem[];
		let blocked: TodoItem[];
		try {
			inProgress = await this.todoProvider.getInProgress();
			pending = await this.todoProvider.getPending();
			blocked = await this.todoProvider.getBlocked();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			debugLog("TodoContinuation", "Failed to read todos:", msg);
			return { action: "stop", reason: `todo read failed: ${msg}` };
		}

		// 4. Check for blocked items FIRST (before selecting any task)
		if (blocked.length > 0) {
			debugLog("TodoContinuation", "Tasks blocked:", blocked.length);
			return { action: "blocked", question: `${blocked.length} task(s) blocked` };
		}

		// 5. Continue in-progress work if any
		if (inProgress.length > 0) {
			const item = inProgress[0];
			
			// Reset counter if switching to a different task
			if (this.state.lastItemContinued !== item.id) {
				this.state.steerAttemptsForCurrentItem = 0;
				this.state.lastItemContinued = item.id;
			}
			
			// Check per-task attempt limit
			if (this.state.steerAttemptsForCurrentItem >= this.config.maxSteerAttempts) {
				return { action: "stop", reason: `max attempts (${this.config.maxSteerAttempts}) reached for task ${item.id}` };
			}
			
			return { action: "continue", nextItemId: item.id };
		}

		// 6. Continue pending work if any
		if (pending.length > 0) {
			const item = pending[0];
			
			// Reset counter if switching to a different task
			if (this.state.lastItemContinued !== item.id) {
				this.state.steerAttemptsForCurrentItem = 0;
				this.state.lastItemContinued = item.id;
			}
			
			// Check per-task attempt limit
			if (this.state.steerAttemptsForCurrentItem >= this.config.maxSteerAttempts) {
				return { action: "stop", reason: `max attempts (${this.config.maxSteerAttempts}) reached for task ${item.id}` };
			}
			
			return { action: "continue", nextItemId: item.id };
		}

		// 7. No work remaining
		return { action: "stop", reason: "No pending tasks" };
	}

	/**
	 * Evaluate continuation decision and execute it
	 */
	private async evaluateContinuation(): Promise<void> {
		// 1. Check user pause
		if (this.state.userPaused) {
			debugLog("TodoContinuation", "User paused, stopping");
			return;
		}

		// 2. Get current todo snapshot
		const availability = await this.todoProvider.availability();
		if (!availability.available) {
			// No todo provider - don't auto-continue
			debugLog("TodoContinuation", "Provider unavailable:", availability.error);
			return;
		}

		try {
			// Get snapshot for state tracking
			await this.todoProvider.getSnapshot();

			// 3. Get in-progress and pending items
			const inProgressItems = await this.todoProvider.getByStatus("in_progress");
			const pendingItems = await this.todoProvider.getPending();
			const completedItems = await this.todoProvider.getCompleted();

			// 4. If there's work in progress, continue it
			if (inProgressItems.length > 0) {
				const item = inProgressItems[0];
				debugLog("TodoContinuation", "In-progress item:", item.subject);
				await this.continueItem(item);
				return;
			}

			// 5. Determine action based on state
			const totalItems = completedItems.length + pendingItems.length + inProgressItems.length;
			const hasWork = pendingItems.length > 0 || inProgressItems.length > 0;

			if (!hasWork && totalItems === 0) {
				debugLog("TodoContinuation", "All items complete");
				return;
			}

			if (pendingItems.length > 0) {
				// Check if items are blocked
				const blockedItems = await this.todoProvider.getBlocked();
				if (blockedItems.length === pendingItems.length) {
					// All pending items are blocked - don't auto-continue
					const blocker = blockedItems[0];
					debugLog("TodoContinuation", "Items blocked:", blocker?.subject);
					return;
				}

				// Continue the first non-blocked pending item
				const readyItems = await this.todoProvider.getReady();
				if (readyItems.length > 0) {
					await this.continueItem(readyItems[0]);
				}
			}
		} catch (err) {
			debugLog("TodoContinuation", "Evaluation error:", err);
		}
	}

	/**
	 * Continue a specific todo item
	 */
	async continueItem(item: TodoItem): Promise<void> {
		// Increment attempts for this specific item
		if (this.state.lastItemContinued !== item.id) {
			this.state.steerAttemptsForCurrentItem = 0;
			this.state.lastItemContinued = item.id;
		}

		if (this.state.steerAttemptsForCurrentItem >= this.config.maxSteerAttempts) {
			debugLog("TodoContinuation", "Max steer attempts reached for item", item.id);
			return;
		}

		this.state.steerAttemptsForCurrentItem++;
		this.state.continuationQueued = true;

		// Build continuation message
		const message = item.description
			? `Continue task: ${item.subject}\n\n${item.description}`
			: `Continue task: ${item.subject}`;

		this.state.lastSteerMessage = message;
		debugLog("TodoContinuation", "Sending continuation:", item.subject);

		// Send continuation message via Pi API
		try {
			await this.ctx.sendUserMessage?.(message, { deliverAs: "steer" });
		} catch (err) {
			debugLog("TodoContinuation", "Failed to send continuation:", String(err));
			this.state.continuationQueued = false;
		}
	}

	/**
	 * Steer to continue a todo item
	 */
	async steerToContinue(itemId: number): Promise<void> {
		// Increment attempts for this specific item
		if (this.state.lastItemContinued !== itemId) {
			this.state.steerAttemptsForCurrentItem = 0;
			this.state.lastItemContinued = itemId;
		}

		if (this.state.steerAttemptsForCurrentItem >= this.config.maxSteerAttempts) {
			debugLog("TodoContinuation", "Max steer attempts reached for item", itemId);
			return;
		}

		this.state.steerAttemptsForCurrentItem++;
		this.state.continuationQueued = true;

		const snapshot = await this.todoProvider.getSnapshot();
		const item = snapshot.items.find((i) => i.id === itemId);

		const message = item
			? `Continue todo item: "${item.subject}". ${item.description ?? ""}`
			: `Continue work on the next ready task.`;

		this.state.lastSteerMessage = message;
		this.state.todoRevision = snapshot.revision;
		debugLog("TodoContinuation", "Steering to continue item", itemId);

		// Send continuation message via Pi API
		try {
			await this.ctx.sendUserMessage?.(message, { deliverAs: "steer" });
		} catch (err) {
			debugLog("TodoContinuation", "Failed to send steer:", String(err));
			this.state.continuationQueued = false;
		}
	}

	/**
	 * Mark a todo item as complete
	 */
	async markComplete(_itemId: number): Promise<void> {
		debugLog("TodoContinuation", "Marking item complete");
		this.state.currentItemId = null;
		this.state.generation++;
	}

	/**
	 * User paused
	 */
	pause(): void {
		debugLog("TodoContinuation", "User paused");
		this.state.userPaused = true;
		this.state.continuationQueued = false;
	}

	/**
	 * Reset state for new session
	 */
	_reset(): void {
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
			steerAttemptsForCurrentItem: 0,
			lastItemContinued: null,
			lastEvaluationResult: null,
		};
	}

	/**
	 * Cleanup on shutdown
	 */
	_cleanup(): void {
		debugLog("TodoContinuation", "Cleaning up");
		this.state.continuationQueued = false;
		this.state.generation++;
	}

	/**
	 * Get current state summary
	 */
	getState(): { current: TodoItem | null; next: TodoItem | null; ready: number } {
		return {
			current: null,
			next: null,
			ready: 0,
		};
	}
}

/**
 * Create a todo continuation controller
 * Note: Caller is responsible for registering event handlers with the proper context
 */
export function createTodoContinuation(
	ctx: TodoContext,
	config?: ContinuationConfig
): TodoContinuationController {
	return new TodoContinuationController(ctx, config);
}
