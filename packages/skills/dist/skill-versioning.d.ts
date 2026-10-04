/**
 * Skill Versioning
 *
 * Track skill changes, store diff history, support rollback.
 * Based on Hermes Agent's skill versioning.
 */
/**
 * Skill version entry
 */
export interface SkillVersion {
    id: string;
    skillId: string;
    version: string;
    createdAt: string;
    author: "agent" | "user" | "curator";
    changes: SkillChanges;
    content: string;
    message?: string;
}
/**
 * Skill changes (diff summary)
 */
export interface SkillChanges {
    frontmatter?: {
        added?: Record<string, unknown>;
        removed?: Record<string, unknown>;
        changed?: Record<string, {
            from: unknown;
            to: unknown;
        }>;
    };
    body?: {
        linesAdded: number;
        linesRemoved: number;
        summary: string;
    };
    references?: {
        added: string[];
        removed: string[];
    };
}
/**
 * Skill versioning store
 */
export interface SkillVersioningStore {
    versions: SkillVersion[];
    currentVersion: string;
}
/**
 * Skill versioning configuration
 */
export interface SkillVersioningConfig {
    /** Enable versioning */
    enabled: boolean;
    /** Directory for version storage */
    versionsDir: string;
    /** Max versions to keep per skill */
    maxVersions: number;
}
/**
 * Default configuration
 */
export declare const DEFAULT_VERSIONING_CONFIG: SkillVersioningConfig;
/**
 * Skill versioning class
 */
export declare class SkillVersioning {
    private config;
    private versionsDir;
    private cache;
    constructor(config?: Partial<SkillVersioningConfig>);
    /**
     * Record a new version
     */
    recordVersion(skillId: string, content: string, author?: "agent" | "user" | "curator", message?: string): SkillVersion;
    /**
     * Get versions for a skill
     */
    getVersions(skillId: string): SkillVersion[];
    /**
     * Get specific version
     */
    getVersion(skillId: string, version: string): SkillVersion | null;
    /**
     * Get latest version
     */
    getLatestVersion(skillId: string): SkillVersion | null;
    /**
     * Rollback to previous version
     */
    rollback(skillId: string, targetVersion: string): SkillVersion | null;
    /**
     * Get diff between versions
     */
    getDiff(skillId: string, fromVersion: string, toVersion: string): {
        from: SkillVersion | null;
        to: SkillVersion | null;
        changes: SkillChanges | null;
    };
    /**
     * Save version to disk
     */
    private saveVersion;
    /**
     * Trim old versions
     */
    private trimVersions;
    /**
     * List all skills with versions
     */
    listSkills(): string[];
    /**
     * Get version history summary
     */
    getHistorySummary(skillId: string): {
        totalVersions: number;
        authors: Record<string, number>;
        lastModified: string | null;
    };
}
export declare function getGlobalSkillVersioning(): SkillVersioning;
export declare function createSkillVersioning(config?: Partial<SkillVersioningConfig>): SkillVersioning;
//# sourceMappingURL=skill-versioning.d.ts.map