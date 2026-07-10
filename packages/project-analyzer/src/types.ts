/**
 * Project Analyzer Types
 *
 * Type definitions for project analysis output and plugin interface.
 */

// ─── SDK Version ───────────────────────────────────────────────────────

export const SDK_VERSION = "1.0.0" as const;

// ─── Project Profile ──────────────────────────────────────────────────

/**
 * Primary output of project analysis.
 * Contains all discovered project metadata, rules, and configuration.
 */
export interface ProjectProfile {
	/** Absolute path to repository root */
	repositoryRoot: string;
	/** Repository name (last path segment) */
	repositoryName: string;
	/** Git revision or 'unknown' if not a git repo */
	revision: string;
	/** Detected frameworks with confidence scores */
	frameworks: DetectedFramework[];
	/** Detected programming languages */
	languages: DetectedLanguage[];
	/** Package manager configurations */
	packageManagers: PackageManagerProfile[];
	/** Discovered applications within monorepo */
	applications: ApplicationProfile[];
	/** Discovered project commands */
	commands: ProjectCommands;
	/** Project-specific rules from AGENTS.md, RULES.md, etc. */
	rules: ProjectRule[];
	/** Paths that should never be included in context */
	sensitivePaths: string[];
	/** Paths that are generated and should be ignored */
	generatedPaths: string[];
	/** Available test capabilities */
	testCapabilities: TestCapability[];
	/** Overall confidence score (0-1) */
	confidence: number;
	/** Warnings about conflicting or missing information */
	warnings: ProjectWarning[];
	/** ISO timestamp of analysis */
	analyzedAt: string;
}

// ─── Framework Detection ──────────────────────────────────────────────

export type FrameworkCategory =
	| "frappe"
	| "frappe_spa"
	| "nextjs"
	| "react"
	| "vite"
	| "django"
	| "laravel"
	| "express"
	| "fastapi"
	| "unknown";

export interface DetectedFramework {
	/** Framework category identifier */
	category: FrameworkCategory;
	/** Detected framework name (e.g., "Next.js", "Frappe") */
	name: string;
	/** Detected version or 'unknown' */
	version?: string;
	/** Confidence score (0-1) */
	confidence: number;
	/** Files and patterns that matched */
	signals: DetectionSignal[];
	/** Whether this is the primary framework */
	primary: boolean;
}

// ─── Language Detection ──────────────────────────────────────────────

export interface DetectedLanguage {
	/** Language name */
	name: string;
	/** Detected version or 'unknown' */
	version?: string;
	/** Percentage of codebase (0-1) */
	coverage: number;
}

// ─── Package Manager ───────────────────────────────────────────────────

export type PackageManagerType =
	| "npm"
	| "yarn"
	| "pnpm"
	| "bun"
	| "pip"
	| "poetry"
	| "bench";

export interface PackageManagerProfile {
	/** Package manager type */
	type: PackageManagerType;
	/** Path to lock file or config */
	configPath: string;
	/** Whether this is the primary package manager */
	primary: boolean;
}

// ─── Application Profile ──────────────────────────────────────────────

export interface ApplicationProfile {
	/** Unique application identifier */
	id: string;
	/** Path to application root */
	root: string;
	/** Primary framework */
	framework: string;
	/** Package manager if applicable */
	packageManager?: PackageManagerType;
	/** Test commands for this application */
	testCommands: string[];
	/** Build commands for this application */
	buildCommands: string[];
	/** Entry point files */
	entryPoints: string[];
	/** Relative to repository root */
	relativePath: string;
}

// ─── Project Commands ─────────────────────────────────────────────────

export interface ProjectCommands {
	/** Unit test commands */
	unitTest: string[];
	/** Integration test commands */
	integrationTest: string[];
	/** End-to-end test commands */
	e2eTest: string[];
	/** Linting commands */
	lint: string[];
	/** Type checking commands */
	typecheck: string[];
	/** Build commands */
	build: string[];
	/** Migration commands */
	migrate: string[];
}

// ─── Project Rules ────────────────────────────────────────────────────

export type RulePriority = "mandatory" | "advisory" | "convention";

export interface ProjectRule {
	/** Unique rule identifier */
	id: string;
	/** Rule file source */
	source: string;
	/** Rule priority */
	priority: RulePriority;
	/** Rule content (markdown or plain text) */
	content: string;
	/** Parsed rule sections */
	sections: RuleSection[];
	/** Whether user explicitly defined this rule */
	userDefined: boolean;
}

export interface RuleSection {
	/** Section identifier */
	id: string;
	/** Section title */
	title: string;
	/** Section content */
	content: string;
	/** Line number in source file */
	line: number;
}

// ─── Test Capabilities ────────────────────────────────────────────────

export type TestRunner =
	| "vitest"
	| "jest"
	| "pytest"
	| "playwright"
	| "cypress"
	| "bun_test"
	| "bench_test"
	| "phpunit"
	| "unknown";

export interface TestCapability {
	/** Test runner type */
	runner: TestRunner;
	/** Config file path */
	configPath?: string;
	/** Whether tests are available */
	available: boolean;
	/** Test file pattern */
	pattern?: string;
}

// ─── Warnings ──────────────────────────────────────────────────────────

export type WarningCode =
	| "CONFLICTING_FRAMEWORKS"
	| "MULTIPLE_PACKAGE_MANAGERS"
	| "NO_TEST_CONFIG"
	| "NO_FRAMEWORK_DETECTED"
	| "MISSING_RULES"
	| "UNKNOWN_LANGUAGE";

