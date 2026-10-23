/**
 * Validation Plan - staged (fast -> full) test tiers for a todo.
 *
 * The harness NEVER guesses a tier from a command string. A tier is declared
 * by the task author in the todo metadata, so the plan stays truthful and
 * reviewable:
 *
 * ```json
 * {
 *   "metadata": {
 *     "validationPlan": {
 *       "fast": { "command": "bun test tests/fast", "expectedDurationMs": 18000, "datasetSize": 100 },
 *       "full": { "command": "bun test tests/full", "expectedDurationMs": 2400000, "datasetSize": 10000 },
 *       "budgetMinutes": 90,
 *       "finalTierRequired": true
 *     }
 *   }
 * }
 * ```
 *
 * Every field is optional. A todo without a plan keeps the current behaviour
 * (no validation context is injected), so small tasks are unaffected.
 */

import type { TodoItem } from "./todo-provider.js";

/**
 * Which side of the ladder a tier sits on.
 *
 * - `fast`: representative, cheap, safe to run after every edit
 * - `full`: complete, expensive, run once as the final acceptance check
 */
export type ValidationTierKind = "fast" | "full";

/**
 * One declared validation tier.
 */
export interface ValidationTier {
	kind: ValidationTierKind;
	/** Exact command for this tier. Never rewritten by the harness. */
	command?: string;
	/** Human label, e.g. "fixture regression". */
	label?: string;
	/** Expected cost of the tier in milliseconds (measured or estimated). */
	expectedDurationMs?: number;
	/** Dataset size the tier exercises, when it is data-volume bound. */
	datasetSize?: number;
}

/**
 * State of one tier for one todo item.
 */
export interface ValidationTierState {
	/** `not-run` when no run was recorded for this tier. */
	status: "passed" | "failed" | "timeout" | "error" | "skipped" | "not-run";
	/** Timestamp of the latest run. */
	at?: string;
	/** Duration of the latest run. */
	durationMs?: number;
	/** Command of the latest run. */
	command?: string;
}

/**
 * Aggregated validation state of a todo item.
 */
export interface ValidationState {
	/** True when the item declares a validation plan. */
	hasPlan: boolean;
	/** State of the cheap tier. */
	fast: ValidationTierState;
	/** State of the expensive tier. */
	full: ValidationTierState;
	/** True when the plan declares the full tier as the final acceptance check. */
	finalTierRequired: boolean;
	/**
	 * True when the final tier is required but has not passed yet.
	 *
	 * A todo in this state must not be reported as complete.
	 */
	finalTierPending: boolean;
	/** Soft time budget of the plan, in minutes. */
	budgetMinutes?: number;
	/** True when the plan requires a final tier but does not declare one. */
	planIncomplete: boolean;
}

/**
 * The full staged validation plan for a todo.
 */
export interface ValidationPlan {
	/** Cheap representative tier, used while the code is changing. */
	fast?: ValidationTier;
	/** Expensive complete tier, used once the implementation is stable. */
	full?: ValidationTier;
	/** Extra guidance for the agent (e.g. "fast tier must cover aggregation"). */
	notes?: string;
	/** Soft time budget for this todo, in minutes. */
	budgetMinutes?: number;
	/** When true, the todo must not be completed before the full tier passed. */
	finalTierRequired?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = source[key];
		if (typeof value === "string" && value.trim().length > 0) return value.trim();
	}
	return undefined;
}

function firstNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
	for (const key of keys) {
		const value = source[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
	}
	return undefined;
}

/**
 * Parse a duration into milliseconds.
 *
 * Strings must carry a unit (`45s`, `40m`, `1h`, `1h30m`). A bare number is
 * milliseconds when it is at least 1000 and seconds below that, because a
 * bare "40" is ambiguous between milliseconds and minutes.
 */
