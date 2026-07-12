/**
 * Project Analyzer
 *
 * A comprehensive project analysis system for pi-harness-runtime.
 * Detects frameworks, languages, commands, rules, and project structure.
 */

// ─── SDK Version ───────────────────────────────────────────────────────

export { SDK_VERSION } from "./types.js";

// ─── Analyzer ──────────────────────────────────────────────────────────

export {
	ProjectAnalyzer,
	createProjectAnalyzer,
	detectLanguages,
	detectTestCapabilities,
} from "./analyzer.js";

// ─── File System Walker ─────────────────────────────────────────────────

export {
	FileSystemWalker,
	createReadonlyFileSystem,
} from "./walker.js";

// ─── Cache ─────────────────────────────────────────────────────────────

export {
	AnalysisCache,
	hashRuleFiles,
	hashManifestFiles,
	hashFrameworkConfigFiles,
} from "./cache.js";

// ─── Rule Discovery ────────────────────────────────────────────────────

export {
	discoverRuleFiles,
	mergeRules,
	extractCommandsFromRules,
	extractMetadataFromRules,
} from "./rule-discovery.js";

// ─── Command Discovery ─────────────────────────────────────────────────

export {
	parsePackageJsonScripts,
	categorizeCommands,
	detectPackageManager,
	parsePythonCommands,
	parseComposerScripts,
} from "./command-discovery.js";

// ─── Detection Signals ─────────────────────────────────────────────────

export {
	GenericFrameworkDetector,
	scanSignals,
	groupSignalsByFramework,
	calculateSignalConfidence,
	createCompositePlugin,
	GENERIC_SIGNALS,
} from "./signals.js";

// ─── Plugin Interface ──────────────────────────────────────────────────

export { GenericFrameworkDetector as CompositePlugin } from "./signals.js";

// ─── Types ────────────────────────────────────────────────────────────

export type {
	// Core types
	ProjectProfile,
	AnalyzeRequest,
	AnalyzeResult,
	AnalysisErrorCode,
	// Framework types
	FrameworkCategory,
	DetectedFramework,
	DetectionSignal,
	FrameworkAnalyzerPlugin,
	DetectionResult,
	ReadonlyFileSystem,
	// Language types
	DetectedLanguage,
	// Package manager types
	PackageManagerType,
	PackageManagerProfile,
	// Application types
	ApplicationProfile,
	// Command types
	ProjectCommands,
	// Rule types
	ProjectRule,
	RuleSection,
	RulePriority,
	// Test types
	TestRunner,
	TestCapability,
	// Warning types
	WarningCode,
	ProjectWarning,
	// Configuration types
	AnalyzerConfig,
	DEFAULT_ANALYZER_CONFIG,
	// Cache types
	CacheEntry,
	CacheKey,
} from "./types.js";

// Types from other modules
export type { DiscoveredCommand } from "./command-discovery.js";

export type { RuleFile } from "./rule-discovery.js";

export type {
	ScannedFile,
	ScanResult,
} from "./walker.js";

export type { CacheOptions } from "./cache.js";
