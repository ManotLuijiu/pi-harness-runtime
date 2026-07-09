# RFC 0040: Framework Plugin SDK

## Summary

A comprehensive plugin SDK for extending the harness runtime with custom framework support, providers, and tooling.

## Motivation

We need a plugin system to:

1. Extend framework detection
2. Add custom providers
3. Create custom adapters
4. Build framework-specific tooling
5. Share plugins across projects

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Plugin SDK Architecture                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Plugin     │  │   Plugin    │  │   Plugin    │             │
│  │   Loader     │  │   Registry  │  │   Sandbox   │             │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Hooks     │  │   Extension │  │   Config    │             │
│  │   System    │  │   Points    │  │   Schema    │             │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Plugin Types

```typescript
interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  
  // SDK version compatibility
  sdkVersion: string;
  runtimeVersion?: string;         // Min runtime version
  
  // Capabilities
  capabilities: PluginCapability[];
  
  // Entry point
  main: string;
  
  // Permissions
  permissions?: Permission[];
  
  // Configuration schema
  configSchema?: JSONSchema;
}

type PluginCapability = 
  | 'provider'           // Custom AI provider
  | 'framework'          // Framework detection extension
  | 'generator'          // Code generator
  | 'linter'             // Custom linter
  | 'template'           // Code template
  | 'validator'          // Custom validator
  | 'tool'               // Custom tool
  | 'hook';              // Hook handler

interface Plugin {
  readonly manifest: PluginManifest;
  
  // Lifecycle
  initialize(context: PluginContext): Promise<void>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  
  // Hook handlers (if capability includes 'hook')
  hooks?: PluginHooks;
}

interface PluginContext {
  config: PluginConfig;
  logger: PluginLogger;
  storage: PluginStorage;
  services: PluginServices;
}

interface PluginHooks {
  [hookName: string]: HookHandler;
}

type HookHandler = (context: HookContext) => Promise<HookResult> | HookResult;

interface HookContext {
  name: string;
  data: unknown;
  meta: HookMetadata;
}

interface HookMetadata {
  jobId?: string;
  taskId?: string;
  correlationId?: string;
  timestamp: string;
}

interface HookResult {
  handled: boolean;
  data?: unknown;
  error?: string;
}
```

### 2. Plugin Lifecycle

```typescript
enum PluginState {
  Registered = 'registered',
  Initializing = 'initializing',
  Active = 'active',
  Deactivating = 'deactivating',
  Inactive = 'inactive',
  Error = 'error'
}

interface PluginInstance {
  manifest: PluginManifest;
  state: PluginState;
  instance: Plugin | null;
  error?: Error;
  activatedAt?: string;
}

class PluginManager {
  constructor(config: PluginManagerConfig);
  
  // Registration
  async register(pluginPath: string): Promise<PluginInstance>;
  async registerFromUrl(url: string): Promise<PluginInstance>;
  async registerBuiltin(id: string): Promise<PluginInstance>;
  
  // Lifecycle
  async initializeAll(): Promise<void>;
  async activate(pluginId: string): Promise<void>;
  async deactivate(pluginId: string): Promise<void>;
  
  // Queries
  getPlugin(id: string): PluginInstance | null;
  listPlugins(state?: PluginState): PluginInstance[];
  hasCapability(pluginId: string, capability: PluginCapability): boolean;
  
  // Hooks
  async emitHook(hookName: string, context: HookContext): Promise<HookResult>;
  
  // Configuration
  configurePlugin(pluginId: string, config: unknown): Promise<void>;
  getPluginConfig(pluginId: string): unknown;
}

// Hook types
interface HookTypes {
  'beforeJobStart': (data: { jobId: string; config: JobConfig }) => void;
  'afterJobComplete': (data: { jobId: string; result: JobResult }) => void;
  'beforeTaskExecute': (data: { taskId: string; context: TaskContext }) => void;
  'afterTaskComplete': (data: { taskId: string; result: TaskResult }) => void;
  'onError': (data: { error: Error; context: HookContext }) => void;
  'onFrameworkDetected': (data: { detection: FrameworkDetection }) => void;
  'beforeGenerate': (data: { template: string; variables: object }) => void;
  'afterGenerate': (data: { files: GeneratedFile[] }) => void;
}
```

### 3. Extension Points

