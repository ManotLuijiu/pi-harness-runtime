# RFC 0037: Code Generation Pipeline

## Summary

A comprehensive code generation system with template management, validation pipeline, and automatic rollback capabilities.

## Motivation

We need automated code generation for:

1. Standard project structures
2. Framework-specific scaffolding
3. Repeated patterns (CRUD, APIs)
4. Generated code validation
5. Safe rollback on failure

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   Code Generation Pipeline                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  Template    │  │  Generator   │  │  Validator   │             │
│  │  Manager     │  │  Engine      │  │  Pipeline    │             │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  Rollback    │  │  Change      │  │  Diff        │             │
│  │  Manager     │  │  Tracker     │  │  Generator   │             │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Template System

```typescript
interface CodeTemplate {
  id: string;
  name: string;
  description: string;
  version: string;
  framework?: string;              // e.g., 'react', 'nextjs', 'frappe'
  
  // Template files (EJS or similar)
  files: TemplateFile[];
  
  // Variables schema
  variables: VariableSchema[];
  
  // Validation rules
  validation?: ValidationRule[];
  
  // Post-generation hooks
  hooks?: {
    beforeGenerate?: HookFunction;
    afterGenerate?: HookFunction;
    onError?: HookFunction;
  };
}

interface TemplateFile {
  path: string;                    // Output path with {{variables}}
  content: string;                // Template content
  mode?: number;                   // File permissions
}

interface VariableSchema {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'array' | 'object';
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: { label: string; value: unknown }[]; // For 'select' type
  validate?: (value: unknown) => ValidationResult;
}

// Example template
const reactComponentTemplate: CodeTemplate = {
  id: 'react-component',
  name: 'React Component',
  description: 'Generate a new React component with tests',
  framework: 'react',
  files: [
    { path: 'src/components/{{name}}/{{name}}.tsx', content: '...' },
    { path: 'src/components/{{name}}/{{name}}.test.tsx', content: '...' },
    { path: 'src/components/{{name}}/index.ts', content: '...' }
  ],
  variables: [
    { name: 'name', type: 'string', required: true },
    { name: 'withProps', type: 'boolean', default: true },
    { name: 'styleType', type: 'select', options: [
      { label: 'CSS Modules', value: 'modules' },
      { label: 'Tailwind', value: 'tailwind' }
    ]}
  ]
};
```

### 2. Generator Engine

```typescript
interface GeneratorConfig {
  templateDir?: string;           // Custom template location
  outputDir?: string;              // Default output directory
  dryRun?: boolean;                // Preview without writing
  force?: boolean;                 // Overwrite existing files
  onProgress?: (event: GenerationEvent) => void;
}

interface GenerationEvent {
  type: 'file-start' | 'file-complete' | 'variable-resolved' | 'error';
  file?: string;
  message?: string;
  progress?: number;
}

interface GenerationResult {
  success: boolean;
  generatedFiles: GeneratedFile[];
  skippedFiles: SkippedFile[];
  errors: GenerationError[];
  duration: number;
  rollbackId?: string;            // For undo
}

interface GeneratedFile {
  path: string;
  content: string;
  size: number;
  template: string;
}

interface GenerationError {
  file: string;
  message: string;
  recoverable: boolean;
}

class CodeGenerator {
  constructor(config: GeneratorConfig);
  
  // Load and manage templates
  loadTemplate(template: CodeTemplate): void;
  loadTemplateFromPath(path: string): Promise<CodeTemplate>;
  listTemplates(): TemplateInfo[];
  
  // Generation
  generate(
    templateId: string, 
    variables: Record<string, unknown>,
    options?: GenerationOptions
  ): Promise<GenerationResult>;
  
  // Dry run
  preview(
    templateId: string, 
    variables: Record<string, unknown>
  ): Promise<GenerationPreview>;
  
  // Rollback
  rollback(rollbackId: string): Promise<RollbackResult>;
}

interface GenerationOptions {
  outputDir?: string;
  dryRun?: boolean;
  force?: boolean;
  skipValidation?: boolean;
  onFile?: (file: GeneratedFile) => void;
}

interface GenerationPreview {
  files: {
    path: string;
    content: string;
    exists: boolean;
    willOverwrite: boolean;
  }[];
  variables: Record<string, unknown>;
  estimatedSize: number;
}
```

