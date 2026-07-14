# RFC-0068 — MCP Adapter

## Summary

Exposes the pi-harness runtime as a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. External MCP-compatible clients (Claude Desktop, Cursor, etc.) can discover and invoke harness capabilities as MCP tools, prompts, and resources.

## Architecture

```
packages/mcp-adapter/
├── src/
│   ├── server.ts           # MCP server (stdio transport)
│   ├── tools.ts            # Tool definitions (4 core tools)
│   ├── resources.ts        # Read-only resource handlers
│   ├── prompts.ts          # Prompt templates
│   ├── types.ts
│   └── index.ts
├── package.json
└── README.md
```

## MCP Protocol Compliance

- **Transport**: STDIO (JSON-RPC 2.0 over stdin/stdout)
- **Protocol version**: 2024-11-05
- **Schema**: Follows MCP JSON-RPC request/response convention

## Exposed Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `analyze_workspace` | Analyze a codebase directory | `{ path: string, framework?: string }` |
| `search_memory` | Search harness memory store | `{ query: string, limit?: number }` |
| `list_skills` | List available harness skills | `{ capability?: string }` |
| `invoke_skill` | Invoke a named skill | `{ name: string, trigger: object }` |

## Exposed Resources

| URI | Description |
|-----|-------------|
| `harness://skills` | JSON list of all registered skills |
| `harness://capabilities` | Current capability registry |
| `harness://framework/{name}` | Framework analysis result |

## Exposed Prompts

| Prompt | Description |
|--------|-------------|
| `analyze_project` | Full project analysis with recommendations |
| `review_code` | Code review with context from workspace |

## Server Entry

```typescript
// src/server.ts
export async function createMCPServer(options?: MCPServerOptions): Promise<void> {
  // Read JSON-RPC requests from stdin
  // Write responses to stdout
  // Log errors to stderr
}
```

## Key Implementation

- **Transport**: STDIO — reads JSON-RPC requests from `process.stdin`, writes to `process.stdout`
- **Protocol**: MCP 2024-11-05 JSON-RPC 2.0
- **Server initialization**: Sends `initialize` response with server name/version/capabilities
- **Tool invocation**: Maps MCP `tools/call` to harness internal calls
- **Resources**: Read-only, served as `resources/list` + `resources/read`
- **Prompts**: Served as `prompts/list` + `prompts/get`
- **No network**: STDIO-only for security

## Types

```typescript
// src/types.ts

export interface MCPServerOptions {
  name?: string;
  version?: string;
  capabilities?: ServerCapabilities;
}

export interface ServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
}

// MCP JSON-RPC types
export interface MCPRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
```

## Acceptance Criteria

- [ ] MCP server starts and responds to `initialize`
- [ ] `tools/list` returns 4 harness tools
- [ ] `tools/call` invokes tool and returns result
- [ ] `resources/list` returns harness resources
- [ ] `prompts/list` returns harness prompts
- [ ] STDIO transport works correctly
- [ ] Unit tests for tool handlers
