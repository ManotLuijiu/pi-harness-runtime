import { describe, it, expect } from "bun:test";
import {
	assessWorkload,
	declaredRecordCount,
	describeWorkload,
	workloadBatchPlan,
} from "../src/workload.js";
import {
	planWorkload,
	planHasPilot,
	summarizeValidationState,
} from "../src/validation-plan.js";
import type { ValidationPlan } from "../src/validation-plan.js";
import { MAX_BATCH_RECORDS, PILOT_RECORDS } from "../src/workload.js";

describe("the declared record count", () => {
	it("a declared count is read from the request", () => {
		expect(declaredRecordCount("reindex the 10,000 records of the corpus")).toBe(10_000);
		expect(declaredRecordCount("migrate 500 rows")).toBe(500);
		expect(declaredRecordCount("process 1.5M items")).toBe(1_500_000);
		expect(declaredRecordCount("read 250 users")).toBe(250);
	});

	it("the largest declaration wins", () => {
		expect(declaredRecordCount("run 100 records of the 10,000 record corpus")).toBe(10_000);
	});

	it("a file is not a record", () => {
		// The number of files is a measured fact, not a declaration.
		expect(declaredRecordCount("touch 42 files")).toBeUndefined();
	});

	it("a request without a count declares nothing", () => {
		expect(declaredRecordCount("refactor the parser")).toBeUndefined();
		expect(declaredRecordCount(undefined)).toBeUndefined();
	});
});

describe("the workload of a job", () => {
	it("a job without any fact is unknown, not small", () => {
		const assessment = assessWorkload({});
		expect(assessment.size).toBe("unknown");
		expect(assessment.unknown).toBe(true);
		expect(assessment.isLarge).toBe(false);
		expect(assessment.pilotRecords).toBeUndefined();
		expect(assessment.reasons.join(" ")).toContain("no fact");
	});

	it("a measured small job is small", () => {
		const assessment = assessWorkload({ scope: { fileCount: 3, callSiteCount: 7 } });
		expect(assessment.size).toBe("small");
		expect(assessment.unknown).toBe(false);
		expect(assessment.pilotRecords).toBeUndefined();
	});

	it("a declared count of records decides the size", () => {
		const assessment = assessWorkload({ requestText: "reindex 10,000 records" });
		expect(assessment.size).toBe("large");
		expect(assessment.isLarge).toBe(true);
		expect(assessment.recordCount).toBe(10_000);
		expect(assessment.pilotRecords).toBe(PILOT_RECORDS);
		expect(assessment.batchRecords).toBe(MAX_BATCH_RECORDS);
	});

	it("the phrase of a large job decides nothing", () => {
		const assessment = assessWorkload({ requestText: "a large refactor of the parser" });
		expect(assessment.size).toBe("unknown");
	});

	it("a measured scope decides the size", () => {
		expect(assessWorkload({ scope: { fileCount: 120 } }).size).toBe("large");
		expect(assessWorkload({ scope: { callSiteCount: 400 } }).size).toBe("large");
		expect(assessWorkload({ scope: { fileCount: 12 } }).size).toBe("medium");
	});

	it("a measured cost per record decides the size", () => {
		const assessment = assessWorkload({ requestText: "process 5,000 records", msPerRecord: 200 });
		expect(assessment.size).toBe("large");
		expect(assessment.estimatedDurationMs).toBe(1_000_000);
	});

	it("the batches run one at a time without a proven partition", () => {
		const assessment = assessWorkload({ requestText: "process 10,000 records" });
		expect(assessment.concurrency).toBe(1);
		expect(assessment.reasons.join(" ")).toContain("one at a time");
	});

	it("the batches may run together when they write to disjoint places", () => {
		const assessment = assessWorkload({ requestText: "process 10,000 records", partitionSafe: true });
		expect(assessment.concurrency).toBe(2);
	});

	it("a large job without a record count has no pilot size", () => {
		const assessment = assessWorkload({ scope: { fileCount: 200 } });
		expect(assessment.isLarge).toBe(true);
		expect(assessment.pilotRecords).toBeUndefined();
		expect(assessment.reasons.join(" ")).toContain("no record count");
	});

	it("the description names the facts", () => {
		const assessment = assessWorkload({ requestText: "process 10,000 records", partitionSafe: true });
		const description = describeWorkload(assessment);
		expect(description).toContain("workload large");
		expect(description).toContain("10000 record(s)");
		expect(description).toContain("pilot 100");
		expect(description).toContain("batch 500");
	});

	it("the batch plan carries only what was measured", () => {
		const assessment = assessWorkload({ requestText: "process 10,000 records", partitionSafe: true });
		const plan = workloadBatchPlan(assessment, { budgetMinutes: 90, maxAttempts: 2 });
		expect(plan.totalRecords).toBe(10_000);
		expect(plan.pilotRecords).toBe(100);
		expect(plan.maxBatchRecords).toBe(500);
		expect(plan.maxConcurrentBatches).toBe(2);
		expect(plan.budgetMinutes).toBe(90);
		// Without a measured cost per record there is no estimate.
		expect(plan.msPerRecord).toBeUndefined();
	});
});

