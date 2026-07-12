/**
 * Rule Discovery
 *
 * Discovers and parses project rules from AGENTS.md, RULES.md, etc.
 */
import type { ProjectRule } from "./types.js";
/**
 * Rule file metadata.
 */
export interface RuleFile {
    /** Absolute path to rule file */
    path: string;
    /** File name without path */
    name: string;
    /** Parsed content */
    content: string;
    /** Whether user explicitly created this file */
    userDefined: boolean;
}
/**
 * Parse a rule file and extract structured content.
 */
export declare function parseRuleFile(file: RuleFile): Promise<ProjectRule>;
/**
 * Discover rule files in a repository.
 */
export declare function discoverRuleFiles(rootPath: string, fs: {
    exists(path: string): Promise<boolean>;
    readFile(path: string): Promise<string>;
    readDir(path: string): Promise<string[]>;
    isDirectory(path: string): Promise<boolean>;
}, fileNames?: string[]): Promise<RuleFile[]>;
/**
 * Merge multiple rule files into a coherent set.
 * Later rules override earlier ones for conflicting sections.
 */
export declare function mergeRules(ruleFiles: RuleFile[], prioritizeUserDefined?: boolean): ProjectRule[];
/**
 * Extract commands from rules.
 * Looks for command patterns like `npm run`, `bun test`, etc.
 */
export declare function extractCommandsFromRules(rules: ProjectRule[]): {
    permitted: string[];
    prohibited: string[];
};
/**
 * Extract key-value metadata from rules.
 */
export declare function extractMetadataFromRules(rules: ProjectRule[]): Record<string, string>;
//# sourceMappingURL=rule-discovery.d.ts.map