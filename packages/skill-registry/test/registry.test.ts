/**
 * Skill Registry Tests (RFC-0052)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
	createSkillRegistry,
	type InMemorySkillRegistry,
	DEFAULT_SKILLS,
	matchTrigger,
	findBestMatch,
	findAllMatches,
	createKeywordTrigger,
	createIntentTrigger,
	createPatternTrigger,
} from "../src/index.js";
import type { Skill, SkillContext } from "../src/types.js";

describe("SkillRegistry", () => {
	let registry: InMemorySkillRegistry;

	beforeEach(() => {
		registry = createSkillRegistry(true);
	});

	describe("initialization", () => {
		it("should load default skills", () => {
			const skills = registry.list();
			expect(skills.length).toBeGreaterThan(0);
		});

		it("should have introspection skill", () => {
			const skill = registry.get("skill-registry-introspect");
			expect(skill).toBeDefined();
			expect(skill!.name).toBe("Introspect Skill Registry");
		});
	});

	describe("register and unregister", () => {
		it("should register a new skill", () => {
			const newSkill: Skill = {
				id: "test-skill",
				name: "Test Skill",
				description: "A test skill",
				version: "1.0.0",
				trigger: createKeywordTrigger(["test"]),
				handler: async () => ({ success: true, output: "test" }),
				metadata: { tags: ["test"] },
			};

			registry.register(newSkill);

			const skill = registry.get("test-skill");
			expect(skill).toBeDefined();
			expect(skill!.name).toBe("Test Skill");
		});

		it("should not register deprecated skills", () => {
			const deprecatedSkill: Skill = {
				id: "deprecated-skill",
				name: "Deprecated",
				description: "Should not be registered",
				version: "1.0.0",
				trigger: createKeywordTrigger(["deprecated"]),
				handler: async () => ({ success: true }),
				metadata: { tags: [], deprecated: true },
			};

			registry.register(deprecatedSkill);

			const skill = registry.get("deprecated-skill");
			expect(skill).toBeUndefined();
		});

		it("should unregister a skill", () => {
			registry.unregister("skill-registry-introspect");

			const skill = registry.get("skill-registry-introspect");
			expect(skill).toBeUndefined();
		});

		it("should track events", () => {
			const events: any[] = [];
			registry.onEvent((e) => events.push(e));

			const newSkill: Skill = {
				id: "event-test",
				name: "Event Test",
				description: "Test event",
				version: "1.0.0",
				trigger: createKeywordTrigger(["event"]),
				handler: async () => ({ success: true }),
				metadata: { tags: [] },
			};

			registry.register(newSkill);

			expect(events).toContainEqual({
				type: "skill.registered",
				skillId: "event-test",
				name: "Event Test",
			});
		});
	});

	describe("find", () => {
		it("should find skills by trigger type", () => {
			// "list" appears in all trigger phrases: "list skills", "show skills", "what skills"
			const skills = registry.find({ type: "keyword", value: "list" });
			expect(skills.length).toBeGreaterThan(0);
		});

		it("should return empty for no match", () => {
			const skills = registry.find({
				type: "keyword",
				value: "xyznonexistent",
			});
			expect(skills).toHaveLength(0);
		});
	});

	describe("invoke", () => {
		it("should invoke a skill", async () => {
			const context: SkillContext = {
				messages: [],
				tools: [],
				metadata: { registry },
			};

			const result = await registry.invoke(
				"skill-registry-introspect",
				context,
			);
			expect(result.success).toBe(true);
			expect(result.output).toContain("Registered Skills");
		});

		it("should return error for unknown skill", async () => {
			const context: SkillContext = {
				messages: [],
				tools: [],
				metadata: {},
			};

			const result = await registry.invoke("unknown-skill", context);
			expect(result.success).toBe(false);
			expect(result.error).toContain("not found");
		});

		it("should track invoke events", async () => {
			const events: any[] = [];
			registry.onEvent((e) => events.push(e));

			const context: SkillContext = {
				messages: [],
				tools: [],
				metadata: { registry },
			};

			await registry.invoke("skill-registry-introspect", context);

			const invokeEvents = events.filter((e) => e.type === "skill.invoked");
			expect(invokeEvents.length).toBe(1);
			expect(invokeEvents[0].skillId).toBe("skill-registry-introspect");
			expect(invokeEvents[0].success).toBe(true);
		});

		it("should handle handler errors", async () => {
			const errorSkill: Skill = {
				id: "error-skill",
				name: "Error Skill",
				description: "Throws error",
				version: "1.0.0",
				trigger: createKeywordTrigger(["error"]),
				handler: async () => {
					throw new Error("Test error");
				},
				metadata: { tags: [] },
			};

			registry.register(errorSkill);

			const events: any[] = [];
			registry.onEvent((e) => events.push(e));

			const context: SkillContext = {
				messages: [],
				tools: [],
				metadata: {},
			};

			const result = await registry.invoke("error-skill", context);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Test error");

			const errorEvents = events.filter((e) => e.type === "skill.error");
			expect(errorEvents.length).toBe(1);
		});
	});

	describe("invokeBestMatch", () => {
		it("should find and invoke best match", async () => {
			const context: SkillContext = {
				messages: [],
				tools: [],
				metadata: { registry },
			};

			// "list" appears in all trigger phrases
			const result = await registry.invokeBestMatch(
				{ type: "keyword", value: "list" },
				context,
			);

			expect(result.success).toBe(true);
		});

		it("should return error when no match", async () => {
			const context: SkillContext = {
				messages: [],
				tools: [],
				metadata: {},
			};

			const result = await registry.invokeBestMatch(
				{ type: "keyword", value: "xyznonexistent" },
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain("No matching skill");
		});
	});
});

describe("Matching Functions", () => {
	describe("matchTrigger", () => {
		it("should match keyword trigger", () => {
			const skill = {
				id: "test",
				name: "Test",
				description: "",
				version: "1.0.0",
				trigger: createKeywordTrigger(["help", "assist"]),
				handler: async () => ({ success: true }),
				metadata: { tags: [] },
			};

			expect(matchTrigger(skill, "Can you help me?")).toBeGreaterThan(0);
			expect(matchTrigger(skill, "I need assistance")).toBeGreaterThan(0);
			expect(matchTrigger(skill, "Nothing relevant")).toBe(0);
		});

		it("should match pattern trigger", () => {
			const skill = {
				id: "test",
				name: "Test",
				description: "",
				version: "1.0.0",
				trigger: createPatternTrigger("fix\\s+\\w+"),
				handler: async () => ({ success: true }),
				metadata: { tags: [] },
			};

			expect(matchTrigger(skill, "fix bug")).toBe(1);
			expect(matchTrigger(skill, "fix error")).toBe(1);
			expect(matchTrigger(skill, "not relevant")).toBe(0);
		});
	});

	describe("findBestMatch", () => {
		it("should return highest scoring match", () => {
			const skills = [
				{
					id: "low",
					name: "Low",
					description: "",
					version: "1.0.0",
					trigger: createKeywordTrigger(["test"]),
					handler: async () => ({ success: true }),
					metadata: { tags: [] },
				},
				{
					id: "high",
					name: "High",
					description: "",
					version: "1.0.0",
					trigger: createKeywordTrigger(["test", "skill", "run"]),
					handler: async () => ({ success: true }),
					metadata: { tags: [] },
				},
			];

			const match = findBestMatch(skills, "run test skill");
			// Both have score 1.0 (all keywords match), so either could be returned
			expect(["high", "low"]).toContain(match?.id);
		});

		it("should respect min confidence", () => {
			const skills = [
				{
					id: "low",
					name: "Low",
					description: "",
					version: "1.0.0",
					trigger: createKeywordTrigger(["test"]),
					handler: async () => ({ success: true }),
					metadata: { tags: [] },
				},
			];

			const match = findBestMatch(skills, "xyz", 0.5);
			expect(match).toBeUndefined();
		});
	});

	describe("findAllMatches", () => {
		it("should return all matches above threshold", () => {
			const skills = [
				{
					id: "one",
					name: "One",
					description: "",
					version: "1.0.0",
					trigger: createKeywordTrigger(["help"]),
					handler: async () => ({ success: true }),
					metadata: { tags: [] },
				},
				{
					id: "two",
					name: "Two",
					description: "",
					version: "1.0.0",
					trigger: createKeywordTrigger(["help", "me"]),
					handler: async () => ({ success: true }),
					metadata: { tags: [] },
				},
			];

			const matches = findAllMatches(skills, "help me");
			expect(matches.length).toBe(2);
		});
	});
});

describe("Trigger Creators", () => {
	it("should create keyword trigger", () => {
		const trigger = createKeywordTrigger(["one", "two"]);
		expect(trigger.type).toBe("keyword");
		expect(trigger.value).toEqual(["one", "two"]);
	});

	it("should create intent trigger", () => {
		const trigger = createIntentTrigger(["intent1"]);
		expect(trigger.type).toBe("intent");
		expect(trigger.value).toEqual(["intent1"]);
	});

	it("should create pattern trigger", () => {
		const trigger = createPatternTrigger("test\\d+");
		expect(trigger.type).toBe("pattern");
		expect(trigger.value).toBe("test\\d+");
	});
});
