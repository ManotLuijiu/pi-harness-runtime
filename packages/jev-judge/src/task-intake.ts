/**
 * Task Intake - Automatic todo capture from user requests
 *
 * Uses Jev Yes/No judgments to determine:
 * - Whether a user request should be tracked as work
 * - Whether it duplicates existing work
 * - Whether it modifies an existing requirement
 */

import { JevJudge } from "./index.js";
import type { JevJudgeConfig } from "./types.js";

/**
 * Task intake configuration
 */
export interface TaskIntakeConfig extends JevJudgeConfig {
	/** Minimum noul threshold for capturing as actionable */
	actionableThreshold?: number;
	/** Dispatch function to send messages to the agent */
	dispatch: (content: string) => Promise<void>;
	/**
	 * The name of the tool that records the work.
	 *
	 * The harness knows which tool records the work of a request: the
	 * plain todo tool, or the tool of a handoff that writes the
	 * identifiers of the handoff into the todo. The name is asked for
	 * when the instruction is written, so a request that belongs to a
	 * handoff is not recorded with a tool that knows nothing of it.
	 *
	 * The message that is captured is given to the asker: the tool of a
	 * handoff is named for the request that is captured, not for every
	 * handoff of the session. A request that works on something else is
	 * recorded with the plain tool, and its todo names no issue.
	 */
	todoToolName?: (userMessage: string) => string;
	/**
	 * The number of the request that is running.
	 *
	 * The reminder is sent once per request: a request that is reminded
	 * twice produces a second reminder, and the second one arrives as a
	 * new request of the work. A new request of the human may be reminded
	 * again.
	 */
	requestGeneration?: () => number | undefined;
}

/**
 * Result of task intake evaluation
 */
export interface TaskIntakeResult {
	/** Whether the request should be captured as actionable work */
	actionable: boolean;
	/** Probability that it's actionable (0-1) */
	probability: number;
	/** Whether it duplicates existing work */
	isDuplicate: boolean;
	/** Whether it modifies an existing requirement */
	modifiesExisting: boolean;
	/** Recommended action */
	action: "create" | "skip" | "amend" | "investigate";
	/** Existing todo ID if duplicate/modifies */
	existingTodoId?: number;
}

/**
 * Task Intake Controller
 *
 * Evaluates user requests with Jev to determine if they should be
 * captured as todos for automatic tracking.
 */
export class TaskIntakeController {
	private jev: JevJudge | null = null;
	private config: Required<TaskIntakeConfig>;
	private lastRequest: string | null = null;
	private lastResult: TaskIntakeResult | null = null;
	// Track recent capture request hashes to prevent self-triggering
	private recentCaptures = new Set<string>();
	private readonly CAPTURE_COOLDOWN_MS = 30000;  // Don't re-trigger for same content within 30s
	/**
	 * The requests that were already reminded.
	 *
	 * The key is the request generation and the text of the request: the
	 * same work of the same request is reminded once, and a new request
	 * of the human may be reminded again.
	 */
	private reminded = new Set<string>();
	// Track stopped state to invalidate pending evaluations on stop

	private _stopped = false;

	constructor(config: TaskIntakeConfig) {
		this.config = {
			actionableThreshold: 0.7,
			...config,
		} as Required<TaskIntakeConfig>;

		// Initialize Jev when a provider is available (an explicit provider
		// chain or a legacy single key)
		if ((config.providers && config.providers.length > 0) || config.apiKey) {
			this.jev = new JevJudge(config as JevJudgeConfig);
		}
	}

	/**
	 * Check if Jev is available
	 */
	isAvailable(): boolean {
		return this.jev !== null;
	}

	/**
	 * Evaluate a user request for task capture
	 */
	async evaluate(
		userMessage: string,
		existingTodos: string[] = []
	): Promise<TaskIntakeResult> {
		return this._evaluate(userMessage, existingTodos);
	}

	/**
	 * Evaluate with actual todo items from continuation controller
	 */
	async evaluateWithTodos(
		userMessage: string,
		controller: { getSnapshot: () => Promise<{ items: Array<{ id: number; subject: string; status: string }> }> }
	): Promise<TaskIntakeResult> {
		// Check if stopped - invalidatePending() was called
		if (this._stopped) {
			return {
				actionable: false,
				probability: 0,
				isDuplicate: false,
				modifiesExisting: false,
				action: "skip",
			};
		}

		// Check for harness-internal messages (prevent self-triggering)
		if (userMessage.includes("[harness:task-capture]")) {
			return {
				actionable: false,
				probability: 0,
				isDuplicate: false,
				modifiesExisting: false,
				action: "skip",
			};
		}

		// Check recent captures to prevent rapid re-triggering
		const hash = this.hashMessage(userMessage);
		if (this.recentCaptures.has(hash)) {
			return {
				actionable: false,
				probability: 0,
				isDuplicate: false,
				modifiesExisting: false,
				action: "skip",
			};
		}

		// Get actual todos from the continuation controller
		let existingTodos: string[] = [];
		try {
			const snapshot = await controller.getSnapshot();
			existingTodos = snapshot.items
				.filter((i) => i.status !== "completed" && i.status !== "deleted")
				.map((i) => i.subject);
		} catch {
			// Ignore errors, use empty list
		}

		return this._evaluate(userMessage, existingTodos);
	}

