/**
 * Project Bootstrap - RFC-0072
 *
 * Main bootstrap orchestration.
 */
import type { ProjectSpec, BootstrapOptions, BootstrapResult, ValidationError, Template } from './types.js';
/**
 * Validate a project spec
 */
export declare function validateSpec(spec: ProjectSpec): ValidationError[];
/**
 * Get template for a spec
 */
export declare function getTemplateForSpec(spec: ProjectSpec, override?: string): Template;
/**
 * Bootstrap a project from a spec
 */
export declare function bootstrap(spec: ProjectSpec, targetDir: string, options?: BootstrapOptions): Promise<BootstrapResult>;
/**
 * Detect framework and suggest a spec
 */
export declare function detectAndSuggest(projectRoot: string): Promise<ProjectSpec | null>;
//# sourceMappingURL=bootstrap.d.ts.map