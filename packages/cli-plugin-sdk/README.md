# @pi/cli-plugin-sdk

CLI Plugin SDK for pi-harness — install, list, remove, update, and invoke plugins.

## Installation

```bash
npm install @pi/cli-plugin-sdk
```

## Usage

```typescript
import { PluginCLI } from "@pi/cli-plugin-sdk";

const cli = new PluginCLI({ cwd: "./my-project" });

// Install a plugin
await cli.install("@pi/frappe-plugin");

// List installed plugins
const plugins = await cli.list();
console.log(plugins);

// Invoke a plugin command
const result = await cli.invoke("my-plugin", "analyze", { path: "./src" });

// Remove a plugin
await cli.remove("my-plugin");

// Update plugins
await cli.update();
await cli.update("my-plugin");

// Search npm for plugins
const results = await cli.search("frappe");
```

## CLI

```bash
npx pi-plugin install <name>
npx pi-plugin list
npx pi-plugin remove <name>
npx pi-plugin update [name]
npx pi-plugin invoke <name> <command> --args <json>
npx pi-plugin search <query>
```
