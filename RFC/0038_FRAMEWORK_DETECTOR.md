# RFC 0038: Framework Detector

## Summary

An intelligent framework detection system that identifies project frameworks, libraries, and architectures to enable framework-aware tooling.

## Motivation

The harness runtime needs to adapt its behavior based on the detected framework. Current detection is limited. We need:

1. Comprehensive signal-based detection
2. Confidence scoring
3. Multi-framework projects support
4. Version detection
5. Real-time detection updates

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Framework Detector                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Signal    │  │   Scoring    │  │   Detection  │             │
│  │   Scanner   │  │   Engine     │  │   Resolver   │             │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   File      │  │   Package    │  │   Config     │             │
│  │   Analyzer  │  │   Resolver   │  │   Parser     │             │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Detection Types

```typescript
interface FrameworkDetection {
  // Primary framework
  framework: FrameworkType;
  
  // Confidence score (0-1)
  confidence: number;
  
  // Detection signals
  signals: DetectionSignal[];
  
  // Version info (if available)
  version?: FrameworkVersion;
  
  // Additional metadata
  metadata?: FrameworkMetadata;
  
  // Detected capabilities
  capabilities: FrameworkCapability[];
  
  // Recommended strategies
  recommendations: StrategyRecommendation[];
}

type FrameworkType = 
  | 'frappe_erpnext'      // Frappe/ERPNext
  | 'frappe_spa'          // Frappe SPA
  | 'nextjs'              // Next.js
  | 'react_vite'          // React with Vite
  | 'react_cra'           // React with Create React App
  | 'vue'                 // Vue.js
  | 'nuxt'                // Nuxt.js
  | 'django'              // Django
  | 'laravel'             // Laravel
  | 'rails'               // Ruby on Rails
  | 'golang'              // Go
  | 'fastapi'             // Python FastAPI
  | 'flask'               // Flask
  | 'spring'              // Spring Boot
  | 'dotnet'              // .NET
  | 'unknown';

interface DetectionSignal {
  type: SignalType;
  source: string;           // File path or config key
  value: string;            // Detected value
  weight: number;           // Contribution to confidence
}

type SignalType = 
  | 'file'              // Specific file exists
  | 'directory'         // Directory exists
  | 'package_json'      // package.json dependency
  | 'package_lock'     // package-lock.json
  | 'config_file'       // Config file with specific key
  | 'dependency'        // Package dependency
  | 'script'            // npm script
  | 'import'            // Import statement
  | 'metadata';         // package.json metadata

interface FrameworkVersion {
  major: number;
  minor: number;
  patch: number;
  raw?: string;             // Raw version string
}

interface FrameworkCapability {
  name: string;             // e.g., 'ssr', 'api', 'database'
  detected: boolean;
  evidence?: string;
}

interface StrategyRecommendation {
  strategy: string;
  confidence: number;
  reason: string;
}
```

### 2. FrameworkSignatures

