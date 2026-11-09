/**
 * What Pi itself does with a failed turn.
 *
 * The installed core of Pi retries a failed turn internally before the
 * session settles. The extension API of Pi does not report that retry:
 * `auto_retry_start` and `auto_retry_end` are session events, and the
 * whitelist that forwards the events to the extensions does not name them
 * (see `harness/pi-retry-visibility.ts`).
 *
 * The harness therefore infers the retry from the facts it can observe:
 *
 * - the settings of Pi decide whether the retry exists at all, and how
 *   many attempts it may make,
 * - the kind of the failure decides whether the retry applies to it,
 * - every failed attempt of Pi produces another failed message in the
 *   same run, so the harness counts the attempts.
 *
 * The inference exists for one decision only: a retry delay that the user
 * cancelled (Escape) must not leave an automatic resume behind. The
 * harness cannot observe the cancellation directly, so it observes the
 * consequence: Pi announced a retry and made fewer attempts than its
 * budget allows.
 *
 * The budget is what makes the inference exact. Pi stops early only when
 * a delay is cancelled, and it makes at most `maxRetries` retries after
 * the first attempt. So a run with fewer attempts than the budget ends in
 * a cancellation, and a run with the whole budget ends in an exhausted
 * budget - and a budget of zero retries is no cancellation at all, it is
 * a run that settles right after the first failure.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The retry settings of Pi.
 *
 * The names and the defaults are the ones of the installed core
 * (`settings.retry`): the retry is on, it makes three attempts, and the
 * first delay is two seconds.
 */
export interface PiRetrySettings {
	/** Whether Pi retries a failed turn at all. */
	enabled: boolean;
	/** How many attempts Pi makes after the first one. */
	maxRetries: number;
	/** The delay of the first attempt, doubled for every attempt. */
	baseDelayMs: number;
}

/**
 * The defaults of the installed core.
 */
export const DEFAULT_PI_RETRY_SETTINGS: PiRetrySettings = {
	enabled: true,
	maxRetries: 3,
	baseDelayMs: 2000,
};

/**
 * The kinds of failure that Pi retries itself.
 *
 * The transient patterns of the core name a rate limit, an overload, a
 * server error, and a transport failure. An exhausted plan and a
 * credential failure are not among them: the core gives up on them at
 * once, so there is no retry delay that a user could cancel.
 */
export function piRetriesFailure(kind: string): boolean {
	return kind === "rate-limit" || kind === "overload";
}

/**
 * Whether Pi would retry this failure.
 *
 * A failure that Pi does not retry has no retry delay, so a cancellation
 * of that delay is impossible and the harness must not read one into it.
 */
export function expectsPiRetry(
	failure: { kind: string },
	settings: PiRetrySettings,
): boolean {
	return settings.enabled && piRetriesFailure(failure.kind);
}

/**
 * The number of attempts Pi may make, including the first one.
 *
 * Pi makes the first attempt and then, at most, `maxRetries` retries. A
 * budget of zero retries is one attempt: the run settles right after the
 * first failure.
 */
export function piAttemptBudget(settings: PiRetrySettings): number {
	return settings.maxRetries + 1;
}

/**
 * What the attempts of the run say about the retry of Pi.
 *
 * - `not-retried`: Pi does not retry this failure. There is no delay that
 *   a user could cancel, so the harness recovers.
 * - `budget-spent`: Pi made every attempt its budget allows. The run
 *   settled because the budget was spent, so the harness recovers.
 * - `cancelled`: Pi would retry but made fewer attempts than its budget.
 *   Pi stops early only when the delay is cancelled, so the user decided
 *   that, and the harness does not recover.
 */
export type PiRetryOutcome = "not-retried" | "budget-spent" | "cancelled";

/**
 * The verdict about the retry of Pi, from the attempts of the run.
 *
 * @param failure The failure that Pi saw
 * @param settings The retry settings of Pi
 * @param attempts The failed attempts of the run
 */
export function piRetryOutcome(
	failure: { kind: string },
	settings: PiRetrySettings,
	attempts: number,
): PiRetryOutcome {
	if (!expectsPiRetry(failure, settings)) {
		return "not-retried";
	}
	if (attempts >= piAttemptBudget(settings)) {
		return "budget-spent";
	}
	return "cancelled";
}

/**
 * Read the retry settings of the installed Pi.
 *
 * The settings of Pi live in the settings of the agent (`settings.json`)
 * and in the settings of the project (`<cwd>/.pi/settings.json`). The
 * project overrides the agent. A file that is missing or unreadable
 * leaves the default of the core in place: the retry of Pi is on unless
 * the user turns it off.
 */
export function readPiRetrySettings(options?: {
	cwd?: string;
	agentDir?: string;
	readFile?: (path: string) => string | undefined;
}): PiRetrySettings {
	const read =
		options?.readFile ??
		((path: string): string | undefined => {
			try {
				if (!existsSync(path)) return undefined;
				return readFileSync(path, "utf8");
			} catch {
				return undefined;
			}
		});

	const home = process.env.HOME || process.env.USERPROFILE || homedir();
	// The core of Pi reads the agent directory from this variable, so the
	// harness reads the same settings file as the core.
	const agentDir =
		options?.agentDir ??
		process.env.PI_CODING_AGENT_DIR ??
		join(home, ".pi", "agent");
	const cwd = options?.cwd ?? process.cwd();

	const global = readSettings(read(join(agentDir, "settings.json")));
	const project = readSettings(read(join(cwd, ".pi", "settings.json")));

	return {
		enabled: project?.retry?.enabled ?? global?.retry?.enabled ?? DEFAULT_PI_RETRY_SETTINGS.enabled,
		maxRetries:
			project?.retry?.maxRetries ?? global?.retry?.maxRetries ?? DEFAULT_PI_RETRY_SETTINGS.maxRetries,
		baseDelayMs:
			project?.retry?.baseDelayMs ??
			global?.retry?.baseDelayMs ??
			DEFAULT_PI_RETRY_SETTINGS.baseDelayMs,
	};
}

interface RetrySettingsFile {
	retry?: {
		enabled?: boolean;
		maxRetries?: number;
		baseDelayMs?: number;
	};
}

/**
 * Read the retry part of a settings file. A broken file is no file.
 */
function readSettings(text: string | undefined): RetrySettingsFile | undefined {
	if (!text) return undefined;
	try {
		const parsed = JSON.parse(text) as RetrySettingsFile;
		return parsed && typeof parsed === "object" ? parsed : undefined;
	} catch {
		return undefined;
	}
}
