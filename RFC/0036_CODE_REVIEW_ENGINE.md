# RFC 0036: Code Review Engine

## Summary

An automated code review engine that performs static analysis, runs linters, and integrates AI-powered review suggestions.

## Motivation

Currently, code review is manual or limited to basic linting. We need:

1. Unified review criteria DSL
2. Multiple linting tool integration
3. AI-powered review suggestions
4. Configurable severity and rules
5. Review history and trending

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Code Review Engine                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Review     │  │   Linter     │  │   AI         │             │
│  │   Runner     │  │   Adapter    │  │   Reviewer   │             │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Results    │  │   Report     │  │   History    │             │
│  │   Aggregator │  │   Generator  │  │   Tracker    │             │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Review Criteria DSL

```typescript
// review-rules.config.ts
export const reviewRules = {
  // File patterns to include/exclude
  patterns: {
    include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    exclude: ['**/*.test.ts', '**/node_modules/**']
  },
  
  // Severity levels: critical, high, medium, low, info
  rules: [
    {
      id: 'no-console-log',
      severity: 'medium',
      pattern: 'console\\.log\\(',
      message: 'Avoid console.log in production code',
      fix: 'Use a proper logging library'
    },
    {
      id: 'no-any-type',
      severity: 'high',
      pattern: ':\\s*any\\b',
      message: 'Avoid using `any` type - use explicit types',
      autoFix: false
    },
    {
      id: 'security-no-eval',
      severity: 'critical',
      pattern: '\\beval\\(',
      message: 'eval() is a security risk',
      autoFix: false
    }
  ],
  
  // Custom linting tools
  tools: [
    {
      name: 'eslint',
      config: './.eslintrc.json',
      severity: 'inherit' // Inherit severity from ESLint rules
    },
    {
      name: 'typescript',
      config: './tsconfig.json',
      severity: 'error'
    },
    {
      name: 'prettier',
      config: './.prettierrc',
      severity: 'warn'
    }
  ]
};
```

### 2. CodeReviewEngine Class

```typescript
interface CodeReviewConfig {
  rulesFile?: string;               // Path to rules config
  rules?: ReviewRule[];             // Or inline rules
  tools?: LinterConfig[];           // Linting tool configs
  aiReviewer?: AIReviewerConfig;   // AI review settings
  parallel?: boolean;               // Run checks in parallel
  failOn?: Severity[];             // Fail on these severities
}

interface ReviewRule {
  id: string;
  severity: Severity;
  pattern: string | RegExp;
  message: string;
  fix?: string;
  autoFix?: boolean;
  tags?: string[];
}

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

class CodeReviewEngine {
  constructor(config: CodeReviewConfig);
  
  // Run review on files
  async reviewFiles(paths: string[]): Promise<ReviewResult>;
  
  // Run review on git diff
  async reviewDiff(repoPath: string, baseRef: string): Promise<ReviewResult>;
  
  // Run specific tool
  async runTool(toolName: string): Promise<ToolResult>;
  
  // Generate report
  generateReport(result: ReviewResult, format: 'text' | 'json' | 'html'): string;
  
  // Trending
  getTrends(jobId: string): Promise<ReviewTrends>;
}

interface ReviewResult {
  timestamp: string;
  duration: number;
  filesReviewed: number;
  findings: Finding[];
  toolResults: ToolResult[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  passed: boolean;
}

interface Finding {
  ruleId: string;
  severity: Severity;
  file: string;
  line: number;
  column: number;
  message: string;
  code?: string;
  fix?: string;
  autoFixable: boolean;
  tags?: string[];
}
```

### 3. Linter Adapters

```typescript
interface LinterAdapter {
  readonly name: string;
  readonly supportedExtensions: string[];
  
  check(file: string, config?: unknown): Promise<LinterResult>;
  format?(output: LinterResult): Finding[];
}

class ESLintAdapter implements LinterAdapter {
  readonly name = 'eslint';
  readonly supportedExtensions = ['.ts', '.tsx', '.js', '.jsx'];
  
  async check(file: string, config?: ESLintConfig): Promise<LinterResult>;
}

// Built-in adapters
const builtInAdapters: LinterAdapter[] = [
  new ESLintAdapter(),
  new TypeScriptAdapter(),
  new PrettierAdapter(),
  new RuffAdapter(),        // Python
  new GolangCILintAdapter() // Go
];
```

### 4. AI Reviewer Integration

```typescript
interface AIReviewerConfig {
  provider: 'openai' | 'anthropic' | 'deepagents';
  model?: string;
  maxTokens?: number;
  focusAreas?: AIArea[];
}

type AIArea = 
  | 'security'
  | 'performance'
  | 'best-practices'
  | 'readability'
  | 'architecture';

interface AIReviewResult {
  file: string;
  suggestions: AISuggestion[];
  summary: string;
}

interface AISuggestion {
  line: number;
  severity: 'enhancement' | 'warning' | 'critical';
  original: string;
  suggestion: string;
  explanation: string;
  reasoning?: string;
}

class AIReviewer {
  constructor(config: AIReviewerConfig);
  
  async reviewFile(file: string, content: string): Promise<AIReviewResult>;
  async reviewChanges(changes: DiffHunk[]): Promise<AIReviewResult[]>;
}
```

