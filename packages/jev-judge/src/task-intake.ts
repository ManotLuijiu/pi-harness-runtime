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

	constructor(config: TaskIntakeConfig) {
		this.config = {
			actionableThreshold: 0.7,
			...config,
		} as Required<TaskIntakeConfig>;

		// Initialize Jev if API key is available
		if (config.apiKey) {
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
	 */
	async requestCapture(
		userMessage: string,
		existingTodos: string[] = []
	): Promise<void> {
		const result = await this.evaluate(userMessage, existingTodos);

		if (result.action === "skip") {
			return;
		}

		// Build a message to prompt the agent to create todos
		let message = "Work detected in user request. ";

		if (result.isDuplicate) {
			message += "Potential duplicate detected. ";
		}

		if (result.modifiesExisting) {
			message += "Existing task modification detected. ";
		}

		message += `Please capture this work in the todo list if not already tracked.`;

		await this.config.dispatch(message);
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
