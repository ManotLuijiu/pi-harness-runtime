/**
 * Harness ASCII Banner — a Pi-compatible custom header.
 *
 * Uses Unicode block characters to create a compact 4×2 logo:
 * - `▀` (U+2580) fills the upper half of a terminal cell
 * - `▄` (U+2584) fills the lower half of a terminal cell
 * - Each cell uses a distinct foreground color to suggest depth
 *
 * The logo is NOT Pi's logo — it uses the same rendering primitives only.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
export interface HarnessHeaderOptions {
    version: string;
    productName?: string;
    onboardingText?: string;
}
export declare function createHarnessHeader(_tui: TUI, theme: Theme, options: HarnessHeaderOptions): HarnessHeaderComponent;
declare class HarnessHeaderComponent implements Component {
    private readonly theme;
    private readonly options;
    private expanded;
    constructor(theme: Theme, options: HarnessHeaderOptions);
    render(width: number): string[];
    private renderCompact;
    private renderExpanded;
    /**
     * Truncate a string to at most `maxWidth` visible characters.
     * ANSI escape sequences are excluded from the width count and preserved in the output.
     * If truncation occurs, a "…" (U+2026) is appended.
     */
    private truncate;
    invalidate(): void;
    setExpanded(expanded: boolean): void;
    dispose(): void;
}
/**
 * Compute the visible character count of a string, excluding ANSI escape sequences.
 * Uses `new RegExp()` to avoid Biome's no-control-characters-in-regex rule.
 */
export declare function visibleWidth(str: string): number;
/** Strip all ANSI escape sequences from a string. */
export declare function stripAnsi(str: string): string;
export {};
//# sourceMappingURL=harness-header.d.ts.map