### 5. Report Generator

```typescript
interface ReportConfig {
  title: string;
  logo?: string;
  includeSummary: boolean;
  includeFindings: boolean;
  includeTrends: boolean;
  maxFindings?: number;
  groupBy?: 'file' | 'severity' | 'rule';
}

class ReviewReportGenerator {
  constructor(config: ReportConfig);
  
  generateText(result: ReviewResult): string;
  generateJSON(result: ReviewResult): string;
  generateHTML(result: ReviewResult): string;
  generateMarkdown(result: ReviewResult): string;
}
```

## File Structure

```
packages/code-review/
├── src/
│   ├── index.ts                    # Public exports
│   ├── engine.ts                   # CodeReviewEngine
│   ├── dsl/
│   │   ├── parser.ts              # Rules DSL parser
│   │   └── validator.ts            # Config validation
│   ├── linters/
│   │   ├── base.ts                # LinterAdapter interface
│   │   ├── eslint.ts
│   │   ├── typescript.ts
│   │   ├── prettier.ts
│   │   └── registry.ts           # Linter registry
│   ├── ai-reviewer/
│   │   ├── index.ts               # AIReviewer
│   │   └── providers/
│   │       ├── openai.ts
│   │       └── anthropic.ts
│   ├── reports/
│   │   ├── text.ts
│   │   ├── html.ts
│   │   └── markdown.ts
│   ├── history/
│   │   └── tracker.ts             # Review history
│   ├── types.ts
│   └── errors.ts
├── test/
├── examples/
│   ├── basic-review.ts
│   ├── custom-rules.ts
│   └── ci-integration.ts
├── rules/
│   ├── typescript.json            # Default TS rules
│   ├── security.json              # Security-focused rules
│   └── best-practices.json
├── package.json
└── README.md
```

## Usage Examples

### Basic File Review

```typescript
import { CodeReviewEngine } from '@pi/code-review';

const engine = new CodeReviewEngine({
  rules: [
    {
      id: 'no-console',
      severity: 'warn',
      pattern: 'console\\.(log|debug)',
      message: 'Avoid console statements'
    }
  ],
  tools: [{ name: 'eslint', config: './.eslintrc.json' }],
  failOn: ['critical', 'high']
});

const result = await engine.reviewFiles([
  'src/index.ts',
  'src/utils.ts'
]);

console.log(`Found ${result.summary.critical} critical issues`);
```

### CI/CD Integration

```typescript
import { CodeReviewEngine } from '@pi/code-review';

const engine = new CodeReviewEngine({
  rulesFile: './review-rules.config.ts',
  failOn: ['critical', 'high']
});

// GitHub Actions style
const result = await engine.reviewDiff(process.cwd(), 'origin/main');

if (!result.passed) {
  console.log('## Code Review Summary');
  console.log(`❌ ${result.summary.critical} critical, ${result.summary.high} high issues`);
  console.log(`\n${engine.generateReport(result, 'text')}`);
  process.exit(1);
}
```

### HTML Report Generation

```typescript
const report = engine.generateReport(result, 'html');

fs.writeFileSync('code-review-report.html', report);

// Or use the report generator directly
import { ReviewReportGenerator } from '@pi/code-review';

const generator = new ReviewReportGenerator({
  title: 'Code Review Report',
  logo: './logo.png',
  includeTrends: true
});

const html = generator.generateHTML(result);
```

### Custom Linter Integration

```typescript
import { LinterAdapter, LinterResult, Finding } from '@pi/code-review';

class CustomLinterAdapter implements LinterAdapter {
  readonly name = 'custom-linter';
  readonly supportedExtensions = ['.custom'];

  async check(file: string, config?: unknown): Promise<LinterResult> {
    const output = await runCustomLinter(file, config);
    return this.parseOutput(output);
  }
}

// Register the adapter
const registry = LinterAdapterRegistry.getInstance();
registry.register(new CustomLinterAdapter());
```

## Integration with AgentWorker

```typescript
// In a task that runs code review
import { AgentWorker } from '@pi/types';

class ReviewAgent implements AgentWorker {
  async execute(request: TaskRequest): Promise<TaskResult> {
    const { files } = request.task.config;
    
    const engine = new CodeReviewEngine({
      rulesFile: './review-rules.config.ts'
    });
    
    const result = await engine.reviewFiles(files);
    
    return {
      status: result.passed ? 'success' : 'failure',
      summary: `Found ${result.summary.total} issues`,
      filesChanged: [],
      output: engine.generateReport(result, 'markdown'),
      completedAt: new Date().toISOString()
    };
  }
}
```

## Acceptance Criteria

1. ✅ Pattern-based rule matching with configurable severity
2. ✅ ESLint, TypeScript, and Prettier integration
3. ✅ AI-powered review suggestions (optional)
4. ✅ Multiple report formats (text, JSON, HTML, Markdown)
5. ✅ CI/CD ready with exit codes
6. ✅ Review history tracking
7. ✅ Auto-fix support for applicable rules

## Dependencies

- `packages/types` - for runtime-types
- `packages/provider-adapter-sdk` - for AI provider integration
- `eslint` - optional, for ESLint integration
- `typescript` - optional, for TS checking
