/**
 * Code Review Engine - Engine
 *
 * Main code review engine with rule matching and multi-pass analysis.
 */

import { randomBytes } from "node:crypto";
import type {
	CodeIssue,
	IssueCategory,
	ReportOptions,
	ReviewFile,
	ReviewRequest,
	ReviewResult,
	ReviewRule,
	ReviewStats,
	RuleSet,
} from "./types.js";
import { TextReporter } from "./reports/text.js";
import { HtmlReporter } from "./reports/html.js";
import { MarkdownReporter } from "./reports/markdown.js";

// ─── Default Rules ────────────────────────────────────────────────────────

const DEFAULT_RULES: ReviewRule[] = [
	// Security rules
	{
		id: "security/no-eval",
		name: "No eval()",
		severity: "error",
		category: "security",
		description: "Avoid using eval() as it can execute arbitrary code",
		pattern: "\\beval\\s*\\(",
		message: "Use of eval() is a security risk",
		suggestion: "Use Function() constructor or JSON.parse() instead",
	},
	{
		id: "security/no-inner-html",
		name: "No innerHTML",
		severity: "warning",
		category: "security",
		description: "Avoid innerHTML to prevent XSS attacks",
		pattern: "\\.innerHTML\\s*=",
		message: "innerHTML can lead to XSS vulnerabilities",
		suggestion: "Use textContent or sanitize HTML before insertion",
	},
	{
		id: "security/no-dynamic-selector",
		name: "No dynamic SQL selectors",
		severity: "error",
		category: "security",
		description: "Avoid dynamic SQL selectors to prevent injection",
		pattern: "(SELECT|INSERT|UPDATE|DELETE)\\s+.*\\$\\{",
		message: "Dynamic SQL can lead to injection attacks",
		suggestion: "Use parameterized queries instead",
	},

	// Performance rules
	{
		id: "performance/no-inner-loop",
		name: "No nested loops",
		severity: "info",
		category: "performance",
		description: "Nested loops can lead to O(n²) complexity",
		pattern: "for\\s*\\([^)]*\\)\\s*\\{[^}]*for\\s*\\(",
		message: "Nested loop detected - consider optimizing",
		suggestion: "Use a hash map or set for O(1) lookups",
	},
	{
		id: "performance/no-sync",
		name: "No synchronous file I/O",
		severity: "warning",
		category: "performance",
		description: "Avoid synchronous I/O in async code",
		pattern: "(readFileSync|writeFileSync|readSync)\\s*\\(",
		message: "Synchronous I/O blocks the event loop",
		suggestion: "Use async/await with fs/promises",
	},

	// Best practice rules
	{
		id: "best-practice/no-console",
		name: "No console statements",
		severity: "info",
		category: "best-practice",
		description: "Remove console statements before production",
		pattern: "\\bconsole\\.(log|debug|info|warn|error)\\s*\\(",
		message: "Console statement found",
		suggestion: "Use a proper logging library in production",
	},
	{
		id: "best-practice/no-any",
		name: "No any type",
		severity: "warning",
		category: "typescript",
		description: "Avoid using 'any' type",
		pattern: ":\\s*any\\b",
		message: "Use of 'any' defeats TypeScript type checking",
		suggestion: "Use 'unknown' and narrow the type safely",
	},
	{
		id: "best-practice/no-deprecated",
		name: "No deprecated APIs",
		severity: "warning",
		category: "best-practice",
		description: "Check for deprecated API usage",
		pattern: "/@(deprecated|deprecated|@deprecated)/i",
		message: "Deprecated API usage detected",
	},

	// Style rules
	{
		id: "style/no-magic-numbers",
		name: "No magic numbers",
		severity: "info",
		category: "style",
		description: "Avoid magic numbers in code",
		pattern: "(?<!\\w)\\d{2,}(?!\\w)",
		message: "Magic number detected - use a named constant",
		suggestion: "Define a constant with a descriptive name",
	},
	{
		id: "style/no-todo",
		name: "No TODO comments",
		severity: "hint",
		category: "style",
		description: "TODO comments should be tracked in issues",
		pattern: "(TODO|FIXME|HACK|XXX):?",
		message: "TODO/FIXME comment found",
		suggestion: "Create a tracked issue for this task",
	},
];

// ─── Code Review Engine ────────────────────────────────────────────────────

export class CodeReviewEngine {
	private rules: ReviewRule[] = [];
	private ruleSets: Map<string, RuleSet> = new Map();
	private customMatchers: Map<string, (file: ReviewFile) => CodeIssue[]> =
		new Map();

	constructor() {
		// Load default rules
		this.rules = [...DEFAULT_RULES];
	}

	/**
	 * Add a rule
	 */
	addRule(rule: ReviewRule): void {
		const existingIndex = this.rules.findIndex((r) => r.id === rule.id);
		if (existingIndex >= 0) {
			this.rules[existingIndex] = rule;
		} else {
			this.rules.push(rule);
		}
	}

	/**
	 * Add multiple rules
	 */
	addRules(rules: ReviewRule[]): void {
		for (const rule of rules) {
			this.addRule(rule);
		}
	}

	/**
	 * Add a rule set
	 */
	addRuleSet(set: RuleSet): void {
		this.ruleSets.set(set.name, set);
		if (set.extends) {
			for (const parentName of set.extends) {
				const parent = this.ruleSets.get(parentName);
				if (parent) {
					this.rules.push(...parent.rules);
				}
			}
		}
		this.rules.push(...set.rules);
	}

