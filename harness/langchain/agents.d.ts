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
import { z } from "zod";
import { type ModelOptions } from "./models.js";
export declare const ReviewVerdictSchema: z.ZodObject<{
    verdict: z.ZodEnum<{
        approved: "approved";
        blocked: "blocked";
        changes_requested: "changes_requested";
    }>;
    summary: z.ZodString;
    comments: z.ZodArray<z.ZodObject<{
        file: z.ZodOptional<z.ZodString>;
        comment: z.ZodString;
        severity: z.ZodOptional<z.ZodEnum<{
            critical: "critical";
            major: "major";
            minor: "minor";
        }>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;
export declare function isAutonomyRequest(request: string): boolean;
/** Directive injected into every system prompt when autonomy signal is detected. */
export declare function autonomyDirective(): string;
export declare function createPlannerAgent(opts?: ModelOptions): import("langchain").ReactAgent<import("langchain").AgentTypeConfig<import("langchain").ResponseFormatUndefined, undefined, import("langchain").AnyAnnotationRoot, readonly import("langchain").AnyAgentMiddleware[], readonly [], readonly []>>;
export declare function createCoderAgent(opts?: ModelOptions): import("langchain").ReactAgent<import("langchain").AgentTypeConfig<import("langchain").ResponseFormatUndefined, undefined, import("langchain").AnyAnnotationRoot, readonly import("langchain").AnyAgentMiddleware[], readonly (import("langchain").DynamicStructuredTool<z.ZodObject<{
    path: z.ZodString;
    encoding: z.ZodOptional<z.ZodEnum<{
        ascii: "ascii";
        base64: "base64";
        "utf-16": "utf-16";
        "utf-8": "utf-8";
    }>>;
}, z.core.$strip>, {
    path: string;
    encoding?: "ascii" | "base64" | "utf-16" | "utf-8" | undefined;
}, {
    path: string;
    encoding?: "ascii" | "base64" | "utf-16" | "utf-8" | undefined;
}, string, unknown, "read_file"> | import("langchain").DynamicStructuredTool<z.ZodObject<{
    path: z.ZodString;
    content: z.ZodString;
    append: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>, {
    path: string;
    content: string;
    append?: boolean | undefined;
}, {
    path: string;
    content: string;
    append?: boolean | undefined;
}, string, unknown, "write_file"> | import("langchain").DynamicStructuredTool<z.ZodObject<{
    path: z.ZodString;
}, z.core.$strip>, {
    path: string;
}, {
    path: string;
}, string, unknown, "list_directory">)[], readonly []>>;
export declare function createReviewerAgent(opts?: ModelOptions): import("langchain").ReactAgent<import("langchain").AgentTypeConfig<{
    verdict: "approved" | "blocked" | "changes_requested";
    summary: string;
    comments: {
        file?: string | undefined;
        comment: string;
        severity?: "critical" | "major" | "minor" | undefined;
    }[];
}, undefined, import("langchain").AnyAnnotationRoot, readonly import("langchain").AnyAgentMiddleware[], readonly [], readonly []>>;
export type PlannerAgent = ReturnType<typeof createPlannerAgent>;
export type CoderAgent = ReturnType<typeof createCoderAgent>;
export type ReviewerAgent = ReturnType<typeof createReviewerAgent>;
export type SupervisorAgent = ReturnType<typeof createSupervisor>;
/** Extract the last assistant message text from an agent result. */
export declare function lastMessage(agentResult: {
    messages: Array<{
        content: unknown;
    }>;
}): string;
export declare function buildDelegationTools(opts?: {
    coder?: CoderAgent;
    reviewer?: ReviewerAgent;
}): {
    delegateToCoder: import("langchain").DynamicStructuredTool<z.ZodObject<{
        instruction: z.ZodString;
        reviewComments: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, {
        instruction: string;
        reviewComments?: string | undefined;
    }, {
        instruction: string;
        reviewComments?: string | undefined;
    }, string, unknown, "delegate_to_coder">;
    delegateToReviewer: import("langchain").DynamicStructuredTool<z.ZodObject<{
        plan: z.ZodString;
        code: z.ZodString;
    }, z.core.$strip>, {
        plan: string;
        code: string;
    }, {
        plan: string;
        code: string;
    }, string, unknown, "delegate_to_reviewer">;
};
export declare function createSupervisor(opts?: {
    plannerModel?: ModelOptions;
    coder?: CoderAgent;
    reviewer?: ReviewerAgent;
}): import("langchain").ReactAgent<import("langchain").AgentTypeConfig<import("langchain").ResponseFormatUndefined, undefined, import("langchain").AnyAnnotationRoot, readonly import("langchain").AnyAgentMiddleware[], readonly [import("langchain").DynamicStructuredTool<z.ZodObject<{
    instruction: z.ZodString;
    reviewComments: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, {
    instruction: string;
    reviewComments?: string | undefined;
}, {
    instruction: string;
    reviewComments?: string | undefined;
}, string, unknown, "delegate_to_coder">, import("langchain").DynamicStructuredTool<z.ZodObject<{
    plan: z.ZodString;
    code: z.ZodString;
}, z.core.$strip>, {
    plan: string;
    code: string;
}, {
    plan: string;
    code: string;
}, string, unknown, "delegate_to_reviewer">], readonly []>>;
//# sourceMappingURL=agents.d.ts.map