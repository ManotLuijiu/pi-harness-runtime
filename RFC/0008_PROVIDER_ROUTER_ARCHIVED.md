# RFC-0008 — Provider Router (ARCHIVED)

## Status: ARCHIVED - Superseded by RFC-0054

This brief RFC has been superseded by RFC-0054 which provides a complete specification.

## Original Content

```markdown
## Purpose
Select the best provider/model for each task.

## Motivation
Different providers have different strengths, prices, quotas, and failure modes. The runtime must not hard-code MiniMax, GLM, or Codex into the core loop.

## Provider State
available
limited
exhausted
disabled
unknown

## Routing Inputs
- task type
- provider capability
```

## Resolution

See RFC-0054 for the complete Provider Router specification.