export function parseDurationMs(value: unknown): number | undefined {
	if (typeof value === "number") {
		if (!Number.isFinite(value)) return undefined;
		return value >= 1000 ? value : Math.round(value * 1000);
	}
	if (typeof value !== "string") return undefined;
	const text = value.trim().toLowerCase();
	if (!text) return undefined;

	const match = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/.exec(text);
	if (!match || (!match[1] && !match[2] && !match[3])) return undefined;
	const hours = match[1] ? Number(match[1]) : 0;
	const minutes = match[2] ? Number(match[2]) : 0;
	const seconds = match[3] ? Number(match[3]) : 0;
	if (hours === 0 && minutes === 0 && seconds === 0) return undefined;
	return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

/**
 * Format a duration for a human-readable status line.
 */
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "0s";
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * Parse one tier declaration.
 *
 * Accepts a plain command string (`"bun test fast"`) or an object with
 * `command`/`label`/`expectedDurationMs`/`datasetSize` fields.
 */
export function parseTier(value: unknown, kind: ValidationTierKind): ValidationTier | undefined {
	if (typeof value === "string") {
		const command = value.trim();
		if (!command) return undefined;
		return { kind, command };
	}
	const record = asRecord(value);
	if (!record) return undefined;
	const command = firstString(record, ["command", "cmd", "run"]);
	const label = firstString(record, ["label", "name", "description"]);
	const expectedDurationMs = firstNumber(record, ["expectedDurationMs", "expectedCostMs", "durationMs"])
		?? parseDurationMs(record.expectedDuration ?? record.expectedCost ?? record.duration);
	const datasetSize = firstNumber(record, ["datasetSize", "records", "rows"]);
	if (!command && !label && expectedDurationMs === undefined && datasetSize === undefined) {
		return undefined;
	}
	return { kind, command, label, expectedDurationMs, datasetSize };
}

/**
 * Read the validation plan of a todo.
 *
 * Returns `null` when the todo declares no plan: ordinary tasks must keep the
 * current behaviour.
 */
export function parseValidationPlan(item: TodoItem | null | undefined): ValidationPlan | null {
	const metadata = asRecord(item?.metadata);
	if (!metadata) return null;
	const raw = asRecord(metadata.validationPlan)
		?? asRecord(metadata.validation)
		?? asRecord(metadata.validation_plan);
	if (!raw) return null;

	const tiers = asRecord(raw.tiers);
	const plan: ValidationPlan = {};

	const fast = parseTier(raw.fast, "fast")
		?? parseTier(raw.fastCommand ?? raw.fastTier ?? tiers?.fast, "fast");
	const full = parseTier(raw.full, "full")
		?? parseTier(raw.fullCommand ?? raw.fullTier ?? tiers?.full, "full");
	if (fast) plan.fast = fast;
	if (full) plan.full = full;

	const notes = firstString(raw, ["notes", "note"]);
	if (notes) plan.notes = notes;

	const budgetMinutes = firstNumber(raw, ["budgetMinutes", "budgetMins", "timeBudgetMinutes"]);
	if (budgetMinutes !== undefined) plan.budgetMinutes = budgetMinutes;

	if (typeof raw.finalTierRequired === "boolean") plan.finalTierRequired = raw.finalTierRequired;

	if (!plan.fast && !plan.full && plan.notes === undefined && plan.budgetMinutes === undefined) {
		return null;
	}
	return plan;
}

/**
 * Describe one tier in a single line: command, expected cost, dataset size.
 */
export function describeTier(tier: ValidationTier): string {
	const what = tier.command ? `\`${tier.command}\`` : tier.label ?? "unspecified tier";
	const extras: string[] = [];
	if (tier.expectedDurationMs !== undefined) extras.push(`~${formatDuration(tier.expectedDurationMs)}`);
	if (tier.datasetSize !== undefined) extras.push(`${tier.datasetSize} records`);
	return extras.length > 0 ? `${what} (${extras.join(", ")})` : what;
}

/**
 * Status of the soft time budget of a plan.
 */
export interface ValidationBudgetStatus {
	/** The budget in milliseconds, when the plan declares one. */
	budgetMs?: number;
	/** Time already spent on the item, when it is known. */
	elapsedMs?: number;
	/** Time left before the budget is exhausted. */
	remainingMs?: number;
	/** True when the budget is spent. */
	exhausted: boolean;
}

/**
 * Compute the budget status of a plan.
 *
 * There is no implicit budget: only a declared `budgetMinutes` arms it. An
 * invented budget could pause legitimate long work, so the harness never
 * guesses one.
 */
export function validationBudgetStatus(
	plan: ValidationPlan | null | undefined,
	elapsedMs?: number,
): ValidationBudgetStatus {
	if (!plan || plan.budgetMinutes === undefined) {
		return { elapsedMs, exhausted: false };
	}
	const budgetMs = Math.max(0, plan.budgetMinutes * 60_000);
	const elapsed = elapsedMs ?? 0;
	const remainingMs = Math.max(0, budgetMs - elapsed);
	return {
		budgetMs,
		elapsedMs: elapsed,
		remainingMs,
		exhausted: elapsed >= budgetMs,
	};
}

/**
 * Aggregate recorded runs into the validation state of an item.
 *
 * The runs are expected in chronological order; the latest run of a tier
 * defines its state.
 */
export function summarizeValidationState(
	plan: ValidationPlan | null | undefined,
	runs: { ts: string; tier: ValidationTierKind; status: string }[],
): ValidationState {
	const notRun: ValidationTierState = { status: "not-run" };
	if (!plan) {
		return {
			hasPlan: false,
			fast: { ...notRun },
			full: { ...notRun },
			finalTierRequired: false,
			finalTierPending: false,
			planIncomplete: false,
		};
	}

	const stateOf = (tier: ValidationTierKind): ValidationTierState => {
		const matching = runs.filter((run) => run.tier === tier);
		if (matching.length === 0) return { ...notRun };
		// The ledger is append-only, so the array order is the chronological
		// order: with an equal timestamp the LATER run wins.
		const latest = matching.reduce((a, b) => (a.ts > b.ts ? a : b));
		const state: ValidationTierState = { status: latest.status as ValidationTierState["status"] };
		state.at = latest.ts;
		return state;
	};

	const finalTierRequired = plan.finalTierRequired === true;
	const planIncomplete = finalTierRequired && plan.full === undefined;
	const full = stateOf("full");

	const state: ValidationState = {
		hasPlan: true,
		fast: stateOf("fast"),
		full,
		finalTierRequired,
		finalTierPending: finalTierRequired && plan.full !== undefined && full.status !== "passed",
		planIncomplete,
	};
	if (plan.budgetMinutes !== undefined) state.budgetMinutes = plan.budgetMinutes;
	return state;
}

/**
 * Render the validation context that is injected into a continuation message.
 *
 * The text is deliberately short: it is added to the steer payload that the
 * agent reads when the harness continues a todo on its own.
 */
export function formatValidationContext(
	plan: ValidationPlan,
	opts: { elapsedMs?: number; state?: ValidationState } = {},
): string {
	const lines: string[] = [];
	const tiers: string[] = [];
	if (plan.fast) tiers.push(`fast=${describeTier(plan.fast)}`);
	if (plan.full) tiers.push(`full=${describeTier(plan.full)}`);

	if (tiers.length === 0 && plan.notes === undefined && plan.budgetMinutes === undefined) {
		return "";
	}

	lines.push(`VALIDATION PLAN (staged): ${tiers.join(" | ") || "no tiers declared"}`);

	if (plan.fast && plan.full) {
		lines.push(
			"Run the fast tier after every edit; run the full tier once when the implementation is stable. " +
				"Do not repeat the full tier after an edit that cannot affect the behavior it covers.",
		);
	}
	if (plan.finalTierRequired) {
		lines.push(
			"The full tier is the final acceptance check: do not complete this todo while it is pending or failed.",
		);
	}
	if (plan.budgetMinutes !== undefined) {
		const budgetMs = plan.budgetMinutes * 60_000;
		const elapsed = opts.elapsedMs;
		const elapsedPart = elapsed === undefined
			? ""
			: ` (elapsed ${formatDuration(elapsed)}, remaining ${formatDuration(Math.max(0, budgetMs - elapsed))})`;
		lines.push(
			`Time budget: ${plan.budgetMinutes}m${elapsedPart}. When the budget is reached: stop, report what passed ` +
				"and what is still pending, and do not mark the todo complete.",
		);
	}
	if (plan.notes) lines.push(`Notes: ${plan.notes}`);

	// The recorded runs tell the agent what already happened, so it neither
	// repeats a tier that passed nor forgets a pending final tier.
	const state = opts.state;
	if (state?.hasPlan) {
		if (state.fast.status !== "not-run") {
			lines.push(`Fast tier: ${state.fast.status}${state.fast.at ? ` (last run ${state.fast.at})` : ""}.`);
		}
		if (state.full.status !== "not-run") {
			lines.push(`Full tier: ${state.full.status}${state.full.at ? ` (last run ${state.full.at})` : ""}.`);
		}
		if (state.full.status === "passed") {
			lines.push(
				"The final tier already passed. Do not repeat it unless the next change can affect what it covers.",
			);
		}
		if (state.planIncomplete) {
			lines.push(
				"The plan requires a final tier but declares none: report that instead of completing the todo silently.",
			);
		}
	}

	return lines.join("\n");
}

/**
 * Convenience wrapper: the validation context of a todo, or an empty string.
 */
export function buildValidationSteerSuffix(
	item: TodoItem | null | undefined,
	opts: { elapsedMs?: number; state?: ValidationState } = {},
): string {
	const plan = parseValidationPlan(item);
	if (!plan) return "";
	return formatValidationContext(plan, opts);
}
