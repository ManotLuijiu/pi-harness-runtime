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
	isAutonomyRequest,
	autonomyDirective,
	lastMessage,
	type ReviewVerdict,
	ReviewVerdictSchema,
} from "./agents.js";
import { readFileSync } from "node:fs";
import { WriteReviewBlackboard } from "../../packages/write-review/src/blackboard.js";
import { getApprovedPatternStore } from "../../packages/trajectory/src/index.js";
import type { Verdict } from "../../packages/write-review/src/types.js";
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
	/** Code from the previous iteration. Used for stuck detection (P0-2). */
	prevCode: Annotation<string | undefined>({
		reducer: (_prev, next) => next,
		default: () => undefined,
	}),
	/** Actual file contents written in the most recent write step.
	 *  P1-1: used to pass real file contents to the reviewer instead of a summary. */
	writtenFiles: Annotation<Record<string, string>>({
		reducer: (_prev, next) => next,
		default: () => ({}),
	}),
});

export type LoopState = typeof LoopState.State;

// ─── Dependencies (inject real agents or dry-run stubs) ─────────────────────

export interface LoopDeps {
	plan: (request: string) => Promise<string>;
	write: (plan: string, review: ReviewVerdict | null) => Promise<string>;
	review: (plan: string, code: string, writtenFiles?: Record<string, string>) => Promise<ReviewVerdict>;
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

/** Extract file paths from a code string (mirrors blackboard.extractFilePaths). */
function extractFilePaths(code: string): string[] {
	const files = new Set<string>();
	const lines = code.split("\n");
	for (const line of lines) {
		const match = line.match(/^```(?:typescript|ts|javascript|js|tsx|jsx|text)?\s*\/([^\s`]+)\s*$/);
		if (match) {
			const path = match[1].trim();
			if (path && !path.includes(" ")) files.add(path);
		}
		const mdMatch = line.match(/^\*\*([^:*]+):\*\*/);
		if (mdMatch) {
			const path = mdMatch[1].trim();
			if (path && !path.includes(" ") && (path.includes("/") || path.endsWith(".ts") || path.endsWith(".js"))) {
				files.add(path);
			}
		}
	}
	return [...files];
}

function writeNode(deps: LoopDeps) {
	return async (state: LoopState): Promise<Partial<LoopState>> => {
		const code = await deps.write(state.plan, state.review ?? null);
		const iter = state.iteration + 1;
		deps.onStep?.("write", { ...state, iteration: iter });
		// P1-1: read actual file contents so the reviewer sees real code, not a summary
		const paths = extractFilePaths(code);
		const writtenFiles: Record<string, string> = {};
		for (const p of paths) {
			try {
				writtenFiles[p] = readFileSync(p, "utf8");
			} catch {
				// File may not exist yet (mkdir was pending); skip
			}
		}
		const reviewNote = state.review
			? ` (addressing ${state.review.comments.length} review comment(s))`
			: "";
		return {
			code,
			writtenFiles,
			iteration: iter,
			// Snapshot the code from the previous iteration (before it was
			// overwritten).  routeAfterReview uses this to detect stuck: if the
			// coder outputs identical content in two consecutive iterations, the
			// loop terminates early instead of wasting another review cycle.
			prevCode: state.code,
			log: [`[write:${iter}] MiniMax wrote code${reviewNote}`],
		};
	};
}

function reviewNode(deps: LoopDeps) {
	return async (state: LoopState): Promise<Partial<LoopState>> => {
		const review = await deps.review(state.plan, state.code, state.writtenFiles ?? {});
		deps.onStep?.("review", state);
		return {
			review,
			log: [`[review:${state.iteration}] GPT verdict: ${review.verdict}`],
		};
	};
}

function finishNode(maxIterations: number) {
	return async (state: LoopState): Promise<Partial<LoopState>> => {
		const verdict = state.review?.verdict ?? "blocked";
		const comments = state.review?.comments ?? [];
		let reason: string;
		if (verdict === "approved") {
			reason = "reviewer approved";
		} else if (verdict === "blocked") {
			reason = "reviewer blocked the task";
		} else if (state.iteration >= maxIterations) {
			reason = `max iterations (${state.iteration}) reached with changes still requested`;
		} else if (
			comments.length > 0 &&
			comments.every((c) => c.severity === "minor" || !c.severity)
		) {
			reason = `converged: only minor comments (${state.iteration})`;
		} else {
			reason = `stuck: changes still requested after ${state.iteration} iteration(s)`;
		}
		return {
			log: [`[finish] ${state.iteration} iteration(s) — ${reason}`],
		};
	};
}

