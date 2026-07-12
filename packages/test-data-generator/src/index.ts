/**
 * Test Data Generator
 *
 * Generate realistic test data with schema definitions, fixtures, and multiple export formats.
 */

// ─── Generator ──────────────────────────────────────────────────────────

export {
	TestDataGenerator,
	createTestDataGenerator,
} from "./generator.js";

// ─── Faker ─────────────────────────────────────────────────────────────

export { SimpleFaker, createFaker } from "./faker-adapter.js";

// ─── Types ────────────────────────────────────────────────────────────

export {
	SDK_VERSION,
	type FieldType,
	type FieldDefinition,
	type FieldOptions,
	type FieldValidator,
	type CustomGenerator,
	type GeneratorContext,
	type Schema,
	type RelationDefinition,
	type RelationType,
	type SchemaHooks,
	type Factory,
	type Sequence,
	type Association,
	type GenerationRequest,
	type GeneratedRecord,
	type GenerationResult,
	type GenerationError,
	type ExportFormat,
	type ExportOptions,
	type ExportResult,
	type FakerAdapter,
	type DateOptions,
	type GeneratorConfig,
	type Fixture,
	type DjangoFixture,
	type LaravelFactory,
} from "./types.js";