```typescript
interface FrameworkSignature {
  framework: FrameworkType;
  patterns: DetectionPattern[];
  minConfidence: number;      // Minimum signals needed
  exclusive?: boolean;        // Can't coexist with other frameworks
}

interface DetectionPattern {
  type: SignalType;
  pattern: string | RegExp;
  weight: number;             // 0-1, importance for this framework
  required?: boolean;         // Must be present
  context?: {                 // Additional context for matching
    path?: string;
    contains?: string;
  };
}

// Framework signatures
const frameworkSignatures: FrameworkSignature[] = [
  {
    framework: 'frappe_erpnext',
    minConfidence: 0.6,
    patterns: [
      { type: 'directory', pattern: 'sites/', weight: 0.4 },
      { type: 'directory', pattern: 'apps/', weight: 0.3 },
      { type: 'file', pattern: 'hooks.py', weight: 0.3 },
      { type: 'directory', pattern: 'doctype/', weight: 0.4 },
      { type: 'file', pattern: 'bench', weight: 0.2, context: { path: 'Pipfile' } },
      { type: 'dependency', pattern: 'frappe', weight: 0.5 },
      { type: 'file', pattern: 'site_config.json', weight: 0.3 }
    ]
  },
  {
    framework: 'frappe_spa',
    minConfidence: 0.5,
    patterns: [
      { type: 'file', pattern: 'vite.config.*', weight: 0.3 },
      { type: 'dependency', pattern: '@frappe/desk', weight: 0.5 },
      { type: 'directory', pattern: 'frontend', weight: 0.3 },
      { type: 'dependency', pattern: 'frappe-ui', weight: 0.4 }
    ]
  },
  {
    framework: 'nextjs',
    minConfidence: 0.6,
    patterns: [
      { type: 'file', pattern: 'next.config.*', weight: 0.5 },
      { type: 'directory', pattern: 'app/', weight: 0.4, context: { path: 'src' } },
      { type: 'directory', pattern: 'pages/', weight: 0.3 },
      { type: 'directory', pattern: 'app/', weight: 0.3 }, // Next.js 13+ App Router
      { type: 'dependency', pattern: 'next', weight: 0.4 }
    ]
  },
  {
    framework: 'react_vite',
    minConfidence: 0.5,
    patterns: [
      { type: 'file', pattern: 'vite.config.*', weight: 0.5 },
      { type: 'directory', pattern: 'src/', weight: 0.2 },
      { type: 'dependency', pattern: 'react', weight: 0.3 },
      { type: 'dependency', pattern: 'vite', weight: 0.4 },
      { type: 'file', pattern: 'index.html', weight: 0.2 }
    ]
  },
  {
    framework: 'django',
    minConfidence: 0.6,
    patterns: [
      { type: 'file', pattern: 'manage.py', weight: 0.5 },
      { type: 'directory', pattern: '{{project_name}}/', weight: 0.3 },
      { type: 'file', pattern: 'settings.py', weight: 0.4 },
      { type: 'dependency', pattern: 'django', weight: 0.4 }
    ]
  },
  {
    framework: 'laravel',
    minConfidence: 0.6,
    patterns: [
      { type: 'file', pattern: 'artisan', weight: 0.5 },
      { type: 'directory', pattern: 'database/', weight: 0.3 },
      { type: 'file', pattern: 'composer.json', weight: 0.2, context: { contains: '"laravel/framework"' } },
      { type: 'directory', pattern: 'app/Http/', weight: 0.3 }
    ]
  },
  {
    framework: 'spring',
    minConfidence: 0.5,
    patterns: [
      { type: 'file', pattern: 'pom.xml', weight: 0.3, context: { contains: '<groupId>org.springframework.boot</groupId>' } },
      { type: 'file', pattern: 'build.gradle', weight: 0.3, context: { contains: 'org.springframework.boot' } },
      { type: 'directory', pattern: 'src/main/java/', weight: 0.3 }
    ]
  }
];
```

### 3. FrameworkDetector Class

```typescript
interface DetectorConfig {
  projectPath: string;          // Root of the project
  maxDepth?: number;            // Max directory traversal depth
  cacheResults?: boolean;        // Cache detection results
  cacheTTL?: number;           // Cache TTL in ms
  parallelScans?: boolean;       // Parallel file scanning
  signals?: DetectionPattern[]; // Custom detection patterns
}

class FrameworkDetector {
  constructor(config: DetectorConfig);
  
  // Main detection
  async detect(): Promise<FrameworkDetection>;
  
  // Quick detection (file-only, no package analysis)
  async quickDetect(): Promise<FrameworkDetection | null>;
  
  // Real-time file watching
  watch(callback: (detection: FrameworkDetection) => void): WatcherHandle;
  
  // Cache management
  clearCache(): void;
  getCachedResult(): FrameworkDetection | null;
  
  // Analysis utilities
  analyzeFile(path: string): Promise<FileAnalysis>;
  analyzePackageJson(): Promise<PackageAnalysis>;
  analyzeDependencies(): Promise<DependencyAnalysis>;
}

interface FileAnalysis {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  size?: number;
  children?: string[];
}

interface PackageAnalysis {
  name?: string;
  version?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  workspaces?: string[];
}

interface DependencyAnalysis {
  packages: PackageInfo[];
  conflicting?: Conflict[];
  outdated?: OutdatedPackage[];
}

interface PackageInfo {
  name: string;
  version: string;
  isDev: boolean;
  resolved?: string;
}
```

### 4. Version Detector

```typescript
class VersionDetector {
  constructor(framework: FrameworkType, projectPath: string);
  
  async detect(): Promise<FrameworkVersion | null>;
  
  // Framework-specific version detection
  detectFrappeVersion(): Promise<FrameworkVersion | null>;
  detectNextjsVersion(): Promise<FrameworkVersion | null>;
  detectDjangoVersion(): Promise<FrameworkVersion | null>;
  // ... etc
}

// Example: Frappe version detection
async detectFrappeVersion(): Promise<FrameworkVersion | null> {
  // Check setup.py or pyproject.toml for frappe version
  const setupContent = await readFile('setup.py');
  const match = setupContent.match(/version\s*=\s*["']([\d.]+)["']/);
  if (match) {
    const [major, minor, patch] = match[1].split('.').map(Number);
    return { major, minor, patch, raw: match[1] };
  }
  
  // Check frappe/__init__.py
  const initContent = await readFile('apps/frappe/frappe/__init__.py');
  const versionMatch = initContent.match(/__version__\s*=\s*["']([\d.]+)["']/);
  if (versionMatch) {
    const [major, minor, patch] = versionMatch[1].split('.').map(Number);
    return { major, minor, patch, raw: versionMatch[1] };
  }
  
  return null;
}
```

