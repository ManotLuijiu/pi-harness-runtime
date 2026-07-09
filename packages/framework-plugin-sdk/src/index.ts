/**
 * Framework Plugin SDK
 *
 * Extensible plugin system for framework integrations.
 */

// ─── Manager ──────────────────────────────────────────────────────────

export {
	PluginManager,
	createPluginManager,
} from "./manager.js";

// ─── Types ────────────────────────────────────────────────────────────

export {
	SDK_VERSION,
	type PluginCapability,
	type PluginStatus,
	type PluginManifest,
	type PluginConfiguration,
	type ConfigSchemaEntry,
	type HookDefinition,
	type PluginPermission,
	type Plugin,
	type PluginLifecycleEvent,
	type LifecycleContext,
	type HookHandler,
	type HookFunction,
	type HookResult,
	type ProviderExtension,
	type FrameworkExtension,
	type GeneratorExtension,
	type LinterExtension,
	type TemplateExtension,
	type ValidatorExtension,
	type ToolExtension,
	type SandboxConfig,
	type SandboxResult,
	type RegistryEntry,
	type PluginManagerConfig,
	type LoadOptions,
	PluginError,
	PluginErrorCode,
} from "./types.js";
