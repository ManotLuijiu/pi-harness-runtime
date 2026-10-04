/**
 * SKILL.md Parser
 *
 * Parses skill files with YAML frontmatter and markdown body.
 * Based on pi.dev Agent Skills specification.
 */
import { existsSync, readFileSync } from "node:fs";
/**
 * Simple YAML-like frontmatter parser (subset of YAML for skill frontmatter)
 * Handles: strings, numbers, booleans, arrays, nested objects
 */
function parseFrontmatter(yaml) {
    const result = {};
    const lines = yaml.split("\n");
    let i = 0;
    function parseValue(line, _indent) {
        line = line.trimEnd();
        // Empty line
        if (!line)
            return undefined;
        // Boolean
        if (line === "true")
            return true;
        if (line === "false")
            return false;
        // Number
        if (/^-?\d+(\.\d+)?$/.test(line))
            return Number(line);
        // Quoted string
        if (line.startsWith('"') && line.endsWith('"')) {
            return line.slice(1, -1);
        }
        if (line.startsWith("'") && line.endsWith("'")) {
            return line.slice(1, -1);
        }
        // Array
        if (line.match(/^-\s/)) {
            const arr = [];
            const itemMatch = line.match(/^-\s+(.*)$/);
            if (itemMatch) {
                arr.push(parseValue(itemMatch[1], 0));
            }
            return arr;
        }
        // Plain value
        return line;
    }
    function parseBlock(_key, lines, start) {
        const arr = [];
        let j = start;
        while (j < lines.length) {
            const line = lines[j];
            if (!line.trim()) {
                j++;
                continue;
            }
            const match = line.match(/^-\s+(.*)$/);
            if (match) {
                arr.push(parseValue(match[1], 0));
                j++;
            }
            else {
                break;
            }
        }
        return { value: arr, end: j };
    }
    while (i < lines.length) {
        const line = lines[i];
        // Skip empty lines and comments
        if (!line.trim() || line.trim().startsWith("#")) {
            i++;
            continue;
        }
        // Check for key: value pattern
        const kvMatch = line.match(/^([\w_]+):\s*(.*)$/);
        if (kvMatch) {
            const key = kvMatch[1];
            const value = kvMatch[2].trim();
            // Check if it's an array/block
            if (!value) {
                // Look ahead for array items
                const blockStart = i + 1;
                if (blockStart < lines.length && lines[blockStart].trim().startsWith("- ")) {
                    const { value: blockValue, end } = parseBlock(key, lines, blockStart);
                    result[key] = blockValue;
                    i = end;
                    continue;
                }
                // Empty value
                result[key] = "";
                i++;
                continue;
            }
            result[key] = parseValue(value, 0);
            i++;
            continue;
        }
        i++;
    }
    return result;
}
// Regex patterns for frontmatter
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/**
 * Parse a SKILL.md file
 */
export function parseSkillFile(filePath) {
    if (!existsSync(filePath)) {
        throw new Error(`Skill file not found: ${filePath}`);
    }
    const content = readFileSync(filePath, "utf-8");
    return parseSkillContent(content, filePath);
}
/**
 * Parse SKILL.md content string
 */
export function parseSkillContent(content, filePath) {
    const match = content.match(FRONTMATTER_REGEX);
    if (!match) {
        // No frontmatter - treat entire content as body
        return createSkillWithoutFrontmatter(content, filePath);
    }
    const [, frontmatterStr, body] = match;
    let frontmatter;
    try {
        frontmatter = parseFrontmatter(frontmatterStr);
    }
    catch (err) {
        throw new Error(`Invalid YAML frontmatter in ${filePath}: ${err}`);
    }
    // Extract pi.dev standard fields
    const fm = extractFrontmatter(frontmatter);
    // Extract Hermes extensions
    const hermes = extractHermesExtensions(frontmatter);
    // Validate required fields
    if (!fm.name) {
        throw new Error(`Missing required field 'name' in ${filePath}`);
    }
    if (!fm.description) {
        throw new Error(`Missing required field 'description' in ${filePath}`);
    }
    // Validate name format (kebab-case)
    if (!NAME_REGEX.test(fm.name)) {
        throw new Error(`Invalid skill name '${fm.name}' in ${filePath}. Must be kebab-case (e.g., 'code-review')`);
    }
    // Create skill object
    const skill = {
        id: fm.name,
        path: filePath ? getSkillDirectory(filePath) : "",
        frontmatter: fm,
        hermes,
        body: body.trim(),
        references: [],
        examples: [],
        metadata: mergeMetadata(fm, hermes),
        loaded: false,
    };
    return skill;
}
/**
 * Extract pi.dev standard frontmatter fields
 */
