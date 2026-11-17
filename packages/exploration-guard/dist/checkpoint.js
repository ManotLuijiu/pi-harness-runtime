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
import { EXPLORATION_CONTINUATION_TEXT } from "./budget.js";
import { ensureCoverage, sanitizePath, sanitizeText } from "./state.js";
/**
 * The compact checkpoint of a state.
 */
export function toCompactCheckpoint(state, savedAt = Date.now()) {
    return {
        workspace: state.workspace,
        sessionId: state.sessionId,
        generation: state.generation,
        phase: state.phase,
        todoId: state.todoId,
        readCount: state.readCount,
        repeatCount: state.repeatCount,
        estimatedTokens: state.estimatedTokens,
        estimatedTokensApproximate: state.estimatedTokensApproximate,
        explorationTimeMs: state.explorationTimeMs,
        findings: state.checkpoint.findings,
        hypotheses: state.checkpoint.hypotheses,
        openQuestions: state.checkpoint.openQuestions,
        nextAction: state.checkpoint.nextAction,
        revision: state.checkpointRevision,
        references: state.files.map((file) => ({
            path: file.path,
            contentHash: file.contentHash,
            version: file.version,
        })),
        savedAt,
    };
}
/**
 * Restore a state from a compact checkpoint.
 *
 * The counters of the request come back with it: a compaction must not
 * reset the budget of the request it belongs to.
 */
export function fromCompactCheckpoint(checkpoint, base) {
    return {
        ...base,
        workspace: checkpoint.workspace,
        sessionId: checkpoint.sessionId,
        generation: checkpoint.generation,
        phase: checkpoint.phase,
        todoId: checkpoint.todoId ?? base.todoId,
        readCount: checkpoint.readCount,
        repeatCount: checkpoint.repeatCount,
        estimatedTokens: checkpoint.estimatedTokens,
        estimatedTokensApproximate: checkpoint.estimatedTokensApproximate,
        explorationTimeMs: checkpoint.explorationTimeMs,
        checkpoint: {
            findings: checkpoint.findings,
            hypotheses: checkpoint.hypotheses,
            openQuestions: checkpoint.openQuestions,
            nextAction: checkpoint.nextAction,
            revision: checkpoint.revision,
        },
        checkpointRevision: checkpoint.revision,
        // The checkpoint of the previous compaction was consumed by the
        // restore, so it is not restored a second time.
        previousCheckpointConsumed: true,
        updatedAt: base.updatedAt,
    };
}
/**
 * Merge the checkpoint of the agent into the state.
 *
 * The revision of the agent decides: a checkpoint that is older than the
 * one the state holds is ignored, so an out-of-order message cannot undo a
 * newer finding.
 */
export function applyCheckpoint(state, input, now = Date.now()) {
    const revision = state.checkpointRevision + 1;
    const findings = (input.findings ?? []).map((finding) => ({
        statement: sanitizeText(finding.statement),
        locations: finding.locations?.map((location) => sanitizeText(location)),
        at: now,
    }));
    const hypotheses = (input.hypotheses ?? []).map((hypothesis) => ({
        statement: sanitizeText(hypothesis.statement),
        rejected: hypothesis.rejected === true,
        at: now,
    }));
    const openQuestions = (input.openQuestions ?? []).map((question) => sanitizeText(question));
    const checkpoint = {
        findings,
        hypotheses,
        openQuestions,
        nextAction: input.nextAction ? sanitizeText(input.nextAction) : undefined,
        revision,
    };
    return {
        ...state,
        files: applyReferences(state.files, input.references ?? []),
        checkpoint,
        checkpointRevision: revision,
        updatedAt: now,
    };
}
/**
 * Apply the references of a checkpoint to the coverage of the files.
 *
 * The hash of a file that changed makes the coverage that was recorded for
 * it void: the ranges are dropped, so a re-read of the file is a new read
 * and not a repetition of a reading that no longer holds.
 */
function applyReferences(files, references) {
    if (references.length === 0)
        return files;
    const next = [...files];
    for (const reference of references) {
        const path = sanitizePath(reference.path);
        if (!path)
            continue;
        const coverage = ensureCoverage(next, path);
        const previous = coverage.contentHash;
        const changed = previous !== undefined &&
            reference.contentHash !== undefined &&
            previous !== reference.contentHash;
        coverage.contentHash = reference.contentHash ?? previous;
        coverage.version = reference.version ?? coverage.version;
        if (changed) {
            // The file holds something else now: the ranges that were
            // covered describe a content that is gone.
            coverage.ranges = [];
            coverage.readCount = 0;
        }
    }
    return next;
}
/**
 * The summary of the checkpoint, for the agent.
 *
 * The summary names the findings and the questions. It does not claim that
 * every relevant file was read: a checkpoint is a statement of what the
 * agent found, not a proof of coverage.
 */
export function summarizeCheckpoint(state) {
    const parts = [];
    const findings = state.checkpoint.findings;
    if (findings.length > 0) {
        parts.push("Recorded findings:");
        for (const finding of findings) {
            const where = finding.locations?.length
                ? ` (${finding.locations.join(", ")})`
                : "";
            parts.push(`- ${finding.statement}${where}`);
        }
    }
    const rejected = state.checkpoint.hypotheses.filter((hypothesis) => hypothesis.rejected);
    if (rejected.length > 0) {
        parts.push("Ruled out:");
        for (const hypothesis of rejected) {
            parts.push(`- ${hypothesis.statement}`);
        }
    }
    const questions = state.checkpoint.openQuestions;
    if (questions.length > 0) {
        parts.push("Open questions:");
        for (const question of questions) {
            parts.push(`- ${question}`);
        }
    }
    if (state.checkpoint.nextAction) {
        parts.push(`Next action: ${state.checkpoint.nextAction}`);
    }
    if (parts.length === 0)
        return "";
    return parts.join("\n");
}
/**
 * The continuation after a compaction.
 *
 * The text asks the agent to reuse the findings and to read further only
 * for a named question. It authorises nothing beyond the work of the
 * request.
 */
export function buildContinuationText(state) {
    const summary = summarizeCheckpoint(state);
    const header = `The exploration checkpoint of this request survived the compaction: ` +
        `${state.readCount} reads, ${state.repeatCount} repeats.`;
    if (!summary) {
        return `${header}\n${EXPLORATION_CONTINUATION_TEXT}`;
    }
    return `${header}\n${summary}\n${EXPLORATION_CONTINUATION_TEXT}`;
}
/**
 * The files whose findings have to be checked before they are used.
 *
 * A hash that changed means the finding may be stale. A file without a hash
 * cannot be checked, so it is listed as unknown rather than as confirmed.
 */
export function filesNeedingRevalidation(state, currentHashes) {
    const needs = [];
    for (const file of state.files) {
        const current = currentHashes[file.path];
        if (current === undefined) {
            needs.push({ path: file.path, reason: "unknown" });
            continue;
        }
        if (file.contentHash !== undefined && file.contentHash !== current) {
            needs.push({ path: file.path, reason: "changed" });
        }
    }
    return needs;
}
/**
 * The text that names the uncertainty of a checkpoint that cannot be read.
 *
 * A checkpoint that cannot be read is unknown. It is never a fresh budget
 * and never the knowledge of the whole repository.
 */
export function describeUnreadableCheckpoint(reason) {
    return (`The exploration checkpoint of this request could not be read: ${sanitizeText(reason)}. ` +
        "The coverage of the files that were read is unknown, so rebuild a bounded subset of it " +
        "instead of assuming that everything was already understood.");
}
//# sourceMappingURL=checkpoint.js.map