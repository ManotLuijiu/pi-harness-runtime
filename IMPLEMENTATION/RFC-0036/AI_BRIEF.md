# RFC-0036 AI Brief: Code Review Engine

## Summary

An automated code review engine that performs static analysis, runs linters, and integrates AI-powered review suggestions.

## Implementation Overview

### Key Classes to Implement

1. **CodeReviewEngine** (`engine.ts`)
   - Pattern-based rule matching
   - Multi-file review
   - Git diff review
   - Report generation

2. **Review DSL Parser** (`dsl/parser.ts`)
   - Parse review-rules.config.ts
   - Validate rule definitions
   - Load ESLint/TypeScript configs

3. **Linter Adapters** (`linters/`)
   - ESLint adapter
   - TypeScript adapter
   - Prettier adapter
   - Custom linter support

4. **AIReviewer** (`ai-reviewer/`)
   - OpenAI integration
   - Anthropic/Claude integration
   - Security, performance, best-practices focus areas

5. **Report Generator** (`reports/`)
   - Text format
   - JSON format
   - HTML format
   - Markdown format

### Dependencies

- `packages/types` - for runtime-types
- `packages/provider-adapter-sdk` - for AI provider integration
- `eslint` - optional, for ESLint integration
- `typescript` - optional, for TS checking

### Files to Create

- `packages/code-review/src/engine.ts`
- `packages/code-review/src/dsl/parser.ts`
- `packages/code-review/src/dsl/validator.ts`
- `packages/code-review/src/linters/base.ts`
- `packages/code-review/src/linters/eslint.ts`
- `packages/code-review/src/linters/typescript.ts`
- `packages/code-review/src/linters/prettier.ts`
- `packages/code-review/src/linters/registry.ts`
- `packages/code-review/src/ai-reviewer/index.ts`
- `packages/code-review/src/reports/text.ts`
- `packages/code-review/src/reports/html.ts`
- `packages/code-review/src/reports/markdown.ts`
- `packages/code-review/src/history/tracker.ts`
- `packages/code-review/src/types.ts`
- `packages/code-review/src/index.ts`
