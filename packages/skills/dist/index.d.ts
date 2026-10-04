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
export * from "./skill-commands.js";
export * from "./skill-tool.js";
export * from "./skill-versioning.js";
export * from "./linter.js";
import type { SkillsConfig, ScanResult } from "./types.js";
/**
 * Initialize skills system
 */
export declare function initSkills(config?: Partial<SkillsConfig & {
    maxDepth?: number;
    includeHidden?: boolean;
}>): ScanResult;
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