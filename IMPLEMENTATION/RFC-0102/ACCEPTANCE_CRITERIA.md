# Acceptance Criteria — RFC-0102 Context Engineering Pipeline

## Functional

- [ ] IntentAnalyzer classifies "fix the login bug" as `bug_fix`
- [ ] IntentAnalyzer classifies "add dark mode support" as `feature`
- [ ] IntentAnalyzer classifies "deploy to production" as `deployment`
- [ ] IntentAnalyzer falls back to `general` for unknown input
- [ ] WorkspaceScanner detects git branch, dirty state, modified files
- [ ] WorkspaceScanner detects project type from package.json, go.mod, Cargo.toml
- [ ] WorkspaceScanner detects framework from vite.config.ts, next.config.js, nuxt.config.ts
- [ ] DependencyAnalyzer parses ESM imports: `import X from './y'`, `import { a } from 'pkg'`
- [ ] DependencyAnalyzer parses CommonJS: `const X = require('./y')`
- [ ] DependencyAnalyzer parses Python: `from module import x`
- [ ] ContextDiscovery collects candidates from workspace + git diff + OKF
- [ ] ContextEngineeringPipeline returns a valid ContextPackage
- [ ] Policy filter denies `**/.env`, `**/*.pem`, `**/credentials/**`
- [ ] Cache key invalidates when git branch changes
- [ ] Cache key invalidates when AGENTS.md changes

## Non-Functional

- [ ] Each package compiles with `npx tsc --skipLibCheck` zero errors
- [ ] All tests pass: `bun test packages/*/test/*.test.ts`
- [ ] No hardcoded paths — uses configurable root
- [ ] No secret leakage — .env files never included
- [ ] Pipeline processes known workspace in < 2 seconds

## Integration

- [ ] Pipeline integrates with `@pi/context-compiler` (compileContext, loadOkfConcepts)
- [ ] Pipeline integrates with `@pi/session-api` for historical context
- [ ] Pipeline output compatible with provider router input format
