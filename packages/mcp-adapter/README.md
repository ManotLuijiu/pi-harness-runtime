# @pi/mcp-adapter

MCP (Model Context Protocol) server adapter for pi-harness. Exposes harness capabilities as MCP tools, resources, and prompts over STDIO transport.

## Protocol

- **Transport**: STDIO (JSON-RPC 2.0 over stdin/stdout)
- **Protocol Version**: 2024-11-05
- **Spec**: <https://modelcontextprotocol.io>

## Tools

| Tool | Description |
|------|-------------|
| `analyze_workspace` | Analyze a codebase for framework detection |
| `search_memory` | Search harness persistent memory |
| `list_skills` | List all registered skills |
| `invoke_skill` | Invoke a named skill |

## Usage

```typescript
import { createMCPServer } from "@pi/mcp-adapter";

await createMCPServer({ name: "pi-harness", version: "0.9.4" });
```

Start as a subprocess:

```bash
node dist/index.js
# or via npx
npx @pi/mcp-adapter
```

## MCP Client Example (Claude Desktop)

```json
{
  "mcpServers": {
    "pi-harness": {
      "command": "node",
      "args": ["/path/to/node_modules/@pi/mcp-adapter/dist/index.js"]
    }
  }
}
```