```typescript
// Framework detection extension
interface FrameworkExtension {
  detect(projectPath: string): Promise<FrameworkDetection | null>;
  getSignatures(): DetectionPattern[];
}

// Provider extension
interface ProviderExtension {
  readonly id: string;
  readonly name: string;
  invoke(request: ProviderRequest): Promise<ProviderResponse>;
  healthCheck(): Promise<boolean>;
}

// Generator extension
interface GeneratorExtension {
  readonly id: string;
  readonly templates: string[];
  generate(templateId: string, variables: object): Promise<GenerationResult>;
}

// Linter extension
interface LinterExtension {
  readonly name: string;
  readonly extensions: string[];
  lint(file: string): Promise<LintResult>;
}

// Tool extension
interface ToolExtension {
  readonly name: string;
  readonly description: string;
  execute(args: unknown, context: ToolContext): Promise<ToolResult>;
}
```

### 4. Plugin Sandbox

```typescript
interface SandboxConfig {
  timeout: number;                  // Max execution time
  memoryLimit?: number;             // Max memory in MB
  networkEnabled: boolean;         // Allow network calls
  filesystemAccess?: string[];     // Allowed paths
  env?: Record<string, string>;     // Environment variables
}

class PluginSandbox {
  constructor(config: SandboxConfig);
  
  // Execute plugin code in sandbox
  async execute<T>(
    code: string | (() => Promise<T>),
    context?: Record<string, unknown>
  ): Promise<T>;
  
  // Execute with resource limits
  async executeWithLimits<T>(
    fn: () => Promise<T>,
    limits: { timeout?: number; memoryLimit?: number }
  ): Promise<T>;
  
  // Terminate sandboxed execution
  terminate(): void;
}
```

### 5. Plugin Configuration Schema

```typescript
// plugins.config.ts
export const pluginsConfig = {
  // Enable/disable plugins
  enabled: {
    'my-custom-provider': true,
    'frappe-tools': true
  },
  
  // Per-plugin configuration
  plugins: {
    'my-custom-provider': {
      apiKey: process.env.MY_PROVIDER_API_KEY,
      endpoint: 'https://api.example.com',
      models: ['model-x', 'model-y']
    },
    'frappe-tools': {
      benchPath: '/path/to/frappe-bench',
      sites: ['site1.local', 'site2.local']
    }
  },
  
  // Global plugin settings
  settings: {
    sandboxEnabled: true,
    sandboxTimeout: 30000,
    autoActivate: true
  }
};
```

## File Structure

```
packages/framework-plugin-sdk/
├── src/
│   ├── index.ts                    # Public exports
│   ├── manager.ts                  # PluginManager class
│   ├── loader.ts                   # PluginLoader
│   ├── sandbox/
│   │   ├── sandbox.ts             # PluginSandbox
│   │   └── isolater.ts           # Code isolation
│   ├── registry/
│   │   ├── index.ts              # PluginRegistry
│   │   ├── capability-registry.ts
│   │   └── hook-registry.ts
│   ├── hooks/
│   │   ├── dispatcher.ts         # Hook dispatcher
│   │   └── types.ts              # Hook definitions
│   ├── config/
│   │   ├── schema.ts             # Config validation
│   │   └── loader.ts             # Config file loader
│   ├── extensions/
│   │   ├── framework.ts          # Framework extension
│   │   ├── provider.ts           # Provider extension
│   │   ├── generator.ts          # Generator extension
│   │   ├── linter.ts             # Linter extension
│   │   └── tool.ts               # Tool extension
│   ├── types.ts
│   ├── errors.ts
│   └── utils.ts
├── api/
│   ├── plugin-api.ts             # Plugin API interface
│   └── runtime-api.ts            # Runtime API for plugins
├── builtin/
│   ├── index.ts                  # Built-in plugins
│   └── example-plugin/
├── test/
├── examples/
│   ├── creating-a-plugin.md
│   ├── provider-plugin.ts
│   ├── framework-plugin.ts
│   └── hooks-example.ts
├── package.json
└── README.md
```

## Usage Examples

### Creating a Plugin

```typescript
// my-frappe-plugin/index.ts
import type { Plugin, PluginContext, PluginManifest } from '@pi/framework-plugin-sdk';

const manifest: PluginManifest = {
  id: 'my-frappe-plugin',
  name: 'My Frappe Tools',
  version: '1.0.0',
  description: 'Custom Frappe development tools',
  sdkVersion: '1.0.0',
  capabilities: ['framework', 'tool', 'hook'],
  main: 'dist/index.js',
  permissions: ['filesystem', 'network'],
  configSchema: {
    type: 'object',
    properties: {
      benchPath: { type: 'string' },
      autoMigrate: { type: 'boolean' }
    }
  }
};

class MyFrappePlugin implements Plugin {
  readonly manifest = manifest;
  
  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    context.logger.info('MyFrappePlugin initialized');
  }
  
  async activate(): Promise<void> {
    // Register tools, hooks, etc.
  }
  
  hooks = {
    async onFrameworkDetected(data) {
      if (data.detection.framework === 'frappe_erpnext') {
        // Add custom Frappe detection logic
        return { handled: true, data: data };
      }
      return { handled: false };
    }
  };
}

export default new MyFrappePlugin();
```

