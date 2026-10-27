/**
 * The batches of a large job.
 *
 * The scenario is the one of the plan: 10,000 records, a representative
 * pilot of 100 records, and a scale-up that only starts when the pilot
 * passed. Every number in the test is measured: the fixture is built,
 * the pilot really runs over its records, and the duration is the time
 * the run took.
 */

import { describe, it, expect } from "bun:test";
import {
	Batch,
	BatchPlan,
	batchProgress,
	buildBatches,
	describeBatches,
	estimateJobMs,
	mayStartScaleUp,
	nextBatches,
	overBudget,
	recordBatchResult,
} from "../src/batch-plan.js";
import {
	buildPilotPlan,
	describePilot,
	evaluatePilot,
} from "../src/pilot.js";
import { summarizeValidationState } from "../src/validation-plan.js";
import { assessWorkload, workloadBatchPlan } from "../src/workload.js";

/** The number of records of the scenario. */
const TOTAL_RECORDS = 10_000;
/** The number of records of the representative pilot. */
const PILOT_RECORDS = 100;
/** The number of records of a scale-up batch. */
const BATCH_RECORDS = 500;
/** The number of batches that may run at the same time. */
const CONCURRENCY = 2;

/** A record of the fixture. */
interface Record {
	id: number;
	key: string;
	amount: number;
	optional?: string;
}

/**
 * The fixture of the scenario.
 *
 * The shape of the data is what the pilot has to keep: a unique key, an
 * optional field, a boundary amount and a relation to the batch it is in.
 */
function buildFixture(records: number): Record[] {
	const list: Record[] = [];
	for (let index = 1; index <= records; index += 1) {
		list.push({
			id: index,
			key: `key-${index}`,
			amount: index === 1 ? 0 : index,
			...(index % 10 === 0 ? { optional: `note-${index}` } : {}),
		});
	}
	return list;
}

/** The plan of the scenario. */
function scenarioPlan(): BatchPlan {
	return {
		totalRecords: TOTAL_RECORDS,
		pilotRecords: PILOT_RECORDS,
		maxBatchRecords: BATCH_RECORDS,
		maxConcurrentBatches: CONCURRENCY,
		budgetMinutes: 90,
		maxAttempts: 2,
	};
}

/**
 * Run one batch of the fixture.
 *
 * The duration is measured, and the check fails when the batch does not
 * keep the shape of the data.
 */
function runBatch(fixture: Record[], batch: Batch): { ok: boolean; durationMs: number; failure?: string } {
	const started = Date.now();
	const slice = fixture.slice(batch.from - 1, batch.to);
	const keys = new Set(slice.map((record) => record.key));
	const unique = keys.size === slice.length;
	const boundaries = slice.length > 0 && slice[0].amount === 0;
	if (!unique || !boundaries) {
		return { ok: false, durationMs: Date.now() - started, failure: "the shape of the data changed" };
	}
	return { ok: true, durationMs: Date.now() - started };
}

