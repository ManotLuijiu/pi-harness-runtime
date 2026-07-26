# RFC-0102 — Context Engineering Pipeline

> **Status:** Proposed  
> **Author:** pi-harness-runtime  
> **Replaces:** N/A  
> **Superseded by:** N/A

---

## Summary

The Context Engineering Pipeline transforms user intent into an optimal LLM input by automatically discovering, collecting, filtering, ranking, compressing, and compiling the correct context. The LLM receives a structured Context Package — not a raw prompt with scattered files.

---

## Motivation

Current AI coding tools:

```
User Prompt → LLM → Answer
```

This runtime should:

```
User Intent
  ↓
Intent Analyzer
  ↓
Workspace Scanner
  ↓
Context Discovery
  ↓
Knowledge Retrieval (OKF)
  ↓
Dependency Analysis
  ↓
Context Ranking
  ↓
Context Compression
  ↓
Prompt Compiler
  ↓
LLM
  ↓
Knowledge Engine (OKF)
```

The quality of the runtime depends on **Context Engineering**, not Prompt Engineering.

---

## Existing Architecture (Do Not Redesign)

The runtime already contains working implementations:

| Component | Package | RFC |
|---|---|---|
| Context Ranker | `packages/context-compiler/src/score.ts` | — |
| Context Compressor | `packages/context-compiler/src/budget.ts` | — |
| Prompt Compiler | `packages/context-compiler/src/compiler.ts` | — |
| Context Cache | `packages/context-compiler/src/cache.ts` | — |
| OKF Loader | `packages/context-compiler/src/okf-loader.ts` | — |
| Shared Blackboard | `harness/blackboard.ts` | RFC-0006 |
| Task Graph | `harness/task-graph.ts` | RFC-0007 |
| Loop Runtime | `harness/loop-runtime.ts` | RFC-0007 |

**Integration rule:** Import from `@pi/context-compiler` — do not copy its logic.

---

## New Packages

```
packages/
  intent-analyzer/         # Stage 1 — Intent Analyzer
  workspace-scanner/        # Stage 2 — Workspace Scanner
  dependency-analyzer/      # Stage 5 — Dependency Analysis
  context-discovery/        # Stage 3 — Context Discovery (orchestrates)
  context-engineering/     # Stage 6 — Pipeline coordinator (wires all stages)
```

---

## Stage 1 — Intent Analyzer

### Responsibility

Determine what the user is actually trying to accomplish from their input.

### Intent Kinds

- `bug_fix` — fix, bug, error, crash, fail, broken, issue, defect, patch, hotfix
- `feature` — add, implement, new, create, build, introduce
- `refactor` — refactor, rename, move, extract, restructure, cleanup, simplify, rewrite
- `code_review` — review, check code, audit, critique, evaluate, assess
- `documentation` — doc, readme, comment, document, guide, changelog
- `testing` — test, spec, coverage, unit test, e2e
- `deployment` — deploy, release, publish, ship, launch, rollout
- `research` — research, investigate, explore, analyze, study
- `learning` — learn, teach, explain, how does, what is
- `migration` — migrate, convert, port, upgrade, transition
- `security` — security, vulnerability, exploit, auth, permission, CVE
- `performance` — performance, speed, optimize, latency, benchmark
- `architecture` — architecture, design, structure, system design, pattern
- `general` — fallback when no signals detected

### Output

```typescript
interface Intent {
  kind: IntentKind;
  confidence: "high" | "medium" | "low";
  signals: IntentSignal[];  // matched keywords + weights
  originalText: string;
}
```

---

## Stage 2 — Workspace Scanner

### Responsibility

Automatically inspect the workspace to build a `WorkspaceSnapshot`.

### Git State

- Branch name
- Dirty status
- Modified files list
- Untracked files list
- Ahead/behind upstream count
- Last commit timestamp

### Project Type Detection

Detect from file presence:

| Indicator | Project Type |
|---|---|
| `package.json` | Node.js |
| `pnpm-lock.yaml` | pnpm |
| `yarn.lock` | yarn |
| `bun.lock` | bun |
| `vite.config.ts` | Vite |
| `next.config.js` | Next.js |
| `nuxt.config.ts` | Nuxt |
| `pyproject.toml` | Python |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `pom.xml` | Java (Maven) |
| `composer.json` | PHP |

