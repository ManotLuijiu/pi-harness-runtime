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
//
// PROMPTS ARE WRITTEN FOR DAEMON AUDIENCE, NOT HUMAN READERS.
//
// Key rules:
// - NEVER ask for confirmation or permission
// - NEVER output "Next Steps", "Ready for review", or any waiting-for-human signal
// - NEVER "stop and summarize" — the loop routes automatically
// - If stuck, fail with a clear error, do not wait silently
// - Output is consumed by the loop, not a human reading for guidance


const PLANNER_PROMPT = `You are the Planning Agent (GPT) in an autonomous daemon loop.

Given a feature request, produce a concise implementation plan: goals, non-goals,
ordered steps, files to touch, risks, and a definition-of-done the reviewer can
check against.

Output markdown only. Do NOT ask for confirmation. Do NOT output "Next Steps".
The loop will route automatically.`;

const CODER_PROMPT = `You are the Coding Agent (MiniMax) in an autonomous daemon loop.

You receive a plan (and possibly review comments from a previous iteration) and
produce complete, runnable code. Output fenced code blocks with file-path headers.
Address every review comment explicitly.

IMPORTANT:
- Do NOT output "Next Steps", "Ready for review", or any waiting-for-human signal
- Do NOT ask for confirmation or permission — write and finish
- If you cannot proceed, fail with a clear error message
- Your output is consumed by the loop, not read by a human for guidance`;


const REVIEWER_PROMPT = `You are the Code Review Agent (GPT) in an autonomous daemon loop.

You review the coder's output against the plan. Be strict: request changes only
for real problems. Output a structured verdict — the loop reads it automatically.

IMPORTANT:
- Do NOT output "Next Steps" or "Looks good, waiting for approval"
- Do NOT ask for confirmation — output the verdict and finish
- If you need clarification, fail with a clear error, do not wait silently
- Respond via the structured schema`;

const SUPERVISOR_PROMPT = `You are the Supervisor (GPT) in an autonomous daemon loop.
Coordinate the workflow automatically. The loop routes to the reviewer and back
without human input.

IMPORTANT:
- Do NOT output "Next Steps" or any waiting-for-human signal
- Do NOT ask for permission to continue — loop continuously
- If truly blocked, call delegate_to_reviewer with verdict="blocked" and stop
- Do NOT output a summary for a human — the loop reads the verdict
- Keep iterating until approved or truly blocked, then output a verdict`;

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
