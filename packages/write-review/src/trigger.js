/**
 * Wiki Prompt Trigger
 *
 * Detects when an agent reads a prompt from {project}/wiki/*
 * This triggers the write-review loop.
 */
import { existsSync } from "fs";
import { join, relative } from "path";
const DEFAULT_WIKI_DIR = "wiki";
/**
 * Detect if a file path is a wiki prompt
 */
export function isWikiPrompt(filePath, projectPath) {
    const wikiDir = join(projectPath, DEFAULT_WIKI_DIR);
    const normalizedPath = filePath.replace(/\\/g, "/");
    const normalizedWiki = wikiDir.replace(/\\/g, "/");
    return (normalizedPath.startsWith(normalizedWiki + "/") ||
        normalizedPath.startsWith(normalizedWiki + "\\"));
}
/**
 * Extract prompt metadata from wiki path
 */
export function parseWikiPrompt(filePath, projectPath) {
    const wikiDir = join(projectPath, DEFAULT_WIKI_DIR);
    const rel = relative(wikiDir, filePath).replace(/\\/g, "/");
    if (!rel || rel.startsWith(".."))
        return null;
    const parts = rel.split("/");
    if (parts.length >= 2) {
        return {
            category: parts[0],
            filename: parts.slice(1).join("/"),
        };
    }
    return {
        category: "root",
        filename: parts[0],
    };
}
/**
 * Get all wiki prompt files in a project
 */
export function getWikiPrompts(projectPath) {
    const wikiDir = join(projectPath, DEFAULT_WIKI_DIR);
    if (!existsSync(wikiDir)) {
        return [];
    }
    const prompts = [];
    function scanDir(dir) {
        const { readdirSync, statSync } = require("fs");
        try {
            for (const entry of readdirSync(dir)) {
                const fullPath = join(dir, entry);
                const stat = statSync(fullPath);
                if (stat.isDirectory()) {
                    scanDir(fullPath);
                }
                else if (stat.isFile() &&
                    (entry.endsWith(".md") || entry.endsWith(".txt"))) {
                    const relPath = relative(wikiDir, fullPath).replace(/\\/g, "/");
                    const parts = relPath.split("/");
                    prompts.push({
                        path: fullPath,
                        category: parts[0],
                        filename: parts.slice(1).join("/"),
                    });
                }
            }
        }
        catch {
            // Ignore permission errors
        }
    }
    scanDir(wikiDir);
    return prompts;
}
/**
 * Create trigger context from a wiki read event
 */
export function createTriggerContext(filePath, projectPath, triggerType = "wiki_read") {
    if (!isWikiPrompt(filePath, projectPath)) {
        return null;
    }
    const parsed = parseWikiPrompt(filePath, projectPath);
    if (!parsed)
        return null;
    return {
        projectPath,
        promptFile: filePath,
        promptContent: "", // Will be filled by caller
        triggerType,
    };
}
/**
 * Check if current working directory has wiki prompts
 */
export function hasWikiPrompts(projectPath) {
    const wikiDir = join(projectPath, DEFAULT_WIKI_DIR);
    return existsSync(wikiDir);
}
/**
 * Get wiki directory path
 */
export function getWikiDir(projectPath) {
    return join(projectPath, DEFAULT_WIKI_DIR);
}
