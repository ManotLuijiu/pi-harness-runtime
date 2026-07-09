/**
 * Code Generation Pipeline
 *
 * Generate code from templates with variable substitution, validation,
 * and automatic rollback capabilities.
 */
// ─── Generator ──────────────────────────────────────────────────────────
export { CodeGenerator, createCodeGenerator, } from "./generator.js";
// ─── Templates ─────────────────────────────────────────────────────────
export { TemplateRegistry } from "./templates/registry.js";
export { EjsRenderer } from "./templates/ejs-renderer.js";
// ─── Types ────────────────────────────────────────────────────────────
export { SDK_VERSION, } from "./types.js";
//# sourceMappingURL=index.js.map