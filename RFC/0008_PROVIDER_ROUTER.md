# RFC 0008 - Provider Router

## Purpose
Select the best provider/model for each task.

## Motivation
Different providers have different strengths, prices, quotas, and failure modes. The runtime must not hard-code MiniMax, GLM, or Codex into the core loop.

## Provider State
```text
available
limited
exhausted
disabled
unknown
```

## Routing Inputs
- task type
- provider capability
- quota state
- previous failures
- user preference
- cost policy
- speed policy

## Example Policy
```text
planner -> codex
code_generation -> minimax
bug_fix -> glm
review -> codex
fallback -> glm
```

## Interface
```ts
interface ProviderRouter {
  selectProvider(task: RuntimeTask, context: RuntimeContext): Promise<ProviderSelection>;
}
```

## Recovery
If provider fails with quota, mark provider exhausted, ask quota manager for reset time, then schedule resume or select fallback provider.
