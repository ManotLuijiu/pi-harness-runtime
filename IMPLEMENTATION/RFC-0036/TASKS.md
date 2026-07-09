# RFC-0036 Implementation Tasks

## Phase 1: Engine Core

- [ ] Create `packages/code-review/` directory
- [ ] Define types (`Finding`, `ReviewResult`, `ReviewRule`)
- [ ] Create `CodeReviewEngine` class
- [ ] Implement `reviewFiles()` method
- [ ] Implement `reviewDiff()` method
- [ ] Implement pattern matching engine

## Phase 2: DSL & Rules

- [ ] Create `dsl/parser.ts`
- [ ] Implement rules configuration parsing
- [ ] Implement pattern validation
- [ ] Create default rules:
  - [ ] no-console-log
  - [ ] no-any-type
  - [ ] security-no-eval
- [ ] Add support for external config files

## Phase 3: Linter Integration

- [ ] Create `LinterAdapter` interface
- [ ] Implement `ESLintAdapter`
- [ ] Implement `TypeScriptAdapter`
- [ ] Implement `PrettierAdapter`
- [ ] Create `LinterRegistry`
- [ ] Add support for custom linters

## Phase 4: AI Reviewer

- [ ] Create `AIReviewer` class
- [ ] Implement `AIReviewerConfig`
- [ ] Implement OpenAI integration
- [ ] Implement Anthropic/Claude integration
- [ ] Add focus areas (security, performance, etc.)

## Phase 5: Reporting

- [ ] Create `ReviewReportGenerator`
- [ ] Implement text report format
- [ ] Implement JSON report format
- [ ] Implement HTML report format
- [ ] Implement Markdown report format

## Phase 6: History & Trends

- [ ] Create `ReviewHistoryTracker`
- [ ] Implement `getTrends()`
- [ ] Add comparison between reviews
- [ ] Create trend visualization data

## Phase 7: Integration

- [ ] Integrate with AgentWorker
- [ ] Add CI/CD examples (GitHub Actions, GitLab CI)
- [ ] Create review-rules.config.ts examples
- [ ] Write unit tests
