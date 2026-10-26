/**
 * Skills Package - File-based skill system with pi.dev compatibility
 *
 * Implements Hermes-style self-improving skills with:
 * - pi.dev Agent Skills specification compatibility
 * - Progressive disclosure (lazy loading)
 * - Background review and auto-improvement
 * - Hermes-style linter for quality checks
 */
export * from "./types.js";
export * from "./parser.js";
export * from "./scanner.js";
export * from "./loader.js";
export * from "./vector-schema.js";
export * from "./sanitize.js";
export * from "./remote-source.js";
export * from "./skill-commands.js";
export * from "./skill-tool.js";
export * from "./skill-versioning.js";
export * from "./linter.js";
export * from "./sync-source.js";
import type { SkillsConfig, ScanResult } from "./types.js";
import { type SkillRegistry } from "./loader.js";
/**
 * The result of the skill initialization.
 *
 * The registry is part of the result so a caller can ask the vector store
 * about its state (how many skills it holds) without reaching for the
 * global registry.
 */
export interface SkillsInitResult extends ScanResult {
    /** The registry the skills were registered in. */
    registry: SkillRegistry;
}
/**
 * Initialize skills system
 *
 * A caller (a test) can pass its own registry, so the initialization does
 * not have to touch the global one.
 */
export declare function initSkills(config?: Partial<SkillsConfig & {
    maxDepth?: number;
    includeHidden?: boolean;
    registry?: SkillRegistry;
}>): SkillsInitResult;
/**
 * Get skills summary
 */
export declare function getSkillsSummary(): {
    total: number;
    loaded: number;
    byAuthor: {
        agent: number;
        user: number;
        curator: number;
        unknown: number;
    };
};
export declare const DEFAULT_SKILL_CONFIG: SkillsConfig;
//# sourceMappingURL=index.d.ts.map