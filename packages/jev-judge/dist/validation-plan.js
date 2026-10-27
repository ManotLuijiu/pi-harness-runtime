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
import { assessWorkload, describeWorkload } from "./workload.js";
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    return value;
}
function firstString(source, keys) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === "string" && value.trim().length > 0)
            return value.trim();
    }
    return undefined;
}
function firstNumber(source, keys) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === "number" && Number.isFinite(value))
            return value;
    }
    return undefined;
}
/**
 * The first list of strings of the source.
 *
 * A single string is a list of one: a plan that names one criterion does
 * not have to wrap it in an array.
 */
function firstStringList(source, keys) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === "string" && value.trim().length > 0)
            return [value.trim()];
        if (Array.isArray(value)) {
            const list = value
                .filter((entry) => typeof entry === "string")
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0);
            if (list.length > 0)
                return list;
        }
    }
    return undefined;
}
/**
 * The tier this one scales up from.
 *
 * Only the known kinds are accepted: an unknown name is no gate at all,
 * so a typo never blocks a run.
 */
function firstTierKind(source, keys) {
    for (const key of keys) {
        const value = source[key];
        if (value === "fast" || value === "full")
            return value;
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
export function parseDurationMs(value) {
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            return undefined;
        return value >= 1000 ? value : Math.round(value * 1000);
    }
    if (typeof value !== "string")
        return undefined;
    const text = value.trim().toLowerCase();
    if (!text)
        return undefined;
    const match = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/.exec(text);
    if (!match || (!match[1] && !match[2] && !match[3]))
        return undefined;
    const hours = match[1] ? Number(match[1]) : 0;
    const minutes = match[2] ? Number(match[2]) : 0;
    const seconds = match[3] ? Number(match[3]) : 0;
    if (hours === 0 && minutes === 0 && seconds === 0)
        return undefined;
    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}
/**
 * Format a duration for a human-readable status line.
 */
export function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0)
        return "0s";
    const seconds = Math.round(ms / 1000);
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60)
        return `${minutes}m`;
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
export function parseTier(value, kind) {
    if (typeof value === "string") {
        const command = value.trim();
        if (!command)
            return undefined;
        return { kind, command };
    }
    const record = asRecord(value);
    if (!record)
        return undefined;
    const command = firstString(record, ["command", "cmd", "run"]);
    const label = firstString(record, ["label", "name", "description"]);
    const expectedDurationMs = firstNumber(record, ["expectedDurationMs", "expectedCostMs", "durationMs"])
        ?? parseDurationMs(record.expectedDuration ?? record.expectedCost ?? record.duration);
    const datasetSize = firstNumber(record, ["datasetSize", "records", "rows"]);
    const owner = firstString(record, ["owner", "responsible"]);
    const passCriteria = firstStringList(record, ["passCriteria", "criteria"]);
    const failureAction = firstString(record, ["failureAction", "onFailure"]);
    const representative = record.representative === true;
    const scaleUpFrom = firstTierKind(record, ["scaleUpFrom", "scalesUpFrom"]);
    if (!command &&
        !label &&
        expectedDurationMs === undefined &&
        datasetSize === undefined &&
        !owner &&
        !passCriteria &&
        !failureAction &&
        !representative &&
        !scaleUpFrom) {
        return undefined;
    }
    return {
        kind,
        command,
        label,
        expectedDurationMs,
        datasetSize,
        owner,
        passCriteria,
        failureAction,
        representative,
        scaleUpFrom,
    };
}
/**
 * Read the validation plan of a todo.
 *
 * Returns `null` when the todo declares no plan: ordinary tasks must keep the
 * current behaviour.
 */
