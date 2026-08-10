/**
 * Project Bootstrap - RFC-0072
 *
 * Typed definitions for project scaffolding.
 */

export type ProjectType = 'monorepo' | 'single-package' | 'multi-package';

export interface ProjectSpec {
  name: string;
  type: ProjectType;
  description?: string;
  author?: string;
  license?: string;
  frameworks: string[];  // e.g. ["frappe", "nextjs"]
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

export interface BootstrapOptions {
  dryRun?: boolean;      // Don't actually create files
  force?: boolean;        // Overwrite existing files
  targetDir?: string;      // Default: current directory
  template?: string;      // Override auto-detected template
  verbose?: boolean;     // Log progress
}

export interface BootstrapResult {
  root: string;
  files: string[];
  packages: string[];
  duration: number;
}

export interface ValidationError {
  field: string;
  message: string;
}

// Template types
export interface Template {
  name: string;
  description: string;
  apply: (spec: ProjectSpec, root: string) => Promise<string[]>;
}

export interface BootstrapContext {
  spec: ProjectSpec;
  root: string;
  files: string[];
  events: EventEmitter;
}

export interface EventEmitter {
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: unknown) => void): void;
}
