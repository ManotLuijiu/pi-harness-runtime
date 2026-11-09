/**
 * The visibility of the automatic retries of the core of Pi.
 *
 * The core of Pi declares the events of its own retry of a provider
 * (`auto_retry_start` and `auto_retry_end`) and the interactive mode
 * consumes them. The extension API of the core does not expose them, and
 * the extension context has no handle of the agent session, so an
 * extension cannot subscribe to them.
 *
 * The consequence is narrow and honest: the harness does not observe the
 * countdown of the internal retry of Pi. Its own bounded recovery is
 * *additional* to that retry, never a replacement for it.
 *
 * Two signals of the installed core do report the cancellation of the
 * user, and the harness uses them: the abort signal of the run
 * (`ctx.signal`) and the stop reason of an aborted turn
 * (`stopReason === "aborted"`). The delay of the retry of Pi produces
 * neither of them, so the harness infers that delay from the settings of
 * Pi, from the kind of the failure, and from the attempts that Pi made
 * (see `harness/pi-retry-policy.ts`).
 *
 * This module reads the declarations of the installed core, so the finding
 * stays a checked fact instead of a belief. A newer core that exposes the
 * events changes the verdict, and the harness can wire the bridge.
 */
import { readFileSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * The events of the core of Pi that describe an automatic retry.
 */
export const CORE_RETRY_EVENTS = [
	"auto_retry_start",
	"auto_retry_end",
] as const;

/**
 * What the installed core allows an extension to see.
 */
export type RetryVisibilityVerdict =
	/** The extension API of the core exposes the retry events. */
	| "exposed"
	/** The core declares the events, but the extension API hides them. */
	| "not-exposed"
	/** The declarations of the core could not be read. */
	| "unknown";

/**
 * The verdict about the internal retries of the core of Pi.
 */
export interface RetryVisibility {
	/** The verdict. */
	verdict: RetryVisibilityVerdict;
	/** The events that the extension API does not expose. */
	hidden: string[];
	/** The reason of the verdict, in one sentence. */
	reason: string;
}

/**
 * Inspect the declarations of the extension API of the core of Pi.
 *
 * The declarations are the source of truth: the runtime of the extension
 * cannot tell which events the API accepts.
 */
export function inspectRetryVisibility(
	extensionTypesSource: string | undefined,
): RetryVisibility {
	if (
		typeof extensionTypesSource !== "string" ||
		extensionTypesSource.length === 0
	) {
		return {
			verdict: "unknown",
			hidden: [],
			reason:
				"the declarations of the extension API of the core could not be read",
		};
	}

	const hidden = CORE_RETRY_EVENTS.filter(
		(event) => !extensionTypesSource.includes(`on(event: "${event}"`),
	);

	if (hidden.length === 0) {
		return {
			verdict: "exposed",
			hidden: [],
			reason: "the extension API of the core exposes the retry events",
		};
	}

	return {
		verdict: "not-exposed",
		hidden: [...hidden],
		reason:
			"the extension API of the core does not expose the retry events, so the countdown of the internal retry is not visible to an extension",
	};
}

/**
 * The path of the declarations of the extension API of the installed core.
 *
 * The core is loaded by the process that runs the extension, so its entry
 * point is in the arguments of the process.
 */
export function resolveExtensionTypesPath(
	argv: string[] = process.argv,
): string | undefined {
	for (const value of argv) {
		const marker = `${sep}pi-coding-agent${sep}`;
		const index = value.indexOf(marker);
		if (index === -1) continue;
		const root = value.slice(0, index + marker.length - 1);
		return join(root, "dist", "core", "extensions", "types.d.ts");
	}
	return undefined;
}

/**
 * Read the declarations of the extension API of the installed core.
 *
 * A core that cannot be found is not a failure: the verdict is then
 * "unknown", and the harness says so.
 */
export function readInstalledExtensionTypes(): string | undefined {
	const path = resolveExtensionTypesPath();
	if (!path) return undefined;
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

/**
 * The visibility of the internal retries of the installed core.
 */
export function installedRetryVisibility(): RetryVisibility {
	return inspectRetryVisibility(readInstalledExtensionTypes());
}