describe("the batches of a large job", () => {
	it("starts with a representative pilot", () => {
		const batches = buildBatches(scenarioPlan());
		expect(batches[0].kind).toBe("pilot");
		expect(batches[0].records).toBe(PILOT_RECORDS);
		expect(batches[0].from).toBe(1);
		expect(batches[0].to).toBe(PILOT_RECORDS);
	});

	it("covers every record of the job exactly once", () => {
		const batches = buildBatches(scenarioPlan());
		const covered = batches.reduce((sum, batch) => sum + batch.records, 0);
		expect(covered).toBe(TOTAL_RECORDS);
		expect(batches[0].from).toBe(1);
		expect(batches[batches.length - 1].to).toBe(TOTAL_RECORDS);
		for (let index = 1; index < batches.length; index += 1) {
			expect(batches[index].from).toBe(batches[index - 1].to + 1);
		}
	});

	it("never offers a scale-up batch before the pilot passed", () => {
		const plan = scenarioPlan();
		let batches = buildBatches(plan);
		const offered = nextBatches(batches, plan);
		expect(offered).toHaveLength(1);
		expect(offered[0].kind).toBe("pilot");

		// A failed pilot stops the scale-up. The pilot itself may be tried
		// again, but only the pilot.
		batches = recordBatchResult(batches, { id: offered[0].id, ok: false, failure: "boom" });
		expect(mayStartScaleUp(batches)).toBe(false);
		const retry = nextBatches(batches, plan);
		expect(retry.every((batch) => batch.kind === "pilot")).toBe(true);
	});

	it("starts the scale-up after the pilot passed", () => {
		const plan = scenarioPlan();
		let batches = buildBatches(plan);
		const pilot = nextBatches(batches, plan)[0];
		batches = recordBatchResult(batches, { id: pilot.id, ok: true, durationMs: 12 });
		expect(mayStartScaleUp(batches)).toBe(true);

		const offered = nextBatches(batches, plan);
		expect(offered).toHaveLength(CONCURRENCY);
		expect(offered.every((batch) => batch.kind === "scale-up")).toBe(true);
	});

	it("keeps the limit of parallel batches", () => {
		const plan = scenarioPlan();
		let batches = buildBatches(plan);
		const pilot = nextBatches(batches, plan)[0];
		batches = recordBatchResult(batches, { id: pilot.id, ok: true });
		const running = nextBatches(batches, plan);
		batches = running.reduce((list, batch) => recordBatchResult(list, { id: batch.id, ok: true }), batches);
		// The batches that are done do not count as running.
		expect(nextBatches(batches, plan).length).toBeLessThanOrEqual(CONCURRENCY);
	});

	it("retries a failed batch and never repeats the ones that are done", () => {
		const plan = scenarioPlan();
		let batches = buildBatches(plan);
		const pilot = nextBatches(batches, plan)[0];
		batches = recordBatchResult(batches, { id: pilot.id, ok: true });
		const first = nextBatches(batches, plan)[0];
		batches = recordBatchResult(batches, { id: first.id, ok: false, failure: "boom" });
		const progress = batchProgress(batches);
		// The failed batch is still part of the work.
		expect(progress.failed).toBe(1);
		expect(progress.done).toBe(1);

		// The retry is offered again.
		const retry = nextBatches(batches, plan);
		expect(retry.map((batch) => batch.id)).toContain(first.id);
		// The batch that is done is never offered again.
		expect(retry.map((batch) => batch.id)).not.toContain(pilot.id);
	});

	it("stops offering a batch that used up its attempts", () => {
		const plan = scenarioPlan();
		let batches = buildBatches(plan);
		const pilot = nextBatches(batches, plan)[0];
		batches = recordBatchResult(batches, { id: pilot.id, ok: false });
		batches = recordBatchResult(batches, { id: pilot.id, ok: false });
		expect(nextBatches(batches, plan)).toHaveLength(0);
	});

	it("knows when the job is over the budget", () => {
		const plan = scenarioPlan();
		expect(overBudget(plan, 10_000)).toBe(false);
		expect(overBudget(plan, 91 * 60_000)).toBe(true);
		// A job without a budget cannot be over it.
		expect(overBudget({ ...plan, budgetMinutes: undefined }, 10_000_000)).toBe(false);
		// A job whose elapsed time was never measured is not over budget.
		expect(overBudget(plan, undefined)).toBe(false);
	});

	it("estimates the duration only from a measured cost", () => {
		const plan = scenarioPlan();
		expect(estimateJobMs(plan)).toBeUndefined();
		expect(estimateJobMs({ ...plan, msPerRecord: 0.5 })).toBe(TOTAL_RECORDS * 0.5);
	});
});

