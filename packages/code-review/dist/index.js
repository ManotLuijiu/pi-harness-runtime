/**
 * Code Review Engine
 *
 * Automated code review with pattern-based rules, multi-file analysis,
 * and configurable reporting.
 */
// ─── Engine ────────────────────────────────────────────────────────────
export { CodeReviewEngine, createCodeReviewEngine } from "./engine.js";
// ─── Reporters ─────────────────────────────────────────────────────────
export { TextReporter } from "./reports/text.js";
export { HtmlReporter } from "./reports/html.js";
export { MarkdownReporter } from "./reports/markdown.js";
// ─── Types ────────────────────────────────────────────────────────────
export { SDK_VERSION, } from "./types.js";
//# sourceMappingURL=index.js.map