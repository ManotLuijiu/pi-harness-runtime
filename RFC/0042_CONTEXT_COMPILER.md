# RFC-0042 — Context Compiler

Status: Draft  
Target package: `packages/context-compiler`  
Depends on: Shared Blackboard, OKF Knowledge Bundle, Repository Reader

## 1. Problem

Agents frequently receive either too much repository context or too little. Raw chat history is unstable, repository-wide dumps exceed model limits, and manually selected files make autonomous execution dependent on a human message relay.

The Context Compiler creates a bounded, traceable `CompiledContext` for a specific task.

## 2. Context sources

The compiler may read:

- Shared Blackboard current state
- Task dependencies and prior agent reports
- Project rules
- OKF concepts
- Repository files
- Git diff and status
- Test failures
- Previous partial responses
- Framework plugin recommendations

It must not treat all sources equally. Every context item includes priority, freshness, trust, and scope.

```ts
export interface ContextCandidate {
  id: string;
  kind:
    | "project_rule"
    | "okf_concept"
    | "source_file"
    | "git_diff"
    | "test_failure"
    | "agent_report"
    | "blackboard_state";
  content: string;
  source: string;
  priority: 0 | 1 | 2 | 3;
  required: boolean;
  updatedAt?: string;
  trust: "authoritative" | "generated" | "unverified";
}
```

## 3. Output

```ts
export interface CompiledContext {
  taskId: string;
  items: CompiledContextItem[];
  omitted: OmittedContextItem[];
  estimatedTokens: number;
  sourceGraph: ContextSourceEdge[];
  generatedAt: string;
}
```

Every omission must be recorded with a reason such as `duplicate`, `out_of_scope`, `stale`, `budget`, or `policy_denied`.

## 4. Selection algorithm

```text
collect candidates
 -> apply policy filters
 -> mark required items
 -> score optional items
 -> resolve direct dependencies
 -> deduplicate
 -> fit within context budget
 -> generate source graph
 -> persist compiled context
```

Suggested score:

```text
score =
  priority_weight
  + direct_file_reference
  + recent_failure_relevance
  + dependency_relevance
  + framework_relevance
  - stale_penalty
  - duplication_penalty
```

The scoring formula is configurable, but required items bypass scoring.

## 5. Progressive disclosure

The compiler should prefer summaries first and source files second:

```text
OKF concept summary
 -> relevant symbol summary
 -> selected source excerpt
 -> complete source file only when required
```

Agents may request expansion through a runtime tool, but initial compilation should avoid sending unrelated files.

## 6. Repository slicing

For source code, context is selected by symbol when supported.

```ts
export interface SourceSlice {
  file: string;
  startLine: number;
  endLine: number;
  symbols: string[];
  reason: string;
  contentHash: string;
}
```

A Framework Plugin may provide AST-aware slicing. The generic fallback uses line ranges and import/reference search.

## 7. OKF integration

OKF documents are authoritative for durable architecture and project knowledge only when their frontmatter identifies them as authoritative or approved.

Example:

```yaml
---
type: Runtime Concept
title: Shared Blackboard
authority: approved
tags: [runtime, coordination]
timestamp: 2026-07-10T00:00:00+07:00
---
```

Generated or stale concepts remain usable but receive a lower trust score.

## 8. Freshness and invalidation

Compiled context is invalidated when:

- A selected source file hash changes.
- A project rule changes.
- A required OKF concept changes.
- The task objective changes.
- A new test failure supersedes an old one.
- The current Git worktree changes branch or HEAD.

The context cache key contains all selected source hashes.

## 9. Safety boundaries

The Context Compiler must obey include/exclude policies such as:

```yaml
context:
  deny:
    - "**/.env"
    - "**/*.pem"
    - "**/credentials/**"
  allow_large_files: false
  max_file_bytes: 200000
```

Denied content is never copied into compiled artifacts. The omission record may contain the file path but not its secret contents.

## 10. Reference interface

```ts
export interface ContextCompiler {
  compile(request: ContextCompileRequest): Promise<CompiledContext>;
  invalidate(reason: ContextInvalidation): Promise<void>;
}

export interface ContextCompileRequest {
  jobId: string;
  task: CompiledTask;
  maximumTokens: number;
  worktreePath: string;
  provider: ProviderTarget;
}
```

## 11. Failure handling

- Missing optional source: omit and record.
- Missing required source: fail.
- Repository parsing failure: fall back to line-based extraction.
- Token estimate unavailable: use conservative character estimate.
- Broken OKF link: preserve concept and record broken edge.
- Blackboard unavailable: fail because current runtime state is required.

## 12. Tests

Required tests include:

1. Required project rules are always included.
2. `.env` content is denied.
3. Duplicate source slices are merged.
4. Changed file hash invalidates cache.
5. Broken optional OKF link does not fail compilation.
6. Broken required source does fail.
7. Context remains under requested token budget.
8. Omitted items include explicit reasons.

## 13. Acceptance criteria

- Every compiled item has a source reference.
- Every omitted candidate has a reason.
- Required content is never silently dropped.
- Compiled context is deterministic for identical repository state.
- Secret-deny patterns are enforced before persistence.
- OKF concepts and source files can coexist in one source graph.
