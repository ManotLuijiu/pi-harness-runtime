/**
 * Harness custom footer — Pi footer information plus dedicated harness rows.
 *
 * Why a custom footer component is required:
 *
 * Pi's built-in footer renders EVERY `ctx.ui.setStatus()` value on ONE shared
 * line (all keys are joined with a space and the result is truncated to the
 * terminal width). Separate status keys therefore do NOT create separate rows:
 * the harness publishes its quota under `harness-runtime` and the workspace
 * environment under `harness-workspace`, so both ended up appended to the same
 * line, and a narrow terminal truncated the workspace summary away.
 *
 * This component mirrors Pi's built-in footer layout (working directory and
 * branch, token/cost/context stats, model and thinking state, other
 * extensions' status values) and then renders each harness-owned status on its
 * OWN row, so the quota keeps a dedicated row and the workspace summary can
 * never be hidden by the quota text.
 *
 * Reference for the replicated layout: pi-coding-agent 1.3.0
 * `dist/modes/interactive/components/footer.js`.
 */
import type { ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
/** Status key that carries the harness quota summary. */
export declare const HARNESS_QUOTA_STATUS_KEY = "harness-runtime";
/** Status key that carries the workspace environment summary. */
export declare const HARNESS_WORKSPACE_STATUS_KEY = "harness-workspace";
/** Status key that carries the auto-continue state. */
export declare const HARNESS_AUTO_CONTINUE_STATUS_KEY = "harness-auto-continue";
export interface HarnessFooterOptions {
    /** Status key holding the quota summary (own row). */
    quotaStatusKey?: string;
    /** Status key holding the workspace environment summary (own row). */
    workspaceStatusKey?: string;
    /** Status key holding the auto-continue state (own row). */
    autoContinueStatusKey?: string;
    /**
     * Supplies the live extension context. May throw when the session was
     * replaced — the footer degrades to status-only rows in that case.
     */
    getContext?: () => ExtensionContext | null;
    /**
     * Whether the session auto-compacts. Pi's footer only appends " (auto)" to
     * the context indicator when auto-compaction is enabled.
     *
     * NOTE: Pi's ExtensionContext does not expose the session's auto-compact
     * setting, so the harness cannot read it. The default matches Pi's own
     * default (`autoCompactEnabled = true` in Pi's footer component); a caller
     * that knows the real setting can override it.
     */
    autoCompactEnabled?: boolean;
}
export interface FooterUsageTotals {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
}
export interface FooterSessionInfo {
    cwd: string;
    branch: string | null;
    sessionName: string | null;
    modelId: string;
    modelProvider: string;
    modelSupportsReasoning: boolean;
    thinkingLevel: string | null;
    usage: FooterUsageTotals;
    cacheHitRate: number | null;
    contextPercent: number | null;
    contextWindow: number;
    providerCount: number;
}
/**
 * Collect cumulative usage from the session entries.
 * Mirrors Pi's footer: usage entries, assistant/tool-result messages,
 * branch summaries and compactions all contribute.
 */
export declare function collectUsageTotals(entries: readonly unknown[]): {
    usage: FooterUsageTotals;
    cacheHitRate: number | null;
};
/**
 * Read the session information the footer needs. Every access is guarded:
 * a stale extension context (session replaced / reloaded) must never break
 * the footer rendering.
 */
export declare function collectSessionInfo(ctx: ExtensionContext | null, footerData: ReadonlyFooterDataProvider): FooterSessionInfo | null;
/** Format a token count the way Pi's footer does. */
export declare function formatTokens(count: number): string;
/**
 * Replace the home directory with `~`, like Pi's footer does.
 *
 * A plain `startsWith(home)` test is wrong: with home `/home/user` the path
 * `/home/userX` is not inside the home directory but would be rendered as
 * `~/X`. Use a relative-path test instead.
 */
export declare function formatCwdForFooter(cwd: string, home: string | undefined): string;
/** Sanitize a status value so it cannot break the single-line layout. */
export declare function sanitizeStatusText(text: string): string;
export interface FooterRow {
    /** Short label used for diagnostics; not rendered. */
    label: string;
    /** Text rendered on the row. */
    text: string;
}
/**
 * Build the footer rows.
 *
 * Row order:
 *   1. working directory (+ branch, session name)
 *   2. token/cost/context stats (+ model, thinking state)
 *   3. harness quota (own row)
 *   4. workspace environment (own row)
 *   5. auto-continue state (own row, when present)
 *   6. other extensions' status values (shared row, as in Pi)
 */
export declare function renderFooterRows(info: FooterSessionInfo | null, rows: readonly FooterRow[], width: number, theme: Theme, autoCompactEnabled?: boolean): string[];
/**
 * Create the harness footer component.
 *
 * The component reads the live extension context on every render (through
 * `options.getContext`) so it never holds a stale session, and reads the
 * harness status values from the footer data provider so the quota and the
 * workspace summary are always rendered from the same source the built-in
 * footer would use.
 */
export declare function createHarnessFooter(_tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider, options?: HarnessFooterOptions): Component & {
    dispose?(): void;
};
//# sourceMappingURL=harness-footer.d.ts.map