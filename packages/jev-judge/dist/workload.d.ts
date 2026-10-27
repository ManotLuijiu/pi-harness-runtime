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
export declare const LARGE_RECORD_COUNT = 1000;
/** A job of this many records is at least a medium job. */
export declare const MEDIUM_RECORD_COUNT = 100;
/** A change of this many files is a large job. */
export declare const LARGE_FILE_COUNT = 50;
/** A change of this many files is at least a medium job. */
export declare const MEDIUM_FILE_COUNT = 10;
/** A change with this many call sites is a large job. */
export declare const LARGE_CALL_SITES = 200;
/** A change with this many call sites is at least a medium job. */
export declare const MEDIUM_CALL_SITES = 50;
/** A job that runs this long is a large job. */
export declare const LARGE_DURATION_MS = 600000;
/** A job that runs this long is at least a medium job. */
export declare const MEDIUM_DURATION_MS = 60000;
/** A change with this many migration files is a large job. */
export declare const LARGE_MIGRATION_FILES = 20;
/** A change with this many migration files is at least a medium job. */
export declare const MEDIUM_MIGRATION_FILES = 5;
/** The size of the representative pilot of a large job. */
export declare const PILOT_RECORDS = 100;
/** The size of a bounded batch of a large job. */
export declare const MAX_BATCH_RECORDS = 500;
/** The highest number of batches that may run at the same time. */
export declare const MAX_CONCURRENCY = 2;
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
/**
 * The largest record count that the request declares.
 *
 * "10,000 records", "500 rows", "1.5M items" and "250 users" are
 * declarations of a count. The largest one wins, because the request may
 * also name the size of a batch or of a sample.
 */
export declare function declaredRecordCount(text: string | undefined): number | undefined;
/**
 * The workload of a job, decided from the facts.
 *
 * The order of the thresholds is the order of the certainty: a declared
 * count of records is the strongest fact, a measured scope is the next
 * one, and a duration that is derived from a measured cost per record is
 * the weakest.
 */
export declare function assessWorkload(input: WorkloadInput): WorkloadAssessment;
/**
 * A one line description of the assessment, for the status line and the
 * instruction of the agent.
 */
export declare function describeWorkload(assessment: WorkloadAssessment): string;
/**
 * The batch plan of an assessed job.
 *
 * The plan carries only what was measured: without a measured cost per
 * record the estimate stays unknown, and the batches stay bounded.
 */
export declare function workloadBatchPlan(assessment: WorkloadAssessment, extra?: {
    budgetMinutes?: number;
    maxAttempts?: number;
    msPerRecord?: number;
}): BatchPlan;
//# sourceMappingURL=workload.d.ts.map