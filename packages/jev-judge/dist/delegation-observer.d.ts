/**
 * The children that were really dispatched.
 *
 * The harness does not dispatch anything: the agent sends the measured
 * groups to the sub-agent tool. The harness watches the tool events, so
 * that a delegation is only reported when a child really ran.
 *
 * Everything in here is observed. The model of a child is the model the
 * extension reported, never one that was guessed.
 */
/**
 * One child that the agent dispatched.
 */
export interface DelegationChild {
    /** The id of the tool call that dispatched the child. */
    toolCallId: string;
    /** The tool that dispatched the child. */
    toolName: string;
    /** The group of the plan that the child works on, when the task names one. */
    groupId?: string;
    /** The task the child received, bounded to a readable length. */
    task?: string;
    /** The model the extension reported for the child, when it reported one. */
    model?: string;
    /** When the child started. */
    startedAt: number;
    /** When the child ended. */
    endedAt?: number;
    /** The state of the child. */
    status: "running" | "completed" | "failed";
    /** A bounded summary of what the child returned. */
    output?: string;
}
/**
 * The model that a result names, when it names one.
 *
 * The result of a dispatch is a report of what the extension did. The
 * model is only recorded when the report carries it: a guess would be a
 * fact that nobody observed.
 */
export declare function modelFromResult(result: unknown): string | undefined;
/**
 * A bounded summary of the output of a child.
 */
export declare function summarizeOutput(result: unknown): string | undefined;
/**
 * The group of the plan that a task works on.
 *
 * The task is matched against the ids of the measured groups. A task that
 * names no group belongs to no group: the work is not guessed.
 */
export declare function groupOfTask(task: string | undefined, groupIds: string[]): string | undefined;
/**
 * The children of a delegation, as they were observed.
 */
export declare class DelegationObserver {
    private readonly children;
    private plan;
    /**
     * A plan was handed to the agent.
     *
     * @param toolName The tool that can dispatch a child.
     * @param groupIds The ids of the measured groups.
     */
    setPlan(toolName: string, groupIds: string[]): void;
    /**
     * A tool call started.
     *
     * @returns The child that was opened, or null when the call is not a
     *   dispatch of the current plan.
     */
    noteStart(event: {
        toolCallId: string;
        toolName: string;
        args?: unknown;
    }): DelegationChild | null;
    /**
     * A tool call ended.
     *
     * @returns The child that was closed, or null when no child of the
     *   current plan was running under that id.
     */
    noteEnd(event: {
        toolCallId: string;
        toolName: string;
        result?: unknown;
        isError?: boolean;
    }): DelegationChild | null;
    /**
     * The children that were observed.
     */
    observed(): DelegationChild[];
    /**
     * The number of children that really ran.
     */
    get dispatchedCount(): number;
}
//# sourceMappingURL=delegation-observer.d.ts.map