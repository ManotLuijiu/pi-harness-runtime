/**
 * Framework Plugin SDK - Plugin Manager
 *
 * Main plugin management system.
 */
import { PluginError, PluginErrorCode } from "./types.js";
// ─── Default Configuration ─────────────────────────────────────────────────
const DEFAULT_CONFIG = {
    pluginDir: "./plugins",
    autoLoad: false,
    autoActivate: false,
    patterns: ["**/plugin.json", "**/manifest.json"],
    sandbox: {
        timeout: 30000,
        memoryLimit: 128 * 1024 * 1024,
        networkAccess: false,
        filesystemAccess: "own",
        allowEval: false,
    },
    hooks: true,
    logLevel: "warn",
};
// ─── Plugin Manager ───────────────────────────────────────────────────────
export class PluginManager {
    config;
    plugins = new Map();
    hooks = new Map();
    registry = new Map();
    lifecycleListeners = new Map();
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Register a plugin from manifest
     */
    async register(manifest) {
        // Check if already registered
        if (this.plugins.has(manifest.id)) {
            throw new PluginError(`Plugin '${manifest.id}' is already registered`, PluginErrorCode.ALREADY_LOADED, manifest.id);
        }
        // Validate manifest
        this.validateManifest(manifest);
        // Create plugin instance
        const plugin = {
            id: manifest.id,
            manifest,
            status: "registered",
            configuration: manifest.configuration?.defaults ?? {},
            capabilities: new Map(),
        };
        // Store plugin
        this.plugins.set(manifest.id, plugin);
        // Register capabilities
        for (const capability of manifest.capabilities) {
            this.registry.set(`${manifest.id}:${capability}`, {
                id: `${manifest.id}:${capability}`,
                name: manifest.name,
                version: manifest.version,
                pluginId: manifest.id,
                capability,
            });
        }
        return plugin;
    }
    /**
     * Load a plugin
     */
    async load(options) {
        const { plugin: pluginSpec, config } = options;
        // Get or create manifest
        let manifest;
        if (typeof pluginSpec === "string" && pluginSpec.includes(".")) {
            // Load from file/path
            manifest = await this.loadManifest(pluginSpec);
        }
        else if (typeof pluginSpec === "object") {
            manifest = pluginSpec;
        }
        else {
            // Look up from registry
            const existing = this.plugins.get(pluginSpec);
            if (!existing) {
                throw new PluginError(`Plugin '${pluginSpec}' not found`, PluginErrorCode.NOT_LOADED, pluginSpec);
            }
            manifest = existing.manifest;
        }
        // Register if not already
        let plugin = this.plugins.get(manifest.id);
        if (!plugin) {
            plugin = await this.register(manifest);
        }
        // Apply configuration
        if (config) {
            plugin.configuration = { ...plugin.configuration, ...config };
        }
        // Update status
        plugin.status = "loaded";
        plugin.loadedAt = new Date().toISOString();
        // Emit lifecycle event
        await this.emitLifecycle("afterLoad", plugin.id);
        return plugin;
    }
    /**
     * Initialize a plugin
     */
    async initialize(pluginId) {
        const plugin = this.getPlugin(pluginId);
        if (!plugin) {
            throw new PluginError(`Plugin '${pluginId}' not found`, PluginErrorCode.NOT_LOADED, pluginId);
        }
        await this.emitLifecycle("beforeInitialize", pluginId);
        // Plugin initialization logic would go here
        // For now, just update status
        plugin.status = "initialized";
        await this.emitLifecycle("afterInitialize", pluginId);
    }
    /**
     * Activate a plugin
     */
    async activate(pluginId) {
        const plugin = this.getPlugin(pluginId);
        if (!plugin) {
            throw new PluginError(`Plugin '${pluginId}' not found`, PluginErrorCode.NOT_LOADED, pluginId);
        }
        if (plugin.status === "active") {
            return; // Already active
        }
        await this.emitLifecycle("beforeActivate", pluginId);
        // Register hooks from manifest
        if (this.config.hooks && plugin.manifest.hooks) {
            for (const hookDef of plugin.manifest.hooks) {
                this.registerHook({
                    id: `${pluginId}:${hookDef.name}`,
                    name: hookDef.name,
                    pluginId,
                    priority: 0,
                    handler: async () => { },
                    description: hookDef.description,
                });
            }
        }
        // Update status
        plugin.status = "active";
        plugin.activatedAt = new Date().toISOString();
        await this.emitLifecycle("afterActivate", pluginId);
    }
    /**
     * Deactivate a plugin
     */
    async deactivate(pluginId) {
        const plugin = this.getPlugin(pluginId);
        if (!plugin) {
            return;
        }
        if (plugin.status !== "active") {
            return;
        }
        await this.emitLifecycle("beforeDeactivate", pluginId);
        // Unregister hooks
        for (const [, handlers] of this.hooks) {
            for (const handler of handlers) {
                if (handler.pluginId === pluginId) {
                    handlers.delete(handler);
                }
            }
        }
        // Update status
        plugin.status = "inactive";
        plugin.activatedAt = undefined;
        await this.emitLifecycle("afterDeactivate", pluginId);
    }
    /**
     * Unload a plugin
     */
    async unload(pluginId) {
        const plugin = this.getPlugin(pluginId);
        if (!plugin) {
            return;
        }
        // Deactivate if active
        if (plugin.status === "active") {
            await this.deactivate(pluginId);
        }
        await this.emitLifecycle("beforeUnload", pluginId);
        // Remove from registry
        for (const [key, entry] of this.registry) {
            if (entry.pluginId === pluginId) {
                this.registry.delete(key);
            }
        }
        // Remove plugin
        this.plugins.delete(pluginId);
        await this.emitLifecycle("afterUnload", pluginId);
    }
    /**
     * Get a plugin
     */
    getPlugin(pluginId) {
        return this.plugins.get(pluginId);
    }
    /**
     * List all plugins
     */
    listPlugins() {
        return Array.from(this.plugins.values());
    }
    /**
     * List plugins by status
     */
    listByStatus(status) {
        return this.listPlugins().filter((p) => p.status === status);
    }
    /**
     * Register a hook handler
     */
    registerHook(handler) {
        if (!this.hooks.has(handler.name)) {
            this.hooks.set(handler.name, new Set());
        }
        const handlers = this.hooks.get(handler.name);
        handlers.add(handler);
        // Sort by priority (higher first)
        const sorted = Array.from(handlers).sort((a, b) => b.priority - a.priority);
        this.hooks.set(handler.name, new Set(sorted));
    }
    /**
     * Unregister a hook handler
     */
    unregisterHook(handlerId) {
        for (const handlers of this.hooks.values()) {
            for (const handler of handlers) {
                if (handler.id === handlerId) {
                    return handlers.delete(handler);
                }
            }
        }
        return false;
    }
    /**
     * Execute hooks for a name
     */
    async executeHooks(hookName, context) {
        const startTime = Date.now();
        const handlers = this.hooks.get(hookName);
        if (!handlers || handlers.size === 0) {
            return {
                hook: hookName,
                handlers: 0,
                results: [],
                durationMs: Date.now() - startTime,
            };
        }
        const results = [];
        for (const handler of handlers) {
            try {
                const result = await handler.handler(context);
                results.push(result);
            }
            catch (error) {
                results.push({
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        return {
            hook: hookName,
            handlers: handlers.size,
            results,
            durationMs: Date.now() - startTime,
        };
    }
    /**
     * Get capabilities by type
     */
    getCapabilities(capability) {
        const results = [];
        for (const entry of this.registry.values()) {
            if (entry.capability === capability) {
                results.push(entry);
            }
        }
        return results;
    }
    /**
     * Get capability instance
     */
    getCapability(pluginId, capability) {
        const plugin = this.getPlugin(pluginId);
        if (!plugin) {
            return undefined;
        }
        return plugin.capabilities.get(capability);
    }
    /**
     * Register capability
     */
    registerCapability(pluginId, capability, instance) {
        const plugin = this.getPlugin(pluginId);
        if (!plugin) {
            throw new PluginError(`Plugin '${pluginId}' not found`, PluginErrorCode.NOT_LOADED, pluginId);
        }
        plugin.capabilities.set(capability, instance);
    }
    /**
     * Add lifecycle event listener
     */
    onLifecycle(event, listener) {
        if (!this.lifecycleListeners.has(event)) {
            this.lifecycleListeners.set(event, new Set());
        }
        this.lifecycleListeners.get(event).add(listener);
    }
    /**
     * Remove lifecycle event listener
     */
    offLifecycle(event, listener) {
        this.lifecycleListeners.get(event)?.delete(listener);
    }
    /**
     * Emit lifecycle event
     */
    async emitLifecycle(event, pluginId) {
        const listeners = this.lifecycleListeners.get(event);
        if (!listeners)
            return;
        const ctx = {
            pluginId,
            event,
            timestamp: new Date().toISOString(),
        };
        for (const listener of listeners) {
            try {
                await listener(ctx);
            }
            catch (error) {
                this.log("error", `Lifecycle listener error: ${error}`);
            }
        }
    }
    /**
     * Load manifest from file
     */
    async loadManifest(path) {
        // In production, this would read and parse the file
        // For now, throw an error
        throw new PluginError(`Cannot load manifest from '${path}' - file loading not implemented`, PluginErrorCode.MANIFEST_NOT_FOUND);
    }
    /**
     * Validate manifest
     */
    validateManifest(manifest) {
        if (!manifest.id) {
            throw new PluginError("Plugin manifest must have an 'id' field", PluginErrorCode.MANIFEST_INVALID);
        }
        if (!manifest.name) {
            throw new PluginError("Plugin manifest must have a 'name' field", PluginErrorCode.MANIFEST_INVALID);
        }
        if (!manifest.version) {
            throw new PluginError("Plugin manifest must have a 'version' field", PluginErrorCode.MANIFEST_INVALID);
        }
        if (!manifest.capabilities || manifest.capabilities.length === 0) {
            throw new PluginError("Plugin manifest must declare at least one capability", PluginErrorCode.MANIFEST_INVALID);
        }
    }
    /**
     * Log message
     */
    log(level, message) {
        const levels = ["debug", "info", "warn", "error"];
        const configLevel = levels.indexOf(this.config.logLevel);
        const msgLevel = levels.indexOf(level);
        if (msgLevel >= configLevel) {
            console[level === "debug" ? "log" : level](`[PluginManager] ${message}`);
        }
    }
}
// ─── Factory Function ──────────────────────────────────────────────────────
/**
 * Create a plugin manager
 */
export function createPluginManager(config) {
    return new PluginManager(config);
}
//# sourceMappingURL=manager.js.map