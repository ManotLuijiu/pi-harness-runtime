/**
 * The checkpoint of the exploration and the contract around a compaction.
 *
 * A compaction summarises the context. It does not erase everything the
 * agent knew, but it does make the agent start reading again, and the
 * readings that follow are often the readings that already happened.
 *
 * The guard therefore keeps the checkpoint of the request beside the
 * summary. The checkpoint is saved before the compaction, restored after it,
 * and the continuation after the compaction asks the agent to reuse the
 * recorded findings instead of rediscovering them.
 *
 * The guard never authorises anything. A commit, a push, a build and a new
 * task stay outside its decision, and it never answers a user question and
 * never touches a provider countdown.
 */
import type { ExplorationFinding, ExplorationState, NarrowedHypothesis } from "./types.js";
/**
 * The compact checkpoint of a request.
 *
 * It is what survives a compaction: the counters, the findings, the
 * questions and the next action. The files that were read are references,
 * not content.
 */
export interface CompactCheckpoint {
    /** The workspace of the request. */
    workspace: string;
    /** The session of the request. */
    sessionId: string;
    /** The generation of the request. */
    generation: string;
    /** The phase of the request. */
    phase: ExplorationState["phase"];
    /** The todo of the request, when there is one. */
    todoId?: number;
    /** How many reads were observed. */
    readCount: number;
    /** How many reads repeated a range. */
    repeatCount: number;
    /** The estimated cost of the exploration. */
    estimatedTokens: number;
    /** True when the estimate is an estimate. */
    estimatedTokensApproximate: boolean;
    /** The time spent exploring, in milliseconds. */
    explorationTimeMs: number;
    /** The findings of the agent. */
    findings: ExplorationFinding[];
    /** The hypotheses the agent narrowed. */
    hypotheses: NarrowedHypothesis[];
    /** The questions that are still open. */
    openQuestions: string[];
    /** The next concrete action. */
    nextAction?: string;
    /** The revision of the checkpoint. */
    revision: number;
    /**
     * The files the findings refer to, with the hash that was observed.
     *
     * The references let the agent check whether a file still holds what it
     * saw before it relies on a stale finding.
     */
    references: {
        path: string;
        contentHash?: string;
        version?: string;
    }[];
    /** When the checkpoint was written. */
    savedAt: number;
}
/**
 * The compact checkpoint of a state.
 */
export declare function toCompactCheckpoint(state: ExplorationState, savedAt?: number): CompactCheckpoint;
/**
 * Restore a state from a compact checkpoint.
 *
 * The counters of the request come back with it: a compaction must not
 * reset the budget of the request it belongs to.
 */
export declare function fromCompactCheckpoint(checkpoint: CompactCheckpoint, base: ExplorationState): ExplorationState;
/**
 * The semantic checkpoint of the agent, as it arrives.
 *
 * The agent supplies it. The guard never writes a finding and never claims
 * that a finding is true.
 */
export interface CheckpointInput {
    findings?: {
        statement: string;
        locations?: string[];
    }[];
    hypotheses?: {
        statement: string;
        rejected?: boolean;
    }[];
    openQuestions?: string[];
    nextAction?: string;
}
/**
 * Merge the checkpoint of the agent into the state.
 *
 * The revision of the agent decides: a checkpoint that is older than the
 * one the state holds is ignored, so an out-of-order message cannot undo a
 * newer finding.
 */
export declare function applyCheckpoint(state: ExplorationState, input: CheckpointInput, now?: number): ExplorationState;
/**
 * The summary of the checkpoint, for the agent.
 *
 * The summary names the findings and the questions. It does not claim that
 * every relevant file was read: a checkpoint is a statement of what the
 * agent found, not a proof of coverage.
 */
export declare function summarizeCheckpoint(state: ExplorationState): string;
/**
 * The continuation after a compaction.
 *
 * The text asks the agent to reuse the findings and to read further only
 * for a named question. It authorises nothing beyond the work of the
 * request.
 */
export declare function buildContinuationText(state: ExplorationState): string;
/**
 * The files whose findings have to be checked before they are used.
 *
 * A hash that changed means the finding may be stale. A file without a hash
 * cannot be checked, so it is listed as unknown rather than as confirmed.
 */
export declare function filesNeedingRevalidation(state: ExplorationState, currentHashes: Record<string, string>): {
    path: string;
    reason: "changed" | "unknown";
}[];
/**
 * The text that names the uncertainty of a checkpoint that cannot be read.
 *
 * A checkpoint that cannot be read is unknown. It is never a fresh budget
 * and never the knowledge of the whole repository.
 */
export declare function describeUnreadableCheckpoint(reason: string): string;
//# sourceMappingURL=checkpoint.d.ts.map