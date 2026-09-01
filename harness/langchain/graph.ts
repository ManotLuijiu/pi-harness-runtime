/**
 * Deterministic write-review loop as a LangGraph StateGraph.
 *
 *   START → plan (GPT) → write (MiniMax) → review (GPT)
 *                                      ├─ approved / blocked / max-iter → finish
 *                                      └─ changes_requested → write (with comments)
 *
 * Unlike the supervisor variant (agents.ts, agents.py style) where an LLM
 * decides routing, here the structured review verdict drives the conditional
 * edge — the loop is guaranteed to terminate at maxIterations.
 *
 * Wiki: wiki/multi-agent-langchain.md
 */

import {
	Annotation,
	END,
	MemorySaver,
	START,
	StateGraph,
} from "@langchain/langgraph";
import {
	lastMessage,
	type ReviewVerdict,
	ReviewVerdictSchema,
} from "./agents.js";
import type { LoopWidget } from "./widget.js";

// ─── State ──────────────────────────────────────────────────────────────────

const LoopState = Annotation.Root({
	/** Original user request */
	request: Annotation<string>,
	/** Plan produced by the GPT planner */
	plan: Annotation<string>,
	/** Current iteration (0 = first pass) */
	iteration: Annotation<number>({
		reducer: (_prev, next) => next,
		default: () => 0,
	}),
	/** Latest code output from the MiniMax coder */
	code: Annotation<string>,
	/** Latest structured review from the GPT reviewer */
	review: Annotation<ReviewVerdict>,
	/** Human-readable step log (reducer appends) */
	log: Annotation<string[]>({
		reducer: (prev, next) => [...(prev ?? []), ...(next ?? [])],
		default: () => [],
	}),
});

export type LoopState = typeof LoopState.State;

// ─── Dependencies (inject real agents or dry-run stubs) ─────────────────────

export interface LoopDeps {
	plan: (request: string) => Promise<string>;
	write: (plan: string, review: ReviewVerdict | null) => Promise<string>;
	review: (plan: string, code: string) => Promise<ReviewVerdict>;
	maxIterations: number;
	onStep?: (step: string, state: LoopState) => void;
	/** Optional widget for TUI / status-line display (mirrors pi-lens footer style). */
	widget?: LoopWidget;
}

// ─── Node implementations ───────────────────────────────────────────────────

function planNode(deps: LoopDeps) {
	return async (state: LoopState): Promise<Partial<LoopState>> => {
		const plan = await deps.plan(state.request);
		deps.onStep?.("plan", state);
		return {
			plan,
			iteration: 0,
			log: [`[plan] GPT produced plan (${plan.length} chars)`],
		};
	};
}

function writeNode(deps: LoopDeps) {
	return async (state: LoopState): Promise<Partial<LoopState>> => {
		const code = await deps.write(state.plan, state.review ?? null);
		const iter = state.iteration + 1;
		deps.onStep?.("write", { ...state, iteration: iter });
		const reviewNote = state.review
			? ` (addressing ${state.review.comments.length} review comment(s))`
			: "";
		// Note: previous `review` stays in state on purpose — the coder reads its comments.
		return {
			code,
			iteration: iter,
			log: [`[write:${iter}] MiniMax wrote code${reviewNote}`],
		};
	};
}

function reviewNode(deps: LoopDeps) {
	return async (state: LoopState): Promise<Partial<LoopState>> => {
		const review = await deps.review(state.plan, state.code);
		deps.onStep?.("review", state);
		return {
			review,
			log: [`[review:${state.iteration}] GPT verdict: ${review.verdict}`],
		};
	};
}

function finishNode() {
	return async (state: LoopState): Promise<Partial<LoopState>> => {
		const verdict = state.review?.verdict ?? "blocked";
		const reason =
			verdict === "approved"
				? "reviewer approved"
				: verdict === "changes_requested"
					? `max iterations (${state.iteration}) reached with changes still requested`
					: "reviewer blocked the task";
		return {
			log: [`[finish] ${state.iteration} iteration(s) — ${reason}`],
		};
	};
}

// ─── Routing ────────────────────────────────────────────────────────────────

function routeAfterReview(
	state: LoopState,
	maxIterations: number,
): "write" | "finish" {
	const verdict = state.review?.verdict;
	if (verdict === "approved" || verdict === "blocked") return "finish";
	if (state.iteration >= maxIterations) return "finish";
	return "write";
}

// ─── Graph builder ──────────────────────────────────────────────────────────