describe("the plan of a large job", () => {
	const largePlan: ValidationPlan = {
		fast: { kind: "fast", command: "bun test tests/fast", datasetSize: 100, representative: true },
		full: { kind: "full", command: "bun test tests/full", datasetSize: 10_000, scaleUpFrom: "fast" },
		finalTierRequired: true,
	};

	it("the workload of a plan comes from its tiers", () => {
		const workload = planWorkload(largePlan);
		expect(workload.isLarge).toBe(true);
		expect(workload.recordCount).toBe(10_000);
	});

	it("a plan with a pilot names it", () => {
		expect(planHasPilot(largePlan)).toBe(true);
	});

	it("a plan without a pilot is incomplete", () => {
		const plan: ValidationPlan = {
			full: { kind: "full", command: "bun test tests/full", datasetSize: 10_000 },
			finalTierRequired: true,
		};
		const state = summarizeValidationState(plan, []);
		expect(state.planIncomplete).toBe(true);
		expect(state.missingPilot).toBe(true);
		expect(state.planIncompleteReasons?.join(" ")).toContain("no pilot tier");
	});

	it("a fast tier alone is not the pilot of the final tier", () => {
		const plan: ValidationPlan = {
			fast: { kind: "fast", command: "bun test tests/fast", datasetSize: 100 },
			full: { kind: "full", command: "bun test tests/full", datasetSize: 10_000 },
			finalTierRequired: true,
		};
		const state = summarizeValidationState(plan, []);
		expect(state.missingPilot).toBe(true);
		expect(state.planIncompleteReasons?.join(" ")).toContain("scale-up");
	});

	it("a complete plan is not incomplete", () => {
		const state = summarizeValidationState(largePlan, []);
		expect(state.planIncomplete).toBe(false);
		expect(state.missingPilot).toBe(false);
	});

	it("a small job needs no pilot", () => {
		const plan: ValidationPlan = {
			full: { kind: "full", command: "bun test", datasetSize: 50 },
			finalTierRequired: true,
		};
		const state = summarizeValidationState(plan, []);
		expect(state.planIncomplete).toBe(false);
		expect(state.missingPilot).toBe(false);
	});

	it("a plan that does not require the final tier is never blocked by the pilot", () => {
		const plan: ValidationPlan = {
			full: { kind: "full", command: "bun test tests/full", datasetSize: 10_000 },
		};
		const state = summarizeValidationState(plan, []);
		expect(state.missingPilot).toBe(false);
		expect(state.planIncomplete).toBe(false);
	});

	it("a plan without a final tier keeps its own reason", () => {
		const state = summarizeValidationState({ fast: { kind: "fast" }, finalTierRequired: true }, []);
		expect(state.planIncomplete).toBe(true);
		expect(state.missingPilot).toBe(false);
		expect(state.planIncompleteReasons?.join(" ")).toContain("final tier");
	});
});
