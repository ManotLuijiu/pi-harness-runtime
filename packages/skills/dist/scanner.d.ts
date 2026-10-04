/**
 * Skill Directory Scanner
 *
 * Recursively scans directories for skills (directories containing SKILL.md).
 * Supports pi.dev Agent Skills locations:
 * - ~/.pi-harness/skills
 * - skills/ (relative to cwd)
 * - .agents/skills/ (pi.dev compatible)
 */
import type { ScanOptions, ScanResult } from "./types.js";
/**
 * Scan multiple directories for skills
 */
export declare function scanForSkills(options?: Partial<ScanOptions>): Promise<ScanResult>;
/**
 * Scan for skills synchronously (for use at startup)
 */
export declare function scanForSkillsSync(options?: Partial<ScanOptions>): ScanResult;
/**
 * Resolve skill locations from options
 */
export declare function resolveSkillLocations(locations?: string[]): string[];
/**
 * Check if a path is a valid skill directory
 */
export declare function isSkillDirectory(path: string): boolean;
/**
 * Watch directories for skill changes
 */
export declare function watchSkillDirectories(directories: string[], onChange: (event: "add" | "change" | "unlink", skillPath: string) => void, options?: {
    pollInterval?: number;
}): () => void;
//# sourceMappingURL=scanner.d.ts.map