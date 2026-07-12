# RFC-0038 AI Brief: Framework Detector

## Summary

An intelligent framework detection system that identifies project frameworks, libraries, and architectures with confidence scoring.

## Implementation Overview

### Key Classes to Implement

1. **FrameworkDetector** (`detector.ts`)
   - Signal-based detection
   - Confidence scoring
   - File scanning
   - Package analysis

2. **FrameworkSignature Registry** (`signatures/registry.ts`)
   - Detection pattern definitions
   - Pattern weighting
   - Framework metadata

3. **VersionDetector** (`version-detector/`)
   - Frappe version detection
   - Next.js version detection
   - Django version detection
   - Framework-specific version parsing

4. **FileScanner** (`scanners/file-scanner.ts`)
   - Directory traversal
   - Pattern matching
   - Caching

### Supported Frameworks

- Frappe/ERPNext
- Frappe SPA
- Next.js
- React with Vite
- React with CRA
- Django
- Laravel
- Spring Boot
- And more...

### Dependencies

- `packages/types` - for runtime-types
- `fast-glob` - for file pattern matching
- `chokidar` - for file watching

### Files to Create

- `packages/framework-detector/src/detector.ts`
- `packages/framework-detector/src/signatures/registry.ts`
- `packages/framework-detector/src/signatures/patterns.ts`
- `packages/framework-detector/src/signatures/weights.ts`
- `packages/framework-detector/src/scanners/file-scanner.ts`
- `packages/framework-detector/src/scanners/package-scanner.ts`
- `packages/framework-detector/src/scanners/config-scanner.ts`
- `packages/framework-detector/src/version-detector/index.ts`
- `packages/framework-detector/src/version-detector/frappe.ts`
- `packages/framework-detector/src/version-detector/nextjs.ts`
- `packages/framework-detector/src/version-detector/django.ts`
- `packages/framework-detector/src/cache/detector-cache.ts`
- `packages/framework-detector/src/watcher/file-watcher.ts`
- `packages/framework-detector/src/types.ts`
- `packages/framework-detector/src/index.ts`
