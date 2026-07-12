/**
 * Project Analyzer
 *
 * A comprehensive project analysis system for pi-harness-runtime.
 * Detects frameworks, languages, commands, rules, and project structure.
 */
export { SDK_VERSION } from "./types.js";
export { ProjectAnalyzer, createProjectAnalyzer, detectLanguages, detectTestCapabilities, } from "./analyzer.js";
export { FileSystemWalker, createReadonlyFileSystem, } from "./walker.js";
export { AnalysisCache, hashRuleFiles, hashManifestFiles, hashFrameworkConfigFiles, } from "./cache.js";
export { discoverRuleFiles, mergeRules, extractCommandsFromRules, extractMetadataFromRules, } from "./rule-discovery.js";
export { parsePackageJsonScripts, categorizeCommands, detectPackageManager, parsePythonCommands, parseComposerScripts, } from "./command-discovery.js";
export { GenericFrameworkDetector, scanSignals, groupSignalsByFramework, calculateSignalConfidence, createCompositePlugin, GENERIC_SIGNALS, } from "./signals.js";
export { GenericFrameworkDetector as CompositePlugin } from "./signals.js";
export type { ProjectProfile, AnalyzeRequest, AnalyzeResult, AnalysisErrorCode, FrameworkCategory, DetectedFramework, DetectionSignal, FrameworkAnalyzerPlugin, DetectionResult, ReadonlyFileSystem, DetectedLanguage, PackageManagerType, PackageManagerProfile, ApplicationProfile, ProjectCommands, ProjectRule, RuleSection, RulePriority, TestRunner, TestCapability, WarningCode, ProjectWarning, AnalyzerConfig, DEFAULT_ANALYZER_CONFIG, CacheEntry, CacheKey, } from "./types.js";
export type { DiscoveredCommand } from "./command-discovery.js";
export type { RuleFile } from "./rule-discovery.js";
export type { ScannedFile, ScanResult, } from "./walker.js";
export type { CacheOptions } from "./cache.js";
//# sourceMappingURL=index.d.ts.map