## File Structure

```
packages/framework-detector/
├── src/
│   ├── index.ts                    # Public exports
│   ├── detector.ts               # FrameworkDetector class
│   ├── signatures/
│   │   ├── registry.ts           # FrameworkSignature registry
│   │   ├── patterns.ts           # Detection patterns
│   │   ├── weights.ts            # Weight calculation
│   │   └── validation.ts         # Pattern validation
│   ├── scanners/
│   │   ├── file-scanner.ts       # File system scanning
│   │   ├── package-scanner.ts    # Package analysis
│   │   └── config-scanner.ts     # Config file parsing
│   ├── version-detector/
│   │   ├── index.ts              # VersionDetector class
│   │   ├── frappe.ts
│   │   ├── nextjs.ts
│   │   ├── django.ts
│   │   └── ...
│   ├── cache/
│   │   └── detector-cache.ts     # Detection caching
│   ├── watcher/
│   │   └── file-watcher.ts       # Real-time detection
│   ├── types.ts
│   └── errors.ts
├── signatures/
│   ├── frameworks.json            # Framework signatures
│   └── patterns.json             # Detection patterns
├── test/
├── examples/
│   ├── basic-detection.ts
│   ├── real-time-watching.ts
│   └── multi-framework.ts
├── package.json
└── README.md
```

## Usage Examples

### Basic Detection

```typescript
import { FrameworkDetector } from '@pi/framework-detector';

const detector = new FrameworkDetector({
  projectPath: '/path/to/project'
});

const detection = await detector.detect();

console.log(`Detected: ${detection.framework}`);
console.log(`Confidence: ${(detection.confidence * 100).toFixed(1)}%`);
console.log(`Signals:`, detection.signals);

// Output:
// Detected: frappe_erpnext
// Confidence: 85.0%
// Signals: [
//   { type: 'directory', source: 'sites/', value: 'exists', weight: 0.4 },
//   { type: 'directory', source: 'apps/', value: 'exists', weight: 0.3 },
//   { type: 'file', source: 'hooks.py', value: 'exists', weight: 0.3 }
// ]
```

### Quick Detection for Performance

```typescript
// Use quickDetect for faster results when confidence isn't critical
const quickResult = await detector.quickDetect();

if (quickResult && quickResult.confidence > 0.8) {
  console.log(`Framework: ${quickResult.framework}`);
} else {
  // Fall back to full detection
  const fullResult = await detector.detect();
}
```

### Real-time Watching

```typescript
const handle = detector.watch((detection) => {
  console.log('Framework changed:', detection.framework);
  console.log('Confidence:', detection.confidence);
});

// Later: stop watching
handle.stop();
```

### Multi-Framework Detection

```typescript
// Detect all frameworks in a monorepo
const detection = await detector.detect();

if (detection.capabilities.includes('monorepo')) {
  console.log('Monorepo detected');
  for (const workspace of detection.metadata.workspaces) {
    const workspaceDetector = new FrameworkDetector({
      projectPath: workspace
    });
    const workspaceDetection = await workspaceDetector.detect();
    console.log(`  ${workspace}: ${workspaceDetection.framework}`);
  }
}
```

### Integration with Other Packages

```typescript
import { FrameworkDetector } from '@pi/framework-detector';
import { CodeGenerator } from '@pi/code-generation';

const detector = new FrameworkDetector({ projectPath: './project' });
const detection = await detector.detect();

// Use detection results
const generator = new CodeGenerator();

// Filter templates by framework
const templates = generator.listTemplates()
  .filter(t => !t.framework || t.framework === detection.framework);

console.log(`Available templates for ${detection.framework}:`, templates);
```

## Acceptance Criteria

1. ✅ Detects all major frameworks (Frappe, Next.js, React, Django, Laravel, etc.)
2. ✅ Confidence scoring with weighted signals
3. ✅ Version detection for primary frameworks
4. ✅ Real-time file watching for changes
5. ✅ Caching for performance
6. ✅ Multi-framework project support
7. ✅ Extensible signature system

## Dependencies

- `packages/types` - for runtime-types
- `fast-glob` - for file pattern matching
- `chokidar` - for file watching
- No framework-specific dependencies
