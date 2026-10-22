/**
 * @pi-harness/tui — TUI integration utilities for pi-harness-runtime.
 *
 * Exports the Harness custom header component that replaces Pi's built-in
 * startup banner with a harness-branded version using Unicode half-block art.
 */
export { createHarnessHeader, type HarnessHeaderOptions, stripAnsi, visibleWidth, } from "./harness-header.js";
export { createHarnessFooter, collectSessionInfo, collectUsageTotals, formatCwdForFooter, formatTokens, HARNESS_AUTO_CONTINUE_STATUS_KEY, HARNESS_QUOTA_STATUS_KEY, HARNESS_WORKSPACE_STATUS_KEY, type FooterRow, type FooterSessionInfo, type FooterUsageTotals, type HarnessFooterOptions, renderFooterRows, sanitizeStatusText, } from "./harness-footer.js";
//# sourceMappingURL=index.d.ts.map