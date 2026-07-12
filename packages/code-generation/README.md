# @pi/code-generation

Code generation pipeline for creating files from templates with variable substitution, validation, and rollback support.

## Features

- **Template Rendering** - EJS-based template engine with variable substitution
- **Template Registry** - Centralized template management with tags and search
- **Validation Pipeline** - Rule-based validation of generated code
- **Variable Resolution** - Custom resolvers for dynamic variable values
- **Type Safety** - TypeScript-first with full type definitions
- **Multiple Engines** - Support for EJS, Handlebars, and custom engines
- **Dry Run Mode** - Preview generation without writing files

## Installation

```bash
npm install @pi/code-generation
```

## Quick Start

### Basic Usage

```typescript
import { createCodeGenerator } from "@pi/code-generation";

const generator = createCodeGenerator();

// Create a template
const template = {
  id: "component",
  name: "React Component",
  description: "Generate a React component",
  content: `<%= componentName %>
import React from 'react';

interface <%= componentName %>Props {
  title: string;
}

export const <%= componentName %>: React.FC<<%= componentName %>Props> = ({ title }) => {
  return <div className="<%= className %>">{title}</div>;
};
`,
  language: "typescript",
  engine: "ejs",
  variables: [
    { name: "componentName", type: "string", required: true },
    { name: "className", type: "string", required: false },
  ],
};

// Generate code
const result = await generator.generate({
  template,
  variables: {
    componentName: "MyComponent",
    className: "my-component",
  },
  outputPath: "src/MyComponent.tsx",
});

if (result.success) {
  console.log(`Generated ${result.files.length} files`);
  console.log(result.files[0].content);
} else {
  console.log("Generation failed:", result.errors);
}
```

### Using the Template Registry

```typescript
import { createCodeGenerator, TemplateRegistry } from "@pi/code-generation";

const registry = new TemplateRegistry();

// Register templates
registry.register({
  id: "typescript-interface",
  name: "TypeScript Interface",
  description: "Create a TypeScript interface",
  content: `export interface <%= name %> {
<% for (const field of fields) { %>
  <%= field.name %>: <%= field.type %>;
<% } %>
}`,
  language: "typescript",
  engine: "ejs",
  variables: [
    { name: "name", type: "string", required: true },
    { name: "fields", type: "array", required: true },
  ],
});

// Query templates
const interfaces = registry.query({ language: "typescript" });
console.log(`Found ${interfaces.length} TypeScript templates`);
```

### Validation Rules

```typescript
import { createCodeGenerator } from "@pi/code-generation";

const generator = createCodeGenerator({
  validationRules: [
    {
      id: "no-console",
      name: "No console statements",
      description: "Generated code should not contain console statements",
      severity: "warning",
      category: "best-practice",
      validate: (context) => {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];

        if (context.generatedCode?.includes("console.log")) {
          warnings.push({
            rule: "no-console",
            message: "Generated code contains console.log statement",
          });
        }

        return { valid: errors.length === 0, errors, warnings };
      },
    },
  ],
});
```

### Custom Renderers

```typescript
import { createCodeGenerator, EjsRenderer } from "@pi/code-generation";

const generator = createCodeGenerator();

// Register custom renderer
generator.registerRenderer("handlebars", new EjsRenderer());

// Now you can use handlebars templates
const result = await generator.generate({
  template: {
    id: "test",
    name: "Test",
    content: "{{name}}",
    engine: "handlebars",
  },
  variables: { name: "Hello, World!" },
});
```

### Dry Run Mode

```typescript
const result = await generator.generate({
  template,
  variables: { componentName: "MyComponent" },
  dryRun: true, // Don't write files
});

if (result.success) {
  console.log("Would generate:");
  for (const file of result.files) {
    console.log(`  ${file.path} (${file.size} bytes)`);
  }
}
```

## Template Syntax

### Variables

```ejs
<%= variableName %>
<%= user.name %>
<%= items[0] %>
```

### Control Flow

```ejs
<% if (condition) { %>
  Content
<% } %>

<% for (const item of items) { %>
  <%= item %>
<% } %>
```

### Includes

```ejs
<%- include('header') %>
```

## API Reference

### CodeGenerator

```typescript
const generator = createCodeGenerator({
  outputDir?: string;           // Default output directory
  dryRun?: boolean;              // Default dry run mode
  validate?: boolean;            // Enable validation
  enableRollback?: boolean;      // Enable rollback on failure
  defaultEngine?: TemplateEngine; // Default template engine
  variableResolvers?: VariableResolver[];
  validationRules?: ValidationRule[];
});
```

### Methods

```typescript
// Register a renderer
generator.registerRenderer(engine, renderer);

// Add validation rule
generator.addValidationRule(rule);

// Generate code
generator.generate(request): Promise<GenerationResult>;
```

### Template

```typescript
interface Template {
  id: string;
  name: string;
  description: string;
  content: string;
  language?: string;
  engine: "ejs" | "handlebars" | "mustache" | "custom";
  variables?: TemplateVariable[];
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}
```

### TemplateVariable

```typescript
interface TemplateVariable {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object" | "enum";
  description?: string;
  defaultValue?: unknown;
  required?: boolean;
  enumValues?: string[];
  validation?: string;
}
```

### GenerationResult

```typescript
interface GenerationResult {
  success: boolean;
  files: GeneratedFile[];
  errors: GenerationError[];
  warnings: GenerationWarning[];
  durationMs: number;
  dryRun: boolean;
}
```

### GeneratedFile

```typescript
interface GeneratedFile {
  path: string;
  content: string;
  language?: string;
  size: number;
  checksum?: string;
  generatedAt: string;
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CodeGenerator                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Template    │  │ Renderer    │  │ Validation      │  │
│  │ Registry    │──│ Engine      │──│ Pipeline        │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
│         │                                       │        │
│         ▼                                       ▼        │
│  ┌─────────────┐                       ┌─────────────────┐│
│  │ EJS/Hndlbrs │                       │ GenerationError ││
│  │ Renderers   │                       │ Warnings       ││
│  └─────────────┘                       └─────────────────┘│
└─────────────────────────────────────────────────────────┘
```
