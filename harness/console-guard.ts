/**
 * Console guard - keep a TUI's terminal clean.
 *
 * A TUI owns the terminal: a stray `console.log` from a library lands in the
 * prompt input field ("[RelayClient] Connected ..."). While the TUI runs, the
 * harness redirects the console into its log file.
 *
 * The guard is deliberately dumb: it never writes to the terminal and a
 * failing sink can never break the caller.
 */

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export interface ConsoleGuardOptions {
	/** Receives every console call. Exceptions are swallowed. */
	sink: (level: ConsoleLevel, message: string) => void;
}

const LEVELS: ConsoleLevel[] = ["log", "info", "warn", "error", "debug"];

/** Flatten the console arguments into a single line. */
export function formatConsoleArgs(args: unknown[]): string {
	return args
		.map((arg) => {
			if (typeof arg === "string") return arg;
			// The stack matters: pi's fatal path prints the error object.
			if (arg instanceof Error) return arg.stack ?? arg.message;
			try {
				const json = JSON.stringify(arg);
				return json === undefined ? String(arg) : json;
			} catch {
				return String(arg);
			}
		})
		.join(" ");
}

/**
 * Replace the console methods with a sink.
 *
 * @returns a restore function that puts the original console back.
 */
export function installConsoleGuard(options: ConsoleGuardOptions): () => void {
	// SAFETY: the console methods are own, writable properties of the global
	// console object; TypeScript cannot express that index signature.
	const target = globalThis.console as unknown as Record<string, unknown>;
	const originals = new Map<string, unknown>();

	for (const level of LEVELS) {
		originals.set(level, target[level]);
		target[level] = (...args: unknown[]): void => {
			try {
				options.sink(level, formatConsoleArgs(args));
			} catch {
				// A failing sink must never break the caller.
			}
		};
	}

	return () => {
		for (const level of LEVELS) {
			// The presence test must not depend on the value: a level that was
			// absent before must be removed again.
			if (!originals.has(level)) continue;
			const original = originals.get(level);
			if (original === undefined) {
				delete target[level];
			} else {
				target[level] = original;
			}
		}
	};
}
