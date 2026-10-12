/**
 * Task Intake - Automatic todo capture from user requests
 *
 * Uses Jev Yes/No judgments to determine:
 * - Whether a user request should be tracked as work
 * - Whether it duplicates existing work
 * - Whether it modifies an existing requirement
 */
import { JevJudge } from "./index.js";
/**
 * Task Intake Controller
 *
 * Evaluates user requests with Jev to determine if they should be
 * captured as todos for automatic tracking.
 */
export class TaskIntakeController {
    jev = null;
    config;
    lastRequest = null;
    lastResult = null;
    constructor(config) {
        this.config = {
            actionableThreshold: 0.7,
            ...config,
        };
        // Initialize Jev if API key is available
        if (config.apiKey) {
            this.jev = new JevJudge(config);
        }
    }
    /**
     * Check if Jev is available
     */
    isAvailable() {
        return this.jev !== null;
    }
    /**
     * Evaluate a user request for task capture
     */
    async evaluate(userMessage, existingTodos = []) {
        return this._evaluate(userMessage, existingTodos);
    }
    /**
     * Evaluate with actual todo items from continuation controller
     */
    async evaluateWithTodos(userMessage, controller) {
        // Get actual todos from the continuation controller
        let existingTodos = [];
        try {
            const snapshot = await controller.getSnapshot();
            existingTodos = snapshot.items
                .filter((i) => i.status !== "completed" && i.status !== "deleted")
                .map((i) => i.subject);
        }
        catch {
            // Ignore errors, use empty list
        }
        return this._evaluate(userMessage, existingTodos);
    }
    /**
     * Internal evaluation logic
     */
    async _evaluate(userMessage, existingTodos) {
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
                    instructions: "Does the user message request concrete work or a specific outcome? Ignore greetings, thanks, or status questions.",
                },
                is_duplicate: {
                    type: "noul",
                    instructions: "Does the user message duplicate work already listed in existingTodos? Check for similar task names or goals.",
                },
                modifies_existing: {
                    type: "noul",
                    instructions: "Does the user message modify or clarify an existing requirement rather than add new work?",
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
            let action;
            if (!actionable) {
                action = "skip";
            }
            else if (modifiesExisting) {
                action = "amend";
            }
            else if (isDuplicate) {
                action = "skip";
            }
            else {
                action = "create";
            }
            const finalResult = {
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
        }
        catch (err) {
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
    simpleHeuristic(userMessage, existingTodos) {
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
     * @param customType - Optional custom type for the message (default: "task-capture")
     */
    async requestCapture(userMessage, customType = "task-capture") {
        // Build a message to prompt the agent to create todos
        let message = `[${customType}] Work detected in user request: "${userMessage.slice(0, 200)}"`;
        message += "\n\nPlease capture this work in the todo list if not already tracked.";
        await this.config.dispatch(message);
    }
    /**
     * Reset state
     */
    reset() {
        this.lastRequest = null;
        this.lastResult = null;
    }
}
/**
 * Create a task intake controller
 */
export function createTaskIntake(config) {
    return new TaskIntakeController(config);
}
//# sourceMappingURL=task-intake.js.map