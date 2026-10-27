/**
 * The runtime wiring of the two-phase workflow.
 *
 * The wiring lives in the package so it can be tested without a Pi session:
 * the extension API, the todo reader and the workspace are injected. Every
 * decision that the runtime takes is conservative - when the state of the
 * todo list is unknown, the workflow waits instead of guessing.
 */

import {
	completedImplementationTodos,
	implementationTodos,
	reviewFixTodos,
	testTodos,
	type TodoLike,
} from "./classify.js";
import {
	detectReviewInvocation,
	explicitReviewRequest,
	parseExtraPatterns,
} from "./signals.js";
import { chunkScope, collectScope, currentRevision } from "./scope.js";
import {
	TwoPhaseStateStore,
	allChunksDone,
	completeWithoutReview,
	createState,
	markComplete,
	recordSignal,
	startReview,
	transitionToReviewFixes,
	transitionToReviewPending,
	transitionToTestPending,
} from "./state.js";
import {
	TWO_PHASE_CONTRACT,
	buildChunkTodoSubject,
	buildDeferralReason,
	buildPhaseInstruction,
	buildPhaseView,
	buildReviewTodoDescription,
	buildReviewTodoSubject,
	formatPhaseStatus,
	syncChunkStatus,
	type DelegationStatus,
	type PhaseView,
} from "./rules.js";
import {
	emptyValidationGateState,
	validationGateSatisfied,
	type ValidationGateReader,
	type ValidationGateState,
} from "./validation.js";
import type { TwoPhasePhase, TwoPhaseState } from "./types.js";

/** The marker every message of the harness itself carries. */
export const HARNESS_MESSAGE_MARKER = "[harness:";

/** The part of the extension API the workflow needs. */
export interface TwoPhaseExtensionApi {
	on(event: string, handler: (...args: any[]) => unknown): void;
	appendEntry?(type: string, data: unknown): void;
	sendUserMessage?(content: string, options?: { deliverAs?: "steer" | "followUp" }): Promise<void> | void;
}

/** The part of the extension context the workflow needs. */
export interface TwoPhaseExtensionContext {
	sessionManager?: { getSessionId?: () => string | undefined };
	ui?: { setStatus?: (key: string, value: string) => void };
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
	/**
	 * Reads the delegation state of the session.
	 *
	 * The status line shows the children that really ran, so the reader
	 * must report the observed children and not a plan.
	 */
	readDelegation?: () => DelegationStatus | undefined;
}

/** The runtime of the workflow. */
export interface TwoPhaseRuntime {
	/** The persisted state of the workflow. */
	getState(): TwoPhaseState;
	/** The phase the workflow is in (derived from the state and the todo list). */
	getPhase(todos?: TodoLike[]): TwoPhasePhase;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

/** The text of a message content (a string or a list of parts). */
function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (!part || typeof part !== "object") return "";
				const entry = part as { type?: string; text?: string };
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
export async function initTwoPhaseReview(
	options: TwoPhaseRuntimeOptions,
): Promise<TwoPhaseRuntime> {
	const { pi } = options;
	const store = options.store ?? new TwoPhaseStateStore();
	const log = options.log ?? (() => {});
	const workspaceRoot = options.workspaceRoot ?? (() => process.cwd());
	const extraPatterns = options.extraPatterns ?? parseExtraPatterns();

	let state: TwoPhaseState = createState("default");
	/** The last message of the human of this session (never a harness message). */
	let lastUserMessage = "";
	/** The messages the runtime sent itself. */
	const sentMessages = new Set<string>();

	const sessionId = (ctx: unknown): string => {
		const context = ctx as TwoPhaseExtensionContext | undefined;
		try {
			return context?.sessionManager?.getSessionId?.() ?? "default";
		} catch {
			return "default";
		}
	};

	/**
	 * Persist a state.
	 *
	 * The state is only replaced when it was written: the file is the source
	 * of truth, so a failed write must not change what the runtime believes.
	 */
	const persist = (next: TwoPhaseState): boolean => {
		try {
			state = store.write(next);
			return true;
		} catch (error) {
			log(`state not written: ${errorMessage(error)}`);
			return false;
		}
	};

	const readTodos = async (ctx: unknown): Promise<TodoReadResult> => {
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
		} catch (error) {
			return { available: false, todos: [], reason: errorMessage(error) };
		}
	};

	const readValidation = async (todos: TodoLike[]): Promise<ValidationGateState> => {
		if (!options.readValidation) {
			return {
				...emptyValidationGateState(),
				reason: "no validation ledger is wired into the workflow",
			};
		}
		try {
			const result = await options.readValidation(todos);
			return { ...emptyValidationGateState(), ...result };
		} catch (error) {
			return { ...emptyValidationGateState(), reason: errorMessage(error) };
		}
	};