// ─── Routing ────────────────────────────────────────────────────────────────

/** Smart stop: loop terminates early when quality criteria are met. */
function routeAfterReview(
	state: LoopState,
	maxIterations: number,
): "write" | "finish" {
	const verdict = state.review?.verdict;
	const comments = state.review?.comments ?? [];
	// 1. Always finish on approved or blocked
	if (verdict === "approved" || verdict === "blocked") return "finish";
	// 2. Hard cap
	if (state.iteration >= maxIterations) return "finish";
	// 3. SMART STOP: only minor comments (≤2) — converge fast
	const hasOnlyMinor = comments.every(
		(c) => c.severity === "minor" || !c.severity,
	);
	if (hasOnlyMinor && comments.length <= 2) return "finish";
	// 4. P0-2 STUCK DETECTION: if the coder produced identical output in consecutive
	//    iterations, no progress is being made — terminate early instead of wasting
	//    another review cycle
	if (state.prevCode !== undefined && state.code === state.prevCode) {
		return "finish";
	}
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
		.addNode("finishStep", finishNode(deps.maxIterations))
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
	/** Directory for .write-review/blackboard. Defaults to process.cwd(). */
	blackboardDir?: string;
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
 *
 * The WriteReviewBlackboard is updated at each step and its markdown is
 * injected into every agent prompt — so each agent sees the shared scoreboard
 * naturally, without explicit prompt injection.
 */
export async function buildRealLoopDeps(
	options: RealLoopOptions = {},
): Promise<LoopDeps> {
	const mod = await import("./agents.js");
	const planner = mod.createPlannerAgent();
	const coder = mod.createCoderAgent();
	const reviewer = mod.createReviewerAgent();

	// Create and init the shared blackboard
	const blackboard = new WriteReviewBlackboard(
		options.blackboardDir ?? process.cwd(),
	);
	if (blackboard.exists()) {
		blackboard.load();
	} else {
		blackboard.init();
	}

	// Autonomy mode: set in plan() based on request content, reused by write()/review()
	let _directive = "";

	/** Inject scoreboard markdown into a user message. */
	const withScoreboard = (msg: string) => {
		const scoreboard = blackboard.toMarkdown();
		return msg + "\n\n## Current Progress\n" + scoreboard;
	};

	/** Inject scoreboard + approved patterns into a user message (for the reviewer). */
	const withReviewContext = (msg: string) => {
		const scoreboard = blackboard.toMarkdown();
		const patterns = getApprovedPatternStore().toMarkdown();
		const parts = [msg];
		if (scoreboard) parts.push("\n\n## Current Progress\n" + scoreboard);
		if (patterns) parts.push("\n\n" + patterns);
		return parts.join("");
	};

	// Wrap onStep to also update the blackboard
	const originalOnStep = options.onStep;
	const onStep = (step: string, state: LoopState) => {
		originalOnStep?.(step, state);

		switch (step) {
			case "plan": {
				blackboard.init();
				blackboard.startWriting(); // phase = "writing", iteration++
				break;
			}
			case "write": {
				// Extract file paths from the code output
				const files = blackboard.extractFilePaths(state.code ?? "");
				if (files.length > 0) {
					blackboard.setCodeFiles(files);
				}
				blackboard.save();
				break;
			}
			case "review": {
				const verdict = state.review?.verdict as Verdict | undefined;
				if (verdict) {
					blackboard.setVerdict(verdict, state.review?.summary);
				}
				if (state.review?.comments && state.review.comments.length > 0) {
					blackboard.setChangesRequested(
						state.review.comments.map(
							(c) =>
								`[${c.severity ?? "minor"}] ${c.file ? `${c.file}: ` : ""}${c.comment}`,
						),
					);
				}
				blackboard.save();
				break;
			}
		}
	};

	return {
		maxIterations: options.maxIterations ?? 3,
		onStep,
		plan: async (request) => {
			// P1-2: detect autonomy signal in the request and unlock full autonomous mode
			_directive = isAutonomyRequest(request) ? autonomyDirective() : "";
			return lastMessage(
				await planner.invoke({
					messages: [
						{ role: "user", content: _directive + withScoreboard(request) },
					],
				}),
			);
		},
		write: async (plan, review) => {
			const userMsg = review
				? `## Plan\n${plan}\n\n## Review comments to address\n${review.comments
						.map((c, i) => `${i + 1}. ${c.comment}`)
						.join("\n")}`
				: `## Plan\n${plan}`;
			return lastMessage(
				await coder.invoke({
					messages: [
						{ role: "user", content: _directive + withScoreboard(userMsg) },
					],
				}),
			);
		},
		review: async (plan, _code, writtenFiles = {}) => {
			// P1-1: build a code-to-review section from actual file contents
			const codeSection =
				Object.keys(writtenFiles).length > 0
					? Object.entries(writtenFiles)
							.map(([path, content]) => `## ${path}\n\n\`\`\`\n${content}\n\`\`\``)
							.join("\n\n")
					: `## Code\n\n\`\`\`\n${_code}\n\`\`\``;
			const result = await reviewer.invoke({
				messages: [
					{
						role: "user",
						content:
							_directive +
								withReviewContext(`## Plan\n${plan}\n\n${codeSection}`),
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
	options: {
		maxIterations?: number;
		onStep?: LoopDeps["onStep"];
		/** Directory for .write-review/blackboard. Defaults to process.cwd(). */
		blackboardDir?: string;
	} = {},
): LoopDeps {
	let writeCount = 0;

	// Create and init the shared blackboard (even in dry-run, so widget can read it)
	const blackboard = new WriteReviewBlackboard(
		options.blackboardDir ?? process.cwd(),
	);
	if (blackboard.exists()) {
		blackboard.load();
	} else {
		blackboard.init();
	}

	const withScoreboard = (msg: string) => {
		const scoreboard = blackboard.toMarkdown();
		return msg + "\n\n## Current Progress\n" + scoreboard;
	};

	// Wrap onStep to also update the blackboard
	const originalOnStep = options.onStep;
	const onStep = (step: string, state: LoopState) => {
		originalOnStep?.(step, state);

		switch (step) {
			case "plan": {
				blackboard.init();
				blackboard.startWriting();
				break;
			}
			case "write": {
				const files = blackboard.extractFilePaths(state.code ?? "");
				if (files.length > 0) blackboard.setCodeFiles(files);
				blackboard.save();
				break;
			}
			case "review": {
				const verdict = state.review?.verdict as Verdict | undefined;
				if (verdict) blackboard.setVerdict(verdict, state.review?.summary);
				if (state.review?.comments && state.review.comments.length > 0) {
					blackboard.setChangesRequested(
						state.review.comments.map(
							(c) =>
								`[${c.severity ?? "minor"}] ${c.file ? `${c.file}: ` : ""}${c.comment}`,
						),
					);
				}
				blackboard.save();
				break;
			}
		}
	};

	return {
		maxIterations: options.maxIterations ?? 3,
		onStep,
		plan: async (request) =>
			withScoreboard(
				`# Plan (dry-run)\n\nRequest: ${request}\n\n1. Stub step one\n2. Stub step two`,
			),
		write: async (plan, review) => {
			writeCount += 1;
			const fixNote = review
				? `\n// addressing: ${review.comments.map((c) => c.comment).join("; ")}`
				: "";
			return withScoreboard(
				`\`\`\`ts\n// stub code, iteration ${writeCount}\nexport const plan = ${JSON.stringify(plan.slice(0, 60))};${fixNote}\n\`\`\``,
			);
		},
		review: async (_plan, _code, _writtenFiles = {}) => {
			if (writeCount < 2) {
				return {
					verdict: "changes_requested",
					summary: "Dry-run: requesting one round of changes",
					comments: [
						{
							file: "index.ts",
							comment: "dry-run: rename the exported constant",
							severity: "major",
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
