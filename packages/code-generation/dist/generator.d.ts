/**
 * Code Generation Pipeline - Generator
 *
 * Main code generation engine with template rendering and validation.
 */
import type { GenerationRequest, GenerationResult, SchemaDefinition, TemplateEngine, ValidationRule, VariableResolver } from "./types.js";
interface GeneratorConfig {
    outputDir?: string;
    dryRun?: boolean;
    validate?: boolean;
    enableRollback?: boolean;
    defaultEngine?: TemplateEngine;
    variableResolvers?: VariableResolver[];
    validationRules?: ValidationRule[];
}
export declare class CodeGenerator {
    private readonly config;
    private readonly registry;
    private readonly renderers;
    private readonly validationRules;
    private readonly schemas;
    constructor(config?: GeneratorConfig);
    /**
     * Register a template renderer
     */
    registerRenderer(engine: TemplateEngine, renderer: TemplateRenderer): void;
    /**
     * Add validation rule
     */
    addValidationRule(rule: ValidationRule): void;
    /**
     * Register a schema for code generation.
     * Converts the schema into a template and registers it.
     */
    registerSchema(schema: SchemaDefinition): void;
    /**
     * Get a registered schema by ID or name.
     */
    getSchema(id: string): SchemaDefinition | undefined;
    /**
     * Generate code from template
     */
    generate(request: GenerationRequest): Promise<GenerationResult>;
    /**
     * Validate variables against template schema
     */
    private validateVariables;
    /**
     * Validate variable type
     */
    private validateVariableType;
    /**
     * Resolve variables using resolvers
     */
    private resolveVariables;
    /**
     * Validate generated code
     */
    private validate;
    /**
     * Calculate checksum
     */
    private calculateChecksum;
}
export interface TemplateRenderer {
    render(template: string, variables: Record<string, unknown>): Promise<string>;
}
/**
 * Create a code generator
 */
export declare function createCodeGenerator(config?: GeneratorConfig): CodeGenerator;
export {};
//# sourceMappingURL=generator.d.ts.map