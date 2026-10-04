/**
 * Wiki Prompt Trigger
 *
 * Detects when an agent reads a prompt from {project}/wiki/*
 * This triggers the write-review loop.
 */
import type { ReviewTriggerContext } from "./types.js";
/**
 * Detect if a file path is a wiki prompt
 */
export declare function isWikiPrompt(filePath: string, projectPath: string): boolean;
/**
 * Extract prompt metadata from wiki path
 */
export declare function parseWikiPrompt(filePath: string, projectPath: string): {
    category: string;
    filename: string;
} | null;
/**
 * Get all wiki prompt files in a project
 */
export declare function getWikiPrompts(projectPath: string): {
    path: string;
    category: string;
    filename: string;
}[];
/**
 * Create trigger context from a wiki read event
 */
export declare function createTriggerContext(filePath: string, projectPath: string, triggerType?: ReviewTriggerContext["triggerType"]): ReviewTriggerContext | null;
/**
 * Check if current working directory has wiki prompts
 */
export declare function hasWikiPrompts(projectPath: string): boolean;
/**
 * Get wiki directory path
 */
export declare function getWikiDir(projectPath: string): string;
//# sourceMappingURL=trigger.d.ts.map