function extractFrontmatter(raw) {
    return {
        name: String(raw.name || ""),
        description: String(raw.description || ""),
        version: raw.version ? String(raw.version) : undefined,
        license: raw.license ? String(raw.license) : undefined,
        compatibility: raw.compatibility ? String(raw.compatibility) : undefined,
        metadata: raw.metadata,
        allowed_tools: Array.isArray(raw.allowed_tools)
            ? raw.allowed_tools.map(String)
            : undefined,
        disable_model_invocation: Boolean(raw.disable_model_invocation),
    };
}
/**
 * Extract Hermes-specific extensions from frontmatter
 */
function extractHermesExtensions(raw) {
    return {
        author: normalizeAuthor(raw.author),
        confidence: typeof raw.confidence === "number"
            ? Math.max(0, Math.min(1, raw.confidence))
            : undefined,
        usage_count: typeof raw.usage_count === "number" ? Math.floor(raw.usage_count) : undefined,
        created_at: raw.created_at ? String(raw.created_at) : undefined,
        updated_at: raw.updated_at ? String(raw.updated_at) : undefined,
        triggers: Array.isArray(raw.triggers)
            ? raw.triggers.map(String)
            : undefined,
        pitfalls: Array.isArray(raw.pitfalls)
            ? raw.pitfalls.map((p) => normalizePitfall(p))
            : undefined,
        anti_patterns: Array.isArray(raw.anti_patterns)
            ? raw.anti_patterns.map(String)
            : undefined,
        auto_update: Boolean(raw.auto_update),
    };
}
/**
 * Normalize author field
 */
function normalizeAuthor(author) {
    if (typeof author === "string") {
        const normalized = author.toLowerCase();
        if (normalized === "agent" ||
            normalized === "user" ||
            normalized === "curator") {
            return normalized;
        }
    }
    return undefined;
}
/**
 * Normalize pitfall entry
 */
function normalizePitfall(p) {
    if (typeof p === "string") {
        return { name: p, why: "" };
    }
    if (typeof p === "object" && p !== null) {
        const obj = p;
        return {
            name: String(obj.name || "unnamed"),
            why: String(obj.why || obj.description || ""),
            affects: obj.affects ? String(obj.affects) : undefined,
        };
    }
    return { name: "unknown", why: "" };
}
/**
 * Create skill without frontmatter (backward compatibility)
 */
function createSkillWithoutFrontmatter(content, filePath) {
    const name = filePath ? getSkillDirectory(filePath).split("/").pop() || "unnamed" : "unnamed";
    return {
        id: name,
        path: filePath ? getSkillDirectory(filePath) : "",
        frontmatter: {
            name,
            description: `Auto-generated skill from ${name}`,
        },
        hermes: {},
        body: content.trim(),
        references: [],
        examples: [],
        metadata: {
            name,
            description: `Auto-generated skill from ${name}`,
        },
        loaded: false,
    };
}
/**
 * Get skill directory from SKILL.md path
 */
function getSkillDirectory(skillFilePath) {
    // Remove /SKILL.md from path
    const match = skillFilePath.match(/^(.*)\/SKILL\.md$/);
    return match ? match[1] : skillFilePath;
}
/**
 * Merge frontmatter and hermes into metadata
 */
function mergeMetadata(fm, hermes) {
    return {
        ...fm,
        ...hermes,
    };
}
/**
 * Scan skill directory for references and examples
 */
export function scanSkillDirectory(skillDir) {
    const references = [];
    const examples = [];
    // Import dynamic dependencies at runtime
    try {
        const { readdirSync, statSync } = require("node:fs");
        const { join, relative } = require("node:path");
        function scanDir(dir, baseDir) {
            if (!existsSync(dir))
                return;
            const entries = readdirSync(dir);
            for (const entry of entries) {
                if (entry.startsWith("."))
                    continue;
                const fullPath = join(dir, entry);
                const stat = statSync(fullPath);
                if (stat.isDirectory()) {
                    if (entry === "references") {
                        scanReferences(fullPath, baseDir, references);
                    }
                    else if (entry === "examples") {
                        scanExamples(fullPath, baseDir, examples);
                    }
                }
            }
        }
        function scanReferences(dir, baseDir, refs) {
            if (!existsSync(dir))
                return;
            const { readdirSync, statSync } = require("node:fs");
            const { join } = require("node:path");
            const entries = readdirSync(dir);
            for (const entry of entries) {
                if (entry.startsWith("."))
                    continue;
                const fullPath = join(dir, entry);
                const stat = statSync(fullPath);
                if (stat.isFile() && /\.(md|txt|json|yaml|yml)$/i.test(entry)) {
                    refs.push({
                        name: entry.replace(/\.(md|txt|json|yaml|yml)$/i, ""),
                        path: fullPath,
                        relativePath: relative(baseDir, fullPath),
                    });
                }
            }
        }
        function scanExamples(dir, baseDir, exs) {
            if (!existsSync(dir))
                return;
            const { readdirSync, statSync } = require("node:fs");
            const { join } = require("node:path");
            const entries = readdirSync(dir);
            for (const entry of entries) {
                if (entry.startsWith("."))
                    continue;
                const fullPath = join(dir, entry);
                const stat = statSync(fullPath);
                if (stat.isFile() && /\.(md|json|txt)$/i.test(entry)) {
                    exs.push({
                        name: entry.replace(/\.(md|json|txt)$/i, ""),
                        path: fullPath,
                        relativePath: relative(baseDir, fullPath),
                    });
                }
            }
        }
        scanDir(skillDir, skillDir);
    }
    catch {
        // Silently ignore fs errors during directory scan
    }
    return { references, examples };
}
/**
 * Serialize skill back to SKILL.md format
 */
