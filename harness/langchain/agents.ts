/**
 * Multi-Agent definitions — GPT (planner/reviewer/supervisor) + MiniMax (coder).
 *
 * This is a TypeScript port of the "supervisor + agents-as-tools" pattern from
 * Mohamad-Hachem/MultiAgent_Wedding_Planner_With_Langchain (agents.py):
 *
 *   Python (agents.py)              →  TypeScript (this file)
 *   ------------------------------------------------------------------
 *   subagent1 = create_agent(...)   →  coderAgent = createAgent({ model: minimax ... })
 *   @tool delegate_to_subagent1     →  delegateToCoder = tool(... { name: "delegate_to_coder" })
 *   main_agent(tools=[delegates])   →  supervisor = createAgent({ tools: [delegateToCoder, ...] })
 *
 * Verdict values intentionally match the existing harness LoopVerdict type
 * ("approved" | "changes_requested" | "blocked") so this module can feed the
 * existing blackboard / HerdrEventBus infrastructure.
 *
 * Wiki: wiki/multi-agent-langchain.md
 */

import { createAgent, tool } from "langchain";
import { z } from "zod";
import {
	createCoderModel,
	createPlannerModel,
	createReviewerModel,
	type ModelOptions,
} from "./models.js";

// ─── Structured review output ───────────────────────────────────────────────

export const ReviewVerdictSchema = z.object({
	verdict: z
		.enum(["approved", "changes_requested", "blocked"])
		.describe("Overall review verdict"),
	summary: z.string().describe("One-paragraph summary of the review"),
	comments: z
		.array(
			z.object({
				file: z.string().optional().describe("Affected file, if known"),
				comment: z.string().describe("Actionable change request"),
				severity: z.enum(["critical", "major", "minor"]).optional(),
			}),
		)
		.describe("Comments to send back to the coder (empty when approved)"),
});

export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

// ─── Prompts ────────────────────────────────────────────────────────────────

const PLANNER_PROMPT = `You are the Planning Agent (GPT). Given a feature request, produce a
concise implementation plan: goals, non-goals, ordered steps, files to touch,
risks, and a definition-of-done the reviewer can check against.
Output markdown only.`;

const CODER_PROMPT = `You are the Coding Agent (MiniMax). You receive a plan (and possibly
review comments from a previous iteration) and produce complete, runnable code.
Always output fenced code blocks with file-path headers. Address every review
comment explicitly.`;

const REVIEWER_PROMPT = `You are the Code Review Agent (GPT). You review the coder's output
against the plan and the review checklist. Be strict but fair: request changes
only for real problems. Respond via the structured schema.`;

const SUPERVISOR_PROMPT = `You are the Supervisor (GPT). Coordinate the workflow:
1. Call delegate_to_coder with the instruction (include review comments when fixing).
2. Call delegate_to_reviewer with the plan + code to review.
3. If the reviewer requests changes, call delegate_to_coder again with the comments.
4. Repeat until approved or you judge further iterations unproductive (then stop and summarize).
Keep the loop tight: no more than 4 coder-review rounds unless the task clearly needs more.`;

// ─── Agents ─────────────────────────────────────────────────────────────────

export function createPlannerAgent(opts: ModelOptions = {}) {
	return createAgent({
		model: createPlannerModel(opts),
		tools: [],
		systemPrompt: PLANNER_PROMPT,
	});
}

export function createCoderAgent(opts: ModelOptions = {}) {
	return createAgent({
		model: createCoderModel(opts),
		tools: [], // roadmap: file read/write tools for real repo edits
		systemPrompt: CODER_PROMPT,
	});
}

export function createReviewerAgent(opts: ModelOptions = {}) {
	return createAgent({
		model: createReviewerModel(opts),
		tools: [],
		systemPrompt: REVIEWER_PROMPT,
		responseFormat: ReviewVerdictSchema,
	});
}

export type PlannerAgent = ReturnType<typeof createPlannerAgent>;
export type CoderAgent = ReturnType<typeof createCoderAgent>;
export type ReviewerAgent = ReturnType<typeof createReviewerAgent>;
export type SupervisorAgent = ReturnType<typeof createSupervisor>;

/** Extract the last assistant message text from an agent result. */
export function lastMessage(agentResult: {
	messages: Array<{ content: unknown }>;
}): string {
	const last = agentResult.messages[agentResult.messages.length - 1];
	if (typeof last?.content === "string") return last.content;
	if (Array.isArray(last?.content)) {
		return last.content.map((c: { text?: string }) => c?.text ?? "").join("\n");
	}
	return "";
}

// ─── Delegation tools (agents-as-tools, port of agents.py) ──────────────────

export function buildDelegationTools(
	opts: { coder?: CoderAgent; reviewer?: ReviewerAgent } = {},
) {
	const coder = opts.coder ?? createCoderAgent();
	const reviewer = opts.reviewer ?? createReviewerAgent();

	const delegateToCoder = tool(
		async ({ instruction, reviewComments }) => {
			const userMsg = reviewComments
				? `${instruction}\n\nPrevious review requested changes:\n${reviewComments}`
				: instruction;
			const result = await coder.invoke({
				messages: [{ role: "user", content: userMsg }],
			});
			return lastMessage(result);
		},
		{
			name: "delegate_to_coder",
			description:
				"Delegate a coding instruction to the MiniMax coder agent. " +
				"Pass previous review comments when fixing issues.",
			schema: z.object({
				instruction: z.string().describe("What the coder should implement or fix"),
				reviewComments: z
					.string()
					.optional()
					.describe("Review comments from the previous iteration"),
			}),
		},
	);

	const delegateToReviewer = tool(
		async ({ plan, code }) => {
			const result = await reviewer.invoke({
				messages: [
					{
						role: "user",
						content: `## Plan\n${plan}\n\n## Code to review\n${code}`,
					},
				],
			});
			const structured = (result as { structuredResponse?: ReviewVerdict })
				.structuredResponse;
			return structured
				? JSON.stringify(structured, null, 2)
				: lastMessage(result);
		},
		{
			name: "delegate_to_reviewer",
			description:
				"Delegate a code review to the GPT reviewer agent. Returns a JSON verdict: " +
				'{verdict: "approved"|"changes_requested"|"blocked", summary, comments[]}.',
			schema: z.object({
				plan: z.string().describe("The implementation plan"),
				code: z.string().describe("The code the coder produced"),
			}),
		},
	);

	return { delegateToCoder, delegateToReviewer };
}

// ─── Supervisor (dynamic routing variant) ───────────────────────────────────

export function createSupervisor(
	opts: {
		plannerModel?: ModelOptions;
		coder?: CoderAgent;
		reviewer?: ReviewerAgent;
	} = {},
) {
	const { delegateToCoder, delegateToReviewer } = buildDelegationTools({
		coder: opts.coder,
		reviewer: opts.reviewer,
	});
	return createAgent({
		model: createPlannerModel(opts.plannerModel ?? {}),
		tools: [delegateToCoder, delegateToReviewer],
		systemPrompt: SUPERVISOR_PROMPT,
	});
}
