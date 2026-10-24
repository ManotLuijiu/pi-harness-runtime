/**
 * Review signals.
 *
 * A "review now" signal is any attempt to start a comprehensive review while
 * the implementation is still running. The workflow records the signal and
 * defers the review instead of letting it interrupt the implementation.
 */
import type { ReviewSignal } from "./types.js";
/**
 * Tool names that start a comprehensive review of the change.
 *
 * Task-level checks (a type error of the file that is edited right now, a
 * failing test of that file) are deliberately absent: they belong to the
 * implementation and stay actionable.
 */
export declare const DEFAULT_REVIEW_TOOL_PATTERNS: string[];
/**
 * Command patterns that start a dedicated review runner from a shell.
 *
 * The list is narrow on purpose: a shell command is only a review signal when
 * it runs a review runner, never when it merely mentions one.
 */
export declare const DEFAULT_REVIEW_COMMAND_PATTERNS: string[];
/** Read the extra patterns a deployment configured. */
export declare function parseExtraPatterns(env?: NodeJS.ProcessEnv): string[];
/**
 * Does the tool name name a comprehensive review?
 *
 * The name is matched exactly: a tool that only contains the name of a
 * review ("read_audit_log") is ordinary work.
 */
export declare function isComprehensiveReviewTool(toolName: string, extraPatterns?: string[]): boolean;
/** Does the shell command run a dedicated review runner? */
export declare function isReviewCommand(command: string): boolean;
/** The agent name of a generic dispatch tool, when it has one. */
export declare function dispatchAgentName(toolName: string, input: unknown): string;
/** A review request that the harness recognized. */
export interface ReviewInvocation {
    /** The source of the request (tool name, agent name or command). */
    source: string;
    /** The files the request points at (best effort). */
    files: string[];
    /** One short line describing the request. */
    reason: string;
}
/** Pull file names out of a tool input (best effort). */
export declare function extractFiles(toolName: string, input: unknown): string[];
/**
 * Recognize a request to start a comprehensive review.
 *
 * Returns `null` when the call is an ordinary task-level check.
 */
export declare function detectReviewInvocation(toolName: string, input: unknown, extraPatterns?: string[]): ReviewInvocation | null;
/**
 * Did the human ask for a review explicitly?
 *
 * The phase order never overrides the intent of the user: an explicit request
 * runs the review now. A sentence that talks about a review without asking
 * for one is not a request.
 */
export declare function explicitReviewRequest(message: string): boolean;
/** The identity of a signal: the same signal is never recorded twice. */
export declare function signalKey(signal: ReviewSignal): string;
/** Add a signal, ignoring an identical one. */
export declare function mergeSignals(signals: ReviewSignal[], signal: ReviewSignal, limit?: number): ReviewSignal[];
/** The merged view of every recorded signal. */
export interface SignalSummary {
    sources: string[];
    files: string[];
    reason: string;
}
/** Merge the recorded signals into one scope. */
export declare function summarizeSignals(signals: ReviewSignal[]): SignalSummary;
//# sourceMappingURL=signals.d.ts.map