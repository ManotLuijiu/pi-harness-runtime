/**
 * Code Review Engine - Types
 *
 * Core types for automated code review.
 */

// ─── SDK Version ────────────────────────────────────────────────────────────

/**
 * SDK version for compatibility checks
 */
export const SDK_VERSION = "1.0.0";

// ─── Severity & Category ───────────────────────────────────────────────────

/**
 * Issue severity
 */
export type IssueSeverity = "error" | "warning" | "info" | "hint";

/**
 * Issue category
 */
export type IssueCategory =
	| "security"
	| "performance"
	| "correctness"
	| "maintainability"
	| "style"
	| "best-practice"
	| "typescript"
	| "lint";

/**
 * Focus area for AI review
 */
export type FocusArea =
	| "security"
	| "performance"
	| "correctness"
	| "best-practices"
	| "readability"
	| "architecture";

// ─── Issue Types ───────────────────────────────────────────────────────────

/**
 * Code issue
 */
export interface CodeIssue {
	id: string;
	severity: IssueSeverity;
	category: IssueCategory;
	title: string;
	message: string;
	file: string;
	line?: number;
	column?: number;
	endLine?: number;
	endColumn?: number;
	rule?: string;
	ruleUrl?: string;
	suggestion?: string;
	code?: string;
	fix?: string;
}

/**
 * Issue summary
 */
export interface IssueSummary {
	total: number;
	errors: number;
	warnings: number;
	info: number;
	hints: number;
	byCategory: Record<IssueCategory, number>;
	byFile: Record<string, number>;
}

// ─── Review Types ──────────────────────────────────────────────────────────

/**
 * File content for review
 */
export interface ReviewFile {
	path: string;
	content: string;
	language?: string;
	ast?: unknown;
}

/**
 * Diff change
 */
export interface DiffChange {
	type: "added" | "removed" | "modified";
	path: string;
	oldContent?: string;
	newContent: string;
	oldLines?: number;
	newLines?: number;
}

/**
 * Review request
 */
export interface ReviewRequest {
	files?: ReviewFile[];
	diff?: DiffChange[];
	rules?: ReviewRule[];
	config?: ReviewConfig;
	aiProvider?: AIProviderConfig;
	includePatterns?: string[];
	excludePatterns?: string[];
}

/**
 * Review result
 */
export interface ReviewResult {
	id: string;
	timestamp: string;
	durationMs: number;
	issues: CodeIssue[];
	summary: IssueSummary;
	aiSuggestions?: AISuggestion[];
	stats: ReviewStats;
	metadata?: Record<string, unknown>;
}

/**
 * Review statistics
 */
export interface ReviewStats {
	filesReviewed: number;
	linesReviewed: number;
	issuesFound: number;
	aiSuggestions: number;
	rulesMatched: number;
}

/**
 * Review configuration
 */
export interface ReviewConfig {
	severityThreshold?: IssueSeverity;
	categories?: IssueCategory[];
	failOnErrors?: boolean;
	failOnWarnings?: boolean;
	maxIssuesPerFile?: number;
	parallelFiles?: boolean;
	parallelRules?: boolean;
	timeoutMs?: number;
	includeAiReview?: boolean;
	aiFocusAreas?: FocusArea[];
	aiModel?: string;
}

// ─── Rule Types ────────────────────────────────────────────────────────────

/**
 * Review rule
 */
export interface ReviewRule {
	id: string;
	name: string;
	severity: IssueSeverity;
	category: IssueCategory;
	description: string;
	pattern?: string | RegExp;
	patternFlags?: string;
	ASTPattern?: string;
	message?: string;
	suggestion?: string;
	url?: string;
	enabled?: boolean;
	tags?: string[];
}

/**
 * Rule set
 */
export interface RuleSet {
	name: string;
	description: string;
	rules: ReviewRule[];
	extends?: string[];
	tags?: string[];
}

// ─── AI Types ──────────────────────────────────────────────────────────────

/**
 * AI provider configuration
 */
export interface AIProviderConfig {
	provider: "openai" | "anthropic" | "ollama";
	model?: string;
	apiKey?: string;
	baseUrl?: string;
	maxTokens?: number;
	temperature?: number;
}

/**
 * AI suggestion
 */
export interface AISuggestion {
	id: string;
	severity: IssueSeverity;
	category: IssueCategory;
	title: string;
	explanation: string;
	suggestion: string;
	file: string;
	line?: number;
	code?: string;
	confidence: number;
	focusArea: FocusArea;
}

/**
 * AI review request
 */
export interface AIReviewRequest {
	files: ReviewFile[];
	focusAreas: FocusArea[];
	maxSuggestions?: number;
	model?: string;
}

/**
 * AI review response
 */
export interface AIReviewResponse {
	suggestions: AISuggestion[];
	overallAssessment: string;
	model: string;
	tokensUsed: number;
}

// ─── Report Types ──────────────────────────────────────────────────────────

/**
 * Report format
 */
export type ReportFormat = "text" | "json" | "html" | "markdown";

/**
 * Report options
 */
export interface ReportOptions {
	format: ReportFormat;
	includeCode?: boolean;
	includeSuggestions?: boolean;
	includeStats?: boolean;
	includeSummary?: boolean;
	groupByFile?: boolean;
	groupBySeverity?: boolean;
	color?: boolean;
	template?: string;
}

// ─── History Types ─────────────────────────────────────────────────────────

/**
 * Review history entry
 */
export interface ReviewHistoryEntry {
	id: string;
	timestamp: string;
	branch?: string;
	commit?: string;
	result: ReviewResult;
	projectPath: string;
}

// ─── Linter Types ──────────────────────────────────────────────────────────

/**
 * Linter result
 */
export interface LinterResult {
	success: boolean;
	issues: CodeIssue[];
	output?: string;
	error?: string;
	durationMs: number;
}

/**
 * Linter configuration
 */
export interface LinterConfig {
	name: string;
	enabled: boolean;
	configPath?: string;
	rules?: Record<string, unknown>;
	extensions?: string[];
}

// ─── Git Types ─────────────────────────────────────────────────────────────

/**
 * Git diff
 */
export interface GitDiff {
	files: DiffChange[];
	from: string;
	to: string;
	baseBranch?: string;
	headBranch?: string;
}

/**
 * Changed file
 */
export interface ChangedFile {
	path: string;
	status: "added" | "modified" | "deleted" | "renamed";
	additions: number;
	deletions: number;
}
