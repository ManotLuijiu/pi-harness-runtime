/**
 * Skill Versioning
 *
 * Track skill changes, store diff history, support rollback.
 * Based on Hermes Agent's skill versioning.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
/**
 * Default configuration
 */
export const DEFAULT_VERSIONING_CONFIG = {
    enabled: true,
    versionsDir: "~/.pi-harness/skill-versions",
    maxVersions: 50,
};
/**
 * Expand path with ~
 */
function expandPath(path) {
    if (path.startsWith("~/")) {
        return join(homedir(), path.slice(2));
    }
    return path;
}
/**
 * Generate changes summary
 */
function generateChanges(oldContent, newContent) {
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");
    // Simple line diff
    let linesAdded = 0;
    let linesRemoved = 0;
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    for (const line of newLines) {
        if (!oldSet.has(line)) {
            linesAdded++;
        }
    }
    for (const line of oldLines) {
        if (!newSet.has(line)) {
            linesRemoved++;
        }
    }
    // Generate summary
    let summary = "";
    if (linesAdded > 0 && linesRemoved > 0) {
        summary = `Modified ${linesAdded} lines, removed ${linesRemoved}`;
    }
    else if (linesAdded > 0) {
        summary = `Added ${linesAdded} lines`;
    }
    else if (linesRemoved > 0) {
        summary = `Removed ${linesRemoved} lines`;
    }
    else {
        summary = "Minor changes";
    }
    return {
        body: {
            linesAdded,
            linesRemoved,
            summary,
        },
    };
}
/**
 * Skill versioning class
 */
export class SkillVersioning {
    config;
    versionsDir;
    cache = new Map();
    constructor(config) {
        this.config = { ...DEFAULT_VERSIONING_CONFIG, ...config };
        this.versionsDir = expandPath(this.config.versionsDir);
        mkdirSync(this.versionsDir, { recursive: true });
    }
    /**
     * Record a new version
     */
    recordVersion(skillId, content, author = "agent", message) {
        // Get current version number
        const versions = this.getVersions(skillId);
        const lastVersion = versions[0];
        const lastVersionNum = lastVersion
            ? parseInt(lastVersion.version.split(".")[2] || "0", 10)
            : 0;
        const newVersion = `1.0.${lastVersionNum + 1}`;
        // Generate changes
        const changes = lastVersion
            ? generateChanges(lastVersion.content, content)
            : { body: { linesAdded: content.split("\n").length, linesRemoved: 0, summary: "Initial version" } };
        const version = {
            id: `${skillId}_v${Date.now()}`,
            skillId,
            version: newVersion,
            createdAt: new Date().toISOString(),
            author,
            changes,
            content,
            message,
        };
        // Add to cache and save
        versions.unshift(version);
        this.cache.set(skillId, versions);
        this.saveVersion(skillId, versions);
        // Trim old versions
        this.trimVersions(skillId);
        return version;
    }
    /**
     * Get versions for a skill
     */
    getVersions(skillId) {
        if (this.cache.has(skillId)) {
            return this.cache.get(skillId);
        }
        const filePath = join(this.versionsDir, `${skillId}.json`);
        if (!existsSync(filePath)) {
            return [];
        }
        try {
            const content = readFileSync(filePath, "utf-8");
            const versions = JSON.parse(content);
            this.cache.set(skillId, versions);
            return versions;
        }
        catch (err) {
            console.error(`[SkillVersioning] Failed to load ${filePath}:`, err);
            return [];
        }
    }
    /**
     * Get specific version
     */
    getVersion(skillId, version) {
        const versions = this.getVersions(skillId);
        return versions.find((v) => v.version === version) ?? null;
    }
    /**
     * Get latest version
     */
    getLatestVersion(skillId) {
        const versions = this.getVersions(skillId);
        return versions[0] ?? null;
    }
    /**
     * Rollback to previous version
     */
    rollback(skillId, targetVersion) {
        const version = this.getVersion(skillId, targetVersion);
        if (!version) {
            return null;
        }
        // Record the rollback as a new version
        return this.recordVersion(skillId, version.content, "user", `Rolled back to version ${targetVersion}`);
    }
    /**
     * Get diff between versions
     */
    getDiff(skillId, fromVersion, toVersion) {
        const from = this.getVersion(skillId, fromVersion);
        const to = this.getVersion(skillId, toVersion);
        if (!from || !to) {
            return { from: null, to: null, changes: null };
        }
        const changes = generateChanges(from.content, to.content);
        return { from, to, changes };
    }
    /**
     * Save version to disk
     */
    saveVersion(skillId, versions) {
        const filePath = join(this.versionsDir, `${skillId}.json`);
        try {
            writeFileSync(filePath, JSON.stringify(versions, null, 2), "utf-8");
        }
        catch (err) {
            console.error(`[SkillVersioning] Failed to save ${filePath}:`, err);
        }
    }
    /**
     * Trim old versions
     */
    trimVersions(skillId) {
        const versions = this.cache.get(skillId);
        if (!versions || versions.length <= this.config.maxVersions) {
            return;
        }
        const trimmed = versions.slice(0, this.config.maxVersions);
        this.cache.set(skillId, trimmed);
        this.saveVersion(skillId, trimmed);
    }
    /**
     * List all skills with versions
     */
    listSkills() {
        try {
            const { readdirSync } = require("node:fs");
            const files = readdirSync(this.versionsDir);
            return files
                .filter((f) => f.endsWith(".json"))
                .map((f) => f.replace(".json", ""));
        }
        catch (err) {
            return [];
        }
    }
    /**
     * Get version history summary
     */
    getHistorySummary(skillId) {
        const versions = this.getVersions(skillId);
        const authors = {};
        for (const v of versions) {
            authors[v.author] = (authors[v.author] || 0) + 1;
        }
        return {
            totalVersions: versions.length,
            authors,
            lastModified: versions[0]?.createdAt ?? null,
        };
    }
}
// Global instance
let globalVersioning = null;
export function getGlobalSkillVersioning() {
    if (!globalVersioning) {
        globalVersioning = new SkillVersioning();
    }
    return globalVersioning;
}
export function createSkillVersioning(config) {
    return new SkillVersioning(config);
}
//# sourceMappingURL=skill-versioning.js.map