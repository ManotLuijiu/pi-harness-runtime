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
import { createTodoProvider } from "./todo-provider.js";
/**
 * Todo-Driven Continuation Controller
 *
 * Evaluates todo state on agent_settled and determines next action.
 */
export class TodoContinuationController {
    pi;
    config;
    todoProvider = createTodoProvider();
    state = {
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
        lastEvaluationResult: null,
    };
    constructor(pi, config) {
        this.pi = pi;
        this.config = {
            jevFallbackMinWaitMs: 5 * 60 * 1000, // 5 minutes
            routineThreshold: 0.7,
            maxSteerAttempts: 3,
            enableJev: true,
            ...config,
        };
        // Initialize Jev judge if enabled
        if (this.config.enableJev) {
            // Jev will be initialized with API key from environment
        }
    }
    /**
     * Register lifecycle hooks
     */
    register() {
        console.log("[TodoContinuation] Registering lifecycle hooks...");
        // Session start - reset state
        this.pi.on("session_start", () => {
            this.reset();
            console.log("[TodoContinuation] Session started");
        });
        // Agent settled - evaluate continuation
        this.pi.on("agent_settled", () => {
            this.evaluateContinuation().catch((err) => console.error("[TodoContinuation] Evaluation failed:", err));
        });
        // User input - reset pause state
        this.pi.on("message_start", (event) => {
            const msg = event.message;
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
     * Evaluate continuation decision and execute it
     */
    async evaluateContinuation() {
        // 1. Check user pause
        if (this.state.userPaused) {
            console.log("[TodoContinuation] User paused, stopping");
            return;
        }
        // 2. Get current todo snapshot
        const availability = await this.todoProvider.availability();
        if (!availability.available) {
            // No todo provider - don't auto-continue
            console.log("[TodoContinuation] Todo provider unavailable:", availability.error);
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
                console.log(`[TodoContinuation] In-progress item: ${item.subject}`);
                await this.continueItem(item);
                return;
            }
            // 5. Determine action based on state
            const totalItems = completedItems.length + pendingItems.length + inProgressItems.length;
            const hasWork = pendingItems.length > 0 || inProgressItems.length > 0;
            if (!hasWork && totalItems === 0) {
                console.log("[TodoContinuation] All items complete");
                return;
            }
            if (pendingItems.length > 0) {
                // Check if items are blocked
                const blockedItems = await this.todoProvider.getBlocked();
                if (blockedItems.length === pendingItems.length) {
                    // All pending items are blocked
                    const blocker = blockedItems[0];
                    console.log("[TodoContinuation] Items blocked:", blocker?.subject);
                    // Don't auto-continue when blocked
                    return;
                }
                // Continue the first non-blocked pending item
                const readyItems = await this.todoProvider.getReady();
                if (readyItems.length > 0) {
                    await this.continueItem(readyItems[0]);
                }
            }
        }
        catch (err) {
            console.error("[TodoContinuation] Evaluation error:", err);
        }
    }
    /**
     * Continue a specific todo item
     */
    async continueItem(item) {
        if (this.state.steerAttempts >= this.config.maxSteerAttempts) {
            console.warn("[TodoContinuation] Max steer attempts reached");
            return;
        }
        this.state.steerAttempts++;
        this.state.continuationQueued = true;
        // Build continuation message
        const message = item.description
            ? `Continue task: ${item.subject}\n\n${item.description}`
            : `Continue task: ${item.subject}`;
        this.state.lastSteerMessage = message;
        console.log(`[TodoContinuation] Continuing: ${item.subject}`);
        console.log(`[TodoContinuation] Message: ${message}`);
        // Note: Pi does not expose sendUserMessage API.
        // The Telegram notification system will prompt user for ambiguous cases.
    }
    /**
     * Steer to continue a todo item
     */
    async steerToContinue(itemId) {
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
    async markComplete(itemId) {
        console.log(`[TodoContinuation] Marking item ${itemId} complete`);
        this.state.currentItemId = null;
        this.state.generation++;
    }
    /**
     * User paused
     */
    pause() {
        this.state.userPaused = true;
        this.state.continuationQueued = false;
        console.log("[TodoContinuation] User paused");
    }
    /**
     * Reset state for new session
     */
    reset() {
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
            lastEvaluationResult: null,
        };
    }
    /**
     * Cleanup on shutdown
     */
    cleanup() {
        console.log("[TodoContinuation] Cleaning up");
        this.state.continuationQueued = false;
        this.state.generation++;
    }
    /**
     * Get current state summary
     */
    getState() {
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
export function createTodoContinuation(pi, config) {
    const controller = new TodoContinuationController(pi, config);
    controller.register();
    return controller;
}
//# sourceMappingURL=continuation-controller.js.map