	/**
	 * Hash a message for deduplication using full content
	 */
	private hashMessage(msg: string): string {
		// Use a simple hash of the full content to avoid collisions
		// Simple DJB2-style hash for strings of any length
		let hash = 5381;
		for (let i = 0; i < msg.length; i++) {
			hash = ((hash << 5) + hash) ^ msg.charCodeAt(i);
		}
		return String(hash >>> 0);  // Convert to positive integer string
	}

	/**
	 * Record that a capture was requested, to prevent re-triggering.
	 *
	 * The record is the state of the attempt. It is not the state of the
	 * work: an item of the task list is what says that the work was
	 * recorded, and only a read of the list says that.
	 */
	private _recordCapture(userMessage: string): void {
		const hash = this.hashMessage(userMessage);
		this.recentCaptures.add(hash);
		// Clean up old entries after cooldown
		setTimeout(() => {
			this.recentCaptures.delete(hash);
		}, this.CAPTURE_COOLDOWN_MS);
	}

	/**
	 * Invalidate any pending evaluations (call when paused/stopped)
	 */
	invalidatePending(): void {
		this._stopped = true;
	}

	/**
	 * Check if stopped
	 */
	isStopped(): boolean {
		return this._stopped;
	}

	/**
	 * Resume intake - clear stopped flag to re-enable processing
	 */
	resumeIntake(): void {
		this._stopped = false;
	}

	/**
	 * Internal evaluation logic
	 */
	private async _evaluate(
		userMessage: string,
		existingTodos: string[]
	): Promise<TaskIntakeResult> {
		// Deduplicate identical requests
		if (userMessage === this.lastRequest && this.lastResult) {
			return this.lastResult;
		}

		// Build state for Jev evaluation
		const state = {
			userMessage,
			existingTodos,
			requestCount: existingTodos.length,
		};

		// If Jev is not available, use simple heuristic
		if (!this.jev) {
			const result = this.simpleHeuristic(userMessage, existingTodos);
			this.lastRequest = userMessage;
			this.lastResult = result;
			return result;
		}

		try {
			// Ask Jev multiple questions
			const result = await this.jev.evaluate(state, {
				is_actionable: {
					type: "noul",
					instructions:
						"Does the user message request concrete work or a specific outcome? Ignore greetings, thanks, or status questions.",
				},
				is_duplicate: {
					type: "noul",
					instructions:
						"Does the user message duplicate work already listed in existingTodos? Check for similar task names or goals.",
				},
				modifies_existing: {
					type: "noul",
					instructions:
						"Does the user message modify or clarify an existing requirement rather than add new work?",
				},
			});

			const actionable = result.decisions.is_actionable.response.type === "noul"
				? result.decisions.is_actionable.response.noul >= this.config.actionableThreshold
				: false;
			const isDuplicate = result.decisions.is_duplicate.response.type === "noul"
				? result.decisions.is_duplicate.response.noul >= 0.5
				: false;
			const modifiesExisting = result.decisions.modifies_existing.response.type === "noul"
				? result.decisions.modifies_existing.response.noul >= 0.5
				: false;

			// Determine recommended action
			let action: TaskIntakeResult["action"];
			if (!actionable) {
				action = "skip";
			} else if (modifiesExisting) {
				action = "amend";
			} else if (isDuplicate) {
				action = "skip";
			} else {
				action = "create";
			}

			const finalResult: TaskIntakeResult = {
				actionable,
				probability: result.decisions.is_actionable.response.type === "noul"
					? result.decisions.is_actionable.response.noul
					: 0,
				isDuplicate,
				modifiesExisting,
				action,
			};

			this.lastRequest = userMessage;
			this.lastResult = finalResult;
			return finalResult;
		} catch (err) {
			// On Jev error, fall back to simple heuristic
			const result = this.simpleHeuristic(userMessage, existingTodos);
			this.lastRequest = userMessage;
			this.lastResult = result;
			return result;
		}
	}

