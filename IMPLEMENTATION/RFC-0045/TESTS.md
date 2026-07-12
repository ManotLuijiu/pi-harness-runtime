# Tests — RFC-0045

**Status: ✅ TESTS PASSING**

## Test File

`packages/project-analyzer/test/index.test.ts`

## Running Tests

```bash
cd packages/project-analyzer
npm test
```

## Test Results

```
14 pass, 0 fail
34 expect() calls
```

## Test Coverage

### Language Detection Tests

- `detectLanguages > detects TypeScript files`
- `detectLanguages > handles empty file list`
- `detectLanguages > sorts by coverage descending`

### Analyzer Tests

- `ProjectAnalyzer > creates analyzer instance`
- `ProjectAnalyzer > analyzes the current repository`
- `ProjectAnalyzer > detects frameworks`
- `ProjectAnalyzer > detects languages`
- `ProjectAnalyzer > discovers rules`
- `ProjectAnalyzer > generates warnings for unknown frameworks`

### Cache Tests

- `AnalysisCache > generates consistent cache keys`
- `AnalysisCache > generates different keys for different inputs`

### Command Discovery Tests

- `Package Script Parsing > extracts scripts from package.json`
- `Package Script Parsing > handles empty scripts`
- `Package Script Parsing > marks primary scripts correctly`

## Additional Test Scenarios (to add)

1. Detect Frappe bench
2. Detect Frappe SPA
3. Detect Next.js
4. Detect React/Vite
5. Return generic profile for unknown project
6. Handle monorepo applications
7. Discover AGENTS.md rules
8. Record but do not execute build/migrate commands
9. Reject symlink traversal outside root
10. Cache invalidates when rule files change
