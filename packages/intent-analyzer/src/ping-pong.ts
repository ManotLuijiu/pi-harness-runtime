import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { IntentAnalyzer } from "./analyzer.js";
import type { Intent, IntentKind } from "./types.js";

export type PingPongDecision =
	| "run_ping_pong"
	| "suggest_ping_pong"
	| "handle_inline";

export interface CodebaseComplexityInput {
	/** Approximate total source/config/documentation files in the current repo. */
	fileCount?: number;
	/** Number of top-level packages/apps/workspaces. */
	packageCount?: number;
	/** Number of framework/runtime signals found, such as package.json, Cargo.toml, or pyproject.toml. */
	frameworkSignalCount?: number;
	/** Number of changed files in the working tree, if known. */
	changedFileCount?: number;
	/** Paths the user explicitly mentioned. */
	mentionedPaths?: string[];
	/** True when tests already exist and changes should usually preserve them. */
	hasTests?: boolean;
	/** True when release/build automation exists. */
	hasCiOrRelease?: boolean;
}

export interface PingPongDecisionOptions {
	/** Project-level complexity signals. Pass scanCodebaseComplexity(cwd) when available. */
	codebase?: CodebaseComplexityInput;
	/** Lower thresholds for fully autonomous sessions. */
	autonomous?: boolean;
	/** Allow exact user override words. Default: true. */
	allowExplicitOverride?: boolean;
}

export interface PingPongSignal {
	id: string;
	label: string;
	weight: number;
}

export interface PingPongDecisionResult {
	decision: PingPongDecision;
	score: number;
	thresholds: {
		run: number;
		suggest: number;
	};
	intent: Intent;
	signals: PingPongSignal[];
	reasons: string[];
}

const CODE_CHANGE_INTENTS = new Set<IntentKind>([
	"bug_fix",
	"feature",
	"refactor",
	"testing",
	"migration",
	"security",
	"performance",
	"deployment",
]);

const INLINE_INTENTS = new Set<IntentKind>([
	"learning",
	"research",
	"code_review",
	"documentation",
	"general",
]);

const ACTION_PATTERNS: Array<[RegExp, string, number]> = [
	[/\b(implement|build|create|add|introduce)\b/i, "implementation request", 2],
	[/\b(fix|debug|repair|patch|resolve)\b/i, "bug-fix request", 2],
	[/\b(refactor|rewrite|restructure|migrate|convert|port)\b/i, "structural change request", 3],
	[/\b(test|spec|coverage|e2e|integration)\b/i, "test-impacting request", 1],
	[/\b(release|deploy|publish|ship)\b/i, "release-impacting request", 2],
];

const COMPLEXITY_PATTERNS: Array<[RegExp, string, number]> = [
	[/\b(system|architecture|daemon|runtime|orchestrator|scheduler|graph|loop|workflow|pipeline)\b/i, "system/architecture area", 3],
	[/\b(concurrent|parallel|async|queue|event|bus|lease|worker|agent|multi[- ]?agent)\b/i, "coordination or concurrency", 3],
	[/\b(cross[- ]?package|workspace|monorepo|package|plugin|extension)\b/i, "cross-package surface", 2],
	[/\b(auth|token|secret|permission|security|quota|billing|cost)\b/i, "sensitive or quota-sensitive area", 2],
	[/\b(database|migration|schema|cache|state|checkpoint|persistence)\b/i, "stateful change area", 2],
];