### Config Files

- `tsconfig.json`, `jsconfig.json`
- `.env`, `.env.local`, `.env.example`
- `eslint.config.js`, `prettierrc.json`
- `jest.config.js`, `vitest.config.ts`

### Output

```typescript
interface WorkspaceSnapshot {
  root: string;
  git: GitState | null;
  project: ProjectConfig;
  envFiles: string[];       // .env, .env.local, etc.
  configFiles: string[];    // tsconfig.json, eslint, etc.
  hasGit: boolean;
  hasNode: boolean;
  hasPython: boolean;
}
```

---

## Stage 3 — Context Discovery

### Responsibility

Orchestrate workspace-scanner, dependency-analyzer, intent-analyzer, and OKF to collect relevant context.

### Discovery Sources

| Source | Priority | Kind |
|---|---|---|
| AGENTS.md | Required | `project_rule` |
| README.md | Required | `source_file` |
| tsconfig.json | Required | `source_file` |
| package.json | Required | `source_file` |
| Modified files (git) | High | `git_diff` |
| Neighboring files (imports) | High | `source_file` |
| RFC files matching intent | Medium | `source_file` |
| OKF concepts | Medium | `okf_concept` |
| Recent commits | Low | `source_file` |
| Test failures | High | `test_failure` |
| Untracked files | Low | `source_file` |

### Avoid

- `**/.env*` — never include
- `**/node_modules/**`
- `**/dist/**`
- `**/*.log`
- `**/coverage/**`
- `**/.git/**`

### Integration with context-compiler

Use `compileContext()` from `@pi/context-compiler` as the final compilation step.

```typescript
import { compileContext } from "@pi/context-compiler";

// candidates come from context-discovery
const result = await compileContext({
  taskId,
  taskObjective: intent.kind,
  maximumTokens: 50_000,
  worktreePath,
  candidates: discoveredCandidates,
});
```

---

## Stage 4 — Knowledge Retrieval (OKF)

### Responsibility

Load relevant OKF concepts for the task.

Uses existing `loadOkfConcepts()` from `@pi/context-compiler/src/okf-loader.ts`.

OKF concepts are pre-classified:

- `concept` — architectural pattern, lesson, failure, decision
- `tags` — searchable keywords
- `content` — the knowledge itself

### Integration

```typescript
import { loadOkfConcepts } from "@pi/context-compiler";

const okfConcepts = loadOkfConcepts();
const relevant = okfConcepts.filter(c =>
  tagsMatch(c.tags, intent.kind) ||
  c.content.includes(filePath)
);
```

---

## Stage 5 — Dependency Analysis

### Responsibility

Discover relationships between files.

### Import Patterns Supported

**TypeScript / JavaScript:**

```typescript
import X from './y'           // ESM default
import X from 'package'       // ESM package
import { a, b } from './x'    // ESM named
import * as X from './x'      // ESM namespace
const X = require('./y')     // CommonJS
```

**Python:**

```python
from module import x          # from-import
import module                 # direct import
```

### Output

```typescript
interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: DependencyEdge[];
}

interface DependencyNode {
  id: string;           // file path
  filePath: string;
  kind: DependencyKind;
  imports: string[];     // resolved import paths
}

interface DependencyEdge {
  from: string;         // file that imports
  to: string;           // imported file
  kind: "import" | "export" | "extends" | "implements" | "call" | "reference";
  weight: number;
}
```

### Cycle Detection

Detect circular dependencies and warn (do not break — just annotate).

---

## Stage 6 — Context Ranking

### Responsibility

Score and prioritize context candidates.

Uses existing `rankCandidates()` from `@pi/context-compiler/src/score.ts`.

### Scoring Signals

| Signal | Weight | Description |
|---|---|---|
| `priority` | 10 | Explicit priority field |
| `directFileReference` | 5 | File mentioned in task |
| `recentFailureRelevance` | 3 | Related to recent test failure |
| `dependencyRelevance` | 2 | Directly depends on referenced files |
| `frameworkRelevance` | 2 | Framework-specific file |

---

