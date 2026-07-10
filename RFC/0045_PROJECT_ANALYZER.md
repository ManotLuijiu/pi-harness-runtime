# RFC-0045 — Project Analyzer

Status: Draft  
Target package: `packages/project-analyzer`  
Depends on: Workspace Manager, Framework Plugin SDK

## 1. Problem

The runtime must understand the target repository before planning work. It needs to know project type, languages, package managers, test commands, entry points, repository rules, framework conventions, and risk areas.

The Project Analyzer creates a versioned `ProjectProfile`.

## 2. Output model

```ts
export interface ProjectProfile {
  repositoryRoot: string;
  repositoryName: string;
  revision: string;
  frameworks: DetectedFramework[];
  languages: DetectedLanguage[];
  packageManagers: PackageManagerProfile[];
  applications: ApplicationProfile[];
  commands: ProjectCommands;
  rules: ProjectRule[];
  sensitivePaths: string[];
  generatedPaths: string[];
  testCapabilities: TestCapability[];
  confidence: number;
  warnings: ProjectWarning[];
  analyzedAt: string;
}
```

## 3. Detection signals

Examples:

### Frappe / ERPNext

- `sites/`
- `apps/`
- `hooks.py`
- `doctype/`
- `bench` executable or configuration

### Frappe SPA

- Frappe app directory
- `frontend/`
- Vite configuration
- Frappe API calls

### Next.js

- `next.config.*`
- `app/` or `pages/`
- `next` dependency

### React / Vite

- `vite.config.*`
- `src/main.tsx`
- `index.html`

### Django

- `manage.py`
- settings module
- Django dependency

### Laravel

- `artisan`
- `composer.json`
- `database/seeders`

Signals are weighted. A single file must not automatically establish full confidence.

## 4. Multi-application repositories

The analyzer must support monorepos and Frappe benches containing multiple apps.

```ts
export interface ApplicationProfile {
  id: string;
  root: string;
  framework: string;
  packageManager?: string;
  testCommands: string[];
  buildCommands: string[];
  entryPoints: string[];
}
```

The Master Planner can scope a job to one application rather than the repository root.

## 5. Rule discovery

The analyzer searches for:

- `AGENTS.md`
- `RULES.md`
- `PROJECT_RULES.md`
- `CONTRIBUTING.md`
- package scripts
- test configuration
- lint configuration
- repository-local harness configuration

Rules are categorized as mandatory or advisory. Explicit user rules override inferred framework conventions.

## 6. Command discovery

Commands are discovered but not executed during analysis.

```ts
export interface ProjectCommands {
  unitTest: string[];
  integrationTest: string[];
  e2eTest: string[];
  lint: string[];
  typecheck: string[];
  build: string[];
  migrate: string[];
}
```

Because the user prohibits build, migrate, and commit without permission, discovery records these commands but Policy Engine blocks execution until approved.

## 7. Sensitive and generated paths

Typical sensitive paths:

```text
.env
.env.*
sites/*/site_config.json
private/
credentials/
*.pem
```

Typical generated paths:

```text
node_modules/
dist/
build/
public/frontend/
coverage/
```

Framework plugins may add patterns. The analyzer must never read secret file contents merely to classify them.

## 8. Confidence

```text
confidence =
  matched_signal_weight
  / total_required_signal_weight
```

Confidence is reported per detected framework and globally. Conflicting signals produce warnings rather than silent selection.

Example:

```json
{
  "framework": "frappe_spa",
  "confidence": 0.94,
  "signals": [
    "hooks.py",
    "frontend/vite.config.ts",
    "frappe API imports"
  ]
}
```

## 9. Cache and invalidation

Project analysis is cached by:

- Git revision
- Hash of rule files
- Hash of package manifests
- Hash of framework configuration files

Source code changes that do not affect these inputs do not require full re-analysis.

## 10. Plugin interface

```ts
export interface FrameworkAnalyzerPlugin {
  id: string;
  detect(fs: ReadonlyFileSystem): Promise<DetectionResult>;
  analyze(
    root: string,
    detection: DetectionResult,
  ): Promise<Partial<ProjectProfile>>;
}
```

Plugins must not execute arbitrary project scripts during detection.

## 11. Failure handling

- Unknown framework: produce generic profile.
- Conflicting package managers: report warning.
- Missing test scripts: report unavailable capability.
- Unreadable rule file: fail if mandatory, warn otherwise.
- Repository larger than scan limit: use bounded traversal.
- Symlink escaping repository root: reject traversal.

## 12. Security

The analyzer must:

- Stay inside repository root.
- Avoid following external symlinks.
- Apply maximum file size and traversal limits.
- Never execute detected scripts.
- Never include secrets in `ProjectProfile`.
- Preserve only paths and metadata for sensitive files.

## 13. Tests

1. Detect Frappe bench.
2. Detect Frappe SPA.
3. Detect Next.js.
4. Detect React/Vite.
5. Return generic profile for unknown project.
6. Handle monorepo applications.
7. Discover `AGENTS.md` rules.
8. Record but do not execute build/migrate commands.
9. Reject symlink traversal outside root.
10. Cache invalidates when rule files change.

## 14. Acceptance criteria

- Framework detection includes confidence and evidence.
- Multi-app repositories are represented.
- Project rules are discoverable and prioritized.
- Sensitive file contents are never read into output.
- Commands are detected but not executed.
- Generic fallback permits planning for unknown frameworks.