const INLINE_PATTERNS: Array<[RegExp, string, number]> = [
	[/\b(explain|what is|how does|why|analyze|investigate|understand)\b/i, "analysis-only wording", -4],
	[/\b(no code|do not edit|don't edit|only explain|just explain|read only|read-only)\b/i, "explicit no-edit wording", -8],
	[/\b(show|list|status|inspect|summarize)\b/i, "inspection wording", -2],
];

const EXPLICIT_RUN = /\b(ping[- ]?pong|write[- ]?review|plan\s*->\s*cod(?:e|ing)|review\s*->\s*fix|write\s+(?:down\s+)?(?:the\s+)?plan\s+to\s+wiki|ask\s+minimax\s+to\s+(?:write|code|implement)|(?:then\s+)?you\s+review)\b/i;
const EXPLICIT_SKIP = /\b(no ping[- ]?pong|skip ping[- ]?pong|do not run ping[- ]?pong|don't run ping[- ]?pong)\b/i;

function pushSignal(
	signals: PingPongSignal[],
	id: string,
	label: string,
	weight: number,
): void {
	signals.push({ id, label, weight });
}

function countPathMentions(text: string): string[] {
	const matches = text.match(
		/(?:^|\s)((?:\.\/|\/)?(?:src|lib|packages|apps|harness|test|tests|docs|wiki|scripts|config|src-ui|src-tauri)[/\w.-]*\.[a-z0-9]+)/gi,
	);
	if (!matches) return [];
	return matches.map((m) => m.trim());
}

function clampScore(score: number): number {
	return Math.max(0, Math.min(20, score));
}

export class PingPongDecisionEngine {
	private readonly intentAnalyzer: IntentAnalyzer;

	constructor(intentAnalyzer = new IntentAnalyzer()) {
		this.intentAnalyzer = intentAnalyzer;
	}

	analyze(
		request: string,
		options: PingPongDecisionOptions = {},
	): PingPongDecisionResult {
		const allowOverride = options.allowExplicitOverride ?? true;
		const intent = this.intentAnalyzer.analyze(request);
		const signals: PingPongSignal[] = [];
		let score = 0;

		if (allowOverride && EXPLICIT_SKIP.test(request)) {
			pushSignal(signals, "override.skip", "explicit skip request", -20);
		} else if (allowOverride && EXPLICIT_RUN.test(request)) {
			pushSignal(signals, "override.run", "explicit PING-PONG request", 20);
		}

		if (CODE_CHANGE_INTENTS.has(intent.kind)) {
			const weight = intent.confidence === "high" ? 4 : 3;
			pushSignal(signals, `intent.${intent.kind}`, `${intent.kind} intent`, weight);
		} else if (INLINE_INTENTS.has(intent.kind)) {
			const weight = intent.kind === "general" ? -3 : -2;
			pushSignal(signals, `intent.${intent.kind}`, `${intent.kind} intent`, weight);
		}

		for (const [pattern, label, weight] of ACTION_PATTERNS) {
			if (pattern.test(request)) pushSignal(signals, `action.${label}`, label, weight);
		}

		for (const [pattern, label, weight] of COMPLEXITY_PATTERNS) {
			if (pattern.test(request)) pushSignal(signals, `complexity.${label}`, label, weight);
		}

		for (const [pattern, label, weight] of INLINE_PATTERNS) {
			if (pattern.test(request)) pushSignal(signals, `inline.${label}`, label, weight);
		}

		const mentionedPaths = [
			...(options.codebase?.mentionedPaths ?? []),
			...countPathMentions(request),
		];
		if (mentionedPaths.length >= 2) {
			pushSignal(signals, "scope.paths.multi", "multiple files mentioned", 2);
		} else if (mentionedPaths.length === 1) {
			pushSignal(signals, "scope.paths.single", "specific file mentioned", 1);
		}

		this.addCodebaseSignals(signals, options.codebase);

		score = clampScore(signals.reduce((sum, signal) => sum + signal.weight, 0));

		const thresholds = {
			run: options.autonomous ? 8 : 9,
			suggest: options.autonomous ? 5 : 6,
		};

		let decision: PingPongDecision;
		if (allowOverride && EXPLICIT_SKIP.test(request)) {
			decision = "handle_inline";
			score = 0;
		} else if (allowOverride && EXPLICIT_RUN.test(request)) {
			decision = "run_ping_pong";
			score = Math.max(score, thresholds.run);
		} else if (score >= thresholds.run) {
			decision = "run_ping_pong";
		} else if (score >= thresholds.suggest) {
			decision = "suggest_ping_pong";
		} else {
			decision = "handle_inline";
		}

		return {
			decision,
			score,
			thresholds,
			intent,
			signals,
			reasons: signals
				.filter((signal) => signal.weight !== 0)
				.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
				.map((signal) => `${signal.label} (${signal.weight > 0 ? "+" : ""}${signal.weight})`),
		};
	}

	private addCodebaseSignals(
		signals: PingPongSignal[],
		codebase?: CodebaseComplexityInput,
	): void {
		if (!codebase) return;

		if ((codebase.fileCount ?? 0) >= 1000) {
			pushSignal(signals, "repo.files.large", "large repository", 3);
		} else if ((codebase.fileCount ?? 0) >= 250) {
			pushSignal(signals, "repo.files.medium", "medium repository", 2);
		}

		if ((codebase.packageCount ?? 0) >= 5) {
			pushSignal(signals, "repo.packages.large", "many packages/apps", 3);
		} else if ((codebase.packageCount ?? 0) >= 2) {
			pushSignal(signals, "repo.packages.multi", "multi-package project", 2);
		}

		if ((codebase.frameworkSignalCount ?? 0) >= 4) {
			pushSignal(signals, "repo.frameworks.many", "many framework/runtime signals", 2);
		}

		if ((codebase.changedFileCount ?? 0) >= 8) {
			pushSignal(signals, "repo.changes.many", "many current changes", 2);
		}

		if (codebase.hasTests) {
			pushSignal(signals, "repo.tests", "test suite present", 1);
		}

		if (codebase.hasCiOrRelease) {
			pushSignal(signals, "repo.release", "release/build automation present", 1);
		}
	}
}

export interface ScanCodebaseOptions {
	maxFiles?: number;
	maxDepth?: number;
}

const SKIP_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"coverage",
	".next",
	".turbo",
	"target",
]);

const FRAMEWORK_FILES = new Set([
	"package.json",
	"tsconfig.json",
	"Cargo.toml",
	"pyproject.toml",
	"composer.json",
	"go.mod",
	"bun.lock",
	"pnpm-lock.yaml",
	"vite.config.ts",
	"next.config.js",
	"tauri.conf.json",
]);

export function scanCodebaseComplexity(
	root: string,
	options: ScanCodebaseOptions = {},
): CodebaseComplexityInput {
	const maxFiles = options.maxFiles ?? 4000;
	const maxDepth = options.maxDepth ?? 6;
	let fileCount = 0;
	let packageCount = 0;
	let frameworkSignalCount = 0;
	let hasTests = false;
	let hasCiOrRelease = false;

	function visit(dir: string, depth: number): void {
		if (fileCount >= maxFiles || depth > maxDepth) return;
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}

		for (const entry of entries) {
			if (fileCount >= maxFiles) return;
			const path = join(dir, entry);
			let stats;
			try {
				stats = statSync(path);
			} catch {
				continue;
			}

			if (stats.isDirectory()) {
				if (SKIP_DIRS.has(entry)) continue;
				if ((entry === "packages" || entry === "apps") && depth <= 1) {
					packageCount += countChildDirs(path);
				}
				if (entry === "test" || entry === "tests" || entry === "__tests__") {
					hasTests = true;
				}
				visit(path, depth + 1);
				continue;
			}

			if (!stats.isFile()) continue;
			fileCount += 1;

			if (FRAMEWORK_FILES.has(entry)) frameworkSignalCount += 1;
			if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry)) hasTests = true;
			if (
				entry === "package.json" &&
				readJsonHasPackageScripts(path, ["build", "release", "publish"])
			) {
				hasCiOrRelease = true;
			}
			if (
				path.includes("/.github/workflows/") ||
				entry === "release.yml" ||
				entry === "release.yaml"
			) {
				hasCiOrRelease = true;
			}
		}
	}

	visit(root, 0);

	return {
		fileCount,
		packageCount,
		frameworkSignalCount,
		hasTests,
		hasCiOrRelease,
	};
}

function countChildDirs(dir: string): number {
	try {
		return readdirSync(dir).filter((entry) => {
			try {
				return statSync(join(dir, entry)).isDirectory();
			} catch {
				return false;
			}
		}).length;
	} catch {
		return 0;
	}
}

function readJsonHasPackageScripts(path: string, scriptNames: string[]): boolean {
	if (!existsSync(path)) return false;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as {
			scripts?: Record<string, unknown>;
		};
		const scripts = parsed.scripts ?? {};
		return scriptNames.some((name) => typeof scripts[name] === "string");
	} catch {
		return false;
	}
}

export function analyzePingPongDecision(
	request: string,
	options: PingPongDecisionOptions = {},
): PingPongDecisionResult {
	return new PingPongDecisionEngine().analyze(request, options);
}
