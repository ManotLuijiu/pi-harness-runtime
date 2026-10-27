/**
 * The pilot and the scale-up.
 *
 * A large job starts with a representative pilot: a small, measured run
 * that keeps the shape of the data. The expensive scale-up only starts
 * when the pilot met its criteria, and the criteria are facts: the run
 * passed, the dataset was the declared size, and the run stayed inside
 * the budget.
 *
 * Nothing here runs a command. The harness reads the ledger, and the
 * ledger is written by whoever ran the tier.
 */

import type { ValidationPlan, ValidationTier, ValidationTierKind } from "./validation-plan.js";

/**
 * One measured run of a tier.
 *
 * The fields are the ones the ledger records: the status, the measured
 * duration and the measured dataset size.
 */
export interface MeasuredRun {
	/** The status the ledger recorded. */
	status: string;
	/** The measured duration in milliseconds. */
	durationMs?: number;
	/** The measured size of the dataset the run exercised. */
	datasetSize?: number;
	/** When the run happened. */
	at?: string;
}

/**
 * The verdict about a pilot.
 *
 * The reasons are the criteria that were not met. A pilot that was not
 * run at all has the reason "not-run".
 */
export interface PilotVerdict {
	/** Did the pilot meet every criterion? */
	passed: boolean;
	/** One reason per criterion that was not met. */
	reasons: string[];
	/** May the scale-up start? */
	mayScaleUp: boolean;
	/** The measured facts of the run. */
	measured: { durationMs?: number; datasetSize?: number };
	/** The status the ledger recorded. */
	status: string;
}

/** The tier status that means the run succeeded. */
const PASSED = "passed";

/**
 * Is the tier the representative pilot of the plan?
 *
 * A pilot is the fast tier. A plan that declares no fast tier has no
 * pilot, and nothing waits for one.
 */
export function pilotTier(plan: ValidationPlan | null | undefined): ValidationTier | undefined {
	return plan?.fast;
}

/**
 * The tier that carries the scale-up of the plan.
 */
export function scaleUpTier(plan: ValidationPlan | null | undefined): ValidationTier | undefined {
	return plan?.full;
}

/**
 * Does the scale-up wait for the pilot?
 *
 * The wait is explicit: the tier declares that it scales up from the
 * fast tier. A plan without that declaration has no scale-up gate.
 */
export function scaleUpWaitsForPilot(plan: ValidationPlan | null | undefined): boolean {
	const full = scaleUpTier(plan);
	return full?.scaleUpFrom === "fast";
}

/**
 * The measured facts of a pilot run.
 */
function measuredFacts(run: MeasuredRun | undefined): { durationMs?: number; datasetSize?: number } {
	if (!run) return {};
	const facts: { durationMs?: number; datasetSize?: number } = {};
	if (run.durationMs !== undefined) facts.durationMs = run.durationMs;
	if (run.datasetSize !== undefined) facts.datasetSize = run.datasetSize;
	return facts;
}

/**
 * The verdict about the pilot of a plan.
 *
 * The criteria that the harness can check are checked: the run passed,
 * the dataset was the declared size, and the run stayed inside the
 * budget. The criteria that only a human can judge are carried in the
 * plan and shown; they never decide the gate on their own.
 */
export function evaluatePilot(
	plan: ValidationPlan | null | undefined,
	run: MeasuredRun | undefined,
): PilotVerdict {
	const measured = measuredFacts(run);
	const pilot = pilotTier(plan);
	if (!plan || !pilot) {
		return {
			passed: false,
			reasons: ["no pilot tier is declared"],
			mayScaleUp: true,
			measured,
			status: run?.status ?? "not-run",
		};
	}
	const reasons: string[] = [];
	const status = run?.status ?? "not-run";
	if (!run) {
		reasons.push("the pilot was not run");
	} else if (status !== PASSED) {
		reasons.push(`the pilot did not pass (${status})`);
	}
	// A pilot that ran on less data than the plan declares is not
	// representative: the shape of the data, not only its size, is what
	// the pilot has to keep.
	if (pilot.datasetSize !== undefined) {
		if (run?.datasetSize === undefined) {
			reasons.push(`the pilot ran without a measured dataset size (${pilot.datasetSize} expected)`);
		} else if (run.datasetSize < pilot.datasetSize) {
			reasons.push(
				`the pilot ran on ${run.datasetSize} record(s), ${pilot.datasetSize} expected`,
			);
		}
	}
	// The budget is the hard limit of the validation.
	if (plan.budgetMinutes !== undefined && run?.durationMs !== undefined) {
		const budgetMs = plan.budgetMinutes * 60_000;
		if (run.durationMs > budgetMs) {
			reasons.push(`the pilot took ${Math.round(run.durationMs / 1000)}s, over the budget`);
		}
	}
	const passed = reasons.length === 0;
	return {
		passed,
		reasons,
		// The scale-up waits for the pilot only when the plan says so.
		mayScaleUp: passed || !scaleUpWaitsForPilot(plan),
		measured,
		status,
	};
}

