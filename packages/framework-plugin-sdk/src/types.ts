/**
 * Framework Plugin SDK - Types
 *
 * Core types for the plugin system.
 */

// ─── SDK Version ────────────────────────────────────────────────────────────

/**
 * SDK version for compatibility checks
 */
export const SDK_VERSION = "1.0.0";

// ─── Plugin Types ─────────────────────────────────────────────────────────────

/**
 * Plugin capability
 */
export type PluginCapability =
	| "provider"
	| "framework"
	| "generator"
	| "linter"
	| "template"
	| "validator"
	| "tool"
	| "hook";

/**
 * Plugin status
 */
export type PluginStatus =
	| "registered"
	| "loaded"
	| "initialized"
	| "active"
	| "inactive"
	| "error"
	| "unloaded";

/**
 * Plugin manifest
 */
export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	description: string;
	author?: string;
	license?: string;
	homepage?: string;
	repository?: string;
	capabilities: PluginCapability[];
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	entryPoint?: string;
	configuration?: PluginConfiguration;
	hooks?: HookDefinition[];
	permissions?: PluginPermission[];
	compatibility?: {
		minSdkVersion?: string;
		maxSdkVersion?: string;
	};
}

/**
 * Plugin configuration schema
 */
export interface PluginConfiguration {
	schema?: Record<string, ConfigSchemaEntry>;
	defaults?: Record<string, unknown>;
}

/**
 * Config schema entry
 */
export interface ConfigSchemaEntry {
	type: "string" | "number" | "boolean" | "object" | "array";
	description?: string;
	default?: unknown;
	required?: boolean;
	minimum?: number;
	maximum?: number;
	pattern?: string;
	enum?: unknown[];
}

/**
 * Hook definition
 */
export interface HookDefinition {
	name: string;
	description?: string;
	parameter?: string;
	returnType?: string;
}

/**
 * Plugin permission
 */
export interface PluginPermission {
	action: "read" | "write" | "execute" | "network" | "filesystem";
	resource?: string;
	scope?: "own" | "all";
}

// ─── Plugin Instance ─────────────────────────────────────────────────────────

/**
 * Plugin instance
 */
export interface Plugin {
	/**
	 * Unique plugin ID
	 */
	id: string;

	/**
	 * Plugin manifest
	 */
	manifest: PluginManifest;

	/**
	 * Current status
	 */
	status: PluginStatus;

	/**
	 * Plugin instance
	 */
	instance?: unknown;

	/**
	 * Configuration
	 */
	configuration: Record<string, unknown>;

	/**
	 * Registered capabilities
	 */
	capabilities: Map<PluginCapability, unknown>;

	/**
	 * Error if status is error
	 */
	error?: string;

	/**
	 * Load time
	 */
	loadedAt?: string;

	/**
	 * Activation time
	 */
	activatedAt?: string;
}

// ─── Lifecycle Types ──────────────────────────────────────────────────────────

/**
 * Plugin lifecycle events
 */
export type PluginLifecycleEvent =
	| "beforeLoad"
	| "afterLoad"
	| "beforeInitialize"
	| "afterInitialize"
	| "beforeActivate"
	| "afterActivate"
	| "beforeDeactivate"
	| "afterDeactivate"
	| "beforeUnload"
	| "afterUnload";

/**
 * Lifecycle context
 */
export interface LifecycleContext {
	pluginId: string;
	event: PluginLifecycleEvent;
	timestamp: string;
	data?: Record<string, unknown>;
}

// ─── Hook Types ──────────────────────────────────────────────────────────────

/**
 * Hook handler
 */
export interface HookHandler {
	id: string;
	name: string;
	pluginId: string;
	priority: number;
	handler: HookFunction;
	description?: string;
}

/**
 * Hook function
 */
export type HookFunction = (
	context: unknown,
	...args: unknown[]
) => unknown | Promise<unknown>;

/**
 * Hook result
 */
export interface HookResult {
	hook: string;
	handlers: number;
	results: unknown[];
	durationMs: number;
}

// ─── Extension Types ─────────────────────────────────────────────────────────

/**
 * Provider extension
 */
export interface ProviderExtension {
	capability: "provider";
	name: string;
	provider: {
		complete: (prompt: string, options?: unknown) => Promise<unknown>;
		stream?: (prompt: string, options?: unknown) => AsyncGenerator<unknown>;
		embed?: (input: string) => Promise<number[]>;
	};
	config?: Record<string, unknown>;
}

/**
 * Framework extension
 */
