/**
 * Code Generation Pipeline
 *
 * Generate code from templates with variable substitution, validation,
 * and automatic rollback capabilities.
 */

// ─── Generator ──────────────────────────────────────────────────────────

export {
	CodeGenerator,
	createCodeGenerator,
	type TemplateRenderer,
} from "./generator.js";

// ─── Templates ─────────────────────────────────────────────────────────

export { TemplateRegistry } from "./templates/registry.js";
export { EjsRenderer } from "./templates/ejs-renderer.js";

// ─── Types ────────────────────────────────────────────────────────────

export {
	SDK_VERSION,
	type Template,
	type TemplateVariable,
	type TemplateEngine,
	type TemplateSet,
	type GenerationRequest,
	type GeneratedFile,
	type GenerationResult,
	type GenerationError,
	type GenerationWarning,
	type ValidationRule,
	type ValidationCategory,
	type ValidationContext,
	type ValidationResult,
	type ValidationIssue,
	type FileSnapshot,
	type ChangeRecord,
	type RollbackSession,
	type RollbackResult,
	type ChangeSet,
	type FileChange,
	type DiffChunk,
	type RegistryEntry,
	type RegistryQuery,
	type GeneratorConfig,
	type VariableResolver,
	type OutputFormat,
	type OutputConfig,
} from "./types.js";
