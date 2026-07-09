/**
 * Test Data Generator - Generator
 *
 * Main test data generation engine.
 */
import type { GenerationRequest, GenerationResult, Schema, GeneratorConfig, GeneratorContext } from "./types.js";
import { SimpleFaker } from "./faker-adapter.js";
export declare class TestDataGenerator {
    private readonly config;
    private readonly faker;
    private readonly schemas;
    private sequences;
    constructor(config?: GeneratorConfig);
    /**
     * Register a custom generator
     */
    registerCustomGenerator(_name: string, _generator: (context: GeneratorContext) => unknown): void;
    /**
     * Register a schema
     */
    registerSchema(schema: Schema): void;
    /**
     * Get a schema
     */
    getSchema(name: string): Schema | undefined;
    /**
     * Generate test data
     */
    generate(request: GenerationRequest): Promise<GenerationResult>;
    /**
     * Generate a single record
     */
    private generateRecord;
    /**
     * Generate a field value
     */
    private generateField;
    /**
     * Generate value by type
     */
    private generateByType;
    /**
     * Generate array
     */
    private generateArray;
    /**
     * Generate object
     */
    private generateObject;
    /**
     * Generate unique ID
     */
    private generateId;
    /**
     * Get faker instance
     */
    getFaker(): SimpleFaker;
    /**
     * Set seed for reproducibility
     */
    setSeed(seed: number): void;
}
/**
 * Create a test data generator
 */
export declare function createTestDataGenerator(config?: GeneratorConfig): TestDataGenerator;
//# sourceMappingURL=generator.d.ts.map