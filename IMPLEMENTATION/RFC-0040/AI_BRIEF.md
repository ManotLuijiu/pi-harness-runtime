# RFC-0040 AI Brief: Framework Plugin SDK

## Summary

A comprehensive plugin SDK for extending the harness runtime with custom framework support, providers, and tooling.

## Implementation Overview

### Key Classes to Implement

1. **PluginManager** (`manager.ts`)
   - Plugin registration
   - Lifecycle management (initialize, activate, deactivate)
   - Hook system
   - Configuration management

2. **PluginLoader** (`loader.ts`)
   - Load plugins from filesystem
   - Load plugins from npm
   - Validate plugin manifest
   - Plugin sandboxing

3. **PluginSandbox** (`sandbox/sandbox.ts`)
   - Code isolation
   - Resource limits
   - Timeout enforcement
   - Network/filesystem restrictions

4. **HookDispatcher** (`hooks/dispatcher.ts`)
   - Hook registration
   - Hook execution
   - Result aggregation

### Extension Points

- Framework detection extensions
- Provider extensions
- Generator extensions
- Linter extensions
- Tool extensions

### Capabilities

- `provider` - Custom AI provider
- `framework` - Framework detection extension
- `generator` - Code generator
- `linter` - Custom linter
- `template` - Code template
- `validator` - Custom validator
- `tool` - Custom tool
- `hook` - Hook handler

### Dependencies

- `packages/types` - for runtime-types
- `chokidar` - for file watching
- `js-yaml` - for config parsing
- `vm2` or `isolated-vm` - for sandboxing

### Files to Create

- `packages/framework-plugin-sdk/src/manager.ts`
- `packages/framework-plugin-sdk/src/loader.ts`
- `packages/framework-plugin-sdk/src/sandbox/sandbox.ts`
- `packages/framework-plugin-sdk/src/sandbox/isolater.ts`
- `packages/framework-plugin-sdk/src/registry/index.ts`
- `packages/framework-plugin-sdk/src/registry/capability-registry.ts`
- `packages/framework-plugin-sdk/src/registry/hook-registry.ts`
- `packages/framework-plugin-sdk/src/hooks/dispatcher.ts`
- `packages/framework-plugin-sdk/src/hooks/types.ts`
- `packages/framework-plugin-sdk/src/config/schema.ts`
- `packages/framework-plugin-sdk/src/config/loader.ts`
- `packages/framework-plugin-sdk/src/extensions/framework.ts`
- `packages/framework-plugin-sdk/src/extensions/provider.ts`
- `packages/framework-plugin-sdk/src/extensions/generator.ts`
- `packages/framework-plugin-sdk/src/extensions/linter.ts`
- `packages/framework-plugin-sdk/src/extensions/tool.ts`
- `packages/framework-plugin-sdk/src/types.ts`
- `packages/framework-plugin-sdk/src/index.ts`
