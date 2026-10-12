import { createTodoProvider } from "./todo-provider.js";
/**
 * Simple debug logger that writes to file, not stdout
 */
const DEBUG_LOG_FILE = "/tmp/pi-harness-debug.log";
function debugLog(component, ...args) {
    try {
        const timestamp = new Date().toISOString();
        const msg = `[${timestamp}] [${component}] ${args.map(a => String(a)).join(" ")}\n`;
        import("node:fs").then(({ appendFileSync }) => {
            appendFileSync(DEBUG_LOG_FILE, msg);
        }).catch(() => { });
    }
    catch {
        // Silently fail
    }
}
/**
 * Todo-Driven Continuation Controller
 *
 * Evaluates todo state on agent_settled and determines next action.
 */
export class TodoContinuationController {
    ctx;
    config;
    todoProvider;
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
        steerAttemptsForCurrentItem: 0,
        lastItemContinued: null,
        lastEvaluationResult: null,
    };
    constructor(ctx, config) {
        this.ctx = ctx;
        this.todoProvider = createTodoProvider(ctx);
        this.config = {
            jevFallbackMinWaitMs: 5 * 60 * 1000, // 5 minutes
            routineThreshold: 0.7,
            maxSteerAttempts: 3,
            enableJev: true,
            ...config,
        };
    }
    /**
     * Check if continuation is allowed (not paused, session idle)
     */
    canContinue() {
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
    async decide() {
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
        let inProgress;
        let ready;
        let blocked;
        try {
            inProgress = await this.todoProvider.getInProgress();
            ready = await this.todoProvider.getReady();
            blocked = await this.todoProvider.getBlocked();
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            debugLog("TodoContinuation", "Failed to read todos:", msg);
            return { action: "stop", reason: `todo read failed: ${msg}` };
        }
        // 4. Continue in-progress work first
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
        // 5. Continue ready pending work (not blocked)
        if (ready.length > 0) {
            const item = ready[0];
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
        // 6. Only report blocked when nothing can proceed
        if (blocked.length > 0) {
            debugLog("TodoContinuation", "Tasks blocked:", blocked.length);
            return { action: "blocked", question: `${blocked.length} task(s) blocked` };
        }
        // 7. No work remaining
        return { action: "stop", reason: "No pending tasks" };
    }
    /**
     * Continue a specific todo item
     */
    async continueItem(item) {
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
        // Send continuation message via dispatch callback
        try {
            await this.config.dispatch(message);
        }
        catch (err) {
            debugLog("TodoContinuation", "Failed to send continuation:", String(err));
            this.state.continuationQueued = false;
        }
    }
    /**
     * Steer to continue a todo item
     */
    async steerToContinue(itemId) {
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
        // Send continuation message via dispatch callback
        try {
            await this.config.dispatch(message);
        }
        catch (err) {
            debugLog("TodoContinuation", "Failed to send steer:", String(err));
            this.state.continuationQueued = false;
        }
    }
    /**
     * Mark a todo item as complete
     */
    async markComplete(_itemId) {
        debugLog("TodoContinuation", "Marking item complete");
        this.state.currentItemId = null;
        this.state.generation++;
    }
    /**
     * User paused
     */
    pause() {
        debugLog("TodoContinuation", "User paused");
        this.state.userPaused = true;
        this.state.continuationQueued = false;
    }
    /**
     * Reset state for new session
     */
    _reset() {
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
    _cleanup() {
        debugLog("TodoContinuation", "Cleaning up");
        this.state.continuationQueued = false;
        this.state.generation++;
    }
    /**
     * Get current state summary
     */
    getState() {
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
export function createTodoContinuation(ctx, config) {
    return new TodoContinuationController(ctx, config);
}
//# sourceMappingURL=continuation-controller.js.map