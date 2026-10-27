/**
 * The runtime wiring of the two-phase workflow.
 *
 * The wiring lives in the package so it can be tested without a Pi session:
 * the extension API, the todo reader and the workspace are injected. Every
 * decision that the runtime takes is conservative - when the state of the
 * todo list is unknown, the workflow waits instead of guessing.
 */
import { type TodoLike } from "./classify.js";
import { TwoPhaseStateStore } from "./state.js";
import { type ValidationGateReader } from "./validation.js";
import type { TwoPhasePhase, TwoPhaseState } from "./types.js";
/** The marker every message of the harness itself carries. */
export declare const HARNESS_MESSAGE_MARKER = "[harness:";
/** The part of the extension API the workflow needs. */
export interface TwoPhaseExtensionApi {
    on(event: string, handler: (...args: any[]) => unknown): void;
    appendEntry?(type: string, data: unknown): void;
    sendUserMessage?(content: string, options?: {
        deliverAs?: "steer" | "followUp";
    }): Promise<void> | void;
}
/** The part of the extension context the workflow needs. */
export interface TwoPhaseExtensionContext {
    sessionManager?: {
        getSessionId?: () => string | undefined;
    };
    ui?: {
        setStatus?: (key: string, value: string) => void;
    };
}
/** The result of reading the todo list of the session. */
export interface TodoReadResult {
    /** Is the todo list readable at all? */
    available: boolean;
    /** The todo items (empty when the list is not readable). */
    todos: TodoLike[];
    /** Why the list is not readable. */
    reason?: string;
}
/** Reads the todo list of the session. */
export type TodoReader = (ctx: unknown) => Promise<TodoReadResult>;
/** The options of the runtime. */
export interface TwoPhaseRuntimeOptions {
    pi: TwoPhaseExtensionApi;
    /** Reads the todo list of the session. */
    readTodos: TodoReader;
    /** The root of the workspace (the Git repository of the task). */
    workspaceRoot?: () => string;
    /** Where the state of the workflow is stored. */
    store?: TwoPhaseStateStore;
    /** Writes a line into the log of the harness. */
    log?: (message: string) => void;
    /** Extra review tool patterns of the deployment. */
    extraPatterns?: string[];
    /**
     * Reads the validation state of the test items of the session.
     *
     * The workflow never runs the tests itself: it reads the ledger of the
     * session, so the phase gate and the ledger can never disagree about
     * whether a tier passed.
     */
    readValidation?: ValidationGateReader;
}
/** The runtime of the workflow. */
export interface TwoPhaseRuntime {
    /** The persisted state of the workflow. */
    getState(): TwoPhaseState;
    /** The phase the workflow is in (derived from the state and the todo list). */
    getPhase(todos?: TodoLike[]): TwoPhasePhase;
}
/**
 * Register the two-phase workflow in the session.
 *
 * The handlers are registered before the function returns, so a session that
 * starts right after the registration is already covered.
 */
export declare function initTwoPhaseReview(options: TwoPhaseRuntimeOptions): Promise<TwoPhaseRuntime>;
//# sourceMappingURL=runtime.d.ts.map