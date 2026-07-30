# Files — RFC-0102 Context Engineering Pipeline

## New Packages

```
packages/
+-- intent-analyzer/
|   +-- src/
|   |   +-- types.ts          # Intent, IntentKind, IntentConfidence, IntentSignal, IntentRule
|   |   +-- analyzer.ts       # IntentAnalyzer class — keyword scoring, analyze(text): Intent
|   |   +-- index.ts         # Public barrel
|   +-- test/
|   |   +-- analyzer.test.ts  # bun test — all intent kinds
|   +-- package.json
|   +-- tsconfig.json
|
+-- workspace-scanner/
|   +-- src/
|   |   +-- types.ts         # WorkspaceSnapshot, GitState, ProjectConfig, ScannerOptions
|   |   +-- git.ts           # getGitState(rootPath): GitState | null via git CLI
|   |   +-- detect.ts        # detectProject(rootPath): ProjectConfig — file-based detection
|   |   +-- scanner.ts       # WorkspaceScanner class — orchestrates git + detect
|   |   +-- index.ts         # Public barrel
|   +-- test/
|   |   +-- scanner.test.ts  # bun test — mock workspace
|   +-- package.json
|   +-- tsconfig.json
|
+-- dependency-analyzer/
|   +-- src/
|   |   +-- types.ts         # DependencyNode, DependencyGraph, DependencyEdge, DependencyKind
|   |   +-- analyzer.ts       # DependencyAnalyzer class — scan + graph build
|   |   +-- imports.ts       # parseImports(content, filePath): string[] — regex for TS/JS/Python
|   |   +-- index.ts         # Public barrel
|   +-- test/
|   |   +-- analyzer.test.ts # bun test — import patterns
|   +-- package.json
|   +-- tsconfig.json
|
+-- context-discovery/
|   +-- src/
|   |   +-- types.ts         # DiscoveredContext, DiscoveryOptions, DiscoveryResult
|   |   +-- discovery.ts     # ContextDiscovery class — orchestrates all stages
|   |   +-- index.ts         # Public barrel
|   +-- test/
|   |   +-- discovery.test.ts # bun test — mock dependencies
|   +-- package.json
|   +-- tsconfig.json
|
+-- context-engineering/
    +-- src/
    |   +-- types.ts         # ContextPackage, PipelineOptions, PipelineStats
    |   +-- pipeline.ts       # ContextEngineeringPipeline — orchestrates all 5 packages
    |   +-- cache.ts          # ContextCache — wraps @pi/context-compiler cache
    |   +-- index.ts          # Public barrel
    +-- test/
    |   +-- pipeline.test.ts  # bun test — full pipeline
    +-- package.json
    +-- tsconfig.json
```

## Integration (do not create new files)

| Source | Import from |
|---|---|
| Context Compiler | `@pi/context-compiler` — compileContext, ContextCandidate, ContextPolicy |
| OKF Loader | `@pi/context-compiler/src/okf-loader.js` — loadOkfConcepts |
| Session API | `@pi/session-api` — getRecentFailures, getArchitectureHistory |

## Files NOT Created

- `packages/context-compiler/` — already exists, do not modify
- `packages/okf-kb/` — already exists, do not modify
