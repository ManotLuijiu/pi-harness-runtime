/**
 * The workload of a job is a fact, not a phrase.
 *
 * A request that says "large refactor" is not a large job, and a request
 * that says "10,000 records" is a large job even when the phrase is
 * missing. The assessment reads the facts that are really available - a
 * declared record count, a measured scope, a declared tier cost, a
 * measured cost per record - and it reports what it decided and why.
 *
 * A job without any fact is `unknown`, never `small`: the difference
 * decides whether a pilot is needed, and a job of unknown size is not a
 * job that may skip the pilot.
 *
 * The assessment is deterministic. It never asks a model what the size of
 * a job is, because a model cannot count the records of a repository.
 */

import type { BatchPlan } from "./batch-plan.js";

/** A job of this many records is a large job. */
export const LARGE_RECORD_COUNT = 1_000;
/** A job of this many records is at least a medium job. */
export const MEDIUM_RECORD_COUNT = 100;
/** A change of this many files is a large job. */
export const LARGE_FILE_COUNT = 50;
/** A change of this many files is at least a medium job. */
export const MEDIUM_FILE_COUNT = 10;
/** A change with this many call sites is a large job. */
export const LARGE_CALL_SITES = 200;
/** A change with this many call sites is at least a medium job. */
export const MEDIUM_CALL_SITES = 50;
/** A job that runs this long is a large job. */
export const LARGE_DURATION_MS = 600_000;
/** A job that runs this long is at least a medium job. */
export const MEDIUM_DURATION_MS = 60_000;
/** A change with this many migration files is a large job. */
export const LARGE_MIGRATION_FILES = 20;
/** A change with this many migration files is at least a medium job. */
export const MEDIUM_MIGRATION_FILES = 5;
/** The size of the representative pilot of a large job. */
export const PILOT_RECORDS = 100;
/** The size of a bounded batch of a large job. */
export const MAX_BATCH_RECORDS = 500;
/** The highest number of batches that may run at the same time. */
export const MAX_CONCURRENCY = 2;

/** The text of a request is only scanned up to this many characters. */
const MAX_SCANNED_TEXT = 20_000;
/** A declared count above this is not a count, it is a typo. */
const MAX_DECLARED_RECORDS = 1e12;

/**
 * The units that name a record. A file is not a record: the number of
 * files is a measured fact of the repository, not a declaration of the
 * user.
 */
const RECORD_UNITS =
	"records?|rows?|items?|entries|documents?|messages?|events?|tickets?|samples?|users?|customers?|orders?|invoices?|transactions?";

/**
 * The count of a record declaration.
 *
 * The pattern is linear: a digit class, an optional fraction, an optional
 * multiplier and a unit. There is no nested repetition, so a hostile
 * request cannot make the scan slow.
 */
const COUNT_PATTERN = new RegExp(
	`(\\d[\\d,]*)(?:\\.(\\d+))?\\s*(k|m)?\\s*(${RECORD_UNITS})\\b`,
	"gi",
);

export type WorkloadSize = "unknown" | "small" | "medium" | "large";

/** The scope that was measured in the repository. */
export interface WorkloadScopeFacts {
	fileCount?: number;
	callSiteCount?: number;
	testFileCount?: number;
	migrationFileCount?: number;
}

/** A tier of the declared validation plan. */
export interface WorkloadTierFacts {
	datasetSize?: number;
	expectedDurationMs?: number;
}

export interface WorkloadInput {
	/** The request of the task. A count in it is a declaration. */
	requestText?: string;
	/** The scope that was measured in the repository. */
	scope?: WorkloadScopeFacts;
	/** The tiers of the declared validation plan. */
	tiers?: WorkloadTierFacts[];
	/** The measured cost of one record. */
	msPerRecord?: number;
	/** The batches write to disjoint destinations. */
	partitionSafe?: boolean;
}

export interface WorkloadAssessment {
	/** The size of the job, decided from the facts. */
	size: WorkloadSize;
	/** The job is a large job. */
	isLarge: boolean;
	/** The facts that decided the size, in plain words. */
	reasons: string[];
	/** The number of records of the job, when it is known. */
	recordCount?: number;
	/** The number of changed files, when it was measured. */
	fileCount?: number;
	/** The number of call sites, when it was measured. */
	callSiteCount?: number;
	/** The measured or declared duration of the job. */
	estimatedDurationMs?: number;
	/** The size of the representative pilot, when the job needs one. */
	pilotRecords?: number;
	/** The size of a bounded batch, when the job has a record count. */
	batchRecords?: number;
	/** How many batches may run at the same time. */
	concurrency: number;
	/** No fact was available, so the size is unknown. */
	unknown: boolean;
}

function positiveNumber(value: number | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isFinite(value)) return undefined;
	if (value <= 0) return undefined;
	return value;
}

