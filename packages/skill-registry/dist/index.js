/**
 * Skill Registry Package (RFC-0052)
 *
 * A centralized registry for dynamic skill discovery and invocation.
 *
 * @example
 * ```typescript
 * import { createSkillRegistry } from "@pi-harness/skill-registry";
 *
 * const registry = createSkillRegistry();
 *
 * // Find skills by trigger
 * const skills = registry.find({ type: "keyword", value: "help" });
 *
 * // Invoke a skill
 * const result = await registry.invoke("skill-help", context);
 * ```
 */
// Registry
export { InMemorySkillRegistry, createSkillRegistry } from "./registry.js";
// Defaults
export { DEFAULT_SKILLS } from "./defaults.js";
// Matching utilities
export { matchTrigger, findBestMatch, findAllMatches, createKeywordTrigger, createIntentTrigger, createPatternTrigger, } from "./matching.js";
//# sourceMappingURL=index.js.map