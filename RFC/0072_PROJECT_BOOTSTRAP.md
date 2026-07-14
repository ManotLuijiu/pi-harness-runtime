# RFC-0072 — Project Bootstrap

## Summary

Creates a complete project scaffold from a typed `ProjectSpec` — repos, directories, config files, CI/CD, and initial documentation — based on a framework detection result.

## Motivation

Agents need to scaffold new projects reliably without manual setup. Bootstrap reads a project spec and generates the complete directory structure, config files, and initial state.

## Types

```ts
export type ProjectType = "monorepo" | "single-package" | "multi-package";

export interface ProjectSpec {
  name: string;
  type: ProjectType;
  description?: string;
  author?: string;
  license?: string;
  frameworks: string[];                    // e.g. ["frappe", "nextjs"]
  packages?: { name: string; type: string }[];
  features?: {
    ci?: boolean;
    cd?: boolean;
    testing?: boolean;
    typescript?: boolean;
    eslint?: boolean;
    prettier?: boolean;
    docs?: boolean;
  };
  gitInit?: boolean;
}

export interface BootstrapResult {
  root: string;
  files: string[];
  packages: string[];
  duration: number;
}
```

## Core Functions

### `bootstrap(spec, targetDir, options?)`
Creates project scaffold. Returns `BootstrapResult`.

### `detectFrameworkAndSuggest(root)`
Runs framework detection and suggests a default spec.

### `validateSpec(spec)`
Returns validation errors for an invalid spec.

### `applyTemplate(template, spec)`
Applies a named template (e.g. "node-typescript", "frappe-app") to a spec.

## Templates

Templates are defined in `src/templates/`:
- `minimal` — bare project with package.json
- `node-typescript` — Node + TypeScript + ESLint + Jest
- `monorepo` — npm workspaces + Turborepo
- `frappe-app` — Frappe app structure with modules, doctypes, web pages
- `nextjs-app` — Next.js App Router with shadcn/ui

## Events

| Event | Payload |
|-------|---------|
| `bootstrap.started` | `{ spec }` |
| `bootstrap.file.created` | `{ path, template }` |
| `bootstrap.completed` | `{ result }` |
| `bootstrap.error` | `{ error, phase }` |

## Acceptance Criteria

- [ ] Creates project from ProjectSpec
- [ ] Framework detection suggests appropriate template
- [ ] Template override works
- [ ] Dry-run mode shows what would be created
- [ ] Unit tests for each template
