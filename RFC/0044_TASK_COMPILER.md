# RFC-0044 — Task Compiler

Status: Draft  
Target package: `packages/task-compiler`  
Depends on: Compiled Requirement, Project Analyzer, Dependency Analyzer

## 1. Problem

A requirement is not directly executable. The runtime needs small, dependency-aware tasks with clear inputs, outputs, permissions, verification, and handoff contracts.

The Task Compiler produces a deterministic task DAG from a compiled requirement and project analysis.

## 2. Task contract

```ts
export interface CompiledTask {
  id: string;
  jobId: string;
  title: string;
  objective: string;
  type:
    | "analysis"
    | "implementation"
    | "test"
    | "review"
    | "repair"
    | "documentation";
  dependencies: string[];
  filesInScope: string[];
  expectedOutputs: TaskOutput[];
  acceptanceCriteria: string[];
  requiredCapabilities: string[];
  permittedCommands: string[];
  prohibitedCommands: string[];
  preferredProvider?: ProviderTarget;
  estimatedComplexity: 1 | 2 | 3 | 5 | 8;
}
```

## 3. Decomposition policy

A task should be split when:

- It requires different agent capabilities.
- It spans unrelated modules.
- It cannot be verified with one coherent test set.
- It mixes destructive operations with ordinary edits.
- It is estimated above the configured complexity threshold.
- It has outputs that can proceed independently.

A task should not be split solely to increase task count.

## 4. Standard engineering flow

```text
analyze
 -> design or schema check
 -> implement
 -> unit test
 -> E2E test when applicable
 -> review
 -> repair if failed
 -> documentation
```

The Task Compiler may omit stages only when project policy explicitly allows it.

## 5. Dependency graph

The compiler must reject cycles.

```ts
export interface TaskGraph {
  jobId: string;
  tasks: CompiledTask[];
  roots: string[];
  terminalTasks: string[];
}
```

Topological order must be reproducible. When multiple tasks are ready, order by:

1. Explicit priority
2. Dependency depth
3. Task ID

## 6. File ownership

Parallel implementation tasks must not modify overlapping files unless the Worktree and Merge Engine explicitly support it.

```ts
export interface FileOwnership {
  taskId: string;
  include: string[];
  exclude: string[];
  mode: "exclusive" | "shared_read";
}
```

An overlap detected between exclusive scopes causes compilation failure or forced serialization.

## 7. Command policy

Commands are generated from project rules and task type.

Example:

```json
{
  "permittedCommands": [
    "bun test packages/task-compiler"
  ],
  "prohibitedCommands": [
    "git commit",
    "bench migrate",
    "bench build"
  ]
}
```

This respects the user's standing rule that build, migrate, and commit require permission.

## 8. Verification contract

Each task must define how completion is proven.

```ts
export interface TaskOutput {
  kind: "file" | "test_result" | "report" | "schema" | "diff";
  path?: string;
  description: string;
  required: boolean;
}
```

A task cannot transition to done merely because an agent says it is complete. Required outputs must exist and verification checks must pass.

## 9. Provider routing hints

The Task Compiler may recommend providers but must not enforce provider availability.

Example routing:

- Master planning and final review: Codex/GPT
- Broad code implementation: MiniMax
- Debugging or alternate review: GLM
- Browser E2E: agent with Playwright capability

The Provider Router makes the final decision using quota and capability status.

## 10. Reference algorithm

```ts
export function compileTasks(input: TaskCompileInput): TaskGraph {
  const candidates = decomposeRequirement(
    input.requirement,
    input.project,
    input.dependencies,
  );

  const normalized = candidates.map(candidate =>
    applyProjectRules(
      assignVerification(
        assignFileScope(candidate, input.project),
        input.requirement.acceptanceCriteria,
      ),
      input.project.rules,
    ),
  );

  const graph = buildGraph(normalized);
  assertNoCycles(graph);
  assertNoExclusiveFileOverlap(graph);
  assertEveryTaskHasVerification(graph);
  return graph;
}
```

## 11. Failure cases

- Cyclic task dependencies
- Missing verification
- Empty objective
- Exclusive file overlap in parallel tasks
- Required capability unavailable in all registered workers
- Destructive command permitted without approval gate
- Acceptance criterion not assigned to any task

## 12. Tests

1. Simple requirement produces analysis, implementation, test, review.
2. Cyclic dependencies fail.
3. Overlapping exclusive file scopes serialize or fail.
4. Every acceptance criterion maps to a task.
5. Build/migrate/commit remain prohibited by default.
6. E2E task is inserted for browser workflows.
7. Provider preference does not become a hard dependency.
8. Graph ordering is deterministic.

## 13. Acceptance criteria

- Generated graph is acyclic.
- Every task has measurable completion outputs.
- Every requirement criterion maps to at least one task.
- Parallel tasks do not have unsafe file overlap.
- Project command policy is preserved.
- Provider routing remains advisory.
