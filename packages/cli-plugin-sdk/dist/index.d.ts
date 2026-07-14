/**
 * CLI Plugin SDK — Main Entry (RFC-0067)
 */
import type { PluginCLIConfig, InstalledPlugin, PluginSearchResult, InvokeResult } from "./types.js";
export type { PluginCLIConfig, InstalledPlugin, PluginSearchResult, InvokeResult, };
/**
 * CLI SDK for managing pi-harness plugins
 */
export declare class PluginCLI {
    private readonly config;
    constructor(config?: PluginCLIConfig);
    /** Install a plugin from npm */
    install(name: string, options?: {
        version?: string;
        global?: boolean;
    }): Promise<void>;
    /** Remove an installed plugin */
    remove(name: string): Promise<void>;
    /** List all installed plugins */
    list(): Promise<InstalledPlugin[]>;
    /** Update plugin(s) */
    update(name?: string): Promise<void>;
    /** Search npm for plugins */
    search(query: string): Promise<PluginSearchResult[]>;
    /** Invoke a plugin exported function */
    invoke(pluginName: string, command: string, args?: Record<string, unknown>): Promise<InvokeResult>;
    /** Get path to an installed plugin */
    getPluginPath(name: string): string | null;
}
//# sourceMappingURL=index.d.ts.map