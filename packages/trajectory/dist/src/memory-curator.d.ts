/**
 * Memory Curator - Autonomous self-improvement for MEMORY.md
 *
 * Uses Jev to judge:
 * 1. Is this a stable fact worth adding to MEMORY.md?
 * 2. Is anything in MEMORY.md stale/outdated?
 *
 * Based on Hermes Agent's self-improvement pattern.
 */
/**
 * Configuration for autonomous curation
 */
export interface MemoryCuratorConfig {
    /** Jev API key */
    apiKey: string;
    /** Jev confidence threshold for auto-add (default: 0.85) */
    autoAddThreshold?: number;
    /** Jev confidence threshold for auto-remove (default: 0.7) */
    autoRemoveThreshold?: number;
    /** Minimum entries before pruning (default: 5) */
    minEntriesForPrune?: number;
    /** Check interval in ms (default: 30 minutes) */
    checkIntervalMs?: number;
    /** Max facts to propose per check (default: 2) */
    maxProposalsPerCheck?: number;
}
/**
 * Result of a curation check
 */
export interface CurationResult {
    added: string[];
    removed: number;
    errors: string[];
    timestamp: number;
}
/**
 * Memory Curator - Autonomous curation using Jev
 */
export declare class MemoryCurator {
    private config;
    private timer;
    private lastCheck;
    private _disposed;
    private memoryFile;
    constructor(config: MemoryCuratorConfig);
    /**
     * Start autonomous curation cycle
     */
    start(): void;
    /**
     * Stop autonomous curation
     */
    stop(): void;
    /**
     * Run one curation cycle
     */
    runCuration(): Promise<CurationResult>;
    /**
     * Parse entries from MEMORY.md
     */
    private parseEntries;
    isRunning(): boolean;
    getLastCheck(): number;
}
//# sourceMappingURL=memory-curator.d.ts.map