function maxOf(values: (number | undefined)[]): number | undefined {
	const known = values.map(positiveNumber).filter((v): v is number => v !== undefined);
	if (known.length === 0) return undefined;
	return Math.max(...known);
}

/**
 * The largest record count that the request declares.
 *
 * "10,000 records", "500 rows", "1.5M items" and "250 users" are
 * declarations of a count. The largest one wins, because the request may
 * also name the size of a batch or of a sample.
 */
export function declaredRecordCount(text: string | undefined): number | undefined {
	if (!text) return undefined;
	const scan = text.length > MAX_SCANNED_TEXT ? text.slice(0, MAX_SCANNED_TEXT) : text;
	COUNT_PATTERN.lastIndex = 0;
	let largest: number | undefined;
	let match: RegExpExecArray | null = COUNT_PATTERN.exec(scan);
	while (match !== null) {
		const integerPart = Number.parseInt((match[1] ?? "0").replace(/,/g, ""), 10);
		const fractionDigits = match[2] ?? "";
		const fraction = fractionDigits.length > 0 ? Number.parseInt(fractionDigits, 10) / 10 ** fractionDigits.length : 0;
		const suffix = match[3]?.toLowerCase();
		let multiplier = 1;
		if (suffix === "m") multiplier = 1_000_000;
		else if (suffix === "k") multiplier = 1_000;
		const value = (integerPart + fraction) * multiplier;
		if (Number.isFinite(value) && value > 0 && value <= MAX_DECLARED_RECORDS) {
			if (largest === undefined || value > largest) largest = value;
		}
		match = COUNT_PATTERN.exec(scan);
	}
	return largest;
}

/**
 * The workload of a job, decided from the facts.
 *
 * The order of the thresholds is the order of the certainty: a declared
 * count of records is the strongest fact, a measured scope is the next
 * one, and a duration that is derived from a measured cost per record is
 * the weakest.
 */
export function assessWorkload(input: WorkloadInput): WorkloadAssessment {
	const reasons: string[] = [];
	const declared = declaredRecordCount(input.requestText);
	const tierRecords = maxOf((input.tiers ?? []).map((tier) => tier.datasetSize));
	const tierDuration = maxOf((input.tiers ?? []).map((tier) => tier.expectedDurationMs));
	const recordCount = maxOf([declared, tierRecords]);
	const fileCount = positiveNumber(input.scope?.fileCount);
	const callSiteCount = positiveNumber(input.scope?.callSiteCount);
	const migrationFileCount = positiveNumber(input.scope?.migrationFileCount);
	const msPerRecord = positiveNumber(input.msPerRecord);
	const estimatedDurationMs =
		msPerRecord !== undefined && recordCount !== undefined ? Math.round(msPerRecord * recordCount) : undefined;
	const declaredDuration = maxOf([tierDuration, estimatedDurationMs]);

	let size: WorkloadSize = "unknown";

	if (recordCount !== undefined && recordCount >= LARGE_RECORD_COUNT) {
		size = "large";
		reasons.push(`${recordCount} record(s) is at least ${LARGE_RECORD_COUNT}`);
	}
	if (fileCount !== undefined && fileCount >= LARGE_FILE_COUNT) {
		size = "large";
		reasons.push(`${fileCount} changed file(s) is at least ${LARGE_FILE_COUNT}`);
	}
	if (callSiteCount !== undefined && callSiteCount >= LARGE_CALL_SITES) {
		size = "large";
		reasons.push(`${callSiteCount} call site(s) is at least ${LARGE_CALL_SITES}`);
	}
	if (migrationFileCount !== undefined && migrationFileCount >= LARGE_MIGRATION_FILES) {
		size = "large";
		reasons.push(`${migrationFileCount} migration file(s) is at least ${LARGE_MIGRATION_FILES}`);
	}
	if (declaredDuration !== undefined && declaredDuration >= LARGE_DURATION_MS) {
		size = "large";
		reasons.push(`a runtime of ${Math.round(declaredDuration / 1000)}s is at least ${LARGE_DURATION_MS / 1000}s`);
	}

	if (size !== "large") {
		if (recordCount !== undefined && recordCount >= MEDIUM_RECORD_COUNT) {
			size = "medium";
			reasons.push(`${recordCount} record(s) is at least ${MEDIUM_RECORD_COUNT}`);
		}
		if (fileCount !== undefined && fileCount >= MEDIUM_FILE_COUNT) {
			size = "medium";
			reasons.push(`${fileCount} changed file(s) is at least ${MEDIUM_FILE_COUNT}`);
		}
		if (callSiteCount !== undefined && callSiteCount >= MEDIUM_CALL_SITES) {
			size = "medium";
			reasons.push(`${callSiteCount} call site(s) is at least ${MEDIUM_CALL_SITES}`);
		}
		if (migrationFileCount !== undefined && migrationFileCount >= MEDIUM_MIGRATION_FILES) {
			size = "medium";
			reasons.push(`${migrationFileCount} migration file(s) is at least ${MEDIUM_MIGRATION_FILES}`);
		}
		if (declaredDuration !== undefined && declaredDuration >= MEDIUM_DURATION_MS) {
			size = "medium";
			reasons.push(`a runtime of ${Math.round(declaredDuration / 1000)}s is at least ${MEDIUM_DURATION_MS / 1000}s`);
		}
	}

	const hasFact =
		recordCount !== undefined ||
		fileCount !== undefined ||
		callSiteCount !== undefined ||
		migrationFileCount !== undefined ||
		declaredDuration !== undefined;

	if (size === "unknown" && hasFact) {
		size = "small";
		reasons.push("every measured fact is below the medium threshold");
	} else if (size === "unknown") {
		reasons.push("no fact about the size of the job was available");
	}

	// The pilot of a large job is the representative sample. It is never
	// bigger than the job itself, and it needs a record count: a pilot
	// without a size is not a pilot.
	let pilotRecords: number | undefined;
	if (size === "large") {
		if (recordCount !== undefined) {
			pilotRecords = Math.min(PILOT_RECORDS, recordCount);
			reasons.push(`the pilot covers ${pilotRecords} record(s)`);
		} else {
			reasons.push("the job is large by scope, but no record count is known, so the pilot has no size");
		}
	}

	const batchRecords = recordCount !== undefined ? Math.min(MAX_BATCH_RECORDS, recordCount) : undefined;

	// Concurrent writers are only allowed when the batches provably write
	// to disjoint destinations. Everything else runs one batch at a time.
	const partitionSafe = input.partitionSafe === true;
	const concurrency = size === "large" && partitionSafe ? MAX_CONCURRENCY : 1;
	if (size === "large") {
		reasons.push(
			partitionSafe
				? `the batches write to disjoint destinations, so ${MAX_CONCURRENCY} of them may run at once`
				: "the batches may share a destination, so they run one at a time",
		);
	}

	const assessment: WorkloadAssessment = {
		size,
		isLarge: size === "large",
		reasons,
		concurrency,
		unknown: size === "unknown",
	};
	if (recordCount !== undefined) assessment.recordCount = recordCount;
	if (fileCount !== undefined) assessment.fileCount = fileCount;
	if (callSiteCount !== undefined) assessment.callSiteCount = callSiteCount;
	if (declaredDuration !== undefined) assessment.estimatedDurationMs = declaredDuration;
	if (pilotRecords !== undefined) assessment.pilotRecords = pilotRecords;
	if (batchRecords !== undefined) assessment.batchRecords = batchRecords;
	return assessment;
}

