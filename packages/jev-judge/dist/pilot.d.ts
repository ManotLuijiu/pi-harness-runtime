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
    measured: {
        durationMs?: number;
        datasetSize?: number;
    };
    /** The status the ledger recorded. */
    status: string;
}
/**
 * Is the tier the representative pilot of the plan?
 *
 * A pilot is the fast tier. A plan that declares no fast tier has no
 * pilot, and nothing waits for one.
 */
export declare function pilotTier(plan: ValidationPlan | null | undefined): ValidationTier | undefined;
/**
 * The tier that carries the scale-up of the plan.
 */
export declare function scaleUpTier(plan: ValidationPlan | null | undefined): ValidationTier | undefined;
/**
 * Does the scale-up wait for the pilot?
 *
 * The wait is explicit: the tier declares that it scales up from the
 * fast tier. A plan without that declaration has no scale-up gate.
 */
export declare function scaleUpWaitsForPilot(plan: ValidationPlan | null | undefined): boolean;
/**
 * The verdict about the pilot of a plan.
 *
 * The criteria that the harness can check are checked: the run passed,
 * the dataset was the declared size, and the run stayed inside the
 * budget. The criteria that only a human can judge are carried in the
 * plan and shown; they never decide the gate on their own.
 */
export declare function evaluatePilot(plan: ValidationPlan | null | undefined, run: MeasuredRun | undefined): PilotVerdict;
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
export declare function buildPilotPlan(input: PilotPlanInput): ValidationPlan;
/**
 * The description of the pilot, for the status and for the steer.
 *
 * The words name the measured facts. A pilot that was not run says so.
 */
export declare function describePilot(plan: ValidationPlan | null | undefined, run: MeasuredRun | undefined): string;
/**
 * The tier that a run belongs to.
 */
export declare function tierKindOf(tier: ValidationTier | undefined): ValidationTierKind | undefined;
//# sourceMappingURL=pilot.d.ts.map