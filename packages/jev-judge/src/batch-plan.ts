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
export function buildBatches(plan: BatchPlan): Batch[] {
	const batches: Batch[] = [];
	if (plan.totalRecords <= 0) return batches;
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
export function estimateJobMs(plan: BatchPlan): number | undefined {
	if (plan.msPerRecord === undefined) return undefined;
	if (plan.totalRecords <= 0) return 0;
	return Math.round(plan.msPerRecord * plan.totalRecords);
}

/**
 * May the scale-up start?
 *
 * The pilot has to be done and it has to have passed. A failed pilot
 * stops the job: the plan never scales up on a failure.
 */
export function mayStartScaleUp(batches: Batch[]): boolean {
	const pilot = batches.find((batch) => batch.kind === "pilot");
	if (!pilot) return true;
	return pilot.status === "done";
}

/**
 * The batches that may run now.
 *
 * The scale-up waits for the pilot, the limit of parallel batches is
 * respected, and a batch that already used up its attempts is never
 * offered again.
 */
export function nextBatches(batches: Batch[], plan: BatchPlan): Batch[] {
	const running = batches.filter((batch) => batch.status === "running").length;
	let free = Math.max(0, plan.maxConcurrentBatches - running);
	if (free === 0) return [];
	const candidates = batches.filter((batch) => {
		if (batch.status === "done") return false;
		if (batch.status === "running") return false;
		if (batch.kind === "scale-up" && !mayStartScaleUp(batches)) return false;
		if (batch.attempts >= (plan.maxAttempts ?? 1)) return false;
		return true;
	});
	// The pilot comes first: it is the batch that proves the job.
	candidates.sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === "pilot" ? -1 : 1;
		return a.from - b.from;
	});
	return candidates.slice(0, free).map((batch) => ({ ...batch, status: "running" as const }));
}

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
export function recordBatchResult(batches: Batch[], result: BatchResult): Batch[] {
	return batches.map((batch) => {
		if (batch.id !== result.id) return batch;
		const next: Batch = {
			...batch,
			status: result.ok ? "done" : "failed",
			attempts: batch.attempts + 1,
		};
		if (result.durationMs !== undefined) next.durationMs = result.durationMs;
		if (result.failure !== undefined) next.failure = result.failure;
		return next;
	});
}

/**
 * The progress of the batches.
 */
export function batchProgress(batches: Batch[]): BatchProgress {
	let done = 0;
	let failed = 0;
	let pending = 0;
	let recordsDone = 0;
	let durationMs = 0;
	for (const batch of batches) {
		if (batch.status === "done") {
			done += 1;
			recordsDone += batch.records;
		} else if (batch.status === "failed") {
			failed += 1;
		} else {
			pending += 1;
		}
		if (batch.durationMs !== undefined) durationMs += batch.durationMs;
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
export function overBudget(
	plan: BatchPlan,
	elapsedMs: number | undefined,
): boolean {
	if (plan.budgetMinutes === undefined) return false;
	if (elapsedMs === undefined) return false;
	return elapsedMs > plan.budgetMinutes * 60_000;
}

/**
 * The description of the batches, for the status line.
 *
 * The line is plain ASCII and names the measured facts.
 */
export function describeBatches(batches: Batch[]): string {
	const progress = batchProgress(batches);
	const parts = [
		`batch ${progress.done + progress.failed}/${batches.length}`,
		`${progress.recordsDone}/${progress.recordsTotal} records`,
	];
	if (progress.failed > 0) parts.push(`${progress.failed} failed`);
	return parts.join(" | ");
}
