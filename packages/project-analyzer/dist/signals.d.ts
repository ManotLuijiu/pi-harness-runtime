/**
 * Detection Signals
 *
 * Generic detection signals for common project types.
 * These are used by the analyzer when no specific plugin matches.
 */
import type { DetectionSignal, FrameworkCategory, FrameworkAnalyzerPlugin, ReadonlyFileSystem, DetectionResult } from "./types.js";
export interface SignalDefinition {
    /** Signal identifier */
    id: string;
    /** File path pattern to match */
    pattern: string;
    /** Signal weight (0-1) */
    weight: number;
    /** Associated framework category */
    framework: FrameworkCategory;
    /** Additional metadata */
    metadata?: Record<string, string>;
}
/**
 * Standard detection signals for common frameworks.
 */
export declare const GENERIC_SIGNALS: SignalDefinition[];
/**
 * Scan for detection signals in the filesystem.
 */
export declare function scanSignals(fs: ReadonlyFileSystem, signals?: SignalDefinition[]): Promise<DetectionSignal[]>;
/**
 * Group signals by framework category.
 */
export declare function groupSignalsByFramework(signals: DetectionSignal[], frameworkMap: Map<FrameworkCategory, SignalDefinition[]>): Map<FrameworkCategory, DetectionSignal[]>;
/**
 * Calculate confidence score from signals.
 */
export declare function calculateSignalConfidence(signals: DetectionSignal[], requiredSignals: number): number;
/**
 * Generic framework detector using signal-based detection.
 */
export declare class GenericFrameworkDetector {
    private signals;
    private signalsPerFramework;
    constructor(signals?: SignalDefinition[]);
    /**
     * Detect frameworks using signals.
     */
    detect(fs: ReadonlyFileSystem): Promise<DetectionResult[]>;
}
/**
 * Create a composite plugin from generic signals and custom plugins.
 */
export declare function createCompositePlugin(customPlugins: FrameworkAnalyzerPlugin[]): FrameworkAnalyzerPlugin;
//# sourceMappingURL=signals.d.ts.map