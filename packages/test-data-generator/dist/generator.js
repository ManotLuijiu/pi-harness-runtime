/**
 * Test Data Generator - Generator
 *
 * Main test data generation engine.
 */
import { randomBytes } from "node:crypto";
import { SimpleFaker } from "./faker-adapter.js";
// ─── Default Configuration ─────────────────────────────────────────────────
const DEFAULT_CONFIG = {
    seed: Date.now(),
    locale: "en",
    verbose: false,
    maxRetries: 10,
    customGenerators: {},
};
// ─── Test Data Generator ─────────────────────────────────────────────────
export class TestDataGenerator {
    config;
    faker;
    schemas = new Map();
    sequences = new Map();
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.faker = new SimpleFaker(this.config.seed);
        // Register custom generators
        for (const [name, generator] of Object.entries(this.config.customGenerators)) {
            this.registerCustomGenerator(name, generator);
        }
    }
    /**
     * Register a custom generator
     */
    registerCustomGenerator(_name, _generator) {
        // Custom generators are handled in the config
    }
    /**
     * Register a schema
     */
    registerSchema(schema) {
        this.schemas.set(schema.name, schema);
    }
    /**
     * Get a schema
     */
    getSchema(name) {
        return this.schemas.get(name);
    }
    /**
     * Generate test data
     */
    async generate(request) {
        const startTime = Date.now();
        const errors = [];
        const records = [];
        // Get schema
        const schema = request.schema ?? this.schemas.get(request.schemaId ?? "");
        if (!schema) {
            return {
                success: false,
                records: [],
                count: 0,
                generationTimeMs: Date.now() - startTime,
                errors: [
                    {
                        field: "schema",
                        message: request.schemaId
                            ? `Schema '${request.schemaId}' not found`
                            : "No schema provided",
                    },
                ],
            };
        }
        // Run beforeBulkCreate hook
        let generateData = Array(request.count)
            .fill(null)
            .map((_, i) => ({
            index: i,
            ...request.data,
        }));
        if (schema.hooks?.beforeBulkCreate) {
            generateData = schema.hooks
                .beforeBulkCreate(generateData.map((d) => d))
                .map((d, i) => ({ index: i, ...d }));
        }
        // Generate records
        for (let i = 0; i < request.count; i++) {
            const index = i;
            const overrides = generateData[i] ?? {};
            try {
                const data = await this.generateRecord(schema, index, overrides);
                // Apply afterCreate hook
                const finalData = schema.hooks?.afterCreate
                    ? schema.hooks.afterCreate(data)
                    : data;
                records.push({
                    id: this.generateId(),
                    data: finalData,
                    createdAt: new Date().toISOString(),
                });
            }
            catch (error) {
                errors.push({
                    field: "record",
                    message: error instanceof Error ? error.message : String(error),
                    value: i,
                });
            }
        }
        // Run afterBulkCreate hook
        if (schema.hooks?.afterBulkCreate && records.length > 0) {
            const allData = records.map((r) => r.data);
            const processed = schema.hooks.afterBulkCreate(allData);
            for (let i = 0; i < records.length; i++) {
                records[i].data = processed[i];
            }
        }
        return {
            success: errors.length === 0,
            records,
            count: records.length,
            generationTimeMs: Date.now() - startTime,
            errors: errors.length > 0 ? errors : undefined,
        };
    }
    /**
     * Generate a single record
     */
    async generateRecord(schema, index, overrides) {
        const data = {};
        // Generate each field
        for (const field of schema.fields) {
            const value = await this.generateField(field, index, data, overrides);
            data[field.name] = value;
        }
        // Apply any remaining overrides (for custom fields)
        for (const [key, value] of Object.entries(overrides)) {
            if (!(key in data) && !["index"].includes(key)) {
                data[key] = value;
            }
        }
        return data;
    }
    /**
     * Generate a field value
     */
    async generateField(field, index, context, overrides) {
        // Check for override
        if (field.name in overrides) {
            return overrides[field.name];
        }
        // Check for default
        if (field.default !== undefined) {
            return field.default;
        }
        // Generate based on type
        const value = await this.generateByType(field, index, context);
        // Validate if validator provided
        if (field.validate) {
            let valid = true;
            try {
                valid = field.validate.validate(value);
            }
            catch {
                valid = false;
            }
            if (!valid) {
                throw new Error(`Validation failed for field '${field.name}': ${field.validate.message ?? "Invalid value"}`);
            }
        }
        return value;
    }
    /**
     * Generate value by type
     */
    async generateByType(field, index, context) {
        const options = field.options ?? {};
        const fakerCtx = {
            field,
            index,
            seed: this.config.seed + index,
            data: context,
            faker: this.faker,
        };
        switch (field.type) {
            // Basic types
            case "string":
                return this.faker.string(options.minLength ?? 5, options.maxLength ?? 20);
            case "number":
                return this.faker.number(options.min ?? 0, options.max ?? 100);
            case "boolean":
                return this.faker.boolean();
            case "date":
                return this.faker
                    .date(options)
                    .toISOString();
            case "datetime":
                return this.faker
                    .date(options)
                    .toISOString();
            // Identity types
            case "email":
                return this.faker.email();
            case "url":
                return this.faker.url();
            case "phone":
                return this.faker.phone();
            case "uuid":
                return this.faker.uuid();
            case "userName":
                return this.faker.userName();
            case "password":
                return this.faker.password(options.minLength ?? 16);
            // Person types
            case "firstName":
                return this.faker.firstName();
            case "lastName":
                return this.faker.lastName();
            case "fullName":
                return this.faker.fullName();
            case "address":
                return this.faker.address();
            case "city":
                return this.faker.city();
            case "country":
                return this.faker.country();
            case "zipCode":
                return this.faker.zipCode();
            // Company types
            case "company":
                return this.faker.company();
            case "department":
                return this.faker.department();
            case "jobTitle":
                return this.faker.jobTitle();
            // Text types
            case "paragraph":
                return this.faker.paragraph(options.maxItems ?? 4);
            case "sentence":
                return this.faker.sentence();
            case "word":
                return this.faker.word();
            case "lorem":
                return this.faker.lorem(options.maxItems ?? 50);
            // Media types
            case "image":
                return this.faker.image(options.maxLength ?? 640, options.minLength ?? 480);
            case "avatar":
                return this.faker.avatar();
            case "color":
                return this.faker.color();
            case "hexColor":
                return this.faker.hexColor();
            // Network types
            case "ipv4":
                return this.faker.ipv4();
            case "ipv6":
                return this.faker.ipv6();
            case "urlWithParams":
                return `${this.faker.url()}?id=${this.faker.uuid()}`;
            // Financial types
            case "creditCard":
                return this.faker.creditCard();
            case "currency":
                return this.faker.currency();
            // File types
            case "fileName":
                return this.faker.fileName(options.suffix ?? "txt");
            case "filePath":
                return this.faker.filePath();
            case "mimeType":
                return this.faker.mimeType();
            // Geographic types
            case "latitude":
                return this.faker.latitude();
            case "longitude":
                return this.faker.longitude();
            // Enum/oneOf
            case "enum":
            case "oneOf": {
                const values = options.values ?? [true, false];
                return this.faker.pick(values);
            }
            // Array
            case "array":
                return this.generateArray(field, index, context);
            // Object
            case "object":
                return await this.generateObject(field, index, context);
            // Custom
            case "custom":
                if (options.generator) {
                    return options.generator(fakerCtx);
                }
                return null;
            default:
                return this.faker.string();
        }
    }
    /**
     * Generate array
     */
    generateArray(field, index, context) {
        const options = field.options ?? {};
        const length = options.length ?? options.maxItems ?? this.faker.number(1, 5);
        const result = [];
        // Create a sub-field for array items
        const itemField = {
            name: `${field.name}Item`,
            type: options.itemType ?? "string",
            options,
        };
        for (let i = 0; i < length; i++) {
            result.push(this.generateByType(itemField, index * 1000 + i, context));
        }
        return result;
    }
    /**
     * Generate object
     */
    async generateObject(field, index, context) {
        const options = field.options ?? {};
        const properties = options.properties ?? [];
        const result = {};
        for (const prop of properties) {
            result[prop.name] = await this.generateByType(prop, index, context);
        }
        return result;
    }
    /**
     * Generate unique ID
     */
    generateId() {
        return randomBytes(8).toString("hex");
    }
    /**
     * Get faker instance
     */
    getFaker() {
        return this.faker;
    }
    /**
     * Set seed for reproducibility
     */
    setSeed(seed) {
        this.config.seed = seed;
        this.faker.setSeed(seed);
        this.sequences.clear();
    }
}
// ─── Factory Function ──────────────────────────────────────────────────────
/**
 * Create a test data generator
 */
export function createTestDataGenerator(config) {
    return new TestDataGenerator(config);
}
//# sourceMappingURL=generator.js.map