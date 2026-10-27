/**
 * The batches of a large job.
 *
 * A large job does not run in one piece. It starts with a measured pilot
 * and continues in bounded batches, and the state of every batch is kept
 * so a failure resumes instead of restarting.
 *
 * Every number here is either given or measured. The harness never
 * estimates a duration from a number it invented: an estimate needs a
 * measured cost per record, and without one the estimate is unknown.
 */
/**
 * The batches of a job.
 *
 * The first batch is the pilot. The rest are the scale-up, in the order
 * of the records.
 */
export function buildBatches(plan) {
    const batches = [];
    if (plan.totalRecords <= 0)
        return batches;
    const pilotRecords = Math.max(0, Math.min(plan.pilotRecords, plan.totalRecords));
    if (pilotRecords > 0) {
        batches.push({
            id: "batch-1",
            kind: "pilot",
            from: 1,
            to: pilotRecords,
            records: pilotRecords,
            status: "pending",
            attempts: 0,
        });
    }
    const maxBatch = Math.max(1, plan.maxBatchRecords);
    let from = pilotRecords + 1;
    let index = 2;
    while (from <= plan.totalRecords) {
        const to = Math.min(from + maxBatch - 1, plan.totalRecords);
        batches.push({
            id: `batch-${index}`,
            kind: "scale-up",
            from,
            to,
            records: to - from + 1,
            status: "pending",
            attempts: 0,
        });
        from = to + 1;
        index += 1;
    }
    return batches;
}
/**
 * The estimated duration of the whole job.
 *
 * The estimate needs a measured cost per record. Without one the answer
 * is unknown: the plan never guesses a duration.
 */
export function estimateJobMs(plan) {
    if (plan.msPerRecord === undefined)
        return undefined;
    if (plan.totalRecords <= 0)
        return 0;
    return Math.round(plan.msPerRecord * plan.totalRecords);
}
/**
 * May the scale-up start?
 *
 * The pilot has to be done and it has to have passed. A failed pilot
 * stops the job: the plan never scales up on a failure.
 */
export function mayStartScaleUp(batches) {
    const pilot = batches.find((batch) => batch.kind === "pilot");
    if (!pilot)
        return true;
    return pilot.status === "done";
}
/**
 * The batches that may run now.
 *
 * The scale-up waits for the pilot, the limit of parallel batches is
 * respected, and a batch that already used up its attempts is never
 * offered again.
 */
export function nextBatches(batches, plan) {
    const running = batches.filter((batch) => batch.status === "running").length;
    let free = Math.max(0, plan.maxConcurrentBatches - running);
    if (free === 0)
        return [];
    const candidates = batches.filter((batch) => {
        if (batch.status === "done")
            return false;
        if (batch.status === "running")
            return false;
        if (batch.kind === "scale-up" && !mayStartScaleUp(batches))
            return false;
        if (batch.attempts >= (plan.maxAttempts ?? 1))
            return false;
        return true;
    });
    // The pilot comes first: it is the batch that proves the job.
    candidates.sort((a, b) => {
        if (a.kind !== b.kind)
            return a.kind === "pilot" ? -1 : 1;
        return a.from - b.from;
    });
    return candidates.slice(0, free).map((batch) => ({ ...batch, status: "running" }));
}
/**
 * Record the result of a batch attempt.
 *
 * A failed batch keeps its place: the batches that are done are never
 * repeated, and a failed batch is tried again until it used up its
 * attempts.
 */
export function recordBatchResult(batches, result) {
    return batches.map((batch) => {
        if (batch.id !== result.id)
            return batch;
        const next = {
            ...batch,
            status: result.ok ? "done" : "failed",
            attempts: batch.attempts + 1,
        };
        if (result.durationMs !== undefined)
            next.durationMs = result.durationMs;
        if (result.failure !== undefined)
            next.failure = result.failure;
        return next;
    });
}
/**
 * The progress of the batches.
 */
export function batchProgress(batches) {
    let done = 0;
    let failed = 0;
    let pending = 0;
    let recordsDone = 0;
    let durationMs = 0;
    for (const batch of batches) {
        if (batch.status === "done") {
            done += 1;
            recordsDone += batch.records;
        }
        else if (batch.status === "failed") {
            failed += 1;
        }
        else {
            pending += 1;
        }
        if (batch.durationMs !== undefined)
            durationMs += batch.durationMs;
    }
    return {
        done,
        failed,
        pending,
        recordsDone,
        recordsTotal: batches.reduce((sum, batch) => sum + batch.records, 0),
        durationMs,
    };
}
/**
 * Is the job over the budget?
 *
 * The budget is a limit, not a wish: a job that spent it stops and
 * reports. A budget that was never measured cannot be spent.
 */
export function overBudget(plan, elapsedMs) {
    if (plan.budgetMinutes === undefined)
        return false;
    if (elapsedMs === undefined)
        return false;
    return elapsedMs > plan.budgetMinutes * 60_000;
}
/**
 * The description of the batches, for the status line.
 *
 * The line is plain ASCII and names the measured facts.
 */
export function describeBatches(batches) {
    const progress = batchProgress(batches);
    const parts = [
        `batch ${progress.done + progress.failed}/${batches.length}`,
        `${progress.recordsDone}/${progress.recordsTotal} records`,
    ];
    if (progress.failed > 0)
        parts.push(`${progress.failed} failed`);
    return parts.join(" | ");
}
//# sourceMappingURL=batch-plan.js.map