/**
 * CLI Plugin SDK — NPM Registry Client (RFC-0067)
 */
import type { PluginSearchResult } from "./types.js";
/**
 * Query npm registry for plugins matching query
 */
export declare function searchPlugins(query: string, registry?: string): Promise<PluginSearchResult[]>;
/**
 * Get package info from npm
 */
export declare function getPackageInfo(name: string, registry?: string): Promise<{
    version: string;
    description: string;
} | null>;
//# sourceMappingURL=registry.d.ts.map