### Plugin Package Structure

```json
// my-frappe-plugin/package.json
{
  "name": "@myorg/frappe-plugin",
  "version": "1.0.0",
  "main": "dist/index.js",
  "pi": {
    "sdkVersion": "1.0.0"
  }
}
```

### Registering and Using Plugins

```typescript
import { PluginManager } from '@pi/framework-plugin-sdk';

const manager = new PluginManager({
  pluginDir: './plugins',
  sandboxEnabled: true,
  autoActivate: true
});

// Register a plugin
await manager.register('./plugins/my-frappe-plugin');

// Activate
await manager.activate('my-frappe-plugin');

// Use plugin capability
const plugin = manager.getPlugin('my-frappe-plugin');
if (plugin?.instance?.hooks) {
  await manager.emitHook('onFrameworkDetected', {
    name: 'onFrameworkDetected',
    data: { detection: existingDetection },
    meta: { timestamp: new Date().toISOString() }
  });
}
```

### Hook System

```typescript
// Plugin hooks
const myPlugin: Plugin = {
  manifest: { /* ... */ },
  
  hooks: {
    // Before a job starts
    async beforeJobStart(data) {
      console.log(`Job ${data.jobId} starting`);
      return { handled: true };
    },
    
    // After task completes
    async afterTaskComplete(data) {
      if (data.result.status === 'failure') {
        await sendAlert(data);
      }
      return { handled: false }; // Allow other handlers
    },
    
    // Custom hook
    async onCustomHook(data) {
      // Handle custom hook
      return { handled: true, data: { processed: true } };
    }
  }
};

// Emit hook from runtime
await pluginManager.emitHook('beforeJobStart', {
  name: 'beforeJobStart',
  data: { jobId: 'job-123', config: jobConfig },
  meta: { timestamp: new Date().toISOString() }
});
```

### Configuration Management

```typescript
import { loadPluginConfig } from '@pi/framework-plugin-sdk';

// plugins.config.ts
const config = await loadPluginConfig('./plugins.config.ts');

// Access plugin config
const providerConfig = config.plugins['my-provider'];
const enabled = config.enabled['my-provider'];
```

### Sandboxed Execution

```typescript
import { PluginSandbox } from '@pi/framework-plugin-sdk';

const sandbox = new PluginSandbox({
  timeout: 5000,
  memoryLimit: 128,
  networkEnabled: false,
  filesystemAccess: ['/tmp/plugin-data']
});

try {
  const result = await sandbox.execute(async () => {
    // Plugin code runs here
    return processData(someInput);
  });
} catch (error) {
  if (error instanceof SandboxError) {
    console.log('Sandbox violation:', error.reason);
  }
} finally {
  sandbox.terminate();
}
```

## Plugin Registry (npm)

```bash
# Publish plugin
npm publish --access public

# Install plugin
pi plugin install @myorg/frappe-plugin

# List installed plugins
pi plugin list

# Update plugin
pi plugin update @myorg/frappe-plugin

# Uninstall plugin
pi plugin uninstall @myorg/frappe-plugin
```

## Security Considerations

| Concern | Mitigation |
| --------- | ------------ |
| Code injection | Sandboxed execution with timeout |
| Filesystem access | Whitelist allowed paths |
| Network access | Optional, configurable per plugin |
| Secrets exposure | Environment variable injection |
| Resource exhaustion | Memory limits, CPU throttling |

## Acceptance Criteria

1. ✅ Plugin manifest with validation
2. ✅ Plugin lifecycle (register, initialize, activate, deactivate)
3. ✅ Hook system for extensibility
4. ✅ Extension points for providers, frameworks, generators
5. ✅ Sandboxed execution for security
6. ✅ Configuration management with schema validation
7. ✅ Plugin registry and npm publishing support

## Dependencies

- `packages/types` - for runtime-types
- `chokidar` - for file watching (config changes)
- `js-yaml` - for config parsing
- `vm2` or `isolated-vm` - for sandboxing