export function buildWriteReviewLoop(
	deps: LoopDeps,
	opts: { checkpointer?: boolean | unknown } = {},
) {
	// Node names must not collide with state channel names (LangGraph rule),
	// hence the "*Step" suffixes.
	const builder = new StateGraph(LoopState)
		.addNode("planStep", planNode(deps))
		.addNode("writeStep", writeNode(deps))
		.addNode("reviewStep", reviewNode(deps))
		.addNode("finishStep", finishNode())
		.addEdge(START, "planStep")
		.addEdge("planStep", "writeStep")
		.addEdge("writeStep", "reviewStep")
		.addConditionalEdges(
			"reviewStep",
			(state) => routeAfterReview(state, deps.maxIterations),
			// Router returns logical names; map them to the physical node names
			{ write: "writeStep", finish: "finishStep" },
		)
		.addEdge("finishStep", END);

	// Resolve checkpointer: false=disabled, object=use it, true/undefined=default MemorySaver
	const cp = opts.checkpointer;
	const checkpointerToUse =
		cp === false
			? undefined
			: cp != null && cp !== true
				? // eslint-disable-next-line @typescript-eslint/no-explicit-any
					(cp as any)
				: new MemorySaver();
	return builder.compile({ checkpointer: checkpointerToUse });
}

/** Inferred compiled-graph type (do not hand-roll langgraph generics). */
export type WriteReviewLoop = ReturnType<typeof buildWriteReviewLoop>;

// ─── Real-model dependency wiring ───────────────────────────────────────────

export interface RealLoopOptions {
	maxIterations?: number;
	onStep?: (step: string, state: LoopState) => void;
	importAgents?: () => Promise<{
		createPlannerAgent: () => {
			invoke: (input: { messages: unknown[] }) => Promise<{
				messages: Array<{ content: unknown }>;
			}>;
		};
		createCoderAgent: () => {
			invoke: (input: { messages: unknown[] }) => Promise<{
				messages: Array<{ content: unknown }>;
			}>;
		};
		createReviewerAgent: () => {
			invoke: (input: { messages: unknown[] }) => Promise<{
				messages: Array<{ content: unknown }>;
				structuredResponse?: ReviewVerdict;
			}>;
		};
	}>;
}

/**
 * Build LoopDeps backed by the real GPT/MiniMax agents from agents.ts.
 * Kept lazy (dynamic import) so dry-run mode never touches API keys.
 */
export async function buildRealLoopDeps(
	options: RealLoopOptions = {},
): Promise<LoopDeps> {
	const mod = await import("./agents.js");
	const planner = mod.createPlannerAgent();
	const coder = mod.createCoderAgent();
	const reviewer = mod.createReviewerAgent();

	return {
		maxIterations: options.maxIterations ?? 3,
		onStep: options.onStep,
		plan: async (request) =>
			lastMessage(
				await planner.invoke({
					messages: [{ role: "user", content: request }],
				}),
			),
		write: async (plan, review) => {
			const userMsg = review
				? `## Plan\n${plan}\n\n## Review comments to address\n${review.comments
						.map((c, i) => `${i + 1}. ${c.comment}`)
						.join("\n")}`
				: `## Plan\n${plan}`;
			return lastMessage(
				await coder.invoke({ messages: [{ role: "user", content: userMsg }] }),
			);
		},
		review: async (plan, code) => {
			const result = await reviewer.invoke({
				messages: [
					{
						role: "user",
						content: `## Plan\n${plan}\n\n## Code to review\n${code}`,
					},
				],
			});
			if (result.structuredResponse) return result.structuredResponse;
			// Fallback: try to parse the last message as JSON
			try {
				return ReviewVerdictSchema.parse(JSON.parse(lastMessage(result)));
			} catch {
				return {
					verdict: "blocked",
					summary: "Reviewer returned unparseable output",
					comments: [],
				};
			}
		},
	};
}

// ─── Dry-run dependencies (no API keys needed) ───────────────────────────────

/** Deterministic stubs: iteration 1 requests changes, iteration 2 approves. */
export function buildDryRunDeps(
	options: { maxIterations?: number; onStep?: LoopDeps["onStep"] } = {},
): LoopDeps {
	let writeCount = 0;
	return {
		maxIterations: options.maxIterations ?? 3,
		onStep: options.onStep,
		plan: async (request) =>
			`# Plan (dry-run)\n\nRequest: ${request}\n\n1. Stub step one\n2. Stub step two`,
		write: async (plan, review) => {
			writeCount += 1;
			const fixNote = review
				? `\n// addressing: ${review.comments.map((c) => c.comment).join("; ")}`
				: "";
			return `\`\`\`ts\n// stub code, iteration ${writeCount}\nexport const plan = ${JSON.stringify(plan.slice(0, 60))};${fixNote}\n\`\`\``;
		},
		review: async (_plan, _code) => {
			if (writeCount < 2) {
				return {
					verdict: "changes_requested",
					summary: "Dry-run: requesting one round of changes",
					comments: [
						{
							file: "index.ts",
							comment: "dry-run: rename the exported constant",
							severity: "minor",
						},
					],
				};
			}
			return {
				verdict: "approved",
				summary: "Dry-run: looks good",
				comments: [],
			};
		},
	};
}
