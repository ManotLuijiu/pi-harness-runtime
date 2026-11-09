/**
 * The watcher of the tools of the Honcho MCP server.
 *
 * A connector connects the registered servers asynchronously, so the tools
 * of the server are not there when the registration returns. The watcher
 * looks for them and reports what it sees.
 *
 * Two facts shape the watcher:
 *
 * - A connector that never connects must not hold the session. The wait is
 *   bounded, and the report at the deadline says what is known then.
 * - A connector that is slow is not a connector that failed. The watcher
 *   keeps looking after the deadline, with a slower rhythm, and corrects
 *   the row when the tools finally appear. The row is replaced, not added,
 *   so the startup shows one truth about Honcho and not two.
 */
import type { HarnessStatus } from "../harness-startup-status.ts";

/** The state of the Honcho MCP server in the session. */
export type HonchoMcpState = "not_registered" | "registered" | "connected";

/** The report of the state of the server. */
export interface HonchoMcpWatcherReport {
	/** The short text of the report. */
	text: string;
	/** The severity of the report. */
	status: "ok" | "warn";
	/** The lines that explain the report. */
	details: string[];
}

/** The dependencies of the watcher. */
export interface HonchoMcpWatcherOptions {
	/** The state of the server, read from the session. */
	readState: () => HonchoMcpState;
	/** The reason a connection failed, when the connector knows one. */
	readFailureReason: () => string | undefined;
	/** The report of a state, from the Honcho module. */
	report: (state: HonchoMcpState, reason?: string) => HonchoMcpWatcherReport;
	/** The log of the startup. */
	log: (message: string) => void;
	/** The row of the startup. The label replaces an earlier row. */
	setRow: (
		label: string,
		text: string,
		status: HarnessStatus,
		details?: string[],
	) => void;
	/** The clock of the watcher. */
	now: () => number;
	/** The timer of the watcher. */
	setTimeout: (callback: () => void, ms: number) => unknown;
	/** The canceller of the timer. */
	clearTimeout: (handle: unknown) => void;
	/** The label of the row of Honcho in the startup. */
	label?: string;
	/** The wait before the report of a failure. */
	waitMs?: number;
	/** The interval between two checks. */
	intervalMs?: number;
	/** The interval between two checks after the deadline. */
	lateIntervalMs?: number;
}

/** The label of the row of Honcho in the startup. */
const DEFAULT_LABEL = "Honcho";

/** The wait before the report of a failure. */
const DEFAULT_WAIT_MS = 15_000;

/** The interval between two checks. */
const DEFAULT_INTERVAL_MS = 500;

/** The interval between two checks after the deadline. */
const DEFAULT_LATE_INTERVAL_MS = 5_000;

/**
 * Watch the tools of the Honcho MCP server and report what happens.
 *
 * The returned function stops the watcher. A watcher of a session that is
 * gone must not keep a timer alive.
 */
export function watchHonchoMcpTools(
	options: HonchoMcpWatcherOptions,
): () => void {
	const label = options.label ?? DEFAULT_LABEL;
	const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
	const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
	const lateIntervalMs = options.lateIntervalMs ?? DEFAULT_LATE_INTERVAL_MS;
	const deadline = options.now() + waitMs;
	let timer: unknown;
	let stopped = false;
	// The failure was already reported. The watcher keeps looking after the
	// deadline, because a connector that is slow is not a connector that
	// failed: the row is corrected when the tools finally appear.
	let reported = false;

	const check = (): void => {
		if (stopped) return;
		const state = options.readState();
		if (state === "connected") {
			options.log("[pi-harness] Honcho: native MCP server connected");
			// The correction comes from the same report as the startup, so
			// the two rows cannot drift apart.
			const report = options.report(state);
			options.setRow(label, report.text, report.status, report.details);
			return;
		}
		if (options.now() >= deadline && !reported) {
			reported = true;
			// The fallback connector knows why the connection failed, and
			// the reason is more useful than "nobody connected it".
			const reason = options.readFailureReason();
			options.log(
				`[pi-harness] Honcho: no connector connected the MCP server (the model sees no Honcho tools)${reason ? `: ${reason}` : ""}`,
			);
			if (reason) {
				const report = options.report("registered", reason);
				options.setRow(label, report.text, report.status, report.details);
			}
		}
		const next = options.setTimeout(
			check,
			reported ? lateIntervalMs : intervalMs,
		);
		timer = next;
	};

	timer = options.setTimeout(check, intervalMs);
	return () => {
		stopped = true;
		if (timer !== undefined) {
			options.clearTimeout(timer);
			timer = undefined;
		}
	};
}