export interface FrameworkExtension {
	capability: "framework";
	name: string;
	detector: {
		detect: (context: unknown) => Promise<unknown>;
		signals?: unknown[];
	};
	config?: Record<string, unknown>;
}

/**
 * Generator extension
 */
export interface GeneratorExtension {
	capability: "generator";
	name: string;
	generator: {
		generate: (
			template: string,
			variables: Record<string, unknown>,
		) => Promise<string>;
		validate?: (code: string) => Promise<boolean>;
	};
	config?: Record<string, unknown>;
}

/**
 * Linter extension
 */
export interface LinterExtension {
	capability: "linter";
	name: string;
	rules: unknown[];
	config?: Record<string, unknown>;
}

/**
 * Template extension
 */
export interface TemplateExtension {
	capability: "template";
	name: string;
	templates: unknown[];
	config?: Record<string, unknown>;
}

/**
 * Validator extension
 */
export interface ValidatorExtension {
	capability: "validator";
	name: string;
	validators: unknown[];
	config?: Record<string, unknown>;
}

/**
 * Tool extension
 */
export interface ToolExtension {
	capability: "tool";
	name: string;
	tools: {
		name: string;
		description: string;
		parameters?: unknown;
		execute: (params: unknown) => Promise<unknown>;
	}[];
	config?: Record<string, unknown>;
}

// ─── Sandbox Types ──────────────────────────────────────────────────────────

/**
 * Sandbox configuration
 */
export interface SandboxConfig {
	timeout?: number;
	memoryLimit?: number;
	networkAccess?: boolean;
	filesystemAccess?: "none" | "own" | "all";
	allowEval?: boolean;
}

/**
 * Sandbox result
 */
export interface SandboxResult {
	success: boolean;
	result?: unknown;
	error?: string;
	durationMs: number;
}

// ─── Registry Types ────────────────────────────────────────────────────────

/**
 * Registry entry
 */
export interface RegistryEntry {
	id: string;
	name: string;
	version: string;
	pluginId: string;
	capability: PluginCapability;
	metadata?: Record<string, unknown>;
}

// ─── Configuration Types ────────────────────────────────────────────────────

/**
 * Plugin manager configuration
 */
export interface PluginManagerConfig {
	/**
	 * Plugin directory
	 */
	pluginDir?: string;

	/**
	 * Auto-load plugins
	 */
	autoLoad?: boolean;

	/**
	 * Auto-activate plugins
	 */
	autoActivate?: boolean;

	/**
	 * Plugin search patterns
	 */
	patterns?: string[];

	/**
	 * Sandbox configuration
	 */
	sandbox?: SandboxConfig;

	/**
	 * Enable hooks
	 */
	hooks?: boolean;

	/**
	 * Log level
	 */
	logLevel?: "debug" | "info" | "warn" | "error";
}

/**
 * Load options
 */
export interface LoadOptions {
	/**
	 * Plugin ID or path
	 */
	plugin: string;

	/**
	 * Configuration
	 */
	config?: Record<string, unknown>;

	/**
	 * Sandbox configuration
	 */
	sandbox?: SandboxConfig;

	/**
	 * Skip validation
	 */
	skipValidation?: boolean;
}

// ─── Error Types ────────────────────────────────────────────────────────────

/**
 * Plugin error
 */
export class PluginError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly pluginId?: string,
	) {
		super(message);
		this.name = "PluginError";
	}
}

/**
 * Error codes
 */
export const PluginErrorCode = {
	MANIFEST_NOT_FOUND: "MANIFEST_NOT_FOUND",
	MANIFEST_INVALID: "MANIFEST_INVALID",
	ENTRY_NOT_FOUND: "ENTRY_NOT_FOUND",
	LOAD_FAILED: "LOAD_FAILED",
	INIT_FAILED: "INIT_FAILED",
	ACTIVATE_FAILED: "ACTIVATE_FAILED",
	DEACTIVATE_FAILED: "DEACTIVATE_FAILED",
	PERMISSION_DENIED: "PERMISSION_DENIED",
	CAPABILITY_NOT_FOUND: "CAPABILITY_NOT_FOUND",
	DEPENDENCY_MISSING: "DEPENDENCY_MISSING",
	DEPENDENCY_CONFLICT: "DEPENDENCY_CONFLICT",
	INCOMPATIBLE_VERSION: "INCOMPATIBLE_VERSION",
	HOOK_FAILED: "HOOK_FAILED",
	SANDBOX_ERROR: "SANDBOX_ERROR",
	ALREADY_LOADED: "ALREADY_LOADED",
	NOT_LOADED: "NOT_LOADED",
	NOT_ACTIVE: "NOT_ACTIVE",
} as const;
