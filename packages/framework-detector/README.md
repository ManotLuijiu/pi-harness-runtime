# @pi/framework-detector

Intelligent framework detection system that identifies project frameworks, libraries, and architectures with confidence scoring.

## Features

- **Signal-Based Detection** - Multiple signals per framework with weighted scoring
- **Confidence Scoring** - 0-1 confidence score based on matched signals
- **Framework Implications** - Auto-detect implied frameworks (e.g., Next.js implies React)
- **Version Detection** - Extract framework versions from dependencies
- **Language Detection** - Identify primary programming language
- **Package Manager Detection** - Detect npm, yarn, pnpm, or bun
- **Caching** - Cache scan results for performance
- **Extensible** - Add custom framework signatures

## Installation

```bash
npm install @pi/framework-detector
```

## Quick Start

### Basic Usage

```typescript
import { createFrameworkDetector } from "@pi/framework-detector";

const detector = createFrameworkDetector();

// Detect frameworks in a project
const analysis = await detector.detect("/path/to/project");

console.log(`Primary: ${analysis.primaryFramework?.framework.name}`);
console.log(`Confidence: ${(analysis.primaryFramework?.confidence ?? 0) * 100}%`);
console.log(`Language: ${analysis.language}`);
console.log(`TypeScript: ${analysis.hasTypeScript}`);
console.log(`Tests: ${analysis.hasTests}`);
```

### Detection Results

```typescript
// All detected frameworks
for (const result of analysis.frameworks) {
  console.log(`${result.framework.name}: ${(result.confidence * 100).toFixed(1)}%`);
  console.log("Matched signals:");
  for (const signal of result.signals) {
    console.log(`  - ${signal.signal.type}: ${signal.match} (${signal.weight})`);
  }
}
```

### Custom Signatures

```typescript
import { createFrameworkDetector } from "@pi/framework-detector";

const detector = createFrameworkDetector({
  signatures: [
    {
      id: "my-framework",
      name: "My Custom Framework",
      category: "fullstack",
      description: "Custom framework for my projects",
      signals: [
        { type: "package", pattern: "my-framework", weight: 0.4, source: "package" },
        { type: "file", pattern: "my.config.js", weight: 0.3, source: "file" },
        { type: "import", pattern: "from ['\"]my-framework['\"]", weight: 0.2, source: "code" },
      ],
      tags: ["custom", "internal"],
    },
  ],
});
```

### Confidence Threshold

```typescript
const detector = createFrameworkDetector({
  confidenceThreshold: 0.5, // Only show frameworks with >50% confidence
});

// Only high-confidence results will be returned
const analysis = await detector.detect("/path/to/project");
```

## Supported Frameworks

### Frontend

- React
- Vue.js
- Angular
- Svelte
- Ember.js
- Preact

### Fullstack

- Next.js
- Nuxt.js
- Remix
- Astro
- Frappe
- ERPNext
- Frappe SPA

### Backend

- Express.js
- Fastify
- NestJS
- Django
- Flask
- FastAPI
- Spring Boot

### Desktop

- Electron
- Tauri
- NW.js

### Mobile

- React Native
- Flutter
- Ionic

## How Detection Works

### Signal Types

| Type | Source | Description |
| ------ | -------- | ------------- |
| `package` | package.json | Package name in dependencies |
| `file` | Directory scan | File name or extension |
| `config` | Directory scan | Config file name |
| `directory` | Directory scan | Directory name |
| `import` | Config files | Import statement in code |

### Confidence Calculation

```
confidence = matched_signal_weights / total_signal_weights
```

For example, Next.js has these signals:

- `next` package: 0.4 weight
- `next.config.js`: 0.3 weight
- `pages` directory: 0.2 weight
- `app` directory: 0.2 weight
- `react` package: 0.1 weight

If `next`, `next.config.js`, and `react` are matched:

```
confidence = (0.4 + 0.3 + 0.1) / (0.4 + 0.3 + 0.2 + 0.2 + 0.1) = 0.8 / 1.2 = 0.67
```

### Framework Implications

Some frameworks imply others:

- Next.js implies React
- Nuxt.js implies Vue.js
- Remix implies React
- ERPNext implies Frappe
- Frappe SPA implies Frappe

Implied frameworks get 80% of the parent framework's confidence.

## API Reference

### FrameworkDetector

```typescript
const detector = createFrameworkDetector({
  confidenceThreshold?: number;    // Min confidence (0-1), default: 0.3
  detectVersions?: boolean;       // Extract versions, default: true
  resolveImplications?: boolean; // Add implied frameworks, default: true
  cache?: boolean;              // Enable caching, default: true
  cacheTtlMs?: number;          // Cache TTL, default: 5 minutes
  timeoutMs?: number;           // Scan timeout, default: 30 seconds
  signatures?: FrameworkSignature[]; // Custom signatures
});
```

### Methods

```typescript
// Detect frameworks in a project
detector.detect(projectPath): Promise<ProjectAnalysis>;

// Scan project files
detector.scan(options): Promise<ScanResult>;

// Clear scan cache
detector.clearCache(): void;

// Get signature registry
detector.getRegistry(): SignatureRegistry;
```

### ProjectAnalysis

```typescript
interface ProjectAnalysis {
  projectPath: string;
  frameworks: DetectionResult[];
  primaryFramework?: DetectionResult;
  language?: string;
  packageManager?: "npm" | "yarn" | "pnpm" | "bun";
  hasTypeScript?: boolean;
  hasTests?: boolean;
  files: ScannedFile[];
  scanTimeMs: number;
}
```

### DetectionResult

```typescript
interface DetectionResult {
  framework: FrameworkInfo;
  confidence: number;          // 0-1
  signals: MatchedSignal[];
  version?: string;             // Detected version
  metadata?: Record<string, unknown>;
}
```

### FrameworkSignature

```typescript
interface FrameworkSignature {
  id: string;
  name: string;
  category: FrameworkCategory;
  description: string;
  signals: DetectionSignal[];
  requires?: string[];         // Required frameworks
  implies?: string[];          // Implied frameworks
  excludes?: string[];         // Excluded frameworks
  tags?: string[];
}
```

### DetectionSignal

```typescript
interface DetectionSignal {
  type: SignalType;
  pattern: string;
  weight: number;               // 0-1
  source?: SignalType;
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  FrameworkDetector                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │   Scanner   │  │   Matcher   │  │  Confidence     │  │
│  │             │──│             │──│  Calculator    │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
│         │                                       │        │
│         ▼                                       ▼        │
│  ┌─────────────┐                       ┌─────────────────┐│
│  │   File     │                       │  Detection      ││
│  │   Cache    │                       │  Results        ││
│  └─────────────┘                       └─────────────────┘│
│                                                  │        │
│  ┌─────────────────────────────────────────────────────┐│
│  │              Signature Registry                     ││
│  │  [React] [Vue] [Next.js] [Django] [Frappe] [...]   ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```
