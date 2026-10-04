/**
 * Curator - Consolidation and Quality Enforcement
 *
 * Periodic pass that:
 * - Merges fragmented memory into skills
 * - Extracts common patterns into skills
 * - Prunes outdated items
 * - Enforces quality standards
 *
 * Based on Hermes Agent's curator system.
 */
import type { Trajectory } from "./types.js";
import type { MemoryEntry } from "./memory-store.js";
/**
 * Local Skill type to avoid circular dependency
 */
interface LocalSkill {
    id: string;
    frontmatter: {
        name: string;
        description: string;
    };
    hermes?: {
        author?: string;
        created_at?: string;
        usage_count?: number;
    };
}
/**
 * Curator configuration
 */
export interface CuratorConfig {
    /** Enable curator */
    enabled: boolean;
    /** Days between consolidation passes */
    consolidationIntervalDays: number;
    /** Max memory entries before consolidation */
    memoryThreshold: number;
    /** Min similar entries to trigger merge */
    similarityThreshold: number;
    /** Archive skills older than this */
    archiveAgeDays: number;
}
/**
 * Default curator configuration
 */
export declare const DEFAULT_CURATOR_CONFIG: CuratorConfig;
/**
 * Curator action types
 */
export type CuratorAction = {
    type: "merge_memory";
    entries: MemoryEntry[];
    into: string;
} | {
    type: "extract_skill";
    pattern: string;
    from: string[];
} | {
    type: "archive_memory";
    id: string;
} | {
    type: "archive_skill";
    id: string;
} | {
    type: "patch_skill";
    id: string;
    patch: Partial<LocalSkill>;
} | {
    type: "prune_low_confidence";
    items: {
        id: string;
        type: "memory" | "skill";
        confidence: number;
    }[];
};
/**
 * Curator event types
 */
export type CuratorEvent = {
    type: "curator.started";
} | {
    type: "curator.completed";
    actions: CuratorAction[];
} | {
    type: "curator.action";
    action: CuratorAction;
} | {
    type: "curator.error";
    error: string;
};
/**
 * Curator event handler
 */
export type CuratorEventHandler = (event: CuratorEvent) => void;
/**
 * Similarity result
 */
export interface SimilarityResult {
    entries: MemoryEntry[];
    similarity: number;
    commonTheme: string;
}
/**
 * Curator class
 */
export declare class Curator {
    private config;
    private handlers;
    private lastConsolidation;
    constructor(config?: Partial<CuratorConfig>);
    /**
     * Register event handler
     */
    on(handler: CuratorEventHandler): () => void;
    /**
     * Emit event
     */
    private emit;
    /**
     * Check if consolidation should run
     */
    shouldConsolidate(): boolean;
    /**
     * Run consolidation pass
     */
    consolidate(memory: MemoryEntry[], skills: LocalSkill[], trajectories: Trajectory[]): Promise<CuratorAction[]>;
    /**
     * Find similar memory entries
     */
    findSimilarMemory(memory: MemoryEntry[]): SimilarityResult[];
    /**
     * Extract key terms from content
     */
    private extractTerms;
    /**
     * Suggest memory merge
     */
    private suggestMerge;
    /**
     * Extract patterns from trajectories
     */
    extractPatterns(trajectories: Trajectory[]): string[];
    /**
     * Categorize task from request
     */
    private categorizeTask;
    /**
     * Suggest skill extraction
     */
    private suggestSkillExtraction;
    /**
     * Find outdated items
     */
    findOutdatedItems(memory: MemoryEntry[], skills: LocalSkill[]): Array<{
        id: string;
        type: "memory" | "skill";
        ageDays: number;
    }>;
    /**
     * Suggest archive action
     */
    private suggestArchive;
    /**
     * Suggest skill patch
     */
    private suggestSkillPatch;
    /**
     * Get quality summary
     */
    getQualitySummary(skills: LocalSkill[]): {
        total: number;
        errors: number;
        warnings: number;
        byRule: Record<string, number>;
    };
    /**
     * Update configuration
     */
    updateConfig(config: Partial<CuratorConfig>): void;
    /**
     * Get configuration
     */
    getConfig(): CuratorConfig;
}
export declare function getGlobalCurator(): Curator;
export declare function createCurator(config?: Partial<CuratorConfig>): Curator;
export {};
//# sourceMappingURL=curator.d.ts.map