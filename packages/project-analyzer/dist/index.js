/**
 * Project Analyzer
 *
 * A comprehensive project analysis system for pi-harness-runtime.
 * Detects frameworks, languages, commands, rules, and project structure.
 */
// ─── SDK Version ───────────────────────────────────────────────────────
export { SDK_VERSION } from "./types.js";
// ─── Analyzer ──────────────────────────────────────────────────────────
export { ProjectAnalyzer, createProjectAnalyzer, detectLanguages, detectTestCapabilities, } from "./analyzer.js";
// ─── File System Walker ─────────────────────────────────────────────────
export { FileSystemWalker, createReadonlyFileSystem, } from "./walker.js";
// ─── Cache ─────────────────────────────────────────────────────────────
export { AnalysisCache, hashRuleFiles, hashManifestFiles, hashFrameworkConfigFiles, } from "./cache.js";
// ─── Rule Discovery ────────────────────────────────────────────────────
export { discoverRuleFiles, mergeRules, extractCommandsFromRules, extractMetadataFromRules, } from "./rule-discovery.js";
// ─── Command Discovery ─────────────────────────────────────────────────
export { parsePackageJsonScripts, categorizeCommands, detectPackageManager, parsePythonCommands, parseComposerScripts, } from "./command-discovery.js";
// ─── Detection Signals ─────────────────────────────────────────────────
export { GenericFrameworkDetector, scanSignals, groupSignalsByFramework, calculateSignalConfidence, createCompositePlugin, GENERIC_SIGNALS, } from "./signals.js";
// ─── Plugin Interface ──────────────────────────────────────────────────
export { GenericFrameworkDetector as CompositePlugin } from "./signals.js";
//# sourceMappingURL=index.js.map