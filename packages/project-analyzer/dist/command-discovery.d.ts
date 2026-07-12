/**
 * Command Discovery
 *
 * Discovers project commands from package.json, pyproject.toml, and other config files.
 */
import type { ProjectCommands, PackageManagerType } from "./types.js";
/**
 * Discovered command entry.
 */
export interface DiscoveredCommand {
    /** Command string */
    command: string;
    /** Source file path */
    source: string;
    /** Whether this is a primary command */
    primary: boolean;
}
/**
 * Parse npm/yarn/pnpm scripts from package.json.
 */
export declare function parsePackageJsonScripts(packageJson: Record<string, unknown>): DiscoveredCommand[];
/**
 * Parse Python scripts from pyproject.toml or setup.py.
 */
export declare function parsePythonCommands(content: string): DiscoveredCommand[];
/**
 * Categorize commands by type.
 */
export declare function categorizeCommands(commands: DiscoveredCommand[]): ProjectCommands;
/**
 * Determine the primary package manager from project files.
 */
export declare function detectPackageManager(files: string[]): PackageManagerType | null;
/**
 * Parse composer.json scripts for Laravel/PHP.
 */
export declare function parseComposerScripts(composerJson: Record<string, unknown>): DiscoveredCommand[];
//# sourceMappingURL=command-discovery.d.ts.map