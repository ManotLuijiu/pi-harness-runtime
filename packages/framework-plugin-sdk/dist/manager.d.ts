/**
 * Framework Plugin SDK - Plugin Manager
 *
 * Main plugin management system.
 */
import type { HookHandler, HookResult, LifecycleContext, LoadOptions, Plugin, PluginCapability, PluginLifecycleEvent, PluginManagerConfig, PluginManifest, PluginStatus, RegistryEntry } from "./types.js";
export declare class PluginManager {
    private readonly config;
    private readonly plugins;
    private readonly hooks;
    private readonly registry;
    private lifecycleListeners;
    constructor(config?: PluginManagerConfig);
    /**
     * Register a plugin from manifest
     */
    register(manifest: PluginManifest): Promise<Plugin>;
    /**
     * Load a plugin
     */
    load(options: LoadOptions): Promise<Plugin>;
    /**
     * Initialize a plugin
     */
    initialize(pluginId: string): Promise<void>;
    /**
     * Activate a plugin
     */
    activate(pluginId: string): Promise<void>;
    /**
     * Deactivate a plugin
     */
    deactivate(pluginId: string): Promise<void>;
    /**
     * Unload a plugin
     */
    unload(pluginId: string): Promise<void>;
    /**
     * Get a plugin
     */
    getPlugin(pluginId: string): Plugin | undefined;
    /**
     * List all plugins
     */
    listPlugins(): Plugin[];
    /**
     * List plugins by status
     */
    listByStatus(status: PluginStatus): Plugin[];
    /**
     * Register a hook handler
     */
    registerHook(handler: HookHandler): void;
    /**
     * Unregister a hook handler
     */
    unregisterHook(handlerId: string): boolean;
    /**
     * Execute hooks for a name
     */
    executeHooks(hookName: string, context: unknown): Promise<HookResult>;
    /**
     * Get capabilities by type
     */
    getCapabilities(capability: PluginCapability): RegistryEntry[];
    /**
     * Get capability instance
     */
    getCapability(pluginId: string, capability: PluginCapability): unknown | undefined;
    /**
     * Register capability
     */
    registerCapability(pluginId: string, capability: PluginCapability, instance: unknown): void;
    /**
     * Add lifecycle event listener
     */
    onLifecycle(event: PluginLifecycleEvent, listener: (ctx: LifecycleContext) => void): void;
    /**
     * Remove lifecycle event listener
     */
    offLifecycle(event: PluginLifecycleEvent, listener: (ctx: LifecycleContext) => void): void;
    /**
     * Emit lifecycle event
     */
    private emitLifecycle;
    /**
     * Load manifest from file
     */
    private loadManifest;
    /**
     * Validate manifest
     */
    private validateManifest;
    /**
     * Log message
     */
    private log;
}
/**
 * Create a plugin manager
 */
export declare function createPluginManager(config?: PluginManagerConfig): PluginManager;
//# sourceMappingURL=manager.d.ts.map