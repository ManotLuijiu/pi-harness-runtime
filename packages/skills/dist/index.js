/**
 * Skills Package - File-based skill system with pi.dev compatibility
 *
 * Implements Hermes-style self-improving skills with:
 * - pi.dev Agent Skills specification compatibility
 * - Progressive disclosure (lazy loading)
 * - Background review and auto-improvement
 * - Hermes-style linter for quality checks
 */
// Re-export all modules
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
import { scanForSkillsSync } from "./scanner.js";
import { getGlobalSkillRegistry } from "./loader.js";
/**
 * Initialize skills system
 *
 * A caller (a test) can pass its own registry, so the initialization does
 * not have to touch the global one.
 */
export function initSkills(config) {
    const registry = config?.registry ?? getGlobalSkillRegistry();
    // Scan for skills
    const scanOptions = {};
    // Only set directories if explicitly provided, otherwise use defaults
    if (config?.locations !== undefined) {
        scanOptions.directories = config.locations;
    }
    if (config?.maxDepth !== undefined)
        scanOptions.maxDepth = config.maxDepth;
    if (config?.includeHidden !== undefined)
        scanOptions.includeHidden = config.includeHidden;
    const result = scanForSkillsSync(scanOptions);
    // Register skills in global registry
    for (const skill of result.skills) {
        registry.register(skill);
    }
    // The scan can find the same skill twice: a symlinked directory is
    // scanned twice, because the scanner follows the path it is given. The
    // registry keeps one entry per id, so the count of the local skills is
    // the count of the DISTINCT skills - and not the count of the files
    // that were read.
    const distinct = new Map();
    for (const skill of result.skills)
        distinct.set(skill.id, skill);
    return { ...result, skills: [...distinct.values()], registry };
}
/**
 * Get skills summary
 */
export function getSkillsSummary() {
    const registry = getGlobalSkillRegistry();
    const skills = registry.list();
    const byAuthor = {
        agent: 0,
        user: 0,
        curator: 0,
        unknown: 0,
    };
    for (const skill of skills) {
        const author = skill.hermes?.author ?? "unknown";
        if (author in byAuthor) {
            byAuthor[author]++;
        }
        else {
            byAuthor.unknown++;
        }
    }
    return {
        total: skills.length,
        loaded: skills.filter((s) => s.loaded).length,
        byAuthor,
    };
}
// Default configuration
export const DEFAULT_SKILL_CONFIG = {
    enabled: true,
    locations: [
        "~/.pi-harness/skills",
        "skills",
        ".agents/skills",
    ],
    write_approval: false,
    auto_create_threshold: 3,
    auto_patch_threshold: 1,
    progressive_disclosure: true,
    default_author: "agent",
};
//# sourceMappingURL=index.js.map