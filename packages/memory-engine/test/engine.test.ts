/**
 * Memory Engine Tests (RFC-0060)
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
	type MemoryEngine,
	createMemoryEngine,
	extractLinks,
	validateConcept,
} from "../src/index.js";
import type { WriteConceptRequest } from "../src/index.js";

describe("MemoryEngine", () => {
	let engine: MemoryEngine;

	beforeEach(() => {
		engine = createMemoryEngine();
	});

	describe("loadBundle", () => {
		it("loads an empty bundle", async () => {
			const bundle = await engine.loadBundle("/tmp/knowledge");

			expect(bundle).toBeDefined();
			expect(bundle.concepts).toEqual([]);
			expect(bundle.path).toBe("/tmp/knowledge");
		});
	});

	describe("writeConcept", () => {
		it("writes a new concept", () => {
			const request: WriteConceptRequest = {
				type: "Engineering Lesson",
				title: "Test Lesson",
				body: "This is a test lesson body",
				tags: ["test", "lesson"],
				authority: "generated",
			};

			const concept = engine.writeConcept(request);

			expect(concept).toBeDefined();
			expect(concept.type).toBe("Engineering Lesson");
			expect(concept.title).toBe("Test Lesson");
			expect(concept.body).toBe("This is a test lesson body");
			expect(concept.tags).toContain("test");
			expect(concept.tags).toContain("lesson");
			expect(concept.timestamp).toBeDefined();
		});

		it("generates unique IDs", () => {
			const request: WriteConceptRequest = {
				type: "Test",
				body: "Test body",
			};

			const concept1 = engine.writeConcept(request);
			const concept2 = engine.writeConcept(request);

			expect(concept1.id).not.toBe(concept2.id);
		});
	});

	describe("validateConcept", () => {
		it("accepts valid concept with frontmatter and type", () => {
			const content = `---
type: Test Type
title: Test Title
tags: [test, sample]
---

Body content`;

			const result = validateConcept(content, "test.md");

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it("rejects concept missing frontmatter", () => {
			const content = `No frontmatter here`;

			const result = validateConcept(content, "test.md");

			expect(result.valid).toBe(false);
			expect(
				result.errors.some((e) => e.message.includes("YAML frontmatter")),
			).toBe(true);
		});

		it("rejects concept missing type field", () => {
			const content = `---
title: Test Title
---

Body content`;

			const result = validateConcept(content, "test.md");

			expect(result.valid).toBe(false);
			expect(
				result.errors.some((e) => e.message.includes("'type' field")),
			).toBe(true);
		});
	});

	describe("search", () => {
		beforeEach(() => {
			engine.writeConcept({
				type: "Lesson",
				title: "Git Best Practices",
				body: "Use worktrees for parallel work",
				tags: ["git", "workflow"],
				authority: "approved",
			});
			engine.writeConcept({
				type: "Pattern",
				title: "Error Handling",
				body: "Handle errors gracefully",
				tags: ["errors", "best-practices"],
				authority: "generated",
			});
		});

		it("searches by type", () => {
			const results = engine.search({ types: ["Lesson"] });

			expect(results.length).toBe(1);
			expect(results[0].concept.type).toBe("Lesson");
		});

		it("searches by tag", () => {
			const results = engine.search({ tags: ["git"] });

			expect(results.length).toBe(1);
			expect(results[0].concept.tags).toContain("git");
		});

		it("filters by authority", () => {
			const results = engine.search({ authority: ["approved"] });

			expect(results.length).toBe(1);
			expect(results[0].concept.metadata.authority).toBe("approved");
		});

		it("returns empty for no matches", () => {
			const results = engine.search({ types: ["NonExistent"] });

			expect(results).toHaveLength(0);
		});
	});

	describe("promoteFromBlackboard", () => {
		it("promotes blackboard content with type", () => {
			const content = "This is blackboard content";
			const metadata = {
				type: "Lesson",
				title: "Promoted Lesson",
				tags: ["promoted"],
			};

			const request = engine.promoteFromBlackboard(content, metadata);

			expect(request.type).toBe("Lesson");
			expect(request.title).toBe("Promoted Lesson");
			expect(request.body).toBe(content);
		});

		it("filters secrets from content", () => {
			const content = `API_KEY=secret123\npassword=mypassword\nusername=test`;
			const metadata = { type: "Config" };

			const request = engine.promoteFromBlackboard(content, metadata);

			expect(request.body).not.toContain("secret123");
			expect(request.body).toContain("API_KEY=[REDACTED]");
		});
	});

	describe("exportToOkf", () => {
		it("exports concept to OKF format", () => {
			const concept = engine.writeConcept({
				type: "Lesson",
				title: "Export Test",
				body: "Test body content",
				tags: ["export"],
				authority: "approved",
			});

			const okf = engine.exportToOkf(concept);

			expect(okf).toContain("---");
			expect(okf).toContain("type: Lesson");
			expect(okf).toContain("title: Export Test");
			expect(okf).toContain("authority: approved");
			expect(okf).toContain("Test body content");
		});
	});
});

describe("extractLinks", () => {
	it("extracts markdown links", () => {
		const markdown = `
Check out [the docs](https://example.com/docs).

Also see [another link](https://example.com/other).
`;

		const links = extractLinks(markdown);

		expect(links).toHaveLength(2);
		expect(links[0]).toEqual({
			href: "https://example.com/docs",
			title: "the docs",
		});
		expect(links[1]).toEqual({
			href: "https://example.com/other",
			title: "another link",
		});
	});

	it("returns empty array for no links", () => {
		const markdown = "No links here";

		const links = extractLinks(markdown);

		expect(links).toHaveLength(0);
	});
});

describe("validateConcept", () => {
	it("validates concept with all required fields", () => {
		const content = `---
type: Test Concept
title: Valid Concept
tags: [test, valid]
authority: approved
---

This is the body.
`;

		const result = validateConcept(content, "concept.md");

		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("rejects missing type field", () => {
		const content = `---
title: Missing Type
---

Body
`;

		const result = validateConcept(content, "concept.md");

		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it("rejects missing frontmatter", () => {
		const content = `Just plain text`;

		const result = validateConcept(content, "concept.md");

		expect(result.valid).toBe(false);
	});
});
