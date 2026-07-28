# Tests — RFC-0102 Context Engineering Pipeline

## intent-analyzer

### Unit Tests

| Test | Input | Expected |
|---|---|---|
| bug_fix detection | "fix the login bug" | kind = "bug_fix" |
| feature detection | "add dark mode support" | kind = "feature" |
| refactor detection | "refactor the auth module" | kind = "refactor" |
| code_review detection | "review the pull request" | kind = "code_review" |
| testing detection | "write tests for payment" | kind = "testing" |
| deployment detection | "deploy to production" | kind = "deployment" |
| security detection | "fix auth vulnerability" | kind = "security" |
| performance detection | "optimize database query" | kind = "performance" |
| architecture detection | "review architecture design" | kind = "architecture" |
| migration detection | "migrate to TypeScript" | kind = "migration" |
| research detection | "investigate memory leak" | kind = "research" |
| learning detection | "explain how X works" | kind = "learning" |
| documentation detection | "add README for API" | kind = "documentation" |
| general fallback | "hello world" | kind = "general" |
| multiple keywords | "fix the security bug" | kind = "bug_fix" (both signals) |
| analyzeBatch | ["fix bug", "add feat"] | [bug_fix, feature] |

## workspace-scanner

### Unit Tests

| Test | Setup | Expected |
|---|---|---|
| detects package.json | package.json in dir | hasNode = true |
| detects pyproject.toml | pyproject.toml in dir | hasPython = true |
| detects git repo | .git in dir | hasGit = true |
| detects dirty git | git with modified files | isDirty = true |
| detects branch | git on branch "feature-x" | branch = "feature-x" |
| detects vite | vite.config.ts in dir | framework = "vite" |
| detects next | next.config.js in dir | framework = "next" |
| skips git | skipGit = true | git = null |
| skips config | skipConfig = true | project = {} |

## dependency-analyzer

### Unit Tests

| Test | Input | Expected |
|---|---|---|
| ESM default import | `import x from './y'` | ['./y'] |
| ESM named import | `import { a, b } from './x'` | ['./x'] |
| ESM package import | `import pkg from 'lodash'` | ['lodash'] |
| ESM namespace | `import * as x from './y'` | ['./y'] |
| CommonJS require | `const x = require('./y')` | ['./y'] |
| Python from-import | `from os import path` | ['os'] |
| Python direct import | `import numpy` | ['numpy'] |
| cycle detection | a->b->c->a | cycle = ['a','b','c'] |
| empty file | '' | [] |

## context-discovery

### Unit Tests

| Test | Setup | Expected |
|---|---|---|
| discovers package.json | npm workspace | candidates has package.json |
| discovers git diff | modified files | candidates has modified files |
| filters .env | workspace has .env | .env not in candidates |
| filters node_modules | workspace has node_modules | node_modules not in candidates |

## context-engineering

### Integration Tests

| Test | Setup | Expected |
|---|---|---|
| full pipeline | known workspace + task | ContextPackage with intent + files |
| cache hit | same task twice | second call faster |
| cache miss | git branch changed | rebuild triggered |
| policy deny | AGENTS.md denies *.pem | pem files omitted |
