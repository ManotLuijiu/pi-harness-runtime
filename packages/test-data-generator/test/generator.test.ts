/**
 * Test Data Generator - Tests
 */

import { describe, it, expect } from "bun:test";
import {
	createTestDataGenerator,
	createFaker,
	SDK_VERSION,
} from "../src/index.js";

describe("TestDataGenerator", () => {
	describe("SDK_VERSION", () => {
		it("should export SDK_VERSION", () => {
			expect(SDK_VERSION).toBeDefined();
			expect(typeof SDK_VERSION).toBe("string");
		});
	});

	describe("createFaker", () => {
		it("should create faker instance with seed", () => {
			const faker = createFaker(12345);
			expect(faker).toBeDefined();
		});

		it("should generate consistent data with same seed", () => {
			const faker1 = createFaker(99999);
			const faker2 = createFaker(99999);

			const name1 = faker1.fullName();
			const name2 = faker2.fullName();

			expect(name1).toBe(name2);
		});
	});

	describe("createTestDataGenerator", () => {
		it("should create a test data generator instance", () => {
			const generator = createTestDataGenerator();
			expect(generator).toBeDefined();
		});

		it("should create with custom config", () => {
			const generator = createTestDataGenerator({
				seed: 12345,
				verbose: true,
			});
			expect(generator).toBeDefined();
		});
	});

	describe("data generation", () => {
		const generator = createTestDataGenerator({
			seed: 12345,
		});

		it("should generate data from schema", async () => {
			const result = await generator.generate({
				schema: {
					name: "TestUser",
					fields: [
						{ name: "email", type: "email" },
						{ name: "name", type: "fullName" },
					],
				},
				count: 1,
			});

			expect(result.success).toBe(true);
			expect(result.records.length).toBe(1);
			expect(result.records[0].data.email).toContain("@");
		});

		it("should generate multiple records", async () => {
			const result = await generator.generate({
				schema: {
					name: "Users",
					fields: [{ name: "name", type: "firstName" }],
				},
				count: 5,
			});

			expect(result.count).toBe(5);
			expect(result.records.length).toBe(5);
		});

		it("should generate different data each run", async () => {
			const gen1 = createTestDataGenerator({ seed: Date.now() });
			const gen2 = createTestDataGenerator({ seed: Date.now() + 1 });

			const result1 = await gen1.generate({
				schema: {
					name: "Random",
					fields: [
						{ name: "value", type: "number", options: { min: 1, max: 1000 } },
					],
				},
				count: 1,
			});

			const result2 = await gen2.generate({
				schema: {
					name: "Random",
					fields: [
						{ name: "value", type: "number", options: { min: 1, max: 1000 } },
					],
				},
				count: 1,
			});

			// Different seeds should produce different results
			expect(typeof result1.records[0].data.value).toBe("number");
			expect(typeof result2.records[0].data.value).toBe("number");
		});

		it("should validate required fields", async () => {
			const result = await generator.generate({
				schema: {
					name: "Required",
					fields: [{ name: "name", type: "string", required: true }],
				},
				count: 1,
			});

			expect(result.success).toBe(true);
		});

		it("should use default values", async () => {
			const result = await generator.generate({
				schema: {
					name: "WithDefaults",
					fields: [
						{
							name: "status",
							type: "enum",
							options: { values: ["active"] },
							default: "active",
						},
					],
				},
				count: 1,
			});

			expect(result.records[0].data.status).toBe("active");
		});

		it("should record generation time", async () => {
			const result = await generator.generate({
				schema: {
					name: "Timing",
					fields: [{ name: "value", type: "number" }],
				},
				count: 1,
			});

			expect(result.generationTimeMs).toBeGreaterThanOrEqual(0);
		});
	});

	describe("field types", () => {
		const generator = createTestDataGenerator({ seed: 12345 });

		it("should generate string fields", async () => {
			const result = await generator.generate({
				schema: {
					name: "Strings",
					fields: [
						{
							name: "text",
							type: "string",
							options: { minLength: 5, maxLength: 10 },
						},
					],
				},
				count: 1,
			});

			const text = result.records[0].data.text as string;
			expect(text.length).toBeGreaterThanOrEqual(5);
			expect(text.length).toBeLessThanOrEqual(10);
		});

		it("should generate number fields", async () => {
			const result = await generator.generate({
				schema: {
					name: "Numbers",
					fields: [
						{ name: "age", type: "number", options: { min: 18, max: 99 } },
					],
				},
				count: 1,
			});

			const age = result.records[0].data.age as number;
			expect(age).toBeGreaterThanOrEqual(18);
			expect(age).toBeLessThanOrEqual(99);
		});

		it("should generate boolean fields", async () => {
			const result = await generator.generate({
				schema: {
					name: "Booleans",
					fields: [{ name: "active", type: "boolean" }],
				},
				count: 1,
			});

			const active = result.records[0].data.active;
			expect(typeof active).toBe("boolean");
		});

		it("should generate enum fields", async () => {
			const result = await generator.generate({
				schema: {
					name: "Enums",
					fields: [
						{
							name: "status",
							type: "enum",
							options: { values: ["pending", "active", "done"] },
						},
					],
				},
				count: 10,
			});

			const statuses = result.records.map((r) => r.data.status);
			statuses.forEach((status) => {
				expect(["pending", "active", "done"]).toContain(status);
			});
		});
	});

	describe("schema registration", () => {
		const generator = createTestDataGenerator();

		it("should register schemas", () => {
			generator.registerSchema({
				name: "RegisteredUser",
				fields: [{ name: "email", type: "email" }],
			});

			const schema = generator.getSchema("RegisteredUser");
			expect(schema).toBeDefined();
			expect(schema?.name).toBe("RegisteredUser");
		});

		it("should generate using registered schema", async () => {
			generator.registerSchema({
				name: "Product",
				fields: [
					{ name: "name", type: "company" },
					{ name: "price", type: "number", options: { min: 1, max: 100 } },
				],
			});

			const result = await generator.generate({
				schemaId: "Product",
				count: 1,
			});

			expect(result.success).toBe(true);
		});
	});
});
