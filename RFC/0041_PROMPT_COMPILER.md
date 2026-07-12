# RFC-0041 — Prompt Compiler

Status: Draft  
Target package: `packages/prompt-compiler`  
Owner: Runtime Intelligence  
Depends on: RFC-0042 Context Compiler, RFC-0043 Requirement Compiler

## 1. Problem

Provider prompts are currently assembled informally. That creates inconsistent instructions, duplicate context, missing output contracts, and poor resumability. The Prompt Compiler shall convert normalized runtime inputs into a deterministic `PromptPackage` that can be sent to Codex, MiniMax, GLM, or another provider adapter.

The compiler does not call a model. It produces an immutable artifact that can be inspected, hashed, cached, resumed, and replayed.

## 2. Inputs and outputs

Inputs:

```ts
export interface PromptCompileRequest {
  task: CompiledTask;
  requirement: CompiledRequirement;
  context: CompiledContext;
  provider: ProviderTarget;
  attempt: number;
  continuation?: ContinuationContext;
}
```

Output:

```ts
export interface PromptPackage {
  version: "1";
  taskId: string;
  provider: ProviderTarget;
  system: string;
  user: string;
  sections: PromptSection[];
  estimatedInputTokens: number;
  sourceRefs: SourceReference[];
  hash: string;
  createdAt: string;
}
```

The generated package is persisted under:

```text
~/.pi/harness/jobs/<job-id>/prompts/<task-id>/<attempt>/
├── prompt.md
├── prompt.json
├── sources.json
└── metadata.json
```

## 3. Compilation pipeline

```text
PromptCompileRequest
  -> normalize input
  -> select provider profile
  -> assemble ordered sections
  -> remove duplicate context
  -> enforce policy constraints
  -> estimate token size
  -> compact optional sections
  -> validate output contract
  -> calculate content hash
  -> persist PromptPackage
```

Section order is deterministic:

1. Runtime identity
2. Project rules
3. Objective
4. Acceptance criteria
5. Relevant context
6. Known constraints
7. Files in scope
8. Required output
9. Tool permissions
10. Continuation instructions

## 4. Provider profiles

```ts
export interface ProviderPromptProfile {
  id: string;
  supportsSystemPrompt: boolean;
  preferredInstructionStyle: "xml" | "markdown" | "plain";
  maximumInputTokens: number;
  reservedOutputTokens: number;
  continuationMarker: string;
}
```

Provider-specific formatting is allowed only in the final formatting stage. Core prompt semantics must remain provider-independent.

## 5. Deduplication

Context entries are normalized using:

```ts
normalize(text) =
  lowercase(
    collapseWhitespace(
      stripMarkdownDecoration(text)
    )
  )
```

Exact duplicate normalized entries are removed. Near-duplicate removal may use a configurable similarity threshold but must be disabled by default because accidental semantic deletion is more dangerous than moderate token waste.

## 6. Token budget

The compiler must reject a package when required sections exceed:

```text
provider.maximumInputTokens - provider.reservedOutputTokens
```

Optional context sections are compacted in this order:

1. Historical logs
2. Previous successful examples
3. Low-priority repository notes
4. Non-blocking discussion
5. Redundant file summaries

Project rules, security constraints, objective, and acceptance criteria are never automatically removed.

## 7. Validation

Compilation fails when:

- `task.id` is empty.
- Objective is empty.
- No expected output is defined.
- A referenced source cannot be resolved and is marked required.
- Token budget remains exceeded after optional compaction.
- The prompt grants a tool permission forbidden by the Policy Engine.

```ts
export type PromptCompileErrorCode =
  | "INVALID_TASK"
  | "MISSING_OBJECTIVE"
  | "MISSING_OUTPUT_CONTRACT"
  | "UNRESOLVED_REQUIRED_SOURCE"
  | "TOKEN_BUDGET_EXCEEDED"
  | "POLICY_CONFLICT";
```

## 8. Runtime events

```ts
type PromptCompilerEvent =
  | { type: "prompt.compilation.started"; taskId: string; attempt: number }
  | { type: "prompt.compaction.applied"; taskId: string; removed: string[] }
  | { type: "prompt.compilation.completed"; taskId: string; hash: string }
  | { type: "prompt.compilation.failed"; taskId: string; code: PromptCompileErrorCode };
```

## 9. Continuation support

When a provider stops because of output limits, the Partial Response Recovery subsystem supplies:

```ts
export interface ContinuationContext {
  previousResponsePath: string;
  completedItems: string[];
  incompleteItems: string[];
  instruction: "continue_without_repeating";
}
```

The compiler must include the previous response reference and incomplete work list, while explicitly forbidding repetition of completed sections.

## 10. Security

The compiler must never embed:

- Provider API keys
- Browser cookies
- OAuth tokens
- Unredacted secrets from environment files
- Entire `.git` history
- Files excluded by project policy

All source material passes through a redaction interface before assembly.

## 11. Reference algorithm

```ts
export async function compilePrompt(
  request: PromptCompileRequest,
  deps: PromptCompilerDependencies,
): Promise<PromptPackage> {
  const normalized = normalizeRequest(request);
  const profile = deps.profiles.get(normalized.provider);
  const rawSections = await deps.sectionBuilder.build(normalized);
  const redacted = await deps.redactor.redact(rawSections);
  const deduplicated = deduplicateSections(redacted);
  const budgeted = compactToBudget(deduplicated, profile);
  validateSections(budgeted, normalized, profile);
  const rendered = renderForProvider(budgeted, profile);
  const hash = deps.hasher.sha256(rendered.system + "\n" + rendered.user);

  return {
    version: "1",
    taskId: normalized.task.id,
    provider: normalized.provider,
    system: rendered.system,
    user: rendered.user,
    sections: budgeted,
    estimatedInputTokens: deps.tokenEstimator.estimate(rendered),
    sourceRefs: collectSourceRefs(budgeted),
    hash,
    createdAt: deps.clock.now().toISOString(),
  };
}
```

## 12. Acceptance criteria

- Identical inputs produce identical prompt content and hash.
- Required sections are never removed by compaction.
- Provider formatting does not alter task semantics.
- Secrets are redacted before persistence.
- Invalid output contracts fail compilation.
- Continuation prompts do not repeat completed work.
- Unit tests cover all error codes.
