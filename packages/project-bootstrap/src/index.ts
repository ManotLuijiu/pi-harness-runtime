/**
 * Project Bootstrap - RFC-0072
 *
 * Create project scaffolds from typed ProjectSpec.
 *
 * @example
 * ```typescript
 * import { bootstrap, detectAndSuggest } from '@pi-harness/project-bootstrap';
 *
 * // Bootstrap a new project
 * const result = await bootstrap({
 *   name: 'my-app',
 *   type: 'single-package',
 *   frameworks: ['nextjs'],
 *   features: { typescript: true, testing: true }
 * }, '/path/to/create');
 *
 * // Auto-detect framework and suggest spec
 * const spec = await detectAndSuggest('/path/to/existing');
 * ```
 */

export * from './types.js';
export * from './bootstrap.js';
export { minimalTemplate } from './minimal.js';
export { nodeTypescriptTemplate } from './typescript.js';
export { frappeTemplate } from './frappe.js';
