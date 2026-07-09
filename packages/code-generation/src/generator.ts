/**
 * Code Generation Pipeline - Generator
 *
 * Main code generation engine with template rendering and validation.
 */

import { createHash } from "node:crypto";
import type {
	GeneratedFile,
	GenerationError,
	GenerationRequest,
	GenerationResult,
	GenerationWarning,
	Template,
	TemplateEngine,
	ValidationContext,
	ValidationResult,
	ValidationRule,
	VariableResolver,
} from "./types.js";
import { TemplateRegistry } from "./templates/registry.js";
import { EjsRenderer } from "./templates/ejs-renderer.js";

// ─── Default Configuration ─────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<GeneratorConfig> = {
	outputDir: "./generated",
	dryRun: false,
	validate: true,
	enableRollback: false,
	defaultEngine: "ejs",
	variableResolvers: [],
	validationRules: [],
};

interface GeneratorConfig {
	outputDir?: string;
	dryRun?: boolean;
	validate?: boolean;
	enableRollback?: boolean;
	defaultEngine?: TemplateEngine;
	variableResolvers?: VariableResolver[];
	validationRules?: ValidationRule[];
}

// ─── Code Generator ───────────────────────────────────────────────────────

export class CodeGenerator {
	private readonly config: Required<GeneratorConfig>;
	private readonly registry: TemplateRegistry;
	private readonly renderers: Map<TemplateEngine, TemplateRenderer>;
	private readonly validationRules: ValidationRule[];

	constructor(config: GeneratorConfig = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config } as Required<GeneratorConfig>;
		this.registry = new TemplateRegistry();
		this.renderers = new Map();
		this.validationRules = [
			...DEFAULT_CONFIG.validationRules!,
			...(config.validationRules ?? []),
		];

