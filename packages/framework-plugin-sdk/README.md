# @pi/framework-plugin-sdk

Extensible plugin SDK for framework integrations, custom providers, and tooling.

## Features

- **Plugin Lifecycle** - Register, load, initialize, activate, deactivate, unload
- **Hook System** - Register and execute hooks across plugins
- **Capability Registry** - Manage plugin capabilities centrally
- **Lifecycle Events** - Subscribe to plugin lifecycle changes
- **Manifest Validation** - Validate plugin manifests before loading
- **Sandbox Support** - Optional sandboxing for untrusted plugins
- **Error Handling** - Comprehensive error codes and handling

## Installation

```bash
npm install @pi/framework-plugin-sdk
```

## Quick Start

### Basic Usage

```typescript
import { createPluginManager } from "@pi/framework-plugin-sdk";

const manager = createPluginManager({
  pluginDir: "./plugins",
  autoActivate: true,
});

// Register a plugin
const plugin = await manager.register({
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  description: "A custom plugin",
  capabilities: ["provider", "framework"],
});

// Load and activate
await manager.load({ plugin: "my-plugin" });
await manager.initialize("my-plugin");
await manager.activate("my-plugin");

// Get plugin info
const info = manager.getPlugin("my-plugin");
console.log(info.status); // "active"
```

### Plugin Manifest

```json
{
  "id": "my-frappe-plugin",
  "name": "Frappe Plugin",
  "version": "1.0.0",
  "description": "Frappe framework integration",
  "capabilities": ["framework", "provider"],
  "dependencies": {
    "@pi/core": "^1.0.0"
  },
  "entryPoint": "./dist/index.js",
  "configuration": {
    "schema": {
      "apiUrl": {
        "type": "string",
        "required": true
      }
    },
    "defaults": {
      "apiUrl": "https://frappe.example.com/api"
    }
  },
  "hooks": [
    {
      "name": "onTaskComplete",
      "description": "Called when a task completes"
    }
  ],
  "permissions": [
    {
      "action": "network",
      "scope": "all"
    }
  ]
}
```

### Hooks

```typescript
// Register a hook handler
manager.registerHook({
  id: "my-hook",
  name: "onTaskComplete",
  pluginId: "my-plugin",
  priority: 10,
  handler: async (context) => {
    console.log("Task completed:", context);
    return { handled: true };
  },
});

// Execute hooks
const result = await manager.executeHooks("onTaskComplete", { taskId: "123" });
console.log(result.results); // [{ handled: true }]
```

### Lifecycle Events

```typescript
manager.onLifecycle("afterActivate", (ctx) => {
  console.log(`Plugin ${ctx.pluginId} activated`);
});

manager.onLifecycle("beforeUnload", (ctx) => {
  console.log(`Plugin ${ctx.pluginId} about to unload`);
});
```

### Capabilities

```typescript
// Register a capability
manager.registerCapability("my-plugin", "provider", {
  complete: async (prompt) => {
    return "Generated response";
  },
});

// Get capabilities
const providers = manager.getCapabilities("provider");
console.log(providers); // [{ id: "my-plugin:provider", ... }]
```

### Capabilities Reference

| Capability | Description |
| ------------ | ------------- |
| `provider` | Custom AI provider implementation |
| `framework` | Framework detection extension |
| `generator` | Code generator |
| `linter` | Custom linter rules |
| `template` | Code templates |
| `validator` | Custom validators |
| `tool` | Custom tools |
| `hook` | Hook handler |

## Plugin Capabilities

### Provider Extension

```typescript
manager.registerCapability("my-plugin", "provider", {
  capability: "provider",
  name: "My Provider",
  provider: {
    complete: async (prompt, options) => {
      // Custom completion logic
      return { content: "Response" };
    },
    stream: async function* (prompt, options) {
      // Streaming support
      yield { content: "Partial " };
      yield { content: "response" };
    },
    embed: async (input) => {
      // Embeddings
      return [0.1, 0.2, 0.3];
    },
  },
});
```

### Framework Extension

```typescript
manager.registerCapability("frappe-plugin", "framework", {
  capability: "framework",
  name: "Frappe Detector",
  detector: {
    detect: async (context) => {
      // Return detected framework info
      return { id: "frappe", confidence: 0.9 };
    },
    signals: [
      { type: "file", pattern: "sites", weight: 0.3 },
      { type: "file", pattern: "bench", weight: 0.3 },
    ],
  },
});
```