### 3. Validation Pipeline

```typescript
interface ValidationRule {
  name: string;
  severity: 'error' | 'warning' | 'info';
  check: (generatedCode: GeneratedFile) => ValidationIssue[];
}

interface ValidationIssue {
  file: string;
  line?: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  rule?: string;
  autoFix?: string;
}

// Built-in validation rules
const builtInRules: ValidationRule[] = [
  {
    name: 'no-typescript-errors',
    severity: 'error',
    check: (file) => {
      if (file.path.endsWith('.ts') || file.path.endsWith('.tsx')) {
        return runTypeCheck(file);
      }
      return [];
    }
  },
  {
    name: 'no-unused-imports',
    severity: 'warning',
    check: (file) => checkImports(file)
  },
  {
    name: 'security-no-hardcoded-secrets',
    severity: 'error',
    check: (file) => scanForSecrets(file)
  }
];

class ValidationPipeline {
  constructor(rules?: ValidationRule[]);
  
  addRule(rule: ValidationRule): void;
  removeRule(name: string): void;
  
  validate(files: GeneratedFile[]): Promise<ValidationResult>;
  
  // Built-in validators
  validateTypeScript(files: GeneratedFile[]): Promise<ValidationResult>;
  validateESLint(files: GeneratedFile[]): Promise<ValidationResult>;
  validateSecurity(files: GeneratedFile[]): Promise<ValidationResult>;
}

interface ValidationResult {
  passed: boolean;
  issues: ValidationIssue[];
  duration: number;
}
```

### 4. Rollback Manager

```typescript
interface RollbackCheckpoint {
  id: string;
  timestamp: string;
  files: FileSnapshot[];
  templateId: string;
  variables: Record<string, unknown>;
}

interface FileSnapshot {
  path: string;
  originalContent: string | null; // null = file didn't exist
  newContent: string | null;     // null = file was deleted
  checksum: string;
}

class RollbackManager {
  constructor(storageDir: string);
  
  createCheckpoint(
    files: string[], 
    templateId: string, 
    variables: Record<string, unknown>
  ): Promise<RollbackCheckpoint>;
  
  rollback(checkpointId: string): Promise<RollbackResult>;
  
  listCheckpoints(options?: ListOptions): Promise<RollbackCheckpoint[]>;
  
  prune(olderThan: Date): Promise<void>;
}

interface RollbackResult {
  success: boolean;
  restoredFiles: string[];
  deletedFiles: string[];
  errors: RollbackError[];
}
```

### 5. Change Tracker

```typescript
interface ChangeSet {
  id: string;
  templateId: string;
  timestamp: string;
  files: FileChange[];
  status: 'generated' | 'validated' | 'rolled-back';
}

interface FileChange {
  path: string;
  action: 'create' | 'modify' | 'delete';
  before?: string;
  after?: string;
  diff?: string;
}

class ChangeTracker {
  constructor(storageDir: string);
  
  recordGeneration(result: GenerationResult): Promise<ChangeSet>;
  recordRollback(checkpointId: string): Promise<void>;
  
  getChangeSet(id: string): Promise<ChangeSet | null>;
  getRecentChanges(limit?: number): Promise<ChangeSet[]>;
  
  generateDiff(changeSet: ChangeSet): string;
}
```

## File Structure