	const updateStatus = (
		ctx: unknown,
		todos?: TodoLike[],
		validation?: ValidationGateState,
	): void => {
		const context = ctx as TwoPhaseExtensionContext | undefined;
		let delegation: DelegationStatus | undefined;
		try {
			delegation = options.readDelegation?.();
		} catch {
			// The delegation state is a convenience, never a requirement.
		}
		const view: PhaseView | undefined = todos
			? buildPhaseView(state, todos, validation, delegation)
			: undefined;
		try {
			context?.ui?.setStatus?.("harness-review", formatPhaseStatus(state, view));
		} catch {
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
	const syncProgress = async (todos: TodoLike[]): Promise<void> => {
		const synced = syncChunkStatus(state, todos);
		const openFixes = reviewFixTodos(todos).length;
		const openTests = testTodos(todos).length;
		const validation = await readValidation(todos);
		const workDone = openTests === 0 && validationGateSatisfied(validation);
		// The work is finished when the validation is done, otherwise the task
		// waits in the phase that owns the open test items.
		const finish = (next: TwoPhaseState): TwoPhaseState =>
			workDone ? markComplete(next) : transitionToTestPending(next);
		let next = synced;
		if (next.phase === "review" && allChunksDone(next)) {
			next = openFixes > 0 ? transitionToReviewFixes(next) : finish(next);
		} else if (next.phase === "review_fixes" && openFixes === 0) {
			next = finish(next);
		} else if (next.phase === "test_pending" && workDone) {
			next = markComplete(next);
		}
		if (next !== state) persist(next);
	};

	pi.on("session_start", (_event: unknown, ctx: unknown) => {
		const id = sessionId(ctx);
		state = store.read(id) ?? createState(id);
		if (!state.startRevision) {
			const revision = currentRevision(workspaceRoot());
			if (revision) state = { ...state, startRevision: revision };
		}
		// The intent of a previous session never carries over.
		lastUserMessage = "";
		persist(state);
		updateStatus(ctx);
	});

	// The intent of the human wins over the phase order.
	pi.on("message_end", (event: { message?: { role?: string; content?: unknown } }) => {
		const message = event?.message;
		if (!message || message.role !== "user") return;
		const text = messageText(message.content).trim();
		if (!text) return;
		// A message of the harness is not the intent of the human.
		if (sentMessages.has(text)) return;
		if (text.startsWith(HARNESS_MESSAGE_MARKER)) return;
		lastUserMessage = text;
	});

	// A comprehensive review is deferred while the implementation runs.
	pi.on(
		"tool_call",
		async (event: { toolName?: string; input?: unknown }, ctx: unknown) => {
			if (state.phase !== "implementation") return {};

			const invocation = detectReviewInvocation(
				event?.toolName ?? "",
				event?.input,
				extraPatterns,
			);
			if (!invocation) return {};
			// The human asked for the review explicitly: the phase order does not win.
			if (explicitReviewRequest(lastUserMessage)) return {};

			const read = await readTodos(ctx);
			if (!read.available) {
				// The implementation state is unknown, so the review waits.
				return {
					block: true,
					reason: `The todo list of the session is not readable (${read.reason ?? "unknown reason"}), so the workflow cannot prove that the implementation is done. The comprehensive review is deferred.`,
				};
			}

			const openImplementation = implementationTodos(read.todos).length;
			if (openImplementation === 0) return {};

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
				} catch {
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
		},
	);

	// The implementation is done: the review scope is derived from the task diff.
	pi.on("turn_end", async (_event: unknown, ctx: unknown) => {
		const read = await readTodos(ctx);
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
				if (done !== state) persist(done);
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

			const lines: string[] = [
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
			} catch (error) {
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
	pi.on("before_agent_start", async (event: { systemPrompt?: string }, ctx: unknown) => {
		const read = await readTodos(ctx);
		if (!read.available) return undefined;
		await syncProgress(read.todos);

		const validation = await readValidation(read.todos);
		const view = buildPhaseView(state, read.todos, validation);
		// The workflow is only active when it has something to say.
		const active =
			view.implementationOpen > 0 ||
			view.reviewOpen > 0 ||
			view.reviewFixOpen > 0 ||
			view.testOpen > 0 ||
			state.phase === "test_pending" ||
			state.signals.length > 0;
		if (!active) return undefined;

		// The system prompt is built per run, so the contract belongs to every
		// run of the phase, not only to the first one.
		const parts: string[] = [TWO_PHASE_CONTRACT];
		const instruction = buildPhaseInstruction(state, view);
		if (instruction) parts.push(instruction);

		return { systemPrompt: `${event?.systemPrompt ?? ""}\n\n${parts.join("\n\n")}` };
	});

	return {
		getState: () => state,
		getPhase: (todos: TodoLike[] = []) => {
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