export function parseValidationPlan(item) {
    const metadata = asRecord(item?.metadata);
    if (!metadata)
        return null;
    const raw = asRecord(metadata.validationPlan)
        ?? asRecord(metadata.validation)
        ?? asRecord(metadata.validation_plan);
    if (!raw)
        return null;
    const tiers = asRecord(raw.tiers);
    const plan = {};
    const fast = parseTier(raw.fast, "fast")
        ?? parseTier(raw.fastCommand ?? raw.fastTier ?? tiers?.fast, "fast");
    const full = parseTier(raw.full, "full")
        ?? parseTier(raw.fullCommand ?? raw.fullTier ?? tiers?.full, "full");
    if (fast)
        plan.fast = fast;
    if (full)
        plan.full = full;
    const notes = firstString(raw, ["notes", "note"]);
    if (notes)
        plan.notes = notes;
    const budgetMinutes = firstNumber(raw, ["budgetMinutes", "budgetMins", "timeBudgetMinutes"]);
    if (budgetMinutes !== undefined)
        plan.budgetMinutes = budgetMinutes;
    if (typeof raw.finalTierRequired === "boolean")
        plan.finalTierRequired = raw.finalTierRequired;
    if (!plan.fast && !plan.full && plan.notes === undefined && plan.budgetMinutes === undefined) {
        return null;
    }
    return plan;
}
/**
 * The workload of the job that a plan describes.
 *
 * The facts come from the plan itself: the dataset size of a tier is the
 * size of the job, and the expected duration of a tier is the declared
 * cost of it. A plan that declares a job of 10,000 records is a large
 * job, whether or not it uses the words.
 */
export function planWorkload(plan) {
    const tiers = [];
    for (const tier of [plan?.fast, plan?.full]) {
        if (!tier)
            continue;
        tiers.push({ datasetSize: tier.datasetSize, expectedDurationMs: tier.expectedDurationMs });
    }
    return assessWorkload({ tiers });
}
/**
 * Does the plan declare a measured pilot for its scale-up?
 *
 * A pilot is the fast tier, and the scale-up is the final tier that names
 * it with `scaleUpFrom: "fast"`. A fast tier alone is not the pilot of the
 * final tier, because nothing then says that the final tier waits for it.
 */
export function planHasPilot(plan) {
    if (!plan?.fast)
        return false;
    return plan.full?.scaleUpFrom === "fast";
}
/**
 * Describe one tier in a single line: command, expected cost, dataset size.
 */
export function describeTier(tier) {
    const what = tier.command ? `\`${tier.command}\`` : tier.label ?? "unspecified tier";
    const extras = [];
    if (tier.expectedDurationMs !== undefined)
        extras.push(`~${formatDuration(tier.expectedDurationMs)}`);
    if (tier.datasetSize !== undefined)
        extras.push(`${tier.datasetSize} records`);
    if (tier.representative)
        extras.push("representative pilot");
    if (tier.scaleUpFrom)
        extras.push(`scales up from ${tier.scaleUpFrom}`);
    return extras.length > 0 ? `${what} (${extras.join(", ")})` : what;
}
/**
 * Compute the budget status of a plan.
 *
 * There is no implicit budget: only a declared `budgetMinutes` arms it. An
 * invented budget could pause legitimate long work, so the harness never
 * guesses one.
 */