### Tool Extension

```typescript
manager.registerCapability("my-plugin", "tool", {
  capability: "tool",
  name: "Custom Tools",
  tools: [
    {
      name: "fetchData",
      description: "Fetch data from an API",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
        },
        required: ["url"],
      },
      execute: async (params) => {
        const { url } = params as { url: string };
        return { data: await fetch(url) };
      },
    },
  ],
});
```

## API Reference

### PluginManager

```typescript
const manager = createPluginManager({
  pluginDir?: string;        // Plugin directory
  autoLoad?: boolean;         // Auto-load plugins
  autoActivate?: boolean;     // Auto-activate plugins
  patterns?: string[];         // Plugin search patterns
  sandbox?: SandboxConfig;     // Sandbox configuration
  hooks?: boolean;            // Enable hooks
  logLevel?: "debug" | "info" | "warn" | "error";
});
```

### Methods

```typescript
// Register a plugin
manager.register(manifest: PluginManifest): Promise<Plugin>;

// Load a plugin
manager.load(options: LoadOptions): Promise<Plugin>;

// Initialize a plugin
manager.initialize(pluginId: string): Promise<void>;

// Activate a plugin
manager.activate(pluginId: string): Promise<void>;

// Deactivate a plugin
manager.deactivate(pluginId: string): Promise<void>;

// Unload a plugin
manager.unload(pluginId: string): Promise<void>;

// Get plugin
manager.getPlugin(pluginId: string): Plugin | undefined;

// List all plugins
manager.listPlugins(): Plugin[];

// List plugins by status
manager.listByStatus(status: PluginStatus): Plugin[];

// Register a hook
manager.registerHook(handler: HookHandler): void;

// Unregister a hook
manager.unregisterHook(handlerId: string): boolean;

// Execute hooks
manager.executeHooks(hookName: string, context: unknown): Promise<HookResult>;

// Get capabilities by type
manager.getCapabilities(capability: PluginCapability): RegistryEntry[];

// Get capability instance
manager.getCapability(pluginId: string, capability: PluginCapability): unknown | undefined;

// Register capability
manager.registerCapability(pluginId: string, capability: PluginCapability, instance: unknown): void;

// Lifecycle events
manager.onLifecycle(event: PluginLifecycleEvent, listener: (ctx) => void): void;
manager.offLifecycle(event: PluginLifecycleEvent, listener: (ctx) => void): void;
```

### Plugin Status

```typescript
type PluginStatus =
  | "registered"  // Manifest registered
  | "loaded"      // Code loaded
  | "initialized" // Initialized
  | "active"      // Running
  | "inactive"    // Paused
  | "error"       // Error state
  | "unloaded";   // Unloaded
```

### Lifecycle Events

```typescript
type PluginLifecycleEvent =
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
```

### Error Codes

```typescript
const PluginErrorCode = {
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
};
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    PluginManager                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │   Lifecycle │  │   Hooks    │  │   Registry     │  │
│  │   Manager  │──│   System   │──│                 │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
│         │                                      │        │
│         ▼                                      ▼        │
│  ┌─────────────┐                       ┌─────────────────┐│
│  │  Event     │                       │  Capabilities  ││
│  │  Listeners │                       │  [provider]   ││
│  └─────────────┘                       │  [framework]   ││
│                                        │  [generator]  ││
│                                        └─────────────────┘│
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│                    Plugins                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ Frappe  │  │ Next.js │  │ Django  │  │ Custom  │ │
│  │ Plugin  │  │ Plugin  │  │ Plugin  │  │ Plugin  │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Security

### Sandbox Configuration

```typescript
const manager = createPluginManager({
  sandbox: {
    timeout: 30000,        // 30 second timeout
    memoryLimit: 128 * 1024 * 1024,  // 128MB
    networkAccess: false,   // Block network
    filesystemAccess: "own", // Only own directory
    allowEval: false,      // No eval
  },
});
```

### Permissions

```json
{
  "permissions": [
    { "action": "network" },
    { "action": "filesystem", "scope": "own" },
    { "action": "execute" }
  ]
}
```
