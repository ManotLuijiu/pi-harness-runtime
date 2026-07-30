# AI Brief — RFC-0102 Context Engineering Pipeline

## What is being built

An 5-package pipeline that transforms user intent into an optimal LLM input:

1. **intent-analyzer** — keyword-based intent classification
2. **workspace-scanner** — git state + project type detection
3. **dependency-analyzer** — import/export graph builder
4. **context-discovery** — orchestrates all stages to collect relevant files
5. **context-engineering** — wires pipeline, builds ContextPackage, manages cache

Existing `packages/context-compiler/` covers: ranking, compression, compilation, OKF loading.

## Key interfaces

- `Intent` — kind (bug_fix/feature/etc.), confidence, signals, originalText
- `WorkspaceSnapshot` — root, git state, project config, env files, config files
- `DependencyGraph` — Map<filePath, DependencyNode> + edges[]
- `DiscoveredContext` — intent + workspace + dependencies + knowledge + files
- `ContextPackage` — structured output sent to LLM

## Integration

- Pipeline reads from: filesystem, git, OKF
- Output feeds: `compileContext()` from `@pi/context-compiler`, then to provider router
- No new schema — uses existing context-compiler types for candidates
- Session API (RFC-0103) provides historical context

## Testing strategy

- Unit: intent detection keywords, workspace detection patterns, import parsing
- Integration: full pipeline on known workspaces
- Mock workspace fixture for CI