/**
 * A plan for a job that starts with a pilot.
 *
 * Every number is either measured or explicitly unknown: the harness
 * never invents a duration or a dataset size.
 */
export interface PilotPlanInput {
	/** Who runs the validation. */
	owner: string;
	/** The command of the representative pilot. */
	pilotCommand: string;
	/** The command of the scale-up. */
	scaleUpCommand: string;
	/** The measured size of the representative dataset. */
	pilotRecords: number;
	/** The measured size of the full dataset. */
	fullRecords: number;
	/** The measured duration of the pilot, when it was measured. */
	pilotDurationMs?: number;
	/** The expected duration of the scale-up, measured or estimated. */
	fullDurationMs?: number;
	/** The soft budget of the whole validation, in minutes. */
	budgetMinutes?: number;
	/** The criteria the pilot has to meet. */
	passCriteria?: string[];
	/** What to do when a tier fails. */
	failureAction?: string;
	/** The label of the pilot. */
	pilotLabel?: string;
	/** The label of the scale-up. */
	scaleUpLabel?: string;
}

/**
 * Build the plan of a job that starts with a pilot.
 *
 * The pilot is the fast tier, the scale-up is the full tier, and the
 * scale-up waits for the pilot.
 */
export function buildPilotPlan(input: PilotPlanInput): ValidationPlan {
	const criteria = input.passCriteria ?? [];
	const plan: ValidationPlan = {
		fast: {
			kind: "fast",
			command: input.pilotCommand,
			label: input.pilotLabel ?? `representative pilot (${input.pilotRecords} record(s))`,
			datasetSize: input.pilotRecords,
			owner: input.owner,
			representative: true,
			...(input.pilotDurationMs !== undefined
				? { expectedDurationMs: input.pilotDurationMs }
				: {}),
			...(criteria.length > 0 ? { passCriteria: criteria } : {}),
			...(input.failureAction ? { failureAction: input.failureAction } : {}),
		},
		full: {
			kind: "full",
			command: input.scaleUpCommand,
			label: input.scaleUpLabel ?? `scale-up (${input.fullRecords} record(s))`,
			datasetSize: input.fullRecords,
			owner: input.owner,
			scaleUpFrom: "fast",
			...(input.fullDurationMs !== undefined
				? { expectedDurationMs: input.fullDurationMs }
				: {}),
			...(criteria.length > 0 ? { passCriteria: criteria } : {}),
			...(input.failureAction ? { failureAction: input.failureAction } : {}),
		},
		finalTierRequired: true,
	};
	if (input.budgetMinutes !== undefined) plan.budgetMinutes = input.budgetMinutes;
	return plan;
}

/**
 * The description of the pilot, for the status and for the steer.
 *
 * The words name the measured facts. A pilot that was not run says so.
 */
export function describePilot(
	plan: ValidationPlan | null | undefined,
	run: MeasuredRun | undefined,
): string {
	const verdict = evaluatePilot(plan, run);
	const pilot = pilotTier(plan);
	if (!plan || !pilot) return "no pilot is declared";
	const parts: string[] = [];
	parts.push(verdict.passed ? "pilot passed" : "pilot did not pass");
	if (verdict.measured.datasetSize !== undefined) {
		parts.push(`${verdict.measured.datasetSize} record(s)`);
	}
	if (verdict.measured.durationMs !== undefined) {
		parts.push(`${Math.round(verdict.measured.durationMs / 1000)}s`);
	}
	if (!verdict.passed) parts.push(`(${verdict.reasons.join("; ")})`);
	return parts.join(" ");
}

/**
 * The tier that a run belongs to.
 */
export function tierKindOf(tier: ValidationTier | undefined): ValidationTierKind | undefined {
	return tier?.kind;
}
