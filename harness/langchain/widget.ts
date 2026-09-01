/**
 * LoopWidget — harness progress display for the pi host status line.
 *
 * Architecture mirrors pi-lens's `clients/widget-state.ts` + `renderWidget()`:
 * - State store: per-file step counts, iteration, phase
 * - Render function: builds the `!NW ●ME` style summary line
 * - Pi host integration: wired via ExtensionUIContext.setWidget() when available
 *
 * The widget is designed as a dependency injected into LoopDaemon/LoopRuntime,
 * so it works in two modes:
 * 1. Standalone (console): logs human-readable progress to stderr
 * 2. Pi host: calls ui.setWidget("harness-loop", renderFn) for TUI display
 *
 * Wiki: wiki/multi-agent-langchain.md
 */

import type { TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

/** Valid theme color keys passed to `theme.fg()`.*/
type ColorKey = "dim" | "error" | "warning" | "success" | "accent";

/**
 * Count visible terminal columns. ANSI CSI sequences (\x1b[...m) contribute 0 width.
 * Terminal wide chars (emoji, CJK) contribute 2 columns.
 */
function visibleWidth(s: string): number {
	let w = 0;
	let i = 0;
	while (i < s.length) {
		const cp = s.codePointAt(i)!;
		if (cp === 0x1b) {
			// Skip CSI sequences: \x1b[ <params> <final>
			// Valid final bytes: m (SGR), H (CUP), J (ED), A/B/C/D (CUU/CUD/CUF/CUB)
			i++;
		while (i < s.length && !/[a-zA-Z@]/.test(s[i])) i++;
			if (i < s.length) i++; // skip final byte
			continue;
		}
		if (cp <= 0x1f || cp === 0x7f) { i++; continue; } // C0 + DEL = 0
		w += cp > 0xffff ? 2 : 1;
		i += cp > 0xffff ? 2 : 1; // advance by code point, not UTF-16 code unit
	}
	return w;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type LoopPhase =
	| "idle"
	| "planning"
	| "writing"
	| "reviewing"
	| "fixing"
	| "approving"
	| "blocked"
	| "surge-pause"
	| "complete"
	| "error";

export interface LoopWidgetOptions {
	/** Called with the rendered lines each time the widget updates. */
	onRender?: (lines: string[]) => void;
}

/** Shaped like the pi-lens FileRecord tier system. */
interface FileStepRecord {
	filePath: string;
	/** Write steps touching this file in current iteration. */
	writeSteps: number;
	/** Review cycles passed (no blocking issues). */
	reviewsPassed: number;
	/** Blocking issues found by reviewer. */
	blockers: number;
	lastPhase: LoopPhase;
	touchedAt: number;
}

// ─── Widget State ─────────────────────────────────────────────────────────────

export class LoopWidget {
	private files = new Map<string, FileStepRecord>();
	private phase: LoopPhase = "idle";
	private iteration = 0;
	private maxIterations: number;
	private stepLabel: string = "";
	private errors = 0;
	private warnings = 0;
	private readonly onRender?: (lines: string[]) => void;

	constructor(options: LoopWidgetOptions = {}) {
		this.maxIterations = 10;
		this.onRender = options.onRender;
	}

	// ─── Mutation API ───────────────────────────────────────────────────────────

	/** Called when the loop starts a new iteration. */
	startIteration(iter: number, max: number): void {
		this.iteration = iter;
		this.maxIterations = max;
		// Clear per-iteration counts; keep file records for history
		for (const rec of this.files.values()) {
			rec.writeSteps = 0;
			rec.reviewsPassed = 0;
			rec.blockers = 0;
		}
		this.errors = 0;
		this.warnings = 0;
		this.render();
	}

	/** Called when the loop transitions to a new phase. */
	setPhase(phase: LoopPhase, label?: string): void {
		this.phase = phase;
		this.stepLabel = label ?? this.phaseLabel(phase);
		this.render();
	}

	/** Called when the coder writes to a file. */
	recordWrite(filePath: string): void {
		const rec = this.getOrCreate(filePath);
		rec.writeSteps++;
		rec.lastPhase = "writing";
		rec.touchedAt = Date.now();
		this.render();
	}

	/** Called when the reviewer reports blockers for a file. */
	recordBlockers(filePath: string, count: number): void {
		const rec = this.getOrCreate(filePath);
		rec.blockers = count;
		rec.lastPhase = count > 0 ? "blocked" : "reviewing";
		rec.touchedAt = Date.now();
		if (count > 0) {
			this.errors += count;
		}
		this.render();
	}

	/** Called when the reviewer passes a file (no blockers). */
	recordReviewPass(filePath: string): void {
		const rec = this.getOrCreate(filePath);
		rec.reviewsPassed++;
		rec.blockers = 0;
		rec.lastPhase = "reviewing";
		rec.touchedAt = Date.now();
		this.render();
	}

	/** Called on surge-pause / quota-wait events. */
	setSurgePause(resetAt?: Date): void {
		this.phase = "surge-pause";
		this.stepLabel = resetAt
			? `surge (${this.formatResetTime(resetAt)})`
			: "surge pause";
		this.render();
	}

	/** Called on unrecoverable error. */
	setError(message: string): void {
		this.phase = "error";
		this.stepLabel = `error: ${message}`;
		this.render();
	}

	/** Called when the loop completes with a verdict. */
	setComplete(verdict: "approved" | "rejected" | "max_iterations"): void {
		this.phase = "complete";
		const labels = {
			approved: "✓ loop complete",
			rejected: "✗ loop rejected",
			"max_iterations": `⚠ max iterations (${this.maxIterations})`,
		};
		this.stepLabel = labels[verdict];
		this.render();
	}

	/** Reset to idle state. */
	reset(): void {
		this.phase = "idle";
		this.iteration = 0;
		this.errors = 0;
		this.warnings = 0;
		this.stepLabel = "";
		this.files.clear();
		this.render();
	}

	// ─── Render (pi host + standalone) ────────────────────────────────────────

	/**
	 * Build widget lines for the pi host's `setWidget()` renderer.
	 *
	 * Returns 0-3 lines:
	 * Line 1: `harness  [iter 2/5]  ✍ coder  !2W`   — header + summary
	 * Line 2: `  surge pause — resets 19:17`           — surge detail (when applicable)
	 * Line 3: `  ●surge.ts  ✍2  🔍3  !1`             — file rows (up to 5)
	 */
	renderWidget(width: number, theme: { fg: (color: ColorKey, s: string) => string }): string[] {
		const dim = (s: string) => theme.fg("dim", s);
		const red = (s: string) => theme.fg("error", s);
		const yellow = (s: string) => theme.fg("warning", s);
		const green = (s: string) => theme.fg("success", s);
		const cyan = (s: string) => theme.fg("accent", s);
		const w = Math.max(1, width || 80);

		const lines: string[] = [];

		// ── Header ──────────────────────────────────────────────────────────────
		const iterStr = this.iteration > 0
			? dim(`iter ${this.iteration}/${this.maxIterations}`)
			: "";
		// Use stepLabel if set (custom phase label, surge detail, error message)
	const phaseStr = this.stepLabel
		? this.phaseIcon(this.phase) + " " + this.stepLabel
		: this.phaseIcon(this.phase) + " " + this.phaseLabel(this.phase);

		// Summary chunks (matches pi-lens style: !NW ●ME)
		const errorChunk = this.errors > 0
			? red(`●${this.errors}E`)
			: "";
		const warningChunk = this.warnings > 0
			? yellow(`!${this.warnings}W`)
			: "";
		const summary = errorChunk
			? errorChunk + (warningChunk ? " " + warningChunk : "")
			: warningChunk
				? warningChunk
				: this.phase === "idle" || this.phase === "complete"
					? green("✓")
					: dim("…");

		const parts = [
			cyan("harness"),
			iterStr,
			phaseStr,
			summary,
		].filter(Boolean).join("  ");

		lines.push(this.fitLine(` ${parts}`, w));

		// ── Surge detail ───────────────────────────────────────────────────────
		if (this.phase === "surge-pause" && this.stepLabel) {
			lines.push(this.fitLine(`  ${yellow("▸")} ${dim(this.stepLabel)}`, w));
		}

		// ── Error detail ───────────────────────────────────────────────────────
		if (this.phase === "error" && this.stepLabel) {
			lines.push(this.fitLine(`  ${red("✗")} ${this.stepLabel}`, w));
		}

		// ── File rows ─────────────────────────────────────────────────────────
		const sorted = this.fileRecords()
			.sort((a, b) => b.touchedAt - a.touchedAt)
			.slice(0, 5);

		for (const rec of sorted) {
			const tier = this.classifyFileTier(rec);
			const dot = tier === "blocking"
				? red("●")
				: tier === "warning"
					? yellow("!")
					: dim("·");
			const base = this.fileBasename(rec.filePath);
			const steps = rec.writeSteps > 0 ? dim(` ✍${rec.writeSteps}`) : "";
			const reviews = rec.reviewsPassed > 0 ? dim(` 🔍${rec.reviewsPassed}`) : "";
			const blockers = rec.blockers > 0 ? red(` !${rec.blockers}`) : "";
			const line = ` ${dot} ${base}${steps}${reviews}${blockers}`;
			lines.push(this.fitLine(line, w));
		}

		return lines;
	}

	/** Console fallback (standalone mode). */
	toConsoleString(): string {
		const phase = this.phaseIcon(this.phase) + " " + this.stepLabel;
		const iter = this.iteration > 0 ? ` [iter ${this.iteration}/${this.maxIterations}]` : "";
		const err = this.errors > 0 ? ` ●${this.errors}E` : "";
		const warn = this.warnings > 0 ? ` !${this.warnings}W` : "";
		const files = [...this.files.values()]
			.filter(r => r.writeSteps > 0 || r.blockers > 0)
			.sort((a, b) => b.touchedAt - a.touchedAt)
			.slice(0, 3)
			.map(r => `${this.fileBasename(r.filePath)}(${r.writeSteps}w/${r.blockers}b)`)
			.join(", ");

		const parts = [
			`harness${iter}`,
			phase,
		].filter(Boolean).join("  ");

		return [
			parts + err + warn,
			files ? `  files: ${files}` : "",
		].filter(Boolean).join("\n");
	}

	// ─── Pi host widget factory (used by index.ts / ExtensionUIContext) ────────

	/**
	 * Returns a pi-tui Component factory for use with `ui.setWidget("harness-loop", factory)`.
	 * The caller (pi host integration) owns the `setWidget` call — this factory is just
	 * the render function.
	 *
	 * Usage in pi host:
	 * ```
	 * setWidget("harness-loop", makeWidgetRenderer(widget, theme), { placement: "belowEditor" });
	 * ```
	 */
	/**
	 * Returns a factory suitable for `ui.setWidget("harness-loop", factory)` in the
	 * pi host. The factory's `render(width)` is called by the pi-tui render loop
	 * on every frame; `invalidate` is called by the harness to trigger a re-render.
	 */
	makeRenderer(): {
		factory: (tui: TUI, theme: Theme) => {
			render: (width: number) => string[];
			invalidate: () => void;
			dispose: () => void;
		};
		invalidate: () => void;
	} {
		// Shared invalidate trigger — both the harness and the pi-tui component call this
		const invalidate = () => { /* mark dirty for next frame */ };

		const factory = (_tui: TUI, theme: Theme) => {
			type ColorKey = "dim" | "error" | "warning" | "success" | "accent";
			const fg = (color: ColorKey, s: string): string => theme.fg(color, s);

			const render = (width: number): string[] => {
				return this.renderWidget(width, { fg });
			};

			// Called by harness to signal the widget needs to re-render
			const widgetInvalidate = () => { /* trigger invalidate */ };

			return {
				render,
				invalidate: widgetInvalidate,
				dispose: () => { /* clean up */ },
			};
		};

		return { factory, invalidate };
	}

	// ─── Internals ─────────────────────────────────────────────────────────────

	private getOrCreate(filePath: string): FileStepRecord {
		if (!this.files.has(filePath)) {
			this.files.set(filePath, {
				filePath,
				writeSteps: 0,
				reviewsPassed: 0,
				blockers: 0,
				lastPhase: "idle",
				touchedAt: Date.now(),
			});
		}
		return this.files.get(filePath)!;
	}

	private fileRecords(): FileStepRecord[] {
		return [...this.files.values()];
	}

	private fileBasename(filePath: string): string {
		const segs = filePath.replace(/\\/g, "/").split("/");
		return segs[segs.length - 1] ?? filePath;
	}

	private classifyFileTier(rec: FileStepRecord): "blocking" | "warning" | "clean" {
		if (rec.blockers > 0) return "blocking";
		if (rec.writeSteps > 0 || rec.reviewsPassed > 0) return "warning";
		return "clean";
	}

	private phaseLabel(phase: LoopPhase): string {
		const labels: Record<LoopPhase, string> = {
			idle: "idle",
			planning: "planning",
			writing: "coding",
			reviewing: "reviewing",
			fixing: "fixing",
			approving: "approving",
			blocked: "blocked",
			"surge-pause": "surge",
			complete: "complete",
			error: "error",
		};
		return labels[phase];
	}

	private phaseIcon(phase: LoopPhase): string {
		const icons: Record<LoopPhase, string> = {
			idle: "○",
			planning: "🧭",
			writing: "✍",
			reviewing: "🔍",
			fixing: "🔧",
			approving: "✅",
			blocked: "⛔",
			"surge-pause": "⏸",
			complete: "✓",
			error: "✗",
		};
		return icons[phase];
	}

	private formatResetTime(date: Date): string {
		const now = new Date();
		const diff = date.getTime() - now.getTime();
		if (diff <= 0) return "now";
		const mins = Math.ceil(diff / 60_000);
		if (mins < 60) return `in ${mins}m`;
		const hrs = Math.floor(mins / 60);
		const rem = mins % 60;
		return rem > 0 ? `in ${hrs}h ${rem}m` : `in ${hrs}h`;
	}

	/**
	 * Truncate `line` to `width` visible columns.
	 * Uses `visibleWidth` (not raw char count) so ANSI codes don't cause
	 * false wrapping — matching how the terminal measures columns.
	 */
	private fitLine(line: string, width: number): string {
		if (visibleWidth(line) <= width) return line;
		// Walk forward, stopping when adding the next character would exceed width
		let w = 0;
		let cut = 0;
		for (let i = 0; i < line.length; i++) {
			const cp = line.codePointAt(i)!;
			if (cp === 0x1b) {
				// Skip ANSI sequences (don't count toward width)
				while (i < line.length && line[i] !== "m" && line[i] !== "H" && line[i] !== "J") i++;
				continue;
			}
			const charW = cp > 0xffff ? 2 : 1;
			if (w + charW > width - 1) break; // need room for the ellipsis
			w += charW;
			cut = i + (cp > 0xffff ? 2 : 1);
		}
		return line.slice(0, cut) + "…";
	}

	private render(): void {
		const console = this.toConsoleString();
		this.onRender?.(console.split("\n"));
	}
}

// ─── Singleton factory ───────────────────────────────────────────────────────

let _instance: LoopWidget | undefined;

export function getLoopWidget(): LoopWidget {
	if (!_instance) {
		_instance = new LoopWidget();
	}
	return _instance;
}
