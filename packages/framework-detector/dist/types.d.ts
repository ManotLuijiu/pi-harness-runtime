/**
 * Framework Detector - Types
 *
 * Core types for framework detection.
 */
/**
 * SDK version for compatibility checks
 */
export declare const SDK_VERSION = "1.0.0";
/**
 * Framework category
 */
export type FrameworkCategory = "frontend" | "backend" | "fullstack" | "mobile" | "desktop" | "library" | "tool";
/**
 * Framework signature
 */
export interface FrameworkSignature {
    id: string;
    name: string;
    category: FrameworkCategory;
    description: string;
    signals: DetectionSignal[];
    requires?: string[];
    implies?: string[];
    excludes?: string[];
    versionParser?: string;
    tags?: string[];
}
/**
 * Detection signal
 */
export interface DetectionSignal {
    type: SignalType;
    pattern: string;
    weight: number;
    source?: SignalType;
    path?: string;
}
/**
 * Signal type
 */
export type SignalType = "file" | "directory" | "package" | "dependency" | "config" | "import" | "content";
/**
 * Detection result
 */
export interface DetectionResult {
    framework: FrameworkInfo;
    confidence: number;
    signals: MatchedSignal[];
    version?: string;
    metadata?: Record<string, unknown>;
}
/**
 * Framework info
 */
export interface FrameworkInfo {
    id: string;
    name: string;
    category: FrameworkCategory;
    description: string;
    tags: string[];
}
/**
 * Matched signal
 */
export interface MatchedSignal {
    signal: DetectionSignal;
    match: string;
    path?: string;
    weight: number;
}
/**
 * Project analysis result
 */
export interface ProjectAnalysis {
    projectPath: string;
    frameworks: DetectionResult[];
    primaryFramework?: DetectionResult;
    language?: string;
    packageManager?: PackageManager;
    hasTypeScript?: boolean;
    hasTests?: boolean;
    files: ScannedFile[];
    scanTimeMs: number;
}
/**
 * Scanned file
 */
export interface ScannedFile {
    path: string;
    exists: boolean;
    content?: string;
    matches: string[];
}
/**
 * Package manager
 */
export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";
/**
 * File pattern
 */
export interface FilePattern {
    pattern: string;
    type: "glob" | "regex";
}
/**
 * Project type
 */
export interface ProjectType {
    name: string;
    frameworks: string[];
    indicators: string[];
}
/**
 * Version detection result
 */
export interface VersionDetectionResult {
    version: string;
    major: number;
    minor: number;
    patch: number;
    suffix?: string;
    raw: string;
}
/**
 * Version parser
 */
export interface VersionParser {
    parse(versionString: string): VersionDetectionResult | null;
}
/**
 * Scan options
 */
export interface ScanOptions {
    /**
     * Project root path
     */
    rootPath: string;
    /**
     * File patterns to scan
     */
    patterns?: string[];
    /**
     * Directories to exclude
     */
    exclude?: string[];
    /**
     * Scan depth limit
     */
    maxDepth?: number;
    /**
     * Enable caching
     */
    cache?: boolean;
    /**
     * Cache TTL in milliseconds
     */
    cacheTtlMs?: number;
}
/**
 * Scan result
 */
export interface ScanResult {
    files: ScannedFile[];
    packageJson?: PackageJson;
    configs: ConfigFile[];
    scanTimeMs: number;
}
/**
 * Package.json
 */
export interface PackageJson {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    engines?: Record<string, string>;
    scripts?: Record<string, string>;
}
/**
 * Config file
 */
export interface ConfigFile {
    path: string;
    name: string;
    content?: string;
    type: string;
}
/**
 * Watch event
 */
export interface WatchEvent {
    type: "add" | "change" | "unlink";
    path: string;
    timestamp: string;
}
/**
 * Watcher options
 */
export interface WatcherOptions {
    patterns?: string[];
    exclude?: string[];
    debounceMs?: number;
    onFrameworkChange?: (result: ProjectAnalysis) => void;
}
/**
 * Detector configuration
 */
export interface DetectorConfig {
    /**
     * Confidence threshold (0-1)
     */
    confidenceThreshold?: number;
    /**
     * Enable version detection
     */
    detectVersions?: boolean;
    /**
     * Enable framework implications
     */
    resolveImplications?: boolean;
    /**
     * Cache scan results
     */
    cache?: boolean;
    /**
     * Cache TTL
     */
    cacheTtlMs?: number;
    /**
     * Scan timeout
     */
    timeoutMs?: number;
    /**
     * Custom signatures
     */
    signatures?: FrameworkSignature[];
}
//# sourceMappingURL=types.d.ts.map