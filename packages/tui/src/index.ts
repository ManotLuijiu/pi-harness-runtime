/**
 * @pi-harness/tui — TUI integration utilities for pi-harness-runtime.
 *
 * Exports the Harness custom header component that replaces Pi's built-in
 * startup banner with a harness-branded version using Unicode half-block art.
 */

export { createHarnessHeader, type HarnessHeaderOptions } from "./harness-header.js";
export { visibleWidth, stripAnsi } from "./harness-header.js";
