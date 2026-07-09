/**
 * Test Data Generator - Types
 *
 * Core types for test data generation.
 */
/**
 * SDK version for compatibility checks
 */
export declare const SDK_VERSION = "1.0.0";
/**
 * Field type for schema definition
 */
export type FieldType = "string" | "number" | "boolean" | "date" | "datetime" | "email" | "url" | "phone" | "uuid" | "firstName" | "lastName" | "fullName" | "address" | "city" | "country" | "zipCode" | "company" | "department" | "jobTitle" | "paragraph" | "sentence" | "word" | "lorem" | "image" | "avatar" | "color" | "hexColor" | "rgbColor" | "ipv4" | "ipv6" | "urlWithParams" | "userName" | "password" | "creditCard" | "currency" | "locale" | "fileName" | "filePath" | "mimeType" | "latitude" | "longitude" | "array" | "object" | "enum" | "oneOf" | "relation" | "custom";
/**
 * Field definition
 */
export interface FieldDefinition {
    name: string;
    type: FieldType;
    options?: FieldOptions;
    required?: boolean;
    default?: unknown;
    validate?: FieldValidator;
}
/**
 * Field options
 */
export interface FieldOptions {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    prefix?: string;
    suffix?: string;
    uppercase?: boolean;
    lowercase?: boolean;
    min?: number;
    max?: number;
    precision?: number;
    integer?: boolean;
    positive?: boolean;
    negative?: boolean;
    multipleOf?: number;
    length?: number;
    minItems?: number;
    maxItems?: number;
    unique?: boolean;
    format?: string;
    minDate?: string;
    maxDate?: string;
    past?: boolean;
    future?: boolean;
    values?: unknown[];
    weights?: number[];
    model?: string;
    field?: string;
    multiple?: boolean;
    generator?: CustomGenerator;
}
/**
 * Field validator
 */
export interface FieldValidator {
    validate: (value: unknown) => boolean;
    message?: string;
}
/**
 * Custom generator function
 */
export type CustomGenerator = (context: GeneratorContext) => unknown;
/**
 * Generator context
 */
export interface GeneratorContext {
    field: FieldDefinition;
    index: number;
    seed: number;
    data: Record<string, unknown>;
    faker: FakerAdapter;
}
/**
 * Schema definition
 */
export interface Schema {
    name: string;
    fields: FieldDefinition[];
    relations?: RelationDefinition[];
    hooks?: SchemaHooks;
}
/**
 * Relation definition
 */
export interface RelationDefinition {
    name: string;
    type: RelationType;
    target: string;
    fields?: string[];
}
/**
 * Relation type
 */
export type RelationType = "hasOne" | "hasMany" | "belongsTo" | "belongsToMany";
/**
 * Schema hooks
 */
export interface SchemaHooks {
    beforeCreate?: (data: Record<string, unknown>) => Record<string, unknown>;
    afterCreate?: (data: Record<string, unknown>) => Record<string, unknown>;
    beforeBulkCreate?: (data: Record<string, unknown>[]) => Record<string, unknown>[];
    afterBulkCreate?: (data: Record<string, unknown>[]) => Record<string, unknown>[];
}
/**
 * Factory definition
 */
export interface Factory<T = Record<string, unknown>> {
    name: string;
    schema: Schema;
    model?: string;
    sequences?: Sequence[];
    associations?: Association[];
    afterCreate?: (data: T) => T | Promise<T>;
    defaults?: Partial<T>;
}
/**
 * Sequence for auto-incrementing fields
 */
export interface Sequence {
    field: string;
    start: number;
    step: number;
}
/**
 * Association definition
 */
export interface Association {
    name: string;
    factory: string;
    type: "hasOne" | "hasMany" | "belongsTo" | "belongsToMany";
    count?: number | {
        min: number;
        max: number;
    };
}
/**
 * Generation request
 */
export interface GenerationRequest {
    schema?: Schema;
    schemaId?: string;
    count: number;
    data?: Partial<Record<string, unknown>>;
    relations?: boolean;
}
/**
 * Generated record
 */
export interface GeneratedRecord {
    id: string;
    data: Record<string, unknown>;
    relations?: Record<string, GeneratedRecord[]>;
    createdAt: string;
}
/**
 * Generation result
 */
export interface GenerationResult {
    success: boolean;
    records: GeneratedRecord[];
    count: number;
    generationTimeMs: number;
    errors?: GenerationError[];
}
/**
 * Generation error
 */
export interface GenerationError {
    field: string;
    message: string;
    value?: unknown;
}
/**
 * Export format
 */
export type ExportFormat = "json" | "csv" | "sql" | "yaml" | "fixtures" | "typescript";
/**
 * Export options
 */
export interface ExportOptions {
    format: ExportFormat;
    pretty?: boolean;
    includeRelations?: boolean;
    flattenRelations?: boolean;
    fileName?: string;
    tableName?: string;
    framework?: "frappe" | "django" | "laravel" | "nextjs";
}
/**
 * Export result
 */
export interface ExportResult {
    content: string;
    format: ExportFormat;
    fileName: string;
    size: number;
}
/**
 * Faker adapter interface
 */
export interface FakerAdapter {
    string: (min?: number, max?: number) => string;
    number: (min?: number, max?: number) => number;
    boolean: () => boolean;
    date: (options?: DateOptions) => Date;
    email: () => string;
    url: () => string;
    phone: () => string;
    uuid: () => string;
    firstName: () => string;
    lastName: () => string;
    fullName: () => string;
    address: () => string;
    city: () => string;
    country: () => string;
    zipCode: () => string;
    company: () => string;
    department: () => string;
    jobTitle: () => string;
    paragraph: (sentences?: number) => string;
    sentence: () => string;
    word: () => string;
    lorem: (words?: number) => string;
    image: (width?: number, height?: number) => string;
    avatar: () => string;
    color: () => string;
    hexColor: () => string;
    ipv4: () => string;
    ipv6: () => string;
    userName: () => string;
    password: (length?: number) => string;
    creditCard: () => string;
    currency: () => string;
    locale: () => string;
    fileName: (ext?: string) => string;
    filePath: () => string;
    mimeType: () => string;
    latitude: () => number;
    longitude: () => number;
}
/**
 * Date generation options
 */
export interface DateOptions {
    min?: Date;
    max?: Date;
    past?: boolean;
    future?: boolean;
}
/**
 * Generator configuration
 */
export interface GeneratorConfig {
    /**
     * Random seed for reproducibility
     */
    seed?: number;
    /**
     * Locale for data generation
     */
    locale?: string;
    /**
     * Enable logging
     */
    verbose?: boolean;
    /**
     * Maximum generation attempts
     */
    maxRetries?: number;
    /**
     * Custom faker adapters
     */
    customGenerators?: Record<string, CustomGenerator>;
}
/**
 * Fixture format
 */
export interface Fixture {
    name: string;
    data: Record<string, unknown>[];
    relations?: Record<string, string[]>;
}
/**
 * Django fixture
 */
export interface DjangoFixture {
    model: string;
    pk: number;
    fields: Record<string, unknown>;
}
/**
 * Laravel factory
 */
export interface LaravelFactory {
    name: string;
    definition: Record<string, unknown>;
    states?: string[];
}
//# sourceMappingURL=types.d.ts.map