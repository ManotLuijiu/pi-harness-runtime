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
/** The kind of a batch. */
export type BatchKind = "pilot" | "scale-up";
/** The state of a batch. */
export type BatchStatus = "pending" | "running" | "done" | "failed";
/**
 * One batch of a large job.
 */
export interface Batch {
    /** The id of the batch. */
    id: string;
    /** The kind of the batch. */
    kind: BatchKind;
    /** The first record of the batch (inclusive). */
    from: number;
    /** The last record of the batch (inclusive). */
    to: number;
    /** The number of records of the batch. */
    records: number;
    /** The state of the batch. */
    status: BatchStatus;
    /** How often the batch was tried. */
    attempts: number;
    /** The measured duration of the batch. */
    durationMs?: number;
    /** The reason of a failure. */
    failure?: string;
}
/**
 * The plan of a large job.
 *
 * The limits are explicit: the size of the pilot, the size of a batch,
 * the number of batches that may run at the same time and the budget.
 */
export interface BatchPlan {
    /** The number of records of the whole job. */
    totalRecords: number;
    /** The number of records of the representative pilot. */
    pilotRecords: number;
    /** The maximum number of records of a scale-up batch. */
    maxBatchRecords: number;
    /** The maximum number of batches that may run at the same time. */
    maxConcurrentBatches: number;
    /**
     * The measured cost of one record, in milliseconds.
     *
     * Without a measured cost the estimated duration of the job is
     * unknown, and the plan says so.
     */
    msPerRecord?: number;
    /** The budget of the whole job, in minutes. */
    budgetMinutes?: number;
    /** How often a failed batch is tried again. */
    maxAttempts?: number;
}
/**
 * The progress of the batches.
 */
export interface BatchProgress {
    /** The batches that are done. */
    done: number;
    /** The batches that failed. */
    failed: number;
    /** The batches that still have to run. */
    pending: number;
    /** The records that are done. */
    recordsDone: number;
    /** The records of the whole job. */
    recordsTotal: number;
    /** The measured duration of the finished batches. */
    durationMs: number;
}
/**
 * The batches of a job.
 *
 * The first batch is the pilot. The rest are the scale-up, in the order
 * of the records.
 */
export declare function buildBatches(plan: BatchPlan): Batch[];
/**
 * The estimated duration of the whole job.
 *
 * The estimate needs a measured cost per record. Without one the answer
 * is unknown: the plan never guesses a duration.
 */
export declare function estimateJobMs(plan: BatchPlan): number | undefined;
/**
 * May the scale-up start?
 *
 * The pilot has to be done and it has to have passed. A failed pilot
 * stops the job: the plan never scales up on a failure.
 */
export declare function mayStartScaleUp(batches: Batch[]): boolean;
/**
 * The batches that may run now.
 *
 * The scale-up waits for the pilot, the limit of parallel batches is
 * respected, and a batch that already used up its attempts is never
 * offered again.
 */
export declare function nextBatches(batches: Batch[], plan: BatchPlan): Batch[];
/**
 * The result of one batch attempt.
 */
export interface BatchResult {
    /** The id of the batch. */
    id: string;
    /** Did the batch succeed? */
    ok: boolean;
    /** The measured duration of the attempt. */
    durationMs?: number;
    /** The reason of a failure. */
    failure?: string;
}
/**
 * Record the result of a batch attempt.
 *
 * A failed batch keeps its place: the batches that are done are never
 * repeated, and a failed batch is tried again until it used up its
 * attempts.
 */
export declare function recordBatchResult(batches: Batch[], result: BatchResult): Batch[];
/**
 * The progress of the batches.
 */
export declare function batchProgress(batches: Batch[]): BatchProgress;
/**
 * Is the job over the budget?
 *
 * The budget is a limit, not a wish: a job that spent it stops and
 * reports. A budget that was never measured cannot be spent.
 */
export declare function overBudget(plan: BatchPlan, elapsedMs: number | undefined): boolean;
/**
 * The description of the batches, for the status line.
 *
 * The line is plain ASCII and names the measured facts.
 */
export declare function describeBatches(batches: Batch[]): string;
//# sourceMappingURL=batch-plan.d.ts.map