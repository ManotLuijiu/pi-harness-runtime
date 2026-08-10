# RFC-0112 — Token Estimation

## Purpose

Rough token counting for context window management.

## Motivation

Before sending requests to LLM APIs, we need to estimate token count to:

- Stay within context limits
- Budget quota usage
- Optimize prompts

## Functions

```typescript
// Rough token count for text
export function roughTokenCount(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.ceil(text.length / 3.5) + Math.ceil(words * 0.3);
}

// Rough token count for messages
export function roughMessageTokens(msg: {
  role?: string;
  content?: string | object;
}): number {
  // Count content tokens + role overhead
}
```

## Accuracy

Conservative estimation (overestimates slightly):

- ~3.5 chars/token for English
- Word-based correction for mixed content

## Files

See `IMPLEMENTATION/RFC-0112/FILES.md`.

## Acceptance Criteria

- [ ] Estimates text token count
- [ ] Estimates message token count
- [ ] Handles tool_calls and tool_results
- [ ] Conservative (slightly overestimates)
