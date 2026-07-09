/**
 * Framework Detector
 *
 * Intelligent framework detection system with confidence scoring.
 */

// ─── Detector ──────────────────────────────────────────────────────────

export {
	FrameworkDetector,
	createFrameworkDetector,
} from "./detector.js";

// ─── Signatures ────────────────────────────────────────────────────────

export {
	SignatureRegistry,
	getDefaultSignatures,
} from "./signatures/registry.js";

// ─── Types ───────────────────────────────────────────────────────────

export {
	SDK_VERSION,
	type FrameworkCategory,
	type FrameworkSignature,
	type DetectionSignal,
	type SignalType,
	type DetectionResult,
	type FrameworkInfo,
	type MatchedSignal,
	type ProjectAnalysis,
	type ScannedFile,
	type PackageManager,
	type FilePattern,
	type ProjectType,
	type VersionDetectionResult,
	type VersionParser,
	type ScanOptions,
	type ScanResult,
	type PackageJson,
	type ConfigFile,
	type WatchEvent,
	type WatcherOptions,
	type DetectorConfig,
} from "./types.js";
