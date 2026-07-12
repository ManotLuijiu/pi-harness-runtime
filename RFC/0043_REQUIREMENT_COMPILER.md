# RFC-0043 — Requirement Compiler

Status: Draft  
Target package: `packages/requirement-compiler`  
Input owner: Human-on-the-loop TUI

## 1. Problem

Client requirements commonly arrive as prose, mixed Thai/English notes, screenshots, and informal acceptance expectations. Coding agents cannot safely execute ambiguous prose directly.

The Requirement Compiler converts raw requirement input into a validated `CompiledRequirement`. It must preserve uncertainty rather than inventing missing business rules.

## 2. Input

```ts
export interface RawRequirement {
  id: string;
  title?: string;
  text: string;
  attachments?: AttachmentReference[];
  source: "tui" | "file" | "api";
  submittedBy: string;
  submittedAt: string;
}
```

## 3. Output

```ts
export interface CompiledRequirement {
  id: string;
  title: string;
  problemStatement: string;
  goals: RequirementGoal[];
  nonGoals: string[];
  constraints: RequirementConstraint[];
  actors: RequirementActor[];
  workflows: RequirementWorkflow[];
  acceptanceCriteria: AcceptanceCriterion[];
  assumptions: RequirementAssumption[];
  ambiguities: RequirementAmbiguity[];
  terminology: Record<string, string>;
  sourceRefs: SourceReference[];
  status: "ready" | "needs_human" | "rejected";
}
```

## 4. Compilation rules

The compiler separates statements into:

- Explicit facts
- Explicit requested behavior
- Constraints
- Assumptions
- Ambiguities
- Suggested implementation details

Suggested implementation details are not converted into mandatory requirements unless the user explicitly marks them as constraints.

Example:

```text
"We prefer Rust WASM for cropping."
```

This becomes:

```json
{
  "kind": "technology_preference",
  "value": "Rust WASM",
  "mandatory": false
}
```

## 5. Ambiguity policy

The compiler must not guess values that materially affect behavior, cost, compliance, or data integrity.

```ts
export interface RequirementAmbiguity {
  id: string;
  question: string;
  blocking: boolean;
  affectedGoals: string[];
  evidence: SourceReference[];
}
```

When the developer instruction allows best-effort progression, a blocking ambiguity may be converted into an explicit reversible assumption, but the assumption must be visible in output.

## 6. Acceptance criteria normalization

Each criterion should use observable language.

Poor:

```text
The page should work well.
```

Compiled:

```json
{
  "id": "AC-001",
  "given": "A valid authenticated user",
  "when": "The user saves the form",
  "then": [
    "The API returns HTTP 200",
    "The saved record is visible after reload",
    "No duplicate record is created"
  ],
  "automatable": true
}
```

## 7. Compliance and risk tags

The compiler identifies requirement areas requiring additional review:

```ts
type RequirementRisk =
  | "financial"
  | "privacy"
  | "authentication"
  | "authorization"
  | "data_migration"
  | "regulatory"
  | "destructive_operation";
```

Risk tags do not replace legal or domain review. They instruct the Master Planner to insert appropriate review tasks.

## 8. Multilingual handling

The original wording must be preserved in source references. The normalized requirement may use the configured project language. Domain terms should be added to `terminology`.

For Thai business systems, the compiler should preserve Thai legal/accounting terms when an English translation could change meaning.

## 9. State model

```text
received
 -> parsing
 -> normalized
 -> validation
 -> ready
      or
 -> needs_human
      or
 -> rejected
```

Rejected means the requirement is empty, internally impossible, or violates project policy. It does not mean implementation failure.

## 10. Reference function

```ts
export async function compileRequirement(
  raw: RawRequirement,
  deps: RequirementCompilerDependencies,
): Promise<CompiledRequirement> {
  const extracted = await deps.extractor.extract(raw);
  const classified = classifyStatements(extracted);
  const normalized = normalizeRequirement(classified, raw);
  const ambiguities = detectAmbiguities(normalized);
  const acceptanceCriteria = normalizeAcceptance(normalized);
  const risks = detectRisks(normalized);

  return validateCompiledRequirement({
    ...normalized,
    acceptanceCriteria,
    ambiguities,
    risks,
    status: ambiguities.some(item => item.blocking)
      ? "needs_human"
      : "ready",
  });
}
```

## 11. Failure cases

- Empty input: reject.
- Unsupported attachment: retain reference and mark extraction failure.
- Contradictory requirements: create blocking ambiguity.
- Missing actor: infer only when obvious; otherwise ambiguity.
- Non-testable acceptance statement: retain as manual criterion.
- Requirement asks for forbidden operation: reject with policy code.

## 12. Tests

1. Explicit requirement remains explicit.
2. Preference is not promoted to mandatory constraint.
3. Contradictory statements create ambiguity.
4. Acceptance criteria become Given/When/Then.
5. Thai terminology remains in the glossary.
6. Financial requirement receives risk tag.
7. Empty requirement is rejected.
8. Source references remain traceable.

## 13. Acceptance criteria

- No material requirement is invented.
- Every compiled goal traces to source text.
- Ambiguities are explicit.
- Acceptance criteria are observable.
- Risk tags are emitted for planner use.
- Original user language is preserved in source references.
