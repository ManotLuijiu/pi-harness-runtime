# Tasks — RFC-0102 Context Engineering Pipeline

## Phase 1 — intent-analyzer

- [ ] Create `packages/intent-analyzer/src/types.ts` — Intent, IntentKind (14 kinds), IntentConfidence, IntentSignal, IntentRule
- [ ] Create `packages/intent-analyzer/src/analyzer.ts` — IntentAnalyzer class with keyword scoring, analyze(text), analyzeBatch(texts)
- [ ] Create `packages/intent-analyzer/src/index.ts` — public barrel
- [ ] Create `packages/intent-analyzer/test/analyzer.test.ts` — bun test for all 14 intent kinds
- [ ] Build and verify: `npx tsc -p packages/intent-analyzer/tsconfig.json --skipLibCheck`
- [ ] Run tests: `bun test packages/intent-analyzer/test/analyzer.test.ts`

## Phase 2 — workspace-scanner

- [ ] Create `packages/workspace-scanner/src/types.ts` — WorkspaceSnapshot, GitState, ProjectConfig, ScannerOptions
- [ ] Create `packages/workspace-scanner/src/git.ts` — getGitState(rootPath) via git CLI (rev-parse, status --porcelain, log -1)
- [ ] Create `packages/workspace-scanner/src/detect.ts` — detectProject(rootPath) from file presence (package.json, go.mod, Cargo.toml, etc.)
- [ ] Create `packages/workspace-scanner/src/scanner.ts` — WorkspaceScanner class orchestrating git + detect
- [ ] Create `packages/workspace-scanner/src/index.ts` — public barrel
- [ ] Create `packages/workspace-scanner/test/scanner.test.ts` — bun test with temp dir
- [ ] Build and verify
- [ ] Run tests

## Phase 3 — dependency-analyzer

- [ ] Create `packages/dependency-analyzer/src/types.ts` — DependencyKind enum, DependencyNode, DependencyGraph, DependencyEdge
- [ ] Create `packages/dependency-analyzer/src/imports.ts` — parseImports(content, filePath) regex for TS/JS/CommonJS/Python
- [ ] Create `packages/dependency-analyzer/src/analyzer.ts` — DependencyAnalyzer class, analyze(filePath, rootPath): DependencyGraph
- [ ] Create `packages/dependency-analyzer/src/index.ts` — public barrel
- [ ] Create `packages/dependency-analyzer/test/analyzer.test.ts` — bun test with sample TypeScript
- [ ] Build and verify
- [ ] Run tests

## Phase 4 — context-discovery

- [ ] Create `packages/context-discovery/src/types.ts` — DiscoveredContext, DiscoveryOptions, DiscoveryResult
- [ ] Create `packages/context-discovery/src/discovery.ts` — ContextDiscovery class orchestrating intent + workspace + dependency + OKF
- [ ] Create `packages/context-discovery/src/index.ts` — public barrel
- [ ] Create `packages/context-discovery/test/discovery.test.ts` — bun test with mocked dependencies
- [ ] Build and verify
- [ ] Run tests

## Phase 5 — context-engineering (Pipeline Coordinator)

- [ ] Create `packages/context-engineering/src/types.ts` — ContextPackage, PipelineOptions, PipelineStats
- [ ] Create `packages/context-engineering/src/pipeline.ts` — ContextEngineeringPipeline class wiring all 5 packages
- [ ] Create `packages/context-engineering/src/cache.ts` — ContextCache wrapping @pi/context-compiler cache
- [ ] Create `packages/context-engineering/src/index.ts` — public barrel
- [ ] Create `packages/context-engineering/test/pipeline.test.ts` — bun test
- [ ] Build and verify
- [ ] Run tests

## Phase 6 — Integration

- [ ] Import `compileContext` from `@pi/context-compiler` in context-discovery
- [ ] Import `loadOkfConcepts` from `@pi/context-compiler/src/okf-loader.js` in context-discovery
- [ ] Wire ContextEngineeringPipeline output to provider router input format
- [ ] Verify full pipeline builds: `npx tsc` across all 5 packages

## Phase 7 — Tests

- [ ] Unit: intent-analyzer — all 14 intent kinds detected correctly
- [ ] Unit: workspace-scanner — git state, project type, framework detection
- [ ] Unit: dependency-analyzer — import parsing for TS/JS/Python, cycle detection
- [ ] Unit: context-discovery — candidates collected from all sources
- [ ] Integration: full pipeline on known test workspace
- [ ] Security: policy filter denies .env files

## Phase 8 — Documentation

- [ ] Write `packages/intent-analyzer/README.md`
- [ ] Write `packages/workspace-scanner/README.md`
- [ ] Write `packages/dependency-analyzer/README.md`
- [ ] Write `packages/context-discovery/README.md`
- [ ] Write `packages/context-engineering/README.md`
- [ ] Update root `README.md` with RFC-0102 reference
