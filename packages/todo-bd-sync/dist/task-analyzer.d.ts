/**
 * Smart Auto-Todo Task Analyzer
 *
 * Decides when to automatically create bd issues based on:
 * 1. Task complexity signals
 * 2. Session state (pending task count)
 *
 * Philosophy:
 * - Simple tasks (grep, quick edit) -> NO todo (avoid noise)
 * - Complex tasks OR multiple pending tasks -> AUTO-CREATE todo
 */
interface TaskSignals {
    /** Estimated number of steps required */
    stepCount: number;
    /** Number of files likely involved */
    fileCount: number;
    /** Requires research (web search, docs lookup) */
    needsResearch: boolean;
    /** Creates new files */
    createsFiles: boolean;
    /** User explicitly says task is complex */
    explicitlyComplex: boolean;
    /** Likely to have subtasks discovered during work */
    likelySubtasks: boolean;
}
/**
 * Analyze user request text for complexity signals
 */
export declare function analyzeTaskSignals(userMessage: string): TaskSignals;
export interface AutoTodoDecision {
    shouldCreate: boolean;
    reason: string;
    confidence: "high" | "medium" | "low";
    skipReason?: string;
}
/**
 * Decide whether to auto-create a todo for the given task
 */
export declare function decideAutoTodo(userMessage: string, options?: {
    forceMode?: boolean;
    skipMode?: boolean;
}): AutoTodoDecision;
/**
 * Quick numeric score (0-100) for task complexity
 * Higher = more likely to need a todo
 */
export declare function getTaskComplexityScore(userMessage: string): number;
export {};
//# sourceMappingURL=task-analyzer.d.ts.map