export function serializeSkill(skill) {
    const lines = ["---"];
    // Add frontmatter fields
    if (skill.frontmatter.name) {
        lines.push(`name: ${skill.frontmatter.name}`);
    }
    if (skill.frontmatter.description) {
        lines.push(`description: ${skill.frontmatter.description}`);
    }
    if (skill.frontmatter.version) {
        lines.push(`version: ${skill.frontmatter.version}`);
    }
    if (skill.frontmatter.license) {
        lines.push(`license: ${skill.frontmatter.license}`);
    }
    if (skill.frontmatter.compatibility) {
        lines.push(`compatibility: ${skill.frontmatter.compatibility}`);
    }
    if (skill.frontmatter.disable_model_invocation) {
        lines.push(`disable_model_invocation: true`);
    }
    if (skill.frontmatter.allowed_tools?.length) {
        lines.push(`allowed_tools:`);
        for (const tool of skill.frontmatter.allowed_tools) {
            lines.push(`  - ${tool}`);
        }
    }
    // Add Hermes extensions
    if (skill.hermes?.author) {
        lines.push(`author: ${skill.hermes.author}`);
    }
    if (skill.hermes?.confidence !== undefined) {
        lines.push(`confidence: ${skill.hermes.confidence}`);
    }
    if (skill.hermes?.usage_count !== undefined) {
        lines.push(`usage_count: ${skill.hermes.usage_count}`);
    }
    if (skill.hermes?.triggers?.length) {
        lines.push(`triggers:`);
        for (const trigger of skill.hermes.triggers) {
            lines.push(`  - "${trigger}"`);
        }
    }
    if (skill.hermes?.pitfalls?.length) {
        lines.push(`pitfalls:`);
        for (const pitfall of skill.hermes.pitfalls) {
            lines.push(`  - name: ${pitfall.name}`);
            if (pitfall.why) {
                lines.push(`    why: ${pitfall.why}`);
            }
            if (pitfall.affects) {
                lines.push(`    affects: ${pitfall.affects}`);
            }
        }
    }
    if (skill.hermes?.anti_patterns?.length) {
        lines.push(`anti_patterns:`);
        for (const anti of skill.hermes.anti_patterns) {
            lines.push(`  - "${anti}"`);
        }
    }
    if (skill.hermes?.auto_update !== undefined) {
        lines.push(`auto_update: ${skill.hermes.auto_update}`);
    }
    // Add timestamps
    const now = new Date().toISOString();
    if (!skill.hermes?.created_at) {
        lines.push(`created_at: ${now}`);
    }
    lines.push(`updated_at: ${now}`);
    // Add metadata if present
    if (skill.frontmatter.metadata && Object.keys(skill.frontmatter.metadata).length > 0) {
        lines.push(`metadata:`);
        for (const [key, value] of Object.entries(skill.frontmatter.metadata)) {
            lines.push(`  ${key}: ${JSON.stringify(value)}`);
        }
    }
    lines.push("---");
    lines.push("");
    lines.push(skill.body);
    return lines.join("\n");
}
/**
 * Generate SKILL.md from trajectory or partial skill
 */
export function generateSkillFromTemplate(template, overrides) {
    const skill = {
        id: template.id || "new-skill",
        path: template.path || "",
        frontmatter: {
            name: overrides?.name || template.frontmatter?.name || "new-skill",
            description: overrides?.description ||
                template.frontmatter?.description ||
                "Auto-generated skill",
            version: overrides?.version || template.frontmatter?.version || "1.0.0",
            ...overrides,
        },
        hermes: template.hermes || {},
        body: template.body || "",
        references: [],
        examples: [],
        metadata: {},
        loaded: false,
    };
    return serializeSkill(skill);
}
//# sourceMappingURL=parser.js.map