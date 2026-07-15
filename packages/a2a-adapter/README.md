# @pi/a2a-adapter

Google Agent-to-Agent (A2A) protocol adapter for pi-harness.

## Protocol

Implements [Google A2A Protocol v1.0](https://google.github.io/A2A/).

## Usage

### Expose as A2A Agent

```typescript
import { createAgentCard, routeTask, getTask } from "@pi/a2a-adapter";

const card = createAgentCard({
  name: "pi-harness",
  description: "AI coding harness",
  url: "http://localhost:3000",
  version: "0.9.4",
});
// Serve card at /.well-known/agent.json

const task = await routeTask({ role: "user", content: "Analyze code" });
```

### Delegate to Remote Agent

```typescript
import { A2AClient } from "@pi/a2a-adapter";

const client = new A2AClient("http://remote-agent:3000");
const agentCard = await client.discoverAgent();
const handle = await client.sendTask("Analyze my codebase");
```