/**
 * A one line description of the assessment, for the status line and the
 * instruction of the agent.
 */
export function describeWorkload(assessment: WorkloadAssessment): string {
	const parts: string[] = [`workload ${assessment.size}`];
	if (assessment.recordCount !== undefined) parts.push(`${assessment.recordCount} record(s)`);
	if (assessment.fileCount !== undefined) parts.push(`${assessment.fileCount} file(s)`);
	if (assessment.callSiteCount !== undefined) parts.push(`${assessment.callSiteCount} call site(s)`);
	if (assessment.pilotRecords !== undefined) parts.push(`pilot ${assessment.pilotRecords}`);
	if (assessment.batchRecords !== undefined) parts.push(`batch ${assessment.batchRecords}`);
	parts.push(`concurrency ${assessment.concurrency}`);
	if (assessment.estimatedDurationMs !== undefined) {
		parts.push(`~${Math.round(assessment.estimatedDurationMs / 1000)}s`);
	}
	return parts.join(" | ");
}

/**
 * The batch plan of an assessed job.
 *
 * The plan carries only what was measured: without a measured cost per
 * record the estimate stays unknown, and the batches stay bounded.
 */
export function workloadBatchPlan(
	assessment: WorkloadAssessment,
	extra: {
		budgetMinutes?: number;
		maxAttempts?: number;
		msPerRecord?: number;
	} = {},
): BatchPlan {
	const plan: BatchPlan = {
		totalRecords: assessment.recordCount ?? 0,
		pilotRecords: assessment.pilotRecords ?? 0,
		maxBatchRecords: assessment.batchRecords ?? MAX_BATCH_RECORDS,
		maxConcurrentBatches: assessment.concurrency,
	};
	if (extra.budgetMinutes !== undefined) plan.budgetMinutes = extra.budgetMinutes;
	if (extra.maxAttempts !== undefined) plan.maxAttempts = extra.maxAttempts;
	if (extra.msPerRecord !== undefined) plan.msPerRecord = extra.msPerRecord;
	return plan;
}
