# RFC-0070 — OpenAI Codex Adapter

## Summary

Integrates OpenAI's [Codex](https://openai.com/index/introducing-codex/) models as a provider for the pi-harness runtime. Codex is a specialized code model that excels at autonomous software engineering tasks — code generation, editing, navigation, and execution.

## Architecture

```
packages/codex-adapter/
├── src/
│   ├── provider.ts        # CodexProvider (implements ProviderExtension)
│   ├── tools.ts           # Codex tool definitions (read, write, execute, browse)
│   ├── executor.ts        # Code execution sandbox
│   ├── types.ts
│   └── index.ts
├── package.json
└── README.md
```

## Why Codex

OpenAI Codex is optimized for:

- Autonomous code generation and editing
- Codebase navigation and reasoning
- Multi-step software engineering tasks
- CLI tool use (`Bash`, `Edit`, `Read`, `Write`, `WebSearch`)

## Provider Implementation

```typescript
// src/provider.ts
export class CodexProvider implements ProviderExtension {
  readonly capability = "provider";
  readonly id = "codex";
  readonly name = "OpenAI Codex";

  constructor(config: CodexConfig);

  // Invoke Codex model
  async complete(prompt: string, options?: CodexOptions): Promise<CodexResponse>;

  // Stream responses
  stream(prompt: string, options?: CodexOptions): AsyncGenerator<string>;

  // Health check
  async healthCheck(): Promise<boolean>;

  // Cost estimation
  estimateCost(inputTokens: number, outputTokens: number): number;
}
```

## Config

```typescript
export interface CodexConfig {
  apiKey: string;                    // OpenAI API key
  model?: "gpt-4o" | "o3" | "o4-mini"; // Default: gpt-4o
  baseUrl?: string;                 // For proxies/self-hosted
  maxTokens?: number;
  temperature?: number;
  tools?: CodexTool[];
  toolChoice?: "auto" | "none";
}

export const DEFAULT_TOOLS: CodexTool[] = [
  { type: "function", name: "Read", description: "Read file contents" },
  { type: "function", name: "Write", description: "Write/edit file" },
  { type: "function", name: "Bash", description: "Execute shell command" },
  { type: "function", name: "WebSearch", description: "Search the web" },
];
```

## Tools as Harness Capabilities

Each Codex tool maps to a harness capability:

| Codex Tool | Harness Capability | Description |
|------------|-------------------|-------------|
| `Read` | `tool.read_file` | Read any file from workspace |
| `Write` | `tool.write_file` | Write/edit files in workspace |
| `Bash` | `tool.execute` | Run shell commands |
| `WebSearch` | `tool.search` | Web search for context |

## Codex as Model Provider

```typescript
// Integrate with model-registry
import { CodexProvider } from '@pi/codex-adapter';

const provider = new CodexProvider({ apiKey: process.env.OPENAI_API_KEY! });
modelRegistry.register('codex', provider);

// Use in harness
const result = await modelRegistry.invoke('codex', {
  prompt: 'Refactor the auth module to use JWT',
  context: { workspace: '/path/to/project' }
});
```

## Execution Sandbox

```typescript
// src/executor.ts
export class ExecutionSandbox {
  constructor(config?: SandboxConfig);

  // Execute code with resource limits
  async execute(code: string, language: string): Promise<ExecutionResult>;

  // Execute with file system access
  async executeWithFS(
    code: string,
    language: string,
    workspace: string
  ): Promise<ExecutionResult>;

  // Kill running process
  kill(processId: string): void;
}
```

## Acceptance Criteria

- [ ] `CodexProvider` implements `ProviderExtension` interface
- [ ] `complete()` calls OpenAI API with Codex tools
- [ ] `stream()` yields partial responses
- [ ] `healthCheck()` validates API key
- [ ] `estimateCost()` calculates cost from token counts
- [ ] Codex tools map to harness capabilities
- [ ] Execution sandbox limits resource usage
- [ ] Unit tests for provider and tools
