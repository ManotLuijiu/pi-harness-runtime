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

export {
	SDK_VERSION,
	type IssueSeverity,
	type IssueCategory,
	type FocusArea,
	type CodeIssue,
	type IssueSummary,
	type ReviewFile,
	type DiffChange,
	type ReviewRequest,
	type ReviewResult,
	type ReviewStats,
	type ReviewConfig,
	type ReviewRule,
	type RuleSet,
	type AIProviderConfig,
	type AISuggestion,
	type AIReviewRequest,
	type AIReviewResponse,
	type ReportFormat,
	type ReportOptions,
	type ReviewHistoryEntry,
	type LinterResult,
	type LinterConfig,
	type GitDiff,
	type ChangedFile,
} from "./types.js";
