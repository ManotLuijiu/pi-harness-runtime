/**
 * The runtime wiring of the two-phase workflow.
 *
 * The wiring lives in the package so it can be tested without a Pi session:
 * the extension API, the todo reader and the workspace are injected. Every
 * decision that the runtime takes is conservative - when the state of the
 * todo list is unknown, the workflow waits instead of guessing.
 */
import { completedImplementationTodos, implementationTodos, reviewFixTodos, testTodos, } from "./classify.js";
import { detectReviewInvocation, explicitReviewRequest, parseExtraPatterns, } from "./signals.js";
import { chunkScope, collectScope, currentRevision } from "./scope.js";
import { TwoPhaseStateStore, allChunksDone, completeWithoutReview, createState, markComplete, recordSignal, startReview, transitionToReviewFixes, transitionToReviewPending, transitionToTestPending, } from "./state.js";
import { TWO_PHASE_CONTRACT, buildChunkTodoSubject, buildDeferralReason, buildPhaseInstruction, buildPhaseView, buildReviewTodoDescription, buildReviewTodoSubject, formatPhaseStatus, syncChunkStatus, } from "./rules.js";
import { emptyValidationGateState, validationGateSatisfied, } from "./validation.js";
/** The marker every message of the harness itself carries. */
export const HARNESS_MESSAGE_MARKER = "[harness:";
function errorMessage(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
/** The text of a message content (a string or a list of parts). */
function messageText(content) {
    if (typeof content === "string")
        return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
            if (!part || typeof part !== "object")
                return "";
            const entry = part;
            return entry.type === "text" ? (entry.text ?? "") : "";
        })
            .join("\n");
    }
    return "";
}
/**
 * Register the two-phase workflow in the session.
 *
 * The handlers are registered before the function returns, so a session that
 * starts right after the registration is already covered.
 */