		// Register default renderers
		this.registerRenderer("ejs", new EjsRenderer());
	}

	/**
	 * Register a template renderer
	 */
	registerRenderer(engine: TemplateEngine, renderer: TemplateRenderer): void {
		this.renderers.set(engine, renderer);
	}

	/**
	 * Add validation rule
	 */
	addValidationRule(rule: ValidationRule): void {
		this.validationRules.push(rule);
	}

	/**
	 * Generate code from template
	 */
	async generate(request: GenerationRequest): Promise<GenerationResult> {
		const startTime = Date.now();
		const errors: GenerationError[] = [];
		const warnings: GenerationWarning[] = [];
		const files: GeneratedFile[] = [];

		// Get template
		const template =
			request.template ??
			(request.templateId ? this.registry.get(request.templateId) : undefined);

		if (!template) {
			return {
				success: false,
				files: [],
				errors: [
					{
						code: "TEMPLATE_NOT_FOUND",
						message: request.templateId
							? `Template '${request.templateId}' not found`
							: "No template provided",
					},
				],
				warnings: [],
				durationMs: Date.now() - startTime,
				dryRun: request.dryRun ?? this.config.dryRun,
			};
		}

		// Validate variables
		const variableValidation = this.validateVariables(
			template,
			request.variables,
		);
		errors.push(...variableValidation.errors);
		warnings.push(...variableValidation.warnings);

		if (errors.length > 0 && !request.validate) {
			return {
				success: false,
				files: [],
				errors,
				warnings,
				durationMs: Date.now() - startTime,
				dryRun: request.dryRun ?? this.config.dryRun,
			};
		}

		// Get renderer
		const renderer = this.renderers.get(template.engine);
		if (!renderer) {
			return {
				success: false,
				files: [],
				errors: [
					{
						code: "UNSUPPORTED_ENGINE",
						message: `Template engine '${template.engine}' is not supported`,
					},
				],
				warnings,
				durationMs: Date.now() - startTime,
				dryRun: request.dryRun ?? this.config.dryRun,
			};
		}

		// Resolve variables
		const resolvedVars = this.resolveVariables(request.variables);

		// Render template
		try {
			const content = await renderer.render(template.content, resolvedVars);

			const generatedFile: GeneratedFile = {
				path:
					request.outputPath ??
					`${template.name}.${template.language ?? "txt"}`,
				content,
				language: template.language,
				size: Buffer.byteLength(content),
				checksum: this.calculateChecksum(content),
				generatedAt: new Date().toISOString(),
			};

			files.push(generatedFile);

			// Validate generated code
			if (request.validate ?? this.config.validate) {
				const validation = await this.validate({
					template,
					variables: resolvedVars,
					generatedCode: content,
					file: generatedFile,
				});

				if (!validation.valid) {
					for (const error of validation.errors) {
						errors.push({
							code: `VALIDATION_${error.rule.toUpperCase()}`,
							message: error.message,
							line: error.location?.line,
						});
					}
				}

				for (const warning of validation.warnings) {
					warnings.push({
						code: `VALIDATION_${warning.rule.toUpperCase()}`,
						message: warning.message,
					});
				}
			}
		} catch (error) {
			errors.push({
				code: "RENDER_ERROR",
				message: error instanceof Error ? error.message : String(error),
			});
		}

		return {
			success: errors.length === 0,
			files,
			errors,
			warnings,
			durationMs: Date.now() - startTime,
			dryRun: request.dryRun ?? this.config.dryRun,
		};
	}

	/**
	 * Validate variables against template schema
	 */
	private validateVariables(
		template: Template,
		variables: Record<string, unknown>,
	): { errors: GenerationError[]; warnings: GenerationWarning[] } {
		const errors: GenerationError[] = [];
		const warnings: GenerationWarning[] = [];

		if (!template.variables) {
			return { errors, warnings };
		}

		// Check required variables
		for (const variable of template.variables) {
			if (variable.required && !(variable.name in variables)) {
				errors.push({
					code: "MISSING_REQUIRED_VARIABLE",
					message: `Required variable '${variable.name}' is missing`,
					variable: variable.name,
				});
			}
		}

		// Check variable types
		for (const [name, value] of Object.entries(variables)) {
			const variable = template.variables.find((v) => v.name === name);
			if (variable && value !== undefined) {
				const typeValid = this.validateVariableType(value, variable.type);
				if (!typeValid) {
					errors.push({
						code: "INVALID_VARIABLE_TYPE",
						message: `Variable '${name}' has invalid type. Expected '${variable.type}'`,
						variable: name,
					});
				}
			}
		}

		// Check for unknown variables
		for (const name of Object.keys(variables)) {
			const variable = template.variables.find((v) => v.name === name);
			if (!variable && template.variables.length > 0) {
				warnings.push({
					code: "UNKNOWN_VARIABLE",
					message: `Variable '${name}' is not defined in template schema`,
					variable: name,
				});
			}
		}

		return { errors, warnings };
	}

	/**
	 * Validate variable type
	 */
	private validateVariableType(value: unknown, type: string): boolean {
		switch (type) {
			case "string":
				return typeof value === "string";
			case "number":
				return typeof value === "number";
			case "boolean":
				return typeof value === "boolean";
			case "array":
				return Array.isArray(value);
			case "object":
				return (
					typeof value === "object" && value !== null && !Array.isArray(value)
				);
			case "enum":
				return true; // Enum validation is done separately
			default:
				return true;
		}
	}

	/**
	 * Resolve variables using resolvers
	 */
	private resolveVariables(
		variables: Record<string, unknown>,
	): Record<string, unknown> {
		const resolved = { ...variables };

		for (const name of Object.keys(variables)) {
			for (const resolver of this.config.variableResolvers ?? []) {
				const resolvedValue = resolver.resolve(name, variables);
				if (resolvedValue !== undefined) {
					resolved[name] = resolvedValue;
					break;
				}
			}
		}

		return resolved;
	}

	/**
	 * Validate generated code
	 */
	private async validate(
		context: ValidationContext,
	): Promise<ValidationResult> {
		const errors: ValidationResult["errors"] = [];
		const warnings: ValidationResult["warnings"] = [];

		for (const rule of this.validationRules) {
			try {
				const result = await rule.validate(context);

				for (const error of result.errors) {
					errors.push({
						rule: rule.id,
						message: error.message,
						location: error.location,
						suggestion: error.suggestion,
					});
				}

				for (const warning of result.warnings) {
					warnings.push({
						rule: rule.id,
						message: warning.message,
						location: warning.location,
						suggestion: warning.suggestion,
					});
				}
			} catch (error) {
				warnings.push({
					rule: rule.id,
					message: `Rule validation failed: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings,
		};
	}

	/**
	 * Calculate checksum
	 */
	private calculateChecksum(content: string): string {
		return createHash("sha256").update(content).digest("hex");
	}
}

// ─── Template Renderer Interface ───────────────────────────────────────────

export interface TemplateRenderer {
	render(template: string, variables: Record<string, unknown>): Promise<string>;
}

// ─── Factory Function ──────────────────────────────────────────────────────

/**
 * Create a code generator
 */
export function createCodeGenerator(config?: GeneratorConfig): CodeGenerator {
	return new CodeGenerator(config);
}
