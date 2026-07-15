# RFC-0069 — Google A2A Adapter

## Summary

Implements the [Google Agent-to-Agent (A2A) protocol](https://google.github.io/A2A/) to enable pi-harness agents to discover, communicate, and delegate tasks to other A2A-compatible agents. Bridges the harness agent system with the broader A2A ecosystem.

## Architecture

```
packages/a2a-adapter/
├── src/
│   ├── agent.ts              # A2AAgent class (agentcard, task handling)
│   ├── client.ts             # A2AClient class (agent discovery, delegation)
│   ├── protocol.ts           # A2A protocol types and constants
│   ├── transport.ts          # HTTP transport with SSE support
│   ├── types.ts
│   └── index.ts
├── package.json
└── README.md
```

## A2A Protocol Overview

A2A defines:

- **AgentCard**: JSON document at `/.well-known/agent.json` describing agent capabilities
- **Tasks**: Long-running task objects with status updates
- **Messages**: Task input/output as JSON
- **Skills**: Agent capability descriptors
- **Transport**: HTTP + Server-Sent Events (SSE) for streaming

## A2AAgent (Server Side)

```typescript
// Expose this harness agent as an A2A agent
export class A2AAgent {
  constructor(config: A2AAgentConfig);

  // Serve AgentCard at /.well-known/agent.json
  async serveAgentCard(): Promise<AgentCard>;

  // Handle incoming A2A requests
  async handleRequest(req: A2ARequest): Promise<A2AResponse>;

  // Send task result back (for push notifications)
  async sendTaskResult(taskId: string, result: TaskResult): Promise<void>;

  // Stream task updates via SSE
  streamTaskUpdates(taskId: string): AsyncGenerator<TaskUpdate>;
}
```

## A2AClient (Delegate Side)

```typescript
// Discover and delegate to remote A2A agents
export class A2AClient {
  constructor(config?: A2AClientConfig);

  // Discover agent via URL or well-known endpoint
  async discoverAgent(url: string): Promise<AgentCard>;

  // Search for agents by skill/capability
  async findAgents(criteria: AgentSearchCriteria): Promise<AgentCard[]>;

  // Send task to agent
  async sendTask(agentUrl: string, task: Task): Promise<TaskHandle>;

  // Get task result
  async getTaskResult(taskId: string, agentUrl: string): Promise<TaskResult>;

  // Subscribe to task updates (SSE)
  subscribeToTask(taskId: string, agentUrl: string): AsyncGenerator<TaskUpdate>;
}
```

## AgentCard

```typescript
export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  skills: Skill[];
  authentication?: { schemes: string[] };
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  inputModes?: string[];
  outputModes?: string[];
}
```

## Task Lifecycle

```
SendingAgent → [send_task] → ReceivingAgent
                         → Task created (status: working)
                         → TaskUpdate events (optional)
                         → Task completed/cancelled/failed
SendingAgent ← [task_result] ← ReceivingAgent
```

## Harness Integration

```typescript
// Integrate with harness agent system
export interface A2AIntegrationConfig {
  agentUrl: string;
  agentPort: number;
  pushUrl?: string;           // For push notifications
  agentCard: Partial<AgentCard>;
}

// When harness receives A2A task, route to skill-registry
// When harness delegates, use A2AClient
```

## Acceptance Criteria

- [ ] `A2AAgent` serves valid AgentCard at well-known endpoint
- [ ] `A2AAgent` handles `send_task` requests and returns task result
- [ ] `A2AClient` discovers agents via well-known URL
- [ ] `A2AClient` sends tasks and retrieves results
- [ ] SSE streaming for task updates works
- [ ] Harness skill-registry used for task routing
- [ ] Unit tests for all components
