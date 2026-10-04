/**
 * Skill Directory Scanner
 *
 * Recursively scans directories for skills (directories containing SKILL.md).
 * Supports pi.dev Agent Skills locations:
 * - ~/.pi-harness/skills
 * - skills/ (relative to cwd)
 * - .agents/skills/ (pi.dev compatible)
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { homedir } from "node:os";
import { parseSkillFile, scanSkillDirectory } from "./parser.js";
/**
 * Default scan options
 */
const DEFAULT_SCAN_OPTIONS = {
    directories: [
        "~/.pi-harness-runtime/skills",
        "~/.pi/skills",
        "skills",
        ".agents/skills",
    ],
    maxDepth: 10,
    includeHidden: false,
};
/**
 * Expand ~ in paths to home directory
 */
function expandPath(path) {
    if (path.startsWith("~/")) {
        return join(homedir(), path.slice(2));
    }
    return path;
}
/**
 * Check if a path should be included based on patterns
 */
function matchesPattern(path, patterns) {
    if (!patterns || patterns.length === 0) {
        return true;
    }
    for (const pattern of patterns) {
        if (path.includes(pattern)) {
            return true;
        }
    }
    return false;
}
/**
 * Recursively scan a directory for skills
 */
function scanDirectory(dir, options, scannedPaths, errors, depth = 0) {
    const skillDirs = [];
    // Skip if max depth exceeded
    if (options.maxDepth !== undefined && depth > options.maxDepth) {
        return skillDirs;
    }
    // Normalize and resolve path
    const normalizedPath = normalize(expandPath(dir));
    // Skip if already scanned
    if (scannedPaths.has(normalizedPath)) {
        return skillDirs;
    }
    scannedPaths.add(normalizedPath);
    // Skip if doesn't exist
    if (!existsSync(normalizedPath)) {
        return skillDirs;
    }
    try {
        const entries = readdirSync(normalizedPath);
        for (const entry of entries) {
            // Skip hidden directories if not included
            if (entry.startsWith(".") && !options.includeHidden) {
                continue;
            }
            const fullPath = join(normalizedPath, entry);
            try {
                const stat = statSync(fullPath);
                if (stat.isDirectory()) {
                    // Check if this directory contains a SKILL.md
                    const skillMdPath = join(fullPath, "SKILL.md");
                    if (existsSync(skillMdPath)) {
                        // Found a skill!
                        skillDirs.push(fullPath);
                    }
                    else {
                        // Recurse into subdirectory
                        const subSkills = scanDirectory(fullPath, options, scannedPaths, errors, depth + 1);
                        skillDirs.push(...subSkills);
                    }
                }
            }
            catch (err) {
                errors.push({
                    path: fullPath,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
    }
    catch (err) {
        errors.push({
            path: normalizedPath,
            error: err instanceof Error ? err.message : String(err),
        });
    }
    return skillDirs;
}
/**
 * Scan multiple directories for skills
 */
export async function scanForSkills(options) {
    const startTime = Date.now();
    const mergedOptions = {
        ...DEFAULT_SCAN_OPTIONS,
        ...options,
    };
    const scannedPaths = new Set();
    const errors = [];
    const skillDirs = [];
    for (const dir of mergedOptions.directories) {
        const dirs = scanDirectory(dir, mergedOptions, scannedPaths, errors, 0);
        skillDirs.push(...dirs);
    }
    // Parse each skill directory
    const skills = [];
    for (const skillDir of skillDirs) {
        try {
            const skillMdPath = join(skillDir, "SKILL.md");
            const skill = parseSkillFile(skillMdPath);
            // Scan for references and examples
            const { references, examples } = scanSkillDirectory(skillDir);
            skill.references = references;
            skill.examples = examples;
            skills.push(skill);
        }
        catch (err) {
            errors.push({
                path: skillDir,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return {
        skills,
        errors,
        scannedPaths: Array.from(scannedPaths),
        durationMs: Date.now() - startTime,
    };
}
/**
 * Scan for skills synchronously (for use at startup)
 */
export function scanForSkillsSync(options) {
    const startTime = Date.now();
    const mergedOptions = {
        ...DEFAULT_SCAN_OPTIONS,
        ...options,
    };
    const scannedPaths = new Set();
    const errors = [];
    const skillDirs = [];
    for (const dir of mergedOptions.directories) {
        const dirs = scanDirectory(dir, mergedOptions, scannedPaths, errors, 0);
        skillDirs.push(...dirs);
    }
    // Parse each skill directory
    const skills = [];
    for (const skillDir of skillDirs) {
        try {
            const skillMdPath = join(skillDir, "SKILL.md");
            const skill = parseSkillFile(skillMdPath);
            // Scan for references and examples
            const { references, examples } = scanSkillDirectory(skillDir);
            skill.references = references;
            skill.examples = examples;
            skills.push(skill);
        }
        catch (err) {
            errors.push({
                path: skillDir,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return {
        skills,
        errors,
        scannedPaths: Array.from(scannedPaths),
        durationMs: Date.now() - startTime,
    };
}
/**
 * Resolve skill locations from options
 */
export function resolveSkillLocations(locations) {
    const defaults = DEFAULT_SCAN_OPTIONS.directories;
    if (!locations || locations.length === 0) {
        return defaults.map(expandPath);
    }
    return locations.map(expandPath);
}
/**
 * Check if a path is a valid skill directory
 */
export function isSkillDirectory(path) {
    const skillMdPath = join(expandPath(path), "SKILL.md");
    return existsSync(skillMdPath);
}
/**
 * Watch directories for skill changes
 */
export function watchSkillDirectories(directories, onChange, options) {
    const pollInterval = options?.pollInterval ?? 5000;
    const lastModified = new Map();
    const check = () => {
        for (const dir of directories) {
            const expandedDir = expandPath(dir);
            if (!existsSync(expandedDir))
                continue;
            try {
                const entries = readdirSync(expandedDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory() || entry.name.startsWith("."))
                        continue;
                    const skillPath = join(expandedDir, entry.name);
                    const skillMdPath = join(skillPath, "SKILL.md");
                    if (!existsSync(skillMdPath))
                        continue;
                    try {
                        const stat = statSync(skillMdPath);
                        const mtime = stat.mtimeMs;
                        const lastMtime = lastModified.get(skillPath);
                        if (!lastMtime) {
                            lastModified.set(skillPath, mtime);
                            onChange("add", skillPath);
                        }
                        else if (mtime > lastMtime) {
                            lastModified.set(skillPath, mtime);
                            onChange("change", skillPath);
                        }
                    }
                    catch {
                        // File might have been deleted
                    }
                }
            }
            catch {
                // Directory might not exist
            }
        }
    };
    const interval = setInterval(check, pollInterval);
    // Return cleanup function
    return () => clearInterval(interval);
}
//# sourceMappingURL=scanner.js.map