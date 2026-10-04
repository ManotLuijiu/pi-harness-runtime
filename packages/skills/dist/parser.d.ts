/**
 * SKILL.md Parser
 *
 * Parses skill files with YAML frontmatter and markdown body.
 * Based on pi.dev Agent Skills specification.
 */
import type { Skill, SkillFrontmatter, SkillReference, SkillExample } from "./types.js";
/**
 * Parse a SKILL.md file
 */
export declare function parseSkillFile(filePath: string): Skill;
/**
 * Parse SKILL.md content string
 */
export declare function parseSkillContent(content: string, filePath?: string): Skill;
/**
 * Scan skill directory for references and examples
 */
export declare function scanSkillDirectory(skillDir: string): {
    references: SkillReference[];
    examples: SkillExample[];
};
/**
 * Serialize skill back to SKILL.md format
 */
export declare function serializeSkill(skill: Skill): string;
/**
 * Generate SKILL.md from trajectory or partial skill
 */
export declare function generateSkillFromTemplate(template: Partial<Skill>, overrides?: Partial<SkillFrontmatter>): string;
export type { SkillPitfall } from "./types.js";
//# sourceMappingURL=parser.d.ts.map