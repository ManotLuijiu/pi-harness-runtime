# RFC-0067 — CLI Plugin SDK

## Summary

A Node.js CLI SDK for managing pi-harness plugins — install, list, update, remove, and invoke plugin commands. Provides both a programmatic API (`PluginCLI`) and a standalone CLI (`pi-plugin`).

## Architecture

```
packages/cli-plugin-sdk/
├── src/
│   ├── index.ts          # PluginCLI class + CLI entry
│   ├── commands/         # Install, list, remove, invoke, update
│   ├── registry.ts       # npm registry client
│   ├── plugin-fs.ts      # Filesystem operations
│   └── types.ts
├── bin/
│   └── pi-plugin.js      # CLI entry point
├── package.json
└── README.md
```

## CLI Commands

```bash
pi-plugin install <name> [--version <v>] [--global]
pi-plugin list [--json]
pi-plugin remove <name>
pi-plugin update [name]
pi-plugin invoke <name> <command> [--args <json>]
pi-plugin search <query>
```

## Programmatic API

```typescript
import { PluginCLI } from '@pi/cli-plugin-sdk';

const cli = new PluginCLI({ cwd: process.cwd() });
await cli.install('my-plugin');
await cli.invoke('my-plugin', 'analyze', { path: './src' });
const plugins = await cli.list();
await cli.remove('my-plugin');
```

## Interfaces

```typescript
// packages/cli-plugin-sdk/src/types.ts

export interface PluginCLIConfig {
  cwd?: string;
  globalDir?: string;
  registry?: string;
  npmBin?: string;
}

export interface InstalledPlugin {
  name: string;
  version: string;
  path: string;
  manifest: PluginManifest;
}

export interface PluginSearchResult {
  name: string;
  version: string;
  description: string;
  downloads: number;
}

export class PluginCLI {
  constructor(config?: PluginCLIConfig);
  install(name: string, options?: { version?: string; global?: boolean }): Promise<void>;
  remove(name: string): Promise<void>;
  list(options?: { json?: boolean }): Promise<InstalledPlugin[]>;
  update(name?: string): Promise<void>;
  search(query: string): Promise<PluginSearchResult[]>;
  invoke(pluginName: string, command: string, args?: Record<string, unknown>): Promise<unknown>;
  getPluginPath(name: string): string | null;
}
```

## Key Implementation Details

- **Installation**: Uses `npm install` with `--save` or `--global` flag
- **Plugin directory**: `{cwd}/node_modules/@pi/plugins/` for local, `~/.pi/plugins/` for global
- **Manifest validation**: Validates `package.json` has `pi` field with `sdkVersion`
- **Invoke**: Loads plugin module and calls exported function by name
- **Search**: Queries npm registry for packages matching `@pi/plugin-*` or `@pi/*-plugin`

## Acceptance Criteria

- [ ] `pi-plugin install` installs from npm and validates manifest
- [ ] `pi-plugin list` shows all installed plugins with versions
- [ ] `pi-plugin remove` uninstalls and cleans up
- [ ] `pi-plugin update` updates to latest compatible version
- [ ] `pi-plugin invoke` calls plugin exported function
- [ ] `pi-plugin search` queries npm registry
- [ ] Programmatic `PluginCLI` API works
- [ ] Unit tests for all commands
