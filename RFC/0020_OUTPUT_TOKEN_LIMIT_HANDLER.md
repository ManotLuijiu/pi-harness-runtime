# RFC 0020 - Output Token Limit Handler

## Purpose

Handle model responses that stop because the maximum output token limit was reached.

## Error Example

```text
Error: Model stopped because it reached the maximum output token limit.
The response may be incomplete.
```

## Classification

| Failure | Runtime Action |
|---|---|
| Quota exhausted | pause until reset |
| Context full | compact and resume |
| Output token limit | continue same task |
| Unknown error | retry or escalate |

## Policy

```json
{
  "max_continue_attempts": 5,
  "continuation_backoff_ms": 1000,
  "require_expected_output_validation": true
}
```

## Runtime Flow

```text
OutputLimitDetected
  -> SavePartialResponse
  -> GenerateContinuationPrompt
  -> RetryContinuation
  -> MergePartialOutputs
  -> ValidateExpectedOutput
```

## Acceptance Criteria

- Runtime detects output-limit messages.
- Runtime saves partial output.
- Runtime continues same task.
- Runtime stops after configurable max attempts.