describe("the scenario of 10,000 records", () => {
	it("runs the pilot, then the scale-up, and measures the pilot", () => {
		const fixture = buildFixture(TOTAL_RECORDS);
		const plan = scenarioPlan();
		let batches = buildBatches(plan);

		// The pilot really runs over its 100 records.
		const pilot = nextBatches(batches, plan)[0];
		const pilotResult = runBatch(fixture, pilot);
		expect(pilotResult.ok).toBe(true);
		batches = recordBatchResult(batches, { id: pilot.id, ok: pilotResult.ok, durationMs: pilotResult.durationMs });

		// The measured pilot is the fast tier of the plan.
		const measuredMsPerRecord = pilotResult.durationMs / pilot.records;
		const validationPlan = buildPilotPlan({
			owner: "the agent that runs the validation",
			pilotCommand: "bun test tests/pilot",
			scaleUpCommand: "bun test tests/full",
			pilotRecords: PILOT_RECORDS,
			fullRecords: TOTAL_RECORDS,
			pilotDurationMs: pilotResult.durationMs,
			fullDurationMs: estimateJobMs({ ...plan, msPerRecord: measuredMsPerRecord }),
			budgetMinutes: plan.budgetMinutes,
			passCriteria: ["every record of the batch is written once", "the counts of source and target match"],
			failureAction: "stop the job and report the failure of the pilot",
		});

		const verdict = evaluatePilot(validationPlan, {
			status: "passed",
			durationMs: pilotResult.durationMs,
			datasetSize: PILOT_RECORDS,
		});
		expect(verdict.passed).toBe(true);
		expect(verdict.mayScaleUp).toBe(true);
		expect(describePilot(validationPlan, { status: "passed", datasetSize: PILOT_RECORDS })).toContain(
			"pilot passed",
		);

		// The scale-up only counts when the pilot passed.
		const withoutPilot = summarizeValidationState(validationPlan, [
			{ ts: "2026-10-27T00:00:00.000Z", tier: "full", status: "passed" },
		]);
		expect(withoutPilot.full.status).toBe("not-run");
		expect(withoutPilot.finalTierPending).toBe(true);

		const withPilot = summarizeValidationState(validationPlan, [
			{ ts: "2026-10-27T00:00:00.000Z", tier: "fast", status: "passed" },
			{ ts: "2026-10-27T00:01:00.000Z", tier: "full", status: "passed" },
		]);
		expect(withPilot.full.status).toBe("passed");
		expect(withPilot.finalTierPending).toBe(false);
	});

	it("never counts a scale-up that ran on less data than the plan declares", () => {
		const plan = buildPilotPlan({
			owner: "the agent",
			pilotCommand: "bun test tests/pilot",
			scaleUpCommand: "bun test tests/full",
			pilotRecords: PILOT_RECORDS,
			fullRecords: TOTAL_RECORDS,
		});
		const verdict = evaluatePilot(plan, {
			status: "passed",
			durationMs: 10,
			datasetSize: 10,
		});
		expect(verdict.passed).toBe(false);
		expect(verdict.reasons.join(" ")).toContain(`${PILOT_RECORDS} expected`);
		expect(verdict.mayScaleUp).toBe(false);
	});

	it("never counts a pilot that did not pass", () => {
		const plan = buildPilotPlan({
			owner: "the agent",
			pilotCommand: "bun test tests/pilot",
			scaleUpCommand: "bun test tests/full",
			pilotRecords: PILOT_RECORDS,
			fullRecords: TOTAL_RECORDS,
		});
		const verdict = evaluatePilot(plan, { status: "failed", datasetSize: PILOT_RECORDS });
		expect(verdict.passed).toBe(false);
		expect(verdict.mayScaleUp).toBe(false);
	});

	it("describes the progress in plain ASCII", () => {
		const plan = scenarioPlan();
		let batches = buildBatches(plan);
		const pilot = nextBatches(batches, plan)[0];
		batches = recordBatchResult(batches, { id: pilot.id, ok: true, durationMs: 12 });
		const line = describeBatches(batches);
		expect(/^[\x20-\x7e]+$/.test(line)).toBe(true);
		expect(line).toContain(`${PILOT_RECORDS}/${TOTAL_RECORDS} records`);
	});

	it("derives the pilot and the batches from the facts of the request", () => {
		// The request declares the size of the job. Everything else comes
		// from the assessment, not from a constant of the code.
		const assessment = assessWorkload({ requestText: `reindex ${TOTAL_RECORDS} records`, partitionSafe: true });
		expect(assessment.isLarge).toBe(true);
		expect(assessment.recordCount).toBe(TOTAL_RECORDS);
		expect(assessment.pilotRecords).toBe(PILOT_RECORDS);
		expect(assessment.batchRecords).toBe(BATCH_RECORDS);
		expect(assessment.concurrency).toBe(CONCURRENCY);

		const plan = workloadBatchPlan(assessment, { budgetMinutes: 90, maxAttempts: 2 });
		const batches = buildBatches(plan);
		const covered = batches.reduce((sum, batch) => sum + batch.records, 0);
		expect(covered).toBe(TOTAL_RECORDS);
		expect(batches[0].records).toBe(PILOT_RECORDS);
		expect(batches[0].kind).toBe("pilot");
		// Every batch stays inside the bound.
		for (const batch of batches) expect(batch.records).toBeLessThanOrEqual(BATCH_RECORDS);
	});

	it("does not complete a large job whose plan declares no pilot", () => {
		const plan = {
			full: { kind: "full" as const, command: "bun test tests/full", datasetSize: TOTAL_RECORDS },
			finalTierRequired: true,
		};
		const state = summarizeValidationState(plan, [
			{ ts: "2026-10-27T00:00:00.000Z", tier: "full", status: "passed" },
		]);
		expect(state.planIncomplete).toBe(true);
		expect(state.missingPilot).toBe(true);
		expect(state.finalTierPending).toBe(false);
	});
});