	/**
	 * Register custom matcher
	 */
	registerCustomMatcher(
		name: string,
		matcher: (file: ReviewFile) => CodeIssue[],
	): void {
		this.customMatchers.set(name, matcher);
	}

	/**
	 * Get enabled rules
	 */
	getRules(): ReviewRule[] {
		return this.rules.filter((r) => r.enabled !== false);
	}

	/**
	 * Review files
	 */
	async review(request: ReviewRequest): Promise<ReviewResult> {
		const startTime = Date.now();
		const files = request.files ?? [];
		const issues: CodeIssue[] = [];

		// Get rules to apply
		const rules = request.rules?.length
			? request.rules.filter((r) => r.enabled !== false)
			: this.getRules().filter((r) => r.enabled !== false);

		// Apply rules to each file
		for (const file of files) {
			const fileIssues = this.applyRules(file, rules);
			issues.push(...fileIssues);
		}

		// Apply custom matchers
		for (const [, matcher] of this.customMatchers) {
			for (const file of files) {
				const matcherIssues = matcher(file);
				issues.push(...matcherIssues);
			}
		}

		// Generate summary
		const summary = this.generateSummary(issues);

		const result: ReviewResult = {
			id: this.generateId(),
			timestamp: new Date().toISOString(),
			durationMs: Date.now() - startTime,
			issues,
			summary,
			stats: this.generateStats(files, issues),
		};

		return result;
	}

	/**
	 * Apply rules to a file
	 */
	private applyRules(file: ReviewFile, rules: ReviewRule[]): CodeIssue[] {
		const issues: CodeIssue[] = [];

		for (const rule of rules) {
			if (rule.pattern) {
				const pattern =
					rule.pattern instanceof RegExp
						? rule.pattern
						: new RegExp(rule.pattern, rule.patternFlags ?? "g");

				// Find all matches
				let match: RegExpExecArray | null;
				while ((match = pattern.exec(file.content)) !== null) {
					const lineInfo = this.getLineInfo(file.content, match.index);
					issues.push(this.createIssue(rule, file.path, lineInfo, match[0]));
				}
			}
		}

		return issues;
	}

	/**
	 * Get line and column info for a position
	 */
	private getLineInfo(
		content: string,
		position: number,
	): { line: number; column: number; lineContent: string } {
		const lines = content.substring(0, position).split("\n");
		const line = lines.length;
		const column = lines[lines.length - 1].length + 1;
		const allLines = content.split("\n");
		return {
			line,
			column,
			lineContent: allLines[line - 1] ?? "",
		};
	}

	/**
	 * Create an issue from a rule match
	 */
	private createIssue(
		rule: ReviewRule,
		file: string,
		lineInfo: { line: number; column: number; lineContent: string },
		_matchedCode: string,
	): CodeIssue {
		return {
			id: `${rule.id}-${this.generateId()}`,
			severity: rule.severity,
			category: rule.category,
			title: rule.name,
			message: rule.message ?? rule.description,
			file,
			line: lineInfo.line,
			column: lineInfo.column,
			rule: rule.id,
			ruleUrl: rule.url,
			suggestion: rule.suggestion,
			code: lineInfo.lineContent.trim(),
			fix: rule.suggestion,
		};
	}

	/**
	 * Generate issue summary
	 */
	private generateSummary(issues: CodeIssue[]): {
		total: number;
		errors: number;
		warnings: number;
		info: number;
		hints: number;
		byCategory: Record<IssueCategory, number>;
		byFile: Record<string, number>;
	} {
		const summary = {
			total: issues.length,
			errors: 0,
			warnings: 0,
			info: 0,
			hints: 0,
			byCategory: {} as Record<IssueCategory, number>,
			byFile: {} as Record<string, number>,
		};

		for (const issue of issues) {
			switch (issue.severity) {
				case "error":
					summary.errors++;
					break;
				case "warning":
					summary.warnings++;
					break;
				case "info":
					summary.info++;
					break;
				case "hint":
					summary.hints++;
					break;
			}

			summary.byCategory[issue.category] =
				(summary.byCategory[issue.category] ?? 0) + 1;
			summary.byFile[issue.file] = (summary.byFile[issue.file] ?? 0) + 1;
		}

		return summary;
	}

	/**
	 * Generate review statistics
	 */
	private generateStats(files: ReviewFile[], issues: CodeIssue[]): ReviewStats {
		const linesReviewed = files.reduce(
			(sum, f) => sum + f.content.split("\n").length,
			0,
		);

		return {
			filesReviewed: files.length,
			linesReviewed,
			issuesFound: issues.length,
			aiSuggestions: 0,
			rulesMatched: this.rules.filter((r) => r.enabled !== false).length,
		};
	}

	/**
	 * Generate unique ID
	 */
	private generateId(): string {
		return randomBytes(8).toString("hex");
	}

	/**
	 * Generate report
	 */
	generateReport(result: ReviewResult, options: ReportOptions): string {
		switch (options.format) {
			case "text":
				return new TextReporter().generate(result, options);
			case "html":
				return new HtmlReporter().generate(result, options);
			case "markdown":
				return new MarkdownReporter().generate(result, options);
			case "json":
			default:
				return JSON.stringify(result, null, 2);
		}
	}
}

// ─── Factory Function ────────────────────────────────────────────────────

/**
 * Create a code review engine
 */
export function createCodeReviewEngine(): CodeReviewEngine {
	return new CodeReviewEngine();
}
