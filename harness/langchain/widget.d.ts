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
export type LoopPhase = "idle" | "planning" | "writing" | "reviewing" | "fixing" | "approving" | "blocked" | "surge-pause" | "complete" | "error";
export interface LoopWidgetOptions {
    /** Called with the rendered lines each time the widget updates. */
    onRender?: (lines: string[]) => void;
}
export declare class LoopWidget {
    private files;
    private phase;
    private iteration;
    private maxIterations;
    private stepLabel;
    private errors;
    private warnings;
    private readonly onRender?;
    constructor(options?: LoopWidgetOptions);
    /** Called when the loop starts a new iteration. */
    startIteration(iter: number, max: number): void;
    /** Called when the loop transitions to a new phase. */
    setPhase(phase: LoopPhase, label?: string): void;
    /** Called when the coder writes to a file. */
    recordWrite(filePath: string): void;
    /** Called when the reviewer reports blockers for a file. */
    recordBlockers(filePath: string, count: number): void;
    /** Called when the reviewer passes a file (no blockers). */
    recordReviewPass(filePath: string): void;
    /** Called on surge-pause / quota-wait events. */
    setSurgePause(resetAt?: Date): void;
    /** Called on unrecoverable error. */
    setError(message: string): void;
    /** Called when the loop completes with a verdict. */
    setComplete(verdict: "approved" | "rejected" | "max_iterations"): void;
    /** Reset to idle state. */
    reset(): void;
    /**
     * Build widget lines for the pi host's `setWidget()` renderer.
     *
     * Returns 0-3 lines:
     * Line 1: `harness  [iter 2/5]  ✍ coder  !2W`   — header + summary
     * Line 2: `  surge pause — resets 19:17`           — surge detail (when applicable)
     * Line 3: `  ●surge.ts  ✍2  🔍3  !1`             — file rows (up to 5)
     */
    renderWidget(width: number, theme: {
        fg: (color: ColorKey, s: string) => string;
    }): string[];
    /** Console fallback (standalone mode). */
    toConsoleString(): string;
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
    };
    private getOrCreate;
    private fileRecords;
    private fileBasename;
    private classifyFileTier;
    private phaseLabel;
    private phaseIcon;
    private formatResetTime;
    /**
     * Truncate `line` to `width` visible columns.
     * Uses `visibleWidth` (not raw char count) so ANSI codes don't cause
     * false wrapping — matching how the terminal measures columns.
     */
    private fitLine;
    private render;
}
export declare function getLoopWidget(): LoopWidget;
//# sourceMappingURL=widget.d.ts.map