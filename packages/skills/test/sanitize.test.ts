/**
 * Tests for the sanitization of a skill for the shared collection.
 *
 * The collection is shared, so the client names of a user must not travel
 * into it. The rules used to live in `scripts/sync-to-qdrant.ts` - the
 * only writer that could reach them. The runtime registry writes into the
 * same collection, so it needs them too.
 */

import { describe, expect, test } from "bun:test";

import { sanitizeText, skillPointName } from "../src/sanitize.js";
import { skillPointPayload } from "../src/vector-schema.js";

describe("the sanitization of a text", () => {
	test("the name of a client is replaced", () => {
		expect(sanitizeText("the client-a workflow")).toBe("the [Client A] workflow");
		expect(sanitizeText("for client-b")).toBe("for [Client B]");
		expect(sanitizeText("insurance-project step")).toBe("[Insurance Project] step");
	});

	test("the name of a client is replaced in any case", () => {
		expect(sanitizeText("client-a and client-a")).toBe("[Client A] and [Client A]");
	});

	test("a text without a client name stays the same", () => {
		expect(sanitizeText("a plain skill")).toBe("a plain skill");
	});

	test("the generic phrases are replaced", () => {
		expect(sanitizeText("Company Name")).toBe("[Client Name]");
		expect(sanitizeText("your company")).toBe("[Client]");
		expect(sanitizeText("our client")).toBe("[Client]");
	});
});

describe("the name of a skill in the shared collection", () => {
	test("a name of the map is renamed", () => {
		expect(skillPointName("client-a-pe-approval-workflow")).toBe(
			"client-a-pe-approval-workflow",
		);
		expect(skillPointName("import-project-clearance-lcv")).toBe(
			"import-project-clearance",
		);
		expect(skillPointName("whispertool")).toBe("whisper-tool");
	});

	test("a name without a client name stays the same", () => {
		expect(skillPointName("code-review")).toBe("code-review");
	});

	test("the name never carries a client name", () => {
		for (const name of [
			"client-a-pe-approval-workflow",
			"insurance-project-step5-slot-filter",
			"import-project-clearance-lcv",
			"whispertool",
		]) {
			expect(skillPointName(name)).not.toMatch(/client-a|insurance-project|import-project/i);
		}
	});
});

describe("the payload of a point is sanitized", () => {
	test("the client names of the body do not travel into the collection", () => {
		const payload = skillPointPayload({
			name: "client-a-pe-approval-workflow",
			description: "the workflow of client-a",
			body: "the approval of client-a for the client",
		});

		expect(payload.name).toBe("client-a-pe-approval-workflow");
		expect(payload.description).not.toMatch(/client-a/i);
		expect(payload.body).not.toMatch(/client-a/i);
		expect(payload.text).not.toMatch(/client-a/i);
	});

	test("the text is built from the sanitized parts", () => {
		const payload = skillPointPayload({
			name: "client-a-pe-approval-workflow",
			description: "the workflow",
			body: "the body",
		});

		expect(payload.text).toContain("client-a-pe-approval-workflow");
		expect(payload.text).not.toContain("client-a-pe-approval-workflow");
	});
});