	/**
	 * Simple heuristic when Jev is not available
	 */
	private simpleHeuristic(
		userMessage: string,
		existingTodos: string[]
	): TaskIntakeResult {
		const lower = userMessage.toLowerCase();

		// Check for non-actionable patterns
		const nonActionable = [
			/^(hi|hello|hey|thanks?|thank you)/i,
			/how are you/i,
			/what('s| is) the status/i,
			/can you help me/i,
			/just checking/i,
		];

		for (const pattern of nonActionable) {
			if (pattern.test(lower)) {
				return {
					actionable: false,
					probability: 0,
					isDuplicate: false,
					modifiesExisting: false,
					action: "skip",
				};
			}
		}

		// Check for actionable patterns
		const actionablePatterns = [
			/\bfix\b/i,
			/\bimplement\b/i,
			/\badd\b/i,
			/\bremove\b/i,
			/\bcreate\b/i,
			/\bupdate\b/i,
			/\bchange\b/i,
			/\bplease\b/i,
			/\bi need\b/i,
			/\bi want\b/i,
			/\bcan you\b/i,
			/\bcould you\b/i,
		];

		let probability = 0;
		for (const pattern of actionablePatterns) {
			if (pattern.test(lower)) {
				probability = Math.min(probability + 0.2, 0.8);
			}
		}

		// Check for duplicates
		let isDuplicate = false;
		for (const todo of existingTodos) {
			const todoLower = todo.toLowerCase();
			// Simple word overlap check
			const words = lower.split(/\s+/).filter(w => w.length > 3);
			const overlap = words.filter(w => todoLower.includes(w)).length;
			if (overlap >= 2) {
				isDuplicate = true;
				break;
			}
		}

		const actionable = probability >= 0.3 && !isDuplicate;

		return {
			actionable,
			probability,
			isDuplicate,
			modifiesExisting: false,
			action: actionable ? "create" : "skip",
		};
	}

	/**
	 * Dispatch a capture request to the agent
	 * @param userMessage - The original user message to capture
	 * @param _customType - Optional custom type for the message (default: "task-capture") - unused, kept for API compatibility
	 */
	async requestCapture(
		userMessage: string,
		_customType: string = "task-capture"
	): Promise<void> {
		// Check if stopped - don't dispatch after stop
		if (this._stopped) {
			return;
		}

		// The reminder of a request is sent once. The key is the request
		// and the text of the request: the same work of the same request
		// must not produce a second reminder, and that reminder would
		// arrive as a new request of the work.
		const generation = this.config.requestGeneration?.();
		const key =
			generation === undefined
				? ""
				: `${generation}:${this.hashMessage(userMessage)}`;
		if (key && this.reminded.has(key)) {
			return;
		}
		if (key) {
			this.reminded.add(key);
			// The set is bounded: the old keys are dropped, because a
			// request that is long past cannot be reminded now.
			if (this.reminded.size > 50) {
				const oldest = this.reminded.values().next();
				if (!oldest.done) this.reminded.delete(oldest.value);
			}
		}

		// Record that a capture was requested. The record is the state of
		// the attempt, not the state of the work: the work is captured
		// when an item of the task list stands for it, and that is
		// observed from the list, not from this record.
		this._recordCapture(userMessage);

		// The instruction names the request, so the agent knows what to
		// record. An instruction that asks for "all tasks" leaves the
		// agent to guess, and the work it leaves out is the work that is
		// lost when the context window fills.
		//
		// The name of the tool is the one the harness names: a request
		// that belongs to a handoff is recorded with the tool of the
		// handoff, so the todo of the work names the issue it belongs
		// to. Two names in one message would leave the agent to choose,
		// and the plain one writes a todo without the link.
		const tool = this.config.todoToolName?.(userMessage) || "todo";
		const message = [
			`Please record the work of this request in the task list (${tool}): ${userMessage}`,
			`Use ${tool} (the local Todos list, not bd). Read the pending and the in_progress items first;`,
			"reuse the existing items and avoid duplicates. Add one item per step of the request, the",
			"subject in the imperative, and the description with what the step is and how it is checked.",
			"Update progress, blockers and the exact next action, and mark an item completed only when",
			"its required validation has passed. Do not start unrelated backlog work.",
		].join(" ");

		try {
			await this.config.dispatch(message);
		} catch (error) {
			// The reminder was not sent. The key is released, so the next
			// attempt of the same request can send it again: a failed
			// dispatch must not cost the request its reminder.
			if (key) this.reminded.delete(key);
			throw error;
		}
	}

	/**
	 * Reset state
	 */
	reset(): void {
		this.lastRequest = null;
		this.lastResult = null;
	}
}

/**
 * Create a task intake controller
 */
export function createTaskIntake(config: TaskIntakeConfig): TaskIntakeController {
	return new TaskIntakeController(config);
}