export async function initTwoPhaseReview(options) {
    const { pi } = options;
    const store = options.store ?? new TwoPhaseStateStore();
    const log = options.log ?? (() => { });
    const workspaceRoot = options.workspaceRoot ?? (() => process.cwd());
    const extraPatterns = options.extraPatterns ?? parseExtraPatterns();
    let state = createState("default");
    /** The last message of the human of this session (never a harness message). */
    let lastUserMessage = "";
    /**
     * The availability of the todo list of the session.
     *
     * The agent owns the todo list, so the harness only reads it. When the
     * provider is not available the phase gate is not active, and the
     * session has to say so instead of pretending that it is.
     */
    let todoAvailability = {
        available: true,
    };
    /** The messages the runtime sent itself. */
    const sentMessages = new Set();
    const sessionId = (ctx) => {
        const context = ctx;
        try {
            return context?.sessionManager?.getSessionId?.() ?? "default";
        }
        catch {
            return "default";
        }
    };
    /**
     * Persist a state.
     *
     * The state is only replaced when it was written: the file is the source
     * of truth, so a failed write must not change what the runtime believes.
     */
    const persist = (next) => {
        try {
            state = store.write(next);
            return true;
        }
        catch (error) {
            log(`state not written: ${errorMessage(error)}`);
            return false;
        }
    };
    const readTodos = async (ctx) => {
        try {
            const result = await options.readTodos(ctx);
            if (!result || typeof result !== "object") {
                return { available: false, todos: [], reason: "the todo reader returned nothing" };
            }
            return {
                available: result.available !== false,
                todos: Array.isArray(result.todos) ? result.todos : [],
                reason: result.reason,
            };
        }
        catch (error) {
            return { available: false, todos: [], reason: errorMessage(error) };
        }
    };
    /**
     * Read the todo list and remember whether it was readable.
     *
     * A change of the availability is reported once: the phase gate is not
     * active while the todo list is unreadable, and the operator has to
     * know that.
     */
    const readTodosWithAvailability = async (ctx) => {
        const read = await readTodos(ctx);
        if (read.available !== todoAvailability.available) {
            todoAvailability = { available: read.available, reason: read.reason };
            log(read.available
                ? "the todo list of the session is readable again"
                : `the todo list of the session is not readable (${read.reason ?? "unknown reason"}): the phase gate is not active`);
        }
        else if (!read.available && read.reason) {
            todoAvailability = { available: false, reason: read.reason };
        }
        return read;
    };
    const readValidation = async (todos) => {
        if (!options.readValidation) {
            return {
                ...emptyValidationGateState(),
                reason: "no validation ledger is wired into the workflow",
            };
        }
        try {
            const result = await options.readValidation(todos);
            return { ...emptyValidationGateState(), ...result };
        }
        catch (error) {
            return { ...emptyValidationGateState(), reason: errorMessage(error) };
        }
    };
    const updateStatus = (ctx, todos, validation) => {
        const context = ctx;
        let delegation;
        try {
            delegation = options.readDelegation?.();
        }
        catch {
            // The delegation state is a convenience, never a requirement.
        }
        const view = todos
            ? buildPhaseView(state, todos, validation, delegation)
            : undefined;
        try {
            // A todo list that cannot be read is shown: the phase gate is
            // not active, and the status must not pretend otherwise.
            const line = todoAvailability.available
                ? formatPhaseStatus(state, view)
                : "[?] TODOS unavailable";
            context?.ui?.setStatus?.("harness-review", line);
        }
        catch {
            // The status line is a convenience, never a requirement.
        }
    };
    /**
     * Keep the chunk status and the phase in sync with the todo list.
     *
     * The chunk status only moves forward, so a todo list that is briefly
     * empty can never erase the progress of the review.
     *
     * The task is only complete when the validation of the test items is
     * done: a final tier that is pending or failed keeps the task open.
     */
    const syncProgress = async (todos) => {
        const synced = syncChunkStatus(state, todos);
        const openFixes = reviewFixTodos(todos).length;
        const openTests = testTodos(todos).length;
        const validation = await readValidation(todos);
        const workDone = openTests === 0 && validationGateSatisfied(validation);
        // The work is finished when the validation is done, otherwise the task
        // waits in the phase that owns the open test items.
        const finish = (next) => workDone ? markComplete(next) : transitionToTestPending(next);
        let next = synced;
        if (next.phase === "review" && allChunksDone(next)) {
            next = openFixes > 0 ? transitionToReviewFixes(next) : finish(next);
        }
        else if (next.phase === "review_fixes" && openFixes === 0) {
            next = finish(next);
        }
        else if (next.phase === "test_pending" && workDone) {
            next = markComplete(next);
        }
        if (next !== state)
            persist(next);
    };
    pi.on("session_start", (_event, ctx) => {
        const id = sessionId(ctx);
        state = store.read(id) ?? createState(id);
        if (!state.startRevision) {
            const revision = currentRevision(workspaceRoot());
            if (revision)
                state = { ...state, startRevision: revision };
        }
        // The intent of a previous session never carries over.
        lastUserMessage = "";
        persist(state);
        updateStatus(ctx);
    });
    // The intent of the human wins over the phase order.
    pi.on("message_end", (event) => {
        const message = event?.message;
        if (!message || message.role !== "user")
            return;
        const text = messageText(message.content).trim();
        if (!text)
            return;
        // A message of the harness is not the intent of the human.
        if (sentMessages.has(text))
            return;
        if (text.startsWith(HARNESS_MESSAGE_MARKER))
            return;
        lastUserMessage = text;
    });
    // A comprehensive review is deferred while the implementation runs.
    pi.on("tool_call", async (event, ctx) => {
        if (state.phase !== "implementation")
            return {};
        const invocation = detectReviewInvocation(event?.toolName ?? "", event?.input, extraPatterns);
        if (!invocation)
            return {};
        // The human asked for the review explicitly: the phase order does not win.
        if (explicitReviewRequest(lastUserMessage))
            return {};
        const read = await readTodosWithAvailability(ctx);
        if (!read.available) {
            // The implementation state is unknown, so the review waits.
            return {
                block: true,
                reason: `The todo list of the session is not readable (${read.reason ?? "unknown reason"}), so the workflow cannot prove that the implementation is done. The comprehensive review is deferred.`,
            };
        }
        const openImplementation = implementationTodos(read.todos).length;
        if (openImplementation === 0)
            return {};
        const next = recordSignal(state, {
            source: invocation.source,
            files: invocation.files,
            reason: invocation.reason,
            at: new Date().toISOString(),
        });
        if (next !== state) {
            if (!persist(next)) {
                // The signal is not persisted, so it is not queued either.
                return {
                    block: true,
                    reason: buildDeferralReason(state, {
                        source: invocation.source,
                        implementationOpen: openImplementation,
                    }),
                };
            }
            // The queued item is part of the session, so a compaction cannot lose it.
            try {
                pi.appendEntry?.("harness-two-phase-review", {
                    queued: {
                        source: invocation.source,
                        files: invocation.files,
                        reason: invocation.reason,
                        subject: buildReviewTodoSubject(state),
                        description: buildReviewTodoDescription(state),
                    },
                });
            }
            catch {
                // The session entry is a copy; the state file is the truth.
            }
        }
        updateStatus(ctx, read.todos);
        return {
            block: true,
            reason: buildDeferralReason(state, {
                source: invocation.source,
                implementationOpen: openImplementation,
            }),
        };
    });
    // The implementation is done: the review scope is derived from the task diff.
    pi.on("turn_end", async (_event, ctx) => {
        const read = await readTodosWithAvailability(ctx);
        if (!read.available) {
            // The implementation state is unknown, so the phase does not move.
            updateStatus(ctx);
            return undefined;
        }
        if (state.phase === "implementation") {
            if (implementationTodos(read.todos).length > 0) {
                updateStatus(ctx, read.todos);
                return undefined;
            }
            // The implementation is over only when the todo list shows that
            // implementation work actually finished. Without that evidence the
            // workflow waits: it never guesses that a task is done.
            if (completedImplementationTodos(read.todos).length === 0) {
                updateStatus(ctx, read.todos);
                return undefined;
            }
            // The review starts on its own: its scope is the measured diff of
            // the task, not a signal the agent has to raise.
            const scope = collectScope(workspaceRoot(), state.startRevision);
            if (scope.files.length === 0) {
                // The task changed no file, so there is nothing to review.
                const done = completeWithoutReview(state, scope.files);
                if (done !== state)
                    persist(done);
                updateStatus(ctx, read.todos);
                return undefined;
            }
            let next = transitionToReviewPending(state, scope.files);
            next = startReview(next, chunkScope(scope.files));
            if (!persist(next)) {
                // Without a persisted state the review must not start.
                updateStatus(ctx, read.todos);
                return undefined;
            }
            updateStatus(ctx, read.todos);
            const lines = [
                "[harness:two-phase] The implementation todos of this request are done. Phase 2 (review) starts now.",
                `Review scope: ${scope.files.length} file(s) (${scope.reason}).`,
                ...state.chunks.map((chunk) => `- ${chunk.id}: ${chunk.label}`),
                "Review every chunk in scope (never the whole repository). Record confirmed findings as [REVIEW-FIX] todos grouped by root cause and severity, fix them after the pass, then run one final integration review over the task diff.",
                "Create one [REVIEW] todo per chunk with the chunk id in the subject and complete it when the chunk is reviewed:",
                ...state.chunks.map((chunk) => `- ${buildChunkTodoSubject(chunk)}`),
                `Keep exactly one queued review item: ${buildReviewTodoSubject(state)}`,
            ];
            const message = lines.join("\n");
            try {
                sentMessages.add(message);
                await pi.sendUserMessage?.(message, { deliverAs: "steer" });
                log(`review started (${scope.files.length} file(s))`);
            }
            catch (error) {
                log(`review steer failed: ${errorMessage(error)}`);
            }
            return undefined;
        }
        // Phase 2: the chunk status and the phase follow the review todos.
        await syncProgress(read.todos);
        updateStatus(ctx, read.todos);
        return undefined;
    });
    // The workflow rules and the current phase reach the agent.
    pi.on("before_agent_start", async (event, ctx) => {
        const read = await readTodosWithAvailability(ctx);
        if (!read.available) {
            // The phase gate is not active while the todo list is
            // unreadable. The agent is told that instead of being given a
            // contract the harness cannot enforce.
            const reason = read.reason ?? "unknown reason";
            return {
                systemPrompt: `${event?.systemPrompt ?? ""}\n\nThe todo list of this session is not readable (${reason}), so the phase gate of the harness is not active. The work is not gated in this session.`,
            };
        }
        await syncProgress(read.todos);
        const validation = await readValidation(read.todos);
        const view = buildPhaseView(state, read.todos, validation);
        // The workflow is only active when it has something to say.
        const active = view.implementationOpen > 0 ||
            view.reviewOpen > 0 ||
            view.reviewFixOpen > 0 ||
            view.testOpen > 0 ||
            state.phase === "test_pending" ||
            state.signals.length > 0;
        if (!active)
            return undefined;
        // The system prompt is built per run, so the contract belongs to every
        // run of the phase, not only to the first one.
        const parts = [TWO_PHASE_CONTRACT];
        const instruction = buildPhaseInstruction(state, view);
        if (instruction)
            parts.push(instruction);
        return { systemPrompt: `${event?.systemPrompt ?? ""}\n\n${parts.join("\n\n")}` };
    });
    return {
        getState: () => state,
        getPhase: (todos = []) => {
            if (state.phase === "complete" && reviewFixTodos(todos).length > 0) {
                return "review_fixes";
            }
            // A task that was completed while a test item was still open waits
            // for its validation.
            if (state.phase === "complete" && testTodos(todos).length > 0) {
                return "test_pending";
            }
            return state.phase;
        },
    };
}
//# sourceMappingURL=runtime.js.map