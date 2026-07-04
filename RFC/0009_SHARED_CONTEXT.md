# RFC 0009 - Shared Context

## Purpose
Define how agents share durable context during a long-running coding job.

## Motivation
A long-running multi-agent coding job needs shared durable state: requirement, plan, task list, decisions, test results, review comments, provider status, and resume prompt.

## Context Layout
```text
~/.pi-harness-runtime/jobs/<job_id>/
  requirement.md
  plan.md
  tasks.json
  decisions.md
  review.md
  resume_prompt.md
  events.jsonl
```

## Interface
```ts
interface SharedContextStore {
  writeRequirement(jobId: string, text: string): Promise<void>;
  readRequirement(jobId: string): Promise<string | null>;
  writeResumePrompt(jobId: string, text: string): Promise<void>;
  appendDecision(jobId: string, text: string): Promise<void>;
}
```

## Design Rule
Shared context is runtime-owned durable project memory, not one model's chat history.
