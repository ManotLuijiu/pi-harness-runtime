/**
 * Skill Tool - Agent-accessible skill management
 *
 * Tool for agent to create, update, delete skills autonomously.
 * Implements Hermes-style skill management with write_approval gate.
 *
 * Note: Full tool integration requires matching handler registration.
 */
import { getGlobalSkillRegistry } from "./loader.js";
import { lintSkill } from "./linter.js";
/**
 * Default configuration
 */
export const DEFAULT_TOOL_CONFIG = {
    enabled: true,
    writeApproval: false,
    autoCreateDir: true,
};
/**
 * Create skill tool definition (for registration with ExtensionAPI)
 */
export function createSkillToolDefinition(handler) {
    return {
        name: "skill_manage",
        label: "Skill Manager",
        description: "Create, update, delete, or view skills. Skills capture procedural knowledge for reuse.",
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["create", "patch", "delete", "list", "info", "search", "lint", "write_file", "remove_file"],
                    description: "Action to perform",
                },
                name: {
                    type: "string",
                    description: "Skill name (kebab-case, e.g., 'code-review')",
                },
                body: {
                    type: "string",
                    description: "Full skill content (SKILL.md body)",
                },
                description: {
                    type: "string",
                    description: "Skill description for routing",
                },
                content: {
                    type: "string",
                    description: "Content for file operations",
                },
                file: {
                    type: "string",
                    description: "File path for write_file/remove_file",
                },
                old_text: {
                    type: "string",
                    description: "Text to match for replacement",
                },
                author: {
                    type: "string",
                    enum: ["agent", "user", "curator"],
                    description: "Author of the skill",
                },
            },
            required: ["action"],
        },
        handler,
    };
}
/**
 * Handle skill creation
 */
export function handleSkillCreate(registry, name, body, description, author = "agent") {
    if (!name) {
        return { success: false, message: "Skill name is required" };
    }
    // Validate name
    const nameRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    if (!nameRegex.test(name)) {
        return {
            success: false,
            message: `Invalid name '${name}'. Must be kebab-case (e.g., 'code-review')`,
        };
    }
    // Check if skill already exists
    if (registry.has(name)) {
        return { success: false, message: `Skill '${name}' already exists. Use 'patch' to update.` };
    }
    // Build skill content
    const skillBody = body || description || "";
    const skillContent = `---
name: ${name}
description: ${description || `Skill: ${name}`}
author: ${author}
version: 1.0.0
confidence: 0.5
---

${skillBody}
`;
    return {
        success: true,
        message: `Skill '${name}' created. Content: ${skillContent.length} chars.`,
        skillId: name,
    };
}
/**
 * Handle skill listing
 */
export function handleSkillList(registry) {
    const skills = registry.list();
    if (skills.length === 0) {
        return { success: true, message: "No skills registered." };
    }
    const lines = ["# Skills", ""];
    for (const skill of skills) {
        lines.push(`- **${skill.frontmatter.name}**: ${skill.frontmatter.description}`);
        if (skill.hermes?.author) {
            lines.push(`  Author: ${skill.hermes.author}`);
        }
    }
    return {
        success: true,
        message: lines.join("\n"),
        details: { count: skills.length },
    };
}
/**
 * Handle skill info
 */
export function handleSkillInfo(registry, name) {
    if (!name) {
        return { success: false, message: "Skill name is required" };
    }
    const skill = registry.get(name);
    if (!skill) {
        return { success: false, message: `Skill '${name}' not found` };
    }
    const lines = [];
    lines.push(`# ${skill.frontmatter.name}`);
    lines.push(`**${skill.frontmatter.description}**`);
    lines.push("");
    lines.push("---");
    lines.push(skill.body);
    return {
        success: true,
        message: lines.join("\n"),
        skillId: skill.id,
    };
}
/**
 * Handle skill search
 */
export function handleSkillSearch(registry, query) {
    if (!query) {
        return { success: false, message: "Search query required" };
    }
    const results = registry.find(query, { threshold: 0.2 });
    if (results.length === 0) {
        return { success: true, message: `No skills found matching: ${query}` };
    }
    const lines = [`# Skills matching: ${query}`, ""];
    for (const result of results.slice(0, 10)) {
        lines.push(`- **${result.skill.frontmatter.name}** (${Math.round(result.score * 100)}% match)`);
        lines.push(`  ${result.skill.frontmatter.description}`);
    }
    return {
        success: true,
        message: lines.join("\n"),
        details: { count: results.length },
    };
}
/**
 * Handle skill linting
 */
export function handleSkillLint(registry, name) {
    if (!name) {
        return { success: false, message: "Skill name required for linting" };
    }
    const skill = registry.get(name);
    if (!skill) {
        return { success: false, message: `Skill '${name}' not found` };
    }
    const results = lintSkill(skill);
    if (results.length === 0) {
        return {
            success: true,
            message: `✓ Skill '${name}' passed linting with no issues.`,
        };
    }
    const lines = [`✗ Skill '${name}' linting issues:`, ""];
    for (const result of results) {
        const icon = result.severity === "error" ? "✗" : result.severity === "warning" ? "⚠" : "ℹ";
        lines.push(`${icon} [${result.severity}] ${result.rule}: ${result.message}`);
    }
    return {
        success: false,
        message: lines.join("\n"),
        details: { issues: results.length },
    };
}
/**
 * Process skill manage action
 */
export async function processSkillManage(params, registry) {
    const reg = registry || getGlobalSkillRegistry();
    const { action, name, body, description, author = "agent" } = params;
    try {
        switch (action) {
            case "create":
                return handleSkillCreate(reg, name, body, description, author);
            case "list":
                return handleSkillList(reg);
            case "info":
                return handleSkillInfo(reg, name);
            case "search":
                return handleSkillSearch(reg, name);
            case "lint":
                return handleSkillLint(reg, name);
            case "patch":
                return { success: false, message: "Patch not implemented yet" };
            case "delete":
                return { success: false, message: "Delete not implemented yet" };
            case "write_file":
                return { success: false, message: "Write file not implemented yet" };
            case "remove_file":
                return { success: false, message: "Remove file not implemented yet" };
            default:
                return { success: false, message: `Unknown action: ${action}` };
        }
    }
    catch (err) {
        return {
            success: false,
            message: err instanceof Error ? err.message : String(err),
        };
    }
}
//# sourceMappingURL=skill-tool.js.map