## Stage 7 — Context Compression

### Responsibility

Fit context into the available token budget.

Uses existing `fitToBudget()` from `@pi/context-compiler/src/budget.ts`.

### Budget Allocation (default 50,000 tokens)

| Section | Budget |
|---|---|
| Intent + Task Objective | 500 tokens |
| Architecture + Project Config | 2,000 tokens |
| OKF Knowledge | 5,000 tokens |
| Modified Files | 15,000 tokens |
| Context Candidates | 25,000 tokens |
| Dependency Graph (text) | 2,500 tokens |

---

## Stage 8 — Prompt Compiler

### Responsibility

Generate a structured Context Package.

Uses existing `compileContext()` from `@pi/context-compiler`.

### Context Package Structure

```typescript
interface ContextPackage {
  intent: Intent;
  workspace: WorkspaceSnapshot;
  architecture: {
    summary: string;
    layers: string[];
    keyPatterns: string[];
  };
  relevantFiles: CompiledContextItem[];
  dependencyGraph: DependencyGraph | null;
  knowledge: OkfConcept[];
  constraints: string[];
  codingRules: string[];      // from AGENTS.md
  acceptanceCriteria: string[]; // from task
  userPrompt: string;
}
```

---

## Stage 9 — Context Cache

### Responsibility

Avoid rebuilding identical contexts.

Uses existing `generateCacheKey()` and `shouldInvalidate()` from `@pi/context-compiler/src/cache.ts`.

### Cache Key Components

- `taskObjective` hash
- `worktreePath`
- `gitCommit` (if available)
- `intent.kind`

### Invalidation Triggers

- `source_hash_changed` — any source file changed
- `project_rule_changed` — AGENTS.md modified
- `required_okf_changed` — OKF concept updated
- `worktree_branch_changed` — git branch switched

---

## Stage 10 — Learning Loop

### After every execution

1. Collect new patterns from LLM output
2. Detect architecture decisions from assistant messages
3. Classify failures → promote to OKF on classification
4. On `TaskResult.kind === "deliverable"` → `OKF.promotePattern(task)`

Uses existing OKF integration from `@pi/context-compiler`.

---

## Integration Points

### With Loop Runtime (harness/loop-runtime.ts)

```
loop-runtime.ts
  → IntentAnalyzer.analyze(userInput)
  → WorkspaceScanner.scan(worktree)
  → ContextDiscovery.discover(task, intent, workspace)
  → compileContext(candidates)     ← from @pi/context-compiler
  → buildContextPackage()
  → LLM call
  → LearningLoop.update(taskResult)
```

### With OKF (packages/okf-kb/)

```
ContextDiscovery
  → loadOkfConcepts()           ← from @pi/context-compiler
  → filter by intent.kind + file matches

LearningLoop
  → promotePattern(task)        ← future
  → promoteLesson(task)        ← future
```

### With Provider Router (packages/providers/)

```
PromptCompiler
  → estimateTokens()             ← from @pi/context-compiler
  → buildContextPackage()
  → providerRouter.buildPrompt(ctx, model)
```

---

## Security

### Secret Leakage Prevention

- Policy filter (from `@pi/context-compiler`) denies: `**/.env*`, `**/*.pem`, `**/credentials/**`, `**/secrets/**`
- OKF concepts never include raw credentials
- Git diffs sanitized before storage

### Prompt Injection

- Context content is treated as **data**, not **code**
- No `eval()` of context content
- LLM output reviewed before committing changes

---

## Performance

### Parallel Scanning

- WorkspaceScanner, IntentAnalyzer, and DependencyAnalyzer run in parallel
- Each returns independently
- ContextDiscovery awaits all

### Caching

- `generateCacheKey()` hashes task + workspace state
- Cache stored in `~/.pi-harness-runtime/cache/context/`

### Incremental Indexing

- First run: full scan
- Subsequent runs: only changed files (via git status)

### Lazy Loading

- OKF concepts loaded only when needed
- Dependency graph built only for modified files

---

## Files

See `IMPLEMENTATION/RFC-0102/FILES.md`.

---

## Acceptance Criteria

See `IMPLEMENTATION/RFC-0102/ACCEPTANCE_CRITERIA.md`.
