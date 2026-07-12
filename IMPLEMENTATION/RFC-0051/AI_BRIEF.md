# RFC-0051 Capability Registry

Implement a centralized capability registry for tracking which models and providers support which capabilities (code_generation, code_review, planning, etc.).

## Key Components

- `CapabilityProfile` - Score, latency, context window for each capability
- `CapabilityRegistry` - Register, query, filter capabilities
- Default capability profiles for OpenAI, Anthropic, MiniMax

## Integration Points

- Provider Router uses capabilities for filtering
- Cost Optimizer uses capability profiles for selection
- Task Compiler uses capabilities for task-to-model matching
