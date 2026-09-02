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
import { Annotation, END, MemorySaver, START, StateGraph, } from "@langchain/langgraph";
import { lastMessage, ReviewVerdictSchema, } from "./agents.js";
import { WriteReviewBlackboard } from "../../packages/write-review/src/blackboard.js";
import { getApprovedPatternStore } from "../../packages/trajectory/src/index.js";
// ─── State ──────────────────────────────────────────────────────────────────
const LoopState = Annotation.Root({
    /** Original user request */
    request: Annotation,
    /** Plan produced by the GPT planner */
    plan: Annotation,
    /** Current iteration (0 = first pass) */
    iteration: Annotation({
        reducer: (_prev, next) => next,
        default: () => 0,
    }),
    /** Latest code output from the MiniMax coder */
    code: Annotation,
    /** Latest structured review from the GPT reviewer */
    review: Annotation,
    /** Human-readable step log (reducer appends) */
    log: Annotation({
        reducer: (prev, next) => [...(prev ?? []), ...(next ?? [])],
        default: () => [],
    }),
    /** File that received comments in the previous review. Used for smart-stop. */
    lastCommentedFile: Annotation({
        reducer: (_prev, next) => next,
        default: () => undefined,
    }),
});
// ─── Node implementations ───────────────────────────────────────────────────
function planNode(deps) {
    return async (state) => {
        const plan = await deps.plan(state.request);
        deps.onStep?.("plan", state);
        return {
            plan,
            iteration: 0,
            log: [`[plan] GPT produced plan (${plan.length} chars)`],
        };
    };
}
function writeNode(deps) {
    return async (state) => {
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
function reviewNode(deps) {
    return async (state) => {
        const review = await deps.review(state.plan, state.code);
        deps.onStep?.("review", state);
        const commentedFile = review.comments.length > 0 ? (review.comments[0].file ?? "") : undefined;
        return {
            review,
            lastCommentedFile: commentedFile,
            log: [`[review:${state.iteration}] GPT verdict: ${review.verdict}`],
        };
    };
}
function finishNode() {
    return async (state) => {
        const verdict = state.review?.verdict ?? "blocked";
        const comments = state.review?.comments ?? [];
        let reason;
        if (verdict === "approved") {
            reason = "reviewer approved";
        }
        else if (verdict === "blocked") {
            reason = "reviewer blocked the task";
        }
        else if (state.iteration >= 3) {
            reason = `max iterations (${state.iteration}) reached with changes still requested`;
        }
        else if (comments.length > 0 &&
            comments.every((c) => c.severity === "minor" || !c.severity)) {
            reason = `converged: only minor comments (${state.iteration})`;
        }
        else {
            const file = state.lastCommentedFile ?? "unknown";
            reason = `stuck: same file (${file}) flagged for ${comments.length} comment(s) across iterations`;
        }
        return {
            log: [`[finish] ${state.iteration} iteration(s) — ${reason}`],
        };
    };
}
// ─── Routing ────────────────────────────────────────────────────────────────
/** Smart stop: loop terminates early when quality criteria are met. */
function routeAfterReview(state, maxIterations) {
    const verdict = state.review?.verdict;
    const comments = state.review?.comments ?? [];
    // 1. Always finish on approved or blocked
    if (verdict === "approved" || verdict === "blocked")
        return "finish";
    // 2. Hard cap
    if (state.iteration >= maxIterations)
        return "finish";
    // 3. SMART STOP: only minor comments (≤2) — converge fast
    const hasOnlyMinor = comments.every((c) => c.severity === "minor" || !c.severity);
    if (hasOnlyMinor && comments.length <= 2)
        return "finish";
    return "write";
}
// ─── Graph builder ──────────────────────────────────────────────────────────
export function buildWriteReviewLoop(deps, opts = {}) {
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
        .addConditionalEdges("reviewStep", (state) => routeAfterReview(state, deps.maxIterations), 
    // Router returns logical names; map them to the physical node names
    { write: "writeStep", finish: "finishStep" })
        .addEdge("finishStep", END);
    // Resolve checkpointer: false=disabled, object=use it, true/undefined=default MemorySaver
    const cp = opts.checkpointer;
    const checkpointerToUse = cp === false
        ? undefined
        : cp != null && cp !== true
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                cp
            : new MemorySaver();
    return builder.compile({ checkpointer: checkpointerToUse });
}
/**
 * Build LoopDeps backed by the real GPT/MiniMax agents from agents.ts.
 * Kept lazy (dynamic import) so dry-run mode never touches API keys.
 *
 * The WriteReviewBlackboard is updated at each step and its markdown is
 * injected into every agent prompt — so each agent sees the shared scoreboard
 * naturally, without explicit prompt injection.
 */
export async function buildRealLoopDeps(options = {}) {
    const mod = await import("./agents.js");
    const planner = mod.createPlannerAgent();
    const coder = mod.createCoderAgent();
    const reviewer = mod.createReviewerAgent();
    // Create and init the shared blackboard
    const blackboard = new WriteReviewBlackboard(options.blackboardDir ?? process.cwd());
    if (blackboard.exists()) {
        blackboard.load();
    }
    else {
        blackboard.init();
    }
    // Autonomy mode: computed inside plan(), stored for write()/review()
    const _directive = "";
    /** Inject scoreboard markdown into a user message. */
    const withScoreboard = (msg) => {
        const scoreboard = blackboard.toMarkdown();
        return msg + "\n\n## Current Progress\n" + scoreboard;
    };
    /** Inject scoreboard + approved patterns into a user message (for the reviewer). */
    const withReviewContext = (msg) => {
        const scoreboard = blackboard.toMarkdown();
        const patterns = getApprovedPatternStore().toMarkdown();
        const parts = [msg];
        if (scoreboard)
            parts.push("\n\n## Current Progress\n" + scoreboard);
        if (patterns)
            parts.push("\n\n" + patterns);
        return parts.join("");
    };
    // Wrap onStep to also update the blackboard
    const originalOnStep = options.onStep;
    const onStep = (step, state) => {
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
                const verdict = state.review?.verdict;
                if (verdict) {
                    blackboard.setVerdict(verdict, state.review?.summary);
                }
                if (state.review?.comments && state.review.comments.length > 0) {
                    blackboard.setChangesRequested(state.review.comments.map((c) => `[${c.severity ?? "minor"}] ${c.file ? `${c.file}: ` : ""}${c.comment}`));
                }
                blackboard.save();
                break;
            }
        }
    };
    return {
        maxIterations: options.maxIterations ?? 3,
        onStep,
        plan: async (request) => lastMessage(await planner.invoke({
            messages: [
                { role: "user", content: _directive + withScoreboard(request) },
            ],
        })),
        write: async (plan, review) => {
            const userMsg = review
                ? `## Plan\n${plan}\n\n## Review comments to address\n${review.comments
                    .map((c, i) => `${i + 1}. ${c.comment}`)
                    .join("\n")}`
                : `## Plan\n${plan}`;
            return lastMessage(await coder.invoke({
                messages: [
                    { role: "user", content: _directive + withScoreboard(userMsg) },
                ],
            }));
        },
        review: async (plan, code) => {
            const result = await reviewer.invoke({
                messages: [
                    {
                        role: "user",
                        content: _directive +
                            withReviewContext(`## Plan\n${plan}\n\n## Code to review\n${code}`),
                    },
                ],
            });
            if (result.structuredResponse)
                return result.structuredResponse;
            // Fallback: try to parse the last message as JSON
            try {
                return ReviewVerdictSchema.parse(JSON.parse(lastMessage(result)));
            }
            catch {
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
export function buildDryRunDeps(options = {}) {
    let writeCount = 0;
    // Create and init the shared blackboard (even in dry-run, so widget can read it)
    const blackboard = new WriteReviewBlackboard(options.blackboardDir ?? process.cwd());
    if (blackboard.exists()) {
        blackboard.load();
    }
    else {
        blackboard.init();
    }
    const withScoreboard = (msg) => {
        const scoreboard = blackboard.toMarkdown();
        return msg + "\n\n## Current Progress\n" + scoreboard;
    };
    // Wrap onStep to also update the blackboard
    const originalOnStep = options.onStep;
    const onStep = (step, state) => {
        originalOnStep?.(step, state);
        switch (step) {
            case "plan": {
                blackboard.init();
                blackboard.startWriting();
                break;
            }
            case "write": {
                const files = blackboard.extractFilePaths(state.code ?? "");
                if (files.length > 0)
                    blackboard.setCodeFiles(files);
                blackboard.save();
                break;
            }
            case "review": {
                const verdict = state.review?.verdict;
                if (verdict)
                    blackboard.setVerdict(verdict, state.review?.summary);
                if (state.review?.comments && state.review.comments.length > 0) {
                    blackboard.setChangesRequested(state.review.comments.map((c) => `[${c.severity ?? "minor"}] ${c.file ? `${c.file}: ` : ""}${c.comment}`));
                }
                blackboard.save();
                break;
            }
        }
    };
    return {
        maxIterations: options.maxIterations ?? 3,
        onStep,
        plan: async (request) => withScoreboard(`# Plan (dry-run)\n\nRequest: ${request}\n\n1. Stub step one\n2. Stub step two`),
        write: async (plan, review) => {
            writeCount += 1;
            const fixNote = review
                ? `\n// addressing: ${review.comments.map((c) => c.comment).join("; ")}`
                : "";
            return withScoreboard(`\`\`\`ts\n// stub code, iteration ${writeCount}\nexport const plan = ${JSON.stringify(plan.slice(0, 60))};${fixNote}\n\`\`\``);
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
//# sourceMappingURL=graph.js.map