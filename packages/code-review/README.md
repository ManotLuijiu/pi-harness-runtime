# @pi/code-review

Automated code review engine with pattern-based rules, multi-file analysis, and configurable reporting.

## Features

- **Pattern-Based Rules** - Define custom rules with regex patterns
- **Multi-File Analysis** - Review entire projects at once
- **Multiple Report Formats** - Text, HTML, Markdown, and JSON
- **Configurable Severity** - Filter by error, warning, info, hint
- **Category Organization** - Security, performance, correctness, style, etc.
- **Git Integration Ready** - Review diffs and changed files
- **Custom Matchers** - Register custom analysis functions
- **Rule Sets** - Group and reuse rule collections

## Installation

```bash
npm install @pi/code-review
```

## Quick Start

### Basic Usage

```typescript
import { createCodeReviewEngine } from "@pi/code-review";

const engine = createCodeReviewEngine();

// Create review request
const request = {
  files: [
    {
      path: "src/index.ts",
      content: `const result = eval(userInput);
console.log("Debug:", result);
const x: any = value;
`
    }
  ]
};

// Run review
const result = await engine.review(request);

console.log(`Found ${result.summary.total} issues`);
console.log(`Errors: ${result.summary.errors}`);
console.log(`Warnings: ${result.summary.warnings}`);
```

### Generate Reports

```typescript
import { createCodeReviewEngine, ReportFormat } from "@pi/code-review";

// Generate text report
const textReport = engine.generateReport(result, {
  format: "text",
  includeCode: true,
  groupByFile: true,
});

console.log(textReport);

// Generate HTML report
const htmlReport = engine.generateReport(result, {
  format: "html",
  includeSuggestions: true,
});

await writeFile("report.html", htmlReport);

// Generate Markdown report
const mdReport = engine.generateReport(result, {
  format: "markdown",
  includeSummary: true,
});
```

### Custom Rules

```typescript
import { createCodeReviewEngine } from "@pi/code-review";

const engine = createCodeReviewEngine();

// Add custom rule
engine.addRule({
  id: "custom/no-passwords",
  name: "No hardcoded passwords",
  severity: "error",
  category: "security",
  description: "Avoid hardcoded passwords in code",
  pattern: "password\\s*=\\s*['\"][^'\"]+['\"]",
  message: "Hardcoded password detected",
  suggestion: "Use environment variables instead"
});

// Add multiple rules
engine.addRules([
  {
    id: "custom/secure-random",
    name: "Use crypto.randomUUID",
    severity: "info",
    category: "best-practice",
    description: "Use crypto.randomUUID for UUIDs",
    pattern: "uuid\\(|UUID\\.generate\\(",
    suggestion: "Use crypto.randomUUID() instead"
  }
]);
```

### Rule Sets

```typescript
import { createCodeReviewEngine } from "@pi/code-review";

const engine = createCodeReviewEngine();

// Create rule set
engine.addRuleSet({
  name: "security-strict",
  description: "Strict security rules for production code",
  rules: [
    {
      id: "security/no-eval",
      name: "No eval()",
      severity: "error",
      category: "security",
      description: "Avoid eval()",
      pattern: "\\beval\\s*\\(",
      message: "eval() is forbidden",
      suggestion: "Use Function() or JSON.parse() instead"
    },
    // ... more rules
  ],
  tags: ["security", "production"]
});
```

### Custom Matchers

```typescript
import { createCodeReviewEngine, ReviewFile, CodeIssue } from "@pi/code-review";

const engine = createCodeReviewEngine();

// Register custom matcher
engine.registerCustomMatcher("complexity", (file: ReviewFile) => {
  const issues: CodeIssue[] = [];
  const lines = file.content.split('\n');
  
  // Check for complex functions
  let bracketCount = 0;
  let functionStart = -1;
  
  lines.forEach((line, index) => {
    if (line.includes('function') || line.includes('=>')) {
      functionStart = index;
      bracketCount = 0;
    }
    bracketCount += (line.match(/{/g) || []).length;
    bracketCount -= (line.match(/}/g) || []).length;
    
    if (bracketCount === 0 && functionStart >= 0 && index - functionStart > 50) {
      issues.push({
        id: `complex-function-${index}`,
        severity: "warning",
        category: "maintainability",
        title: "Complex function",
        message: `Function at line ${functionStart + 1} has ${index - functionStart} lines`,
        file: file.path,
        line: functionStart + 1,
        suggestion: "Consider breaking this into smaller functions"
      });
      functionStart = -1;
    }
  });
  
  return issues;
});
```

### Git Diff Review

```typescript
import { createCodeReviewEngine } from "@pi/code-review";

const engine = createCodeReviewEngine();

// Review a diff
const result = await engine.review({
  diff: [
    {
      type: "modified",
      path: "src/index.ts",
      oldContent: "...",
      newContent: "...",
      oldLines: 10,
      newLines: 15
    }
  ]
});
```

## Default Rules

The engine includes these built-in rules:

### Security
- `security/no-eval` - Warns against eval() usage
- `security/no-inner-html` - Warns against innerHTML usage
- `security/no-dynamic-selector` - Warns against dynamic SQL

### Performance
- `performance/no-inner-loop` - Flags nested loops
- `performance/no-sync` - Warns against sync file I/O

### Best Practices
- `best-practice/no-console` - Warns against console statements
- `best-practice/no-any` - Warns against TypeScript any type
- `best-practice/no-deprecated` - Flags deprecated API usage

### Style
- `style/no-magic-numbers` - Warns against magic numbers
- `style/no-todo` - Flags TODO/FIXME comments

## API Reference

### CodeReviewEngine

```typescript
const engine = createCodeReviewEngine(options?);
```

### Methods

```typescript
// Add a rule
engine.addRule(rule: ReviewRule): void;

// Add multiple rules
engine.addRules(rules: ReviewRule[]): void;

// Add a rule set
engine.addRuleSet(set: RuleSet): void;

// Register custom matcher
engine.registerCustomMatcher(name: string, matcher: (file) => CodeIssue[]): void;

// Get enabled rules
engine.getRules(): ReviewRule[];

// Review files
engine.review(request: ReviewRequest): Promise<ReviewResult>;

// Generate report
engine.generateReport(result: ReviewResult, options: ReportOptions): string;
```

### Report Options

```typescript
interface ReportOptions {
  format: "text" | "json" | "html" | "markdown";
  includeCode?: boolean;
  includeSuggestions?: boolean;
  includeStats?: boolean;
  includeSummary?: boolean;
  groupByFile?: boolean;
  groupBySeverity?: boolean;
  color?: boolean;
}
```

### Review Rule

```typescript
interface ReviewRule {
  id: string;
  name: string;
  severity: "error" | "warning" | "info" | "hint";
  category: "security" | "performance" | "correctness" | "maintainability" | "style" | "best-practice";
  description: string;
  pattern?: string | RegExp;
  patternFlags?: string;
  message?: string;
  suggestion?: string;
  url?: string;
  enabled?: boolean;
  tags?: string[];
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  CodeReviewEngine                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Rule Engine │  │ Custom       │  │ Report       │  │
│  │             │──│ Matchers     │──│ Generator    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│         │                                      │        │
│         ▼                                      ▼        │
│  ┌──────────────┐                     ┌──────────────┐  │
│  │ Pattern     │                     │ Text|Html|Md  │  │
│  │ Matcher     │                     │ Reporters    │  │
│  └──────────────┘                     └──────────────┘  │
└─────────────────────────────────────────────────────────┘
```
