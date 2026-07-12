/**
 * Code Generation Pipeline - Types
 *
 * Core types for code generation from templates.
 */
/**
 * SDK version for compatibility checks
 */
export declare const SDK_VERSION = "1.0.0";
/**
 * Template definition
 */
export interface Template {
    id: string;
    name: string;
    description: string;
    content: string;
    language?: string;
    engine: TemplateEngine;
    variables?: TemplateVariable[];
    tags?: string[];
    createdAt: string;
    updatedAt: string;
}
/**
 * Template variable
 */
export interface TemplateVariable {
    name: string;
    type: "string" | "number" | "boolean" | "array" | "object" | "enum";
    description?: string;
    defaultValue?: unknown;
    required?: boolean;
    enumValues?: string[];
    validation?: string;
}
/**
 * Template engine
 */
export type TemplateEngine = "ejs" | "handlebars" | "mustache" | "custom";
/**
 * Template set
 */
export interface TemplateSet {
    id: string;
    name: string;
    description: string;
    templates: Template[];
    metadata?: Record<string, unknown>;
}
/**
 * Generation request
 */
export interface GenerationRequest {
    templateId?: string;
    schemaId?: string;
    template?: Template;
    variables: Record<string, unknown>;
    outputPath?: string;
    dryRun?: boolean;
    validate?: boolean;
    overwrite?: boolean;
}
/**
 * Generated file
 */
export interface GeneratedFile {
    path: string;
    content: string;
    language?: string;
    size: number;
    checksum?: string;
    generatedAt: string;
}
/**
 * Generation result
 */
export interface GenerationResult {
    success: boolean;
    files: GeneratedFile[];
    errors: GenerationError[];
    warnings: GenerationWarning[];
    durationMs: number;
    dryRun: boolean;
}
/**
 * Generation error
 */
export interface GenerationError {
    code: string;
    message: string;
    file?: string;
    line?: number;
    variable?: string;
}
/**
 * Generation warning
 */
export interface GenerationWarning {
    code: string;
    message: string;
    file?: string;
    variable?: string;
}
/**
 * Validation rule
 */
export interface ValidationRule {
    id: string;
    name: string;
    description: string;
    validate: (context: ValidationContext) => ValidationResult;
    severity: "error" | "warning" | "info";
    category: ValidationCategory;
}
/**
 * Validation category
 */
export type ValidationCategory = "syntax" | "security" | "compatibility" | "best-practice" | "custom";
/**
 * Validation context
 */
export interface ValidationContext {
    template?: Template;
    variables: Record<string, unknown>;
    generatedCode?: string;
    file?: GeneratedFile;
}
/**
 * Validation result
 */
export interface ValidationResult {
    valid: boolean;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
}
/**
 * Validation issue
 */
export interface ValidationIssue {
    rule: string;
    message: string;
    location?: {
        line?: number;
        column?: number;
        startLine?: number;
        endLine?: number;
    };
    suggestion?: string;
}
/**
 * Snapshot of file state
 */
export interface FileSnapshot {
    path: string;
    content: string;
    checksum: string;
    timestamp: string;
}
/**
 * Change record
 */
export interface ChangeRecord {
    id: string;
    type: "create" | "modify" | "delete";
    path: string;
    oldSnapshot?: FileSnapshot;
    newSnapshot?: FileSnapshot;
    timestamp: string;
}
/**
 * Rollback session
 */
export interface RollbackSession {
    id: string;
    startTime: string;
    changes: ChangeRecord[];
    status: "active" | "completed" | "rolled-back";
}
/**
 * Rollback result
 */
export interface RollbackResult {
    success: boolean;
    restoredFiles: string[];
    failedFiles: string[];
    error?: string;
}
/**
 * Change set
 */
export interface ChangeSet {
    id: string;
    description: string;
    changes: FileChange[];
    createdAt: string;
    author?: string;
}
/**
 * File change
 */
export interface FileChange {
    path: string;
    type: "added" | "modified" | "deleted" | "renamed";
    oldContent?: string;
    newContent?: string;
    diff?: string;
}
/**
 * Diff chunk
 */
export interface DiffChunk {
    type: "add" | "delete" | "context";
    value: string;
    lineNumber?: number;
}
/**
 * Registry entry
 */
export interface RegistryEntry {
    id: string;
    type: "template" | "template-set";
    name: string;
    tags: string[];
    createdAt: string;
}
/**
 * Registry query
 */
export interface RegistryQuery {
    tags?: string[];
    language?: string;
    search?: string;
    limit?: number;
}
/**
 * Generator configuration
 */
export interface GeneratorConfig {
    /**
     * Output directory
     */
    outputDir?: string;
    /**
     * Enable dry run by default
     */
    dryRun?: boolean;
    /**
     * Enable validation
     */
    validate?: boolean;
    /**
     * Enable rollback on failure
     */
    enableRollback?: boolean;
    /**
     * Template engine
     */
    defaultEngine?: TemplateEngine;
    /**
     * Variable resolvers
     */
    variableResolvers?: VariableResolver[];
    /**
     * Validation rules
     */
    validationRules?: ValidationRule[];
}
/**
 * Variable resolver
 */
export interface VariableResolver {
    name: string;
    resolve: (name: string, context: Record<string, unknown>) => unknown;
    priority?: number;
}
/**
 * Output format
 */
export type OutputFormat = "file" | "buffer" | "stream" | "stdout";
/**
 * Output configuration
 */
export interface OutputConfig {
    format: OutputFormat;
    path?: string;
    encoding?: BufferEncoding;
    overwrite?: boolean;
    backup?: boolean;
}
/**
 * Schema field definition
 */
export interface SchemaField {
    name: string;
    type: "string" | "number" | "boolean" | "array" | "object" | "enum";
    description?: string;
    defaultValue?: unknown;
}
/**
 * Schema definition for code generation
 */
export interface SchemaDefinition {
    /** Schema identifier */
    id?: string;
    /** Schema name */
    name: string;
    /** Schema description */
    description?: string;
    /** Schema fields */
    fields: SchemaField[];
}
//# sourceMappingURL=types.d.ts.map