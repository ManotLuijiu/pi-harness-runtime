/**
 * CLI Plugin SDK — Filesystem Operations (RFC-0067)
 */
import type { InstalledPlugin, PluginCLIConfig } from "./types.js";
/**
 * Resolve plugin directory from config
 */
export declare function resolvePluginDir(config: PluginCLIConfig): string;
/**
 * Check if a plugin is installed
 */
export declare function isInstalled(name: string, config: PluginCLIConfig): boolean;
/**
 * Get installed plugin info
 */
export declare function getInstalledPlugin(name: string, config: PluginCLIConfig): InstalledPlugin | null;
/**
 * List all installed pi-* plugins
 */
export declare function listInstalledPlugins(config: PluginCLIConfig): InstalledPlugin[];
//# sourceMappingURL=plugin-fs.d.ts.map