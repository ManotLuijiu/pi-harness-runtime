# RFC-0057 — Evaluation Engine

## 1. Purpose

The Evaluation Engine determines whether an agent-produced result is acceptable before the runtime advances the task. It combines test results, static analysis, policy checks, diff review, artifact validation, and task-specific acceptance criteria.

## 2. Inputs

```ts
export interface EvaluationRequest {
  jobId: string;
  task: CompiledTask;
  worktreePath: string;
  outputs: TaskOutputArtifact[];
  testResults: TestResult[];
  policyFindings: PolicyFinding[];
}
```

## 3. Outputs

```ts
export interface EvaluationResult {
  status: "passed" | "failed" | "needs_review";
  score: number;
  findings: EvaluationFinding[];
  evidence: EvaluationEvidence[];
  recommendedAction: "continue" | "repair" | "human_review";
}
```

## 4. Evaluation Dimensions

- Correctness
- Test completeness
- Acceptance criteria coverage
- Policy compliance
- Code quality
- Security risk
- Regression risk
- Documentation completeness

## 5. Scoring

```text
final_score =
  correctness_weight
  + test_weight
  + acceptance_weight
  + quality_weight
  - policy_penalty
  - security_penalty
  - regression_penalty
```

A critical policy or security finding forces failure regardless of numeric score.

## 6. Evidence Contract

```ts
export interface EvaluationEvidence {
  kind: "test" | "diff" | "file" | "policy" | "screenshot" | "trace";
  path?: string;
  description: string;
  hash?: string;
}
```

The engine must not accept an agent's self-reported completion without external evidence.

## 7. State Flow

```text
pending
 -> collecting_evidence
 -> evaluating
 -> passed
      or failed
      or needs_review
```

## 8. Failure Classification

```ts
export type EvaluationFailureClass =
  | "test_failure"
  | "missing_output"
  | "acceptance_gap"
  | "policy_violation"
  | "security_issue"
  | "regression_risk"
  | "insufficient_evidence";
```

## 9. Integration

- Passed: Task Graph marks task complete.
- Failed: Repair Engine creates repair task.
- Needs review: Human Approval Gate or reviewer agent receives evidence bundle.

## 10. Tests

- Fails when required artifact is missing.
- Fails on critical policy violation.
- Passes when all acceptance criteria are evidenced.
- Returns needs-review for ambiguous manual criterion.
- Preserves evidence references.
- Produces deterministic score.

## 11. Acceptance Criteria

- Every result includes findings and evidence.
- Critical policy findings force failure.
- Self-reported completion alone is insufficient.
- Each acceptance criterion is mapped to evidence or marked unmet.
- Evaluation results are persisted for replay.
