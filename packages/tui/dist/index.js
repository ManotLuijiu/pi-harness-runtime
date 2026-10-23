/**
 * @pi-harness/tui — TUI integration utilities for pi-harness-runtime.
 *
 * Exports the Harness custom header component that replaces Pi's built-in
 * startup banner with a harness-branded version using Unicode half-block art.
 */
export { createHarnessHeader, stripAnsi, visibleWidth, } from "./harness-header.js";
export { createHarnessFooter, collectSessionInfo, collectUsageTotals, formatCwdForFooter, formatTokens, HARNESS_AUTO_CONTINUE_STATUS_KEY, HARNESS_QUOTA_STATUS_KEY, HARNESS_WORKSPACE_STATUS_KEY, renderFooterRows, sanitizeStatusText, wrapStatusText, } from "./harness-footer.js";
//# sourceMappingURL=index.js.map