export function validationBudgetStatus(plan, elapsedMs) {
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
export function summarizeValidationState(plan, runs) {
    const notRun = { status: "not-run" };
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
    const stateOf = (tier) => {
        const matching = runs.filter((run) => run.tier === tier);
        if (matching.length === 0)
            return { ...notRun };
        // The ledger is append-only, so the array order is the chronological
        // order: with an equal timestamp the LATER run wins.
        const latest = matching.reduce((a, b) => (a.ts > b.ts ? a : b));
        const state = { status: latest.status };
        state.at = latest.ts;
        return state;
    };
    const finalTierRequired = plan.finalTierRequired === true;
    const workload = planWorkload(plan);
    const missingPilot = finalTierRequired && workload.isLarge && !planHasPilot(plan);
    const planIncompleteReasons = [];
    if (finalTierRequired && plan.full === undefined) {
        planIncompleteReasons.push("the plan requires a final tier but declares none");
    }
    if (missingPilot) {
        const size = workload.recordCount !== undefined ? `${workload.recordCount} record(s)` : "a large scope";
        planIncompleteReasons.push(plan.fast
            ? `the plan declares a large job (${size}) but the final tier does not name the pilot as its scale-up`
            : `the plan declares a large job (${size}) but declares no pilot tier`);
    }
    const planIncomplete = (finalTierRequired && plan.full === undefined) || missingPilot;
    const fast = stateOf("fast");
    let full = stateOf("full");
    // A scale-up that waits for its pilot only counts when the pilot
    // passed: a run of the expensive tier that started too early is not
    // the acceptance check of the task.
    if (plan.full?.scaleUpFrom === "fast" && fast.status !== "passed" && full.status !== "not-run") {
        full = { ...full, status: "not-run" };
    }
    const state = {
        hasPlan: true,
        fast,
        full,
        finalTierRequired,
        finalTierPending: finalTierRequired && plan.full !== undefined && full.status !== "passed",
        planIncomplete,
        missingPilot,
        workload,
    };
    if (planIncompleteReasons.length > 0)
        state.planIncompleteReasons = planIncompleteReasons;
    if (plan.budgetMinutes !== undefined)
        state.budgetMinutes = plan.budgetMinutes;
    return state;
}
/**
 * Render the validation context that is injected into a continuation message.
 *
 * The text is deliberately short: it is added to the steer payload that the
 * agent reads when the harness continues a todo on its own.
 */
export function formatValidationContext(plan, opts = {}) {
    const lines = [];
    const tiers = [];
    if (plan.fast)
        tiers.push(`fast=${describeTier(plan.fast)}`);
    if (plan.full)
        tiers.push(`full=${describeTier(plan.full)}`);
    if (tiers.length === 0 && plan.notes === undefined && plan.budgetMinutes === undefined) {
        return "";
    }
    lines.push(`VALIDATION PLAN (staged): ${tiers.join(" | ") || "no tiers declared"}`);
    if (plan.fast && plan.full) {
        lines.push("Run the fast tier after every edit; run the full tier once when the implementation is stable. " +
            "Do not repeat the full tier after an edit that cannot affect the behavior it covers.");
    }
    if (plan.finalTierRequired) {
        lines.push("The full tier is the final acceptance check: do not complete this todo while it is pending or failed.");
    }
    // A plan that starts with a representative pilot says so, and the
    // scale-up waits for it.
    if (plan.full?.scaleUpFrom === "fast" || plan.fast?.representative) {
        lines.push("The fast tier is the representative pilot: it keeps the shape of the data, not only its size. " +
            "The scale-up only counts when the pilot passed, so run the pilot first and record it.");
    }
    for (const tier of [plan.fast, plan.full]) {
        if (!tier)
            continue;
        if (tier.owner)
            lines.push(`The ${tier.kind} tier is owned by ${tier.owner}.`);
        if (tier.passCriteria && tier.passCriteria.length > 0) {
            lines.push(`Pass criteria of the ${tier.kind} tier: ${tier.passCriteria.join("; ")}.`);
        }
        if (tier.failureAction) {
            lines.push(`When the ${tier.kind} tier fails: ${tier.failureAction}.`);
        }
    }
    if (plan.budgetMinutes !== undefined) {
        const budgetMs = plan.budgetMinutes * 60_000;
        const elapsed = opts.elapsedMs;
        const elapsedPart = elapsed === undefined
            ? ""
            : ` (elapsed ${formatDuration(elapsed)}, remaining ${formatDuration(Math.max(0, budgetMs - elapsed))})`;
        lines.push(`Time budget: ${plan.budgetMinutes}m${elapsedPart}. When the budget is reached: stop, report what passed ` +
            "and what is still pending, and do not mark the todo complete.");
    }
    if (plan.notes)
        lines.push(`Notes: ${plan.notes}`);
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
            lines.push("The final tier already passed. Do not repeat it unless the next change can affect what it covers.");
        }
        if (state.planIncomplete) {
            const reasons = state.planIncompleteReasons && state.planIncompleteReasons.length > 0
                ? state.planIncompleteReasons.join("; ")
                : "the plan requires a final tier but declares none";
            lines.push(`The plan cannot be completed as it is: ${reasons}.`);
            if (state.missingPilot) {
                lines.push("A large job is accepted by the scale-up of a representative pilot: declare a fast tier with " +
                    '"representative": true and a final tier with "scaleUpFrom": "fast", then record the pilot.');
            }
        }
        if (state.workload && state.workload.size !== "unknown") {
            lines.push(`Workload: ${describeWorkload(state.workload)}.`);
        }
    }
    return lines.join("\n");
}
/**
 * Convenience wrapper: the validation context of a todo, or an empty string.
 */
export function buildValidationSteerSuffix(item, opts = {}) {
    const plan = parseValidationPlan(item);
    if (!plan)
        return "";
    return formatValidationContext(plan, opts);
}
//# sourceMappingURL=validation-plan.js.map