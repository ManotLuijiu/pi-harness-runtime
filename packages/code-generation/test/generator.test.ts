/**
 * Code Generation Pipeline - Tests
 */

import { describe, it, expect } from "bun:test";
import { createCodeGenerator, createFaker, SDK_VERSION } from "../src/index.js";

describe("CodeGeneration", () => {
	describe("SDK_VERSION", () => {
		it("should export SDK_VERSION", () => {
			expect(SDK_VERSION).toBeDefined();
			expect(typeof SDK_VERSION).toBe("string");
		});
	});

	describe("createFaker", () => {
		it("should create faker instance", () => {
			const faker = createFaker(12345);
			expect(faker).toBeDefined();
		});

		it("should generate consistent data with seed", () => {
			const faker1 = createFaker(12345);
			const faker2 = createFaker(12345);

			expect(faker1.firstName()).toBe(faker2.firstName());
		});

		it("should generate different data without seed", () => {
			const faker1 = createFaker();
			const faker2 = createFaker();

			// May or may not be different (random)
			expect(typeof faker1.firstName()).toBe("string");
			expect(typeof faker2.firstName()).toBe("string");
		});
	});

	describe("Faker data generation", () => {
		const faker = createFaker(12345);

		it("should generate names", () => {
			expect(typeof faker.firstName()).toBe("string");
			expect(typeof faker.lastName()).toBe("string");
			expect(typeof faker.fullName()).toBe("string");
		});

		it("should generate email", () => {
			const email = faker.email();
			expect(email).toContain("@");
			expect(email).toContain(".");
		});

		it("should generate uuid", () => {
			const uuid = faker.uuid();
			expect(uuid).toMatch(/^[0-9a-f-]+$/);
		});

		it("should generate phone", () => {
			const phone = faker.phone();
			expect(phone).toMatch(/\d/);
		});

		it("should generate addresses", () => {
			expect(typeof faker.address()).toBe("string");
			expect(typeof faker.city()).toBe("string");
			expect(typeof faker.country()).toBe("string");
			expect(typeof faker.zipCode()).toBe("string");
		});

		it("should generate company info", () => {
			expect(typeof faker.company()).toBe("string");
			expect(typeof faker.department()).toBe("string");
			expect(typeof faker.jobTitle()).toBe("string");
		});

		it("should generate text", () => {
			expect(typeof faker.word()).toBe("string");
			expect(typeof faker.sentence()).toBe("string");
			expect(typeof faker.paragraph()).toBe("string");
		});

		it("should generate numbers within range", () => {
			const num = faker.number(10, 20);
			expect(num).toBeGreaterThanOrEqual(10);
			expect(num).toBeLessThanOrEqual(20);
		});

		it("should generate boolean", () => {
			const bool = faker.boolean();
			expect(typeof bool).toBe("boolean");
		});
	});

	describe("createCodeGenerator", () => {
		it("should create code generator instance", () => {
			const generator = createCodeGenerator();
			expect(generator).toBeDefined();
		});

		it("should create with custom config", () => {
			const generator = createCodeGenerator({
				seed: 12345,
				verbose: true,
			});
			expect(generator).toBeDefined();
		});
	});

	describe("code generation", () => {
		const generator = createCodeGenerator({
			seed: 12345,
		});

		it("should generate code from template", async () => {
			const result = await generator.generate({
				template: {
					id: "test",
					name: "Test",
					description: "Test template",
					content: "Hello, <%= name %>!",
					engine: "ejs",
				},
				variables: { name: "World" },
			});

			expect(result.success).toBe(true);
			expect(result.files[0].content).toContain("Hello, World!");
		});

		it("should generate with multiple variables", async () => {
			const result = await generator.generate({
				template: {
					id: "test2",
					name: "Test2",
					description: "Test template 2",
					content: "User: <%= firstName %> <%= lastName %>",
					engine: "ejs",
				},
				variables: { firstName: "John", lastName: "Doe" },
			});

			expect(result.success).toBe(true);
			expect(result.files[0].content).toContain("John Doe");
		});

		it("should return errors for missing template", async () => {
			const result = await generator.generate({
				schemaId: "non-existent",
				variables: {},
			});

			expect(result.success).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
		});

		it("should validate required variables", async () => {
			const result = await generator.generate({
				template: {
					id: "required",
					name: "Required",
					description: "Required vars",
					content: "Hello <%= name %>",
					engine: "ejs",
					variables: [{ name: "name", type: "string", required: true }],
				},
				variables: {},
			});

			expect(result.success).toBe(false);
		});

		it("should support dry run", async () => {
			const result = await generator.generate({
				template: {
					id: "dry-run",
					name: "DryRun",
					description: "Dry run test",
					content: "Test",
					engine: "ejs",
				},
				variables: {},
				dryRun: true,
			});

			expect(result.dryRun).toBe(true);
		});

		it("should calculate generation time", async () => {
			const result = await generator.generate({
				template: {
					id: "timing",
					name: "Timing",
					description: "Timing test",
					content: "Test content",
					engine: "ejs",
				},
				variables: {},
			});

			expect(result.durationMs).toBeGreaterThanOrEqual(0);
		});
	});

	describe("schema registration", () => {
		const generator = createCodeGenerator();

		it("should register schemas", () => {
			generator.registerSchema({
				name: "User",
				fields: [{ name: "name", type: "string" }],
			});

			const schema = generator.getSchema("User");
			expect(schema).toBeDefined();
			expect(schema?.name).toBe("User");
		});

		it("should generate using registered schema", async () => {
			generator.registerSchema({
				id: "registered",
				name: "Product",
				description: "Product schema",
				fields: [
					{ name: "name", type: "string" },
					{ name: "price", type: "number" },
				],
			});

			const result = await generator.generate({
				schemaId: "registered",
				variables: {},
			});

			expect(result.success).toBe(true);
		});
	});
});