```
packages/code-generation/
├── src/
│   ├── index.ts                    # Public exports
│   ├── generator.ts                # CodeGenerator class
│   ├── templates/
│   │   ├── manager.ts              # Template manager
│   │   ├── loader.ts               # Template loader
│   │   └── registry.ts             # Template registry
│   ├── validation/
│   │   ├── pipeline.ts             # ValidationPipeline
│   │   ├── rules/                  # Built-in rules
│   │   └── validators/             # Built-in validators
│   ├── rollback/
│   │   ├── manager.ts              # RollbackManager
│   │   └── snapshot.ts             # FileSnapshot logic
│   ├── changes/
│   │   └── tracker.ts              # ChangeTracker
│   ├── engine/
│   │   └── renderer.ts             # Template rendering (EJS)
│   ├── types.ts
│   └── errors.ts
├── templates/
│   ├── react-component/
│   ├── nextjs-page/
│   ├── frappe-doc-type/
│   └── api-endpoint/
├── test/
├── examples/
│   ├── basic-generation.ts
│   ├── custom-template.ts
│   └── validation-setup.ts
├── package.json
└── README.md
```

## Usage Examples

### Basic Generation

```typescript
import { CodeGenerator } from '@pi/code-generation';

const generator = new CodeGenerator({
  outputDir: './src',
  dryRun: false
});

// Load a template
await generator.loadTemplate(reactComponentTemplate);

// Generate
const result = await generator.generate('react-component', {
  name: 'UserProfile',
  withProps: true,
  styleType: 'modules'
});

if (result.success) {
  console.log(`Generated ${result.generatedFiles.length} files`);
} else {
  console.log(`Errors: ${result.errors}`);
}
```

### Dry Run Preview

```typescript
const preview = await generator.preview('react-component', {
  name: 'UserProfile'
});

for (const file of preview.files) {
  console.log(`\n=== ${file.path} ===`);
  console.log(file.content);
}
```

### Custom Template with Validation

```typescript
import { CodeGenerator, ValidationPipeline } from '@pi/code-generation';

const customTemplate: CodeTemplate = {
  id: 'api-handler',
  name: 'API Handler',
  files: [
    { path: 'handlers/{{name}}.ts', content: '...' }
  ],
  variables: [
    { name: 'name', type: 'string', required: true }
  ]
};

const validation = new ValidationPipeline([
  {
    name: 'no-console',
    severity: 'error',
    check: (file) => {
      if (file.content.includes('console.log')) {
        return [{ file: file.path, message: 'No console.log', severity: 'error' }];
      }
      return [];
    }
  }
]);

const generator = new CodeGenerator();
generator.loadTemplate(customTemplate);

// Generate with validation
const result = await generator.generate('api-handler', { name: 'users' });

if (result.success) {
  const validationResult = await validation.validate(result.generatedFiles);
  if (!validationResult.passed) {
    console.log('Validation issues:', validationResult.issues);
  }
}
```

### Rollback on Failure

```typescript
const result = await generator.generate('react-component', variables);

if (result.success) {
  // Run validation
  const validation = await validationPipeline.validate(result.generatedFiles);
  
  if (!validation.passed) {
    // Rollback generated changes
    if (result.rollbackId) {
      await generator.rollback(result.rollbackId);
      console.log('Rolled back due to validation errors');
    }
  }
}
```

## Framework Integration

```typescript
import { CodeGenerator } from '@pi/code-generation';
import { FrameworkDetector } from '@pi/framework-detector';

// Auto-detect framework and suggest templates
const detector = new FrameworkDetector();
const detection = await detector.detect('./project');

const generator = new CodeGenerator();

if (detection.framework) {
  const templates = generator.listTemplates()
    .filter(t => t.framework === detection.framework);
  
  console.log(`Available templates for ${detection.framework}:`);
  for (const t of templates) {
    console.log(`  - ${t.name}: ${t.description}`);
  }
}
```

## Acceptance Criteria

1. ✅ EJS-based template system with variable substitution
2. ✅ Framework-specific template support
3. ✅ Validation pipeline with configurable rules
4. ✅ Automatic rollback on generation/validation failure
5. ✅ Change tracking with diff generation
6. ✅ Dry run/preview mode
7. ✅ Template registry with loading from filesystem

## Dependencies

- `packages/types` - for runtime-types
- `ejs` - template rendering
- `diff` - for generating file diffs
- `fast-glob` - for file pattern matching