export interface ProjectWarning {
	/** Warning code */
	code: WarningCode;
	/** Human-readable message */
	message: string;
	/** Affected paths or files */
	affected?: string[];
}

// ─── Detection Signal ──────────────────────────────────────────────────

export interface DetectionSignal {
	/** Signal type */
	type: string;
	/** File path or pattern that matched */
	path: string;
	/** Signal weight (0-1) */
	weight: number;
	/** Matched value if applicable */
	value?: string;
}

// ─── Plugin Interface ─────────────────────────────────────────────────

/**
 * Result of framework plugin detection phase.
 */
export interface DetectionResult {
	/** Detected framework category */
	category: FrameworkCategory;
	/** Confidence score */
	confidence: number;
	/** Matched signals */
	signals: DetectionSignal[];
	/** Detected version if available */
	version?: string;
}

/**
 * Filesystem abstraction for plugin use.
 * Readonly to ensure plugins cannot modify the filesystem.
 */
export interface ReadonlyFileSystem {
	/** Check if path exists */
	exists(path: string): Promise<boolean>;
	/** Read file contents */
	readFile(path: string): Promise<string>;
	/** List directory contents */
	readDir(path: string): Promise<string[]>;
	/** Check if path is directory */
	isDirectory(path: string): Promise<boolean>;
	/** Glob pattern matching */
	glob(pattern: string, cwd?: string): Promise<string[]>;
}

/**
 * Framework analyzer plugin interface.
 * Plugins provide framework-specific detection and analysis.
 */
export interface FrameworkAnalyzerPlugin {
	/** Plugin identifier */
	id: string;
	/** Plugin version */
	version: string;
	/** Priority (lower = higher priority) */
	priority: number;

	/**
	 * Detect if this plugin's framework is present.
	 * Should be fast and read-only.
	 */
	detect(fs: ReadonlyFileSystem): Promise<DetectionResult | null>;

	/**
	 * Perform deeper analysis once framework is detected.
	 * May read additional files.
	 */
	analyze(
		root: string,
		detection: DetectionResult,
		fs: ReadonlyFileSystem,
	): Promise<Partial<ProjectProfile>>;
}

// ─── Analyzer Configuration ───────────────────────────────────────────

export interface AnalyzerConfig {
	/** Maximum files to scan */
	maxScanFiles: number;
	/** Maximum file size to read (bytes) */
	maxFileSize: number;
	/** Maximum directory depth */
	maxDepth: number;
	/** Custom sensitive path patterns */
	sensitivePatterns: string[];
	/** Custom generated path patterns */
	generatedPatterns: string[];
	/** Rule file names to discover */
	ruleFileNames: string[];
	/** Whether to scan monorepo subdirectories */
	detectMonorepo: boolean;
}

export const DEFAULT_ANALYZER_CONFIG: AnalyzerConfig = {
	maxScanFiles: 10000,
	maxFileSize: 200000, // 200KB
	maxDepth: 20,
	sensitivePatterns: [
		".env",
		".env.*",
		"*.pem",
		"credentials/**",
		"secrets/**",
		"private/**",
		"*.key",
		"*.p12",
		"*.pfx",
	],
	generatedPatterns: [
		"node_modules/**",
		"dist/**",
		"build/**",
		"coverage/**",
		"__pycache__/**",
		".pytest_cache/**",
		".next/**",
		".nuxt/**",
		".output/**",
	],
	ruleFileNames: [
		"AGENTS.md",
		"RULES.md",
		"PROJECT_RULES.md",
		"CONTRIBUTING.md",
		".claude.md",
		"CLAUDE.md",
	],
	detectMonorepo: true,
};

// ─── Analysis Request / Response ─────────────────────────────────────

export interface AnalyzeRequest {
	/** Path to repository root */
	repositoryRoot: string;
	/** Git revision to analyze (optional, uses current if not provided) */
	revision?: string;
	/** Analysis configuration overrides */
	config?: Partial<AnalyzerConfig>;
	/** Additional plugins to register */
	plugins?: FrameworkAnalyzerPlugin[];
}

export interface AnalyzeResult {
	/** Success status */
	success: boolean;
	/** Project profile if successful */
	profile?: ProjectProfile;
	/** Error message if failed */
	error?: string;
	/** Error code if failed */
	errorCode?: AnalysisErrorCode;
	/** Time taken to analyze (ms) */
	durationMs: number;
}

export type AnalysisErrorCode =
	| "REPOSITORY_NOT_FOUND"
	| "NOT_A_DIRECTORY"
	| "SYMLINK_ESCAPE"
	| "SCAN_LIMIT_EXCEEDED"
	| "INVALID_CONFIG"
	| "UNKNOWN_ERROR";

// ─── Cache ────────────────────────────────────────────────────────────

export interface CacheEntry {
	/** Cached project profile */
	profile: ProjectProfile;
	/** Hash of rule files */
	ruleHash: string;
	/** Hash of package manifests */
	manifestHash: string;
	/** Hash of framework config files */
	configHash: string;
	/** Git revision when cached */
	revision: string;
	/** When this entry was created */
	cachedAt: string;
}

export interface CacheKey {
	/** Repository root */
	repositoryRoot: string;
	/** Git revision */
	revision: string;
	/** Combined hash of configuration files */
	configHash: string;
}
