/**
 * Code Generation Pipeline - Generator
 *
 * Main code generation engine with template rendering and validation.
 */
import { createHash } from "node:crypto";
import { EjsRenderer } from "./templates/ejs-renderer.js";
import { TemplateRegistry } from "./templates/registry.js";
// ─── Default Configuration ─────────────────────────────────────────────────
const DEFAULT_CONFIG = {
    outputDir: "./generated",
    dryRun: false,
    validate: true,
    enableRollback: false,
    defaultEngine: "ejs",
    variableResolvers: [],
    validationRules: [],
};
// ─── Code Generator ───────────────────────────────────────────────────────
export class CodeGenerator {
    config;
    registry;
    renderers;
    validationRules;
    schemas;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.registry = new TemplateRegistry();
        this.renderers = new Map();
        this.validationRules = [
            ...DEFAULT_CONFIG.validationRules,
            ...(config.validationRules ?? []),
        ];
        this.schemas = new Map();
        // Register default renderers
        this.registerRenderer("ejs", new EjsRenderer());
    }
    /**
     * Register a template renderer
     */
    registerRenderer(engine, renderer) {
        this.renderers.set(engine, renderer);
    }
    /**
     * Add validation rule
     */
    addValidationRule(rule) {
        this.validationRules.push(rule);
    }
    /**
     * Register a schema for code generation.
     * Converts the schema into a template and registers it.
     */
    registerSchema(schema) {
        const id = schema.id ?? schema.name;
        this.schemas.set(id, schema);
        // Convert schema to a template for registration
        const fieldsContent = schema.fields
            .map((f) => ` * @param ${f.name} - ${f.description ?? f.type}`)
            .join("\n");
        const template = {
            id,
            name: schema.name,
            description: schema.description ?? `Schema: ${schema.name}`,
            content: `/**\n${fieldsContent}\n */\nexport interface ${schema.name} {\n<% for (const field of fields) { %>\n  <%= field.name %>: <%= field.type %>;\n<% } %>\n}`,
            tags: ["schema"],
            engine: "ejs",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        this.registry.register(template);
    }
    /**
     * Get a registered schema by ID or name.
     */
    getSchema(id) {
        return this.schemas.get(id);
    }
    /**
     * Generate code from template
     */
    async generate(request) {
        const startTime = Date.now();
        const errors = [];
        const warnings = [];
        const files = [];
        // Get template
        const template = request.template ??
            (request.templateId
                ? this.registry.get(request.templateId)
                : undefined) ??
            (request.schemaId ? this.registry.get(request.schemaId) : undefined);
        if (!template) {
            return {
                success: false,
                files: [],
                errors: [
                    {
                        code: "TEMPLATE_NOT_FOUND",
                        message: request.templateId
                            ? `Template '${request.templateId}' not found`
                            : request.schemaId
                                ? `Schema '${request.schemaId}' not found`
                                : "No template provided",
                    },
                ],
                warnings: [],
                durationMs: Date.now() - startTime,
                dryRun: request.dryRun ?? this.config.dryRun,
            };
        }
        // Validate variables
        const variableValidation = this.validateVariables(template, request.variables);
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
            const generatedFile = {
                path: request.outputPath ??
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
        }
        catch (error) {
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
    validateVariables(template, variables) {
        const errors = [];
        const warnings = [];
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
    validateVariableType(value, type) {
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
                return (typeof value === "object" && value !== null && !Array.isArray(value));
            case "enum":
                return true; // Enum validation is done separately
            default:
                return true;
        }
    }
    /**
     * Resolve variables using resolvers
     */
    resolveVariables(variables) {
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
    async validate(context) {
        const errors = [];
        const warnings = [];
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
            }
            catch (error) {
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
    calculateChecksum(content) {
        return createHash("sha256").update(content).digest("hex");
    }
}
// ─── Factory Function ──────────────────────────────────────────────────────
/**
 * Create a code generator
 */
export function createCodeGenerator(config) {
    return new CodeGenerator(config);
}
//# sourceMappingURL=generator.js.map