/**
 * Memory Engine Tests (RFC-0060)
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
	type MemoryEngine,
	createMemoryEngine,
	extractLinks,
	validateConcept,
} from "../src/index.js";
import type { WriteConceptRequest } from "../src/index.js";

// Temp directories for filesystem tests
const tempDirs: string[] = [];

afterEach(async () => {
	// Clean up temp directories
	for (const dir of tempDirs) {
		try {
			await fs.rm(dir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	}
	tempDirs.length = 0;
});

async function mkdtemp(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-engine-"));
	tempDirs.push(dir);
	return dir;
}

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
		it("writes a new concept", async () => {
			const request: WriteConceptRequest = {
				type: "Engineering Lesson",
				title: "Test Lesson",
				body: "This is a test lesson body",
				tags: ["test", "lesson"],
				authority: "generated",
			};

			const concept = await engine.writeConcept(request);

			expect(concept).toBeDefined();
			expect(concept.type).toBe("Engineering Lesson");
			expect(concept.title).toBe("Test Lesson");
			expect(concept.body).toBe("This is a test lesson body");
			expect(concept.tags).toContain("test");
			expect(concept.tags).toContain("lesson");
			expect(concept.timestamp).toBeDefined();
		});

		it("generates unique IDs", async () => {
			const request: WriteConceptRequest = {
				type: "Test",
				body: "Test body",
			};

			const concept1 = await engine.writeConcept(request);
			const concept2 = await engine.writeConcept(request);

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
		it("exports concept to OKF format", async () => {
			const concept = await engine.writeConcept({
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

		it("excludes bundle-level fields from exported frontmatter", async () => {
			const concept = await engine.writeConcept({
				type: "Lesson",
				title: "Bundle Fields Test",
				body: "Body",
				authority: "approved",
			});

			// Simulate bundle-level metadata merged by loadBundle
			const withBundleMeta = {
				...concept,
				metadata: {
					...concept.metadata,
					index: "previous-index-content",
					log: "previous-log-content",
					directories: ["/some/path"],
					extra: "should-appear",
				},
			};

			const okf = engine.exportToOkf(withBundleMeta);

			expect(okf).not.toContain("index:");
			expect(okf).not.toContain("log:");
			expect(okf).not.toContain("directories:");
			expect(okf).toContain("extra: should-appear");
		});
	});

	describe("Filesystem Operations", () => {
		it("writeConcept persists file to disk", async () => {
			const dir = await mkdtemp();
			const e = createMemoryEngine();
			await e.loadBundle(dir);

			await e.writeConcept({
				type: "Lesson",
				title: "Persisted Concept",
				body: "This was written to disk",
				tags: ["disk"],
				authority: "approved",
			});

			// Verify file was created
			const files = await fs.readdir(dir);
			const conceptFile = files.find(
				(f) => f.endsWith(".md") && f !== "index.md" && f !== "log.md",
			);
			expect(conceptFile).toBeDefined();

			const content = await fs.readFile(path.join(dir, conceptFile!), "utf-8");
			expect(content).toContain("Persisted Concept");
			expect(content).toContain("This was written to disk");
		});

		it("loadBundle reads files from disk", async () => {
			const dir = await mkdtemp();

			// Write a concept file directly
			await fs.writeFile(
				path.join(dir, "from-disk.md"),
				`---
type: Lesson
title: From Disk
tags: [loaded, disk]
authority: approved
---

This concept was written directly to disk.`,
				"utf-8",
			);
			await fs.writeFile(
				path.join(dir, "index.md"),
				"# Knowledge Index",
				"utf-8",
			);
			await fs.writeFile(
				path.join(dir, "log.md"),
				"## Log\n- Entry 1",
				"utf-8",
			);

			const e = createMemoryEngine();
			const bundle = await e.loadBundle(dir);

			expect(bundle.concepts.length).toBeGreaterThanOrEqual(1);
			const loaded = bundle.concepts.find((c) => c.title === "From Disk");
			expect(loaded).toBeDefined();
			expect(loaded!.type).toBe("Lesson");
			expect(loaded!.tags).toContain("loaded");
			expect(loaded!.body).toContain("directly to disk");
			expect(bundle.index).toContain("Knowledge Index");
			expect(bundle.log).toContain("Entry 1");
		});

		it("loadBundle excludes reserved files (index.md, log.md)", async () => {
			const dir = await mkdtemp();

			await fs.writeFile(
				path.join(dir, "index.md"),
				"# Index Content",
				"utf-8",
			);
			await fs.writeFile(path.join(dir, "log.md"), "# Log Content", "utf-8");
			await fs.writeFile(
				path.join(dir, "real-concept.md"),
				`---
type: Pattern
title: Real Concept
---

Body`,
				"utf-8",
			);

			const e = createMemoryEngine();
			const bundle = await e.loadBundle(dir);

			expect(bundle.concepts.some((c) => c.title === "Real Concept")).toBe(
				true,
			);
			expect(bundle.concepts.some((c) => c.id === "index")).toBe(false);
			expect(bundle.concepts.some((c) => c.id === "log")).toBe(false);
		});

		it("writeConcept generates slug-based IDs from title", async () => {
			const dir = await mkdtemp();
			const e = createMemoryEngine();
			await e.loadBundle(dir);

			const concept = await e.writeConcept({
				type: "Lesson",
				title: "My Test Concept Title",
				body: "Body",
			});

			// ID should start with slugified title
			expect(concept.id).toMatch(/^my-test-concept-title-/);
		});

		it("rebuildIndex writes index.md to disk", async () => {
			const dir = await mkdtemp();
			const e = createMemoryEngine();
			await e.loadBundle(dir);

			await e.writeConcept({
				type: "Pattern",
				title: "Indexed Concept",
				body: "Body",
			});

			await e.rebuildIndex(dir);

			const indexContent = await fs.readFile(
				path.join(dir, "index.md"),
				"utf-8",
			);
			expect(indexContent).toContain("Knowledge Index");
			expect(indexContent).toContain("Indexed Concept");
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
