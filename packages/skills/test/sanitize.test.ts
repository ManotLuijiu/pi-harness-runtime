/**
 * Tests for the sanitization of a skill for the shared collection.
 *
 * The collection is shared, so the client names of a user must not travel
 * into it. The rules used to live in `scripts/sync-to-qdrant.ts` - the
 * only writer that could reach them. The runtime registry writes into the
 * same collection, so it needs them too.
 *
 * The rules of the clients are **not** in this repository: it is public,
 * and a list of client names in it is a list of client names in the world.
 * They live in a local file, so the tests use a fixture with made up
 * names and pass the rules in. A test must never read the rules of the
 * machine it runs on - that would make the result of the test depend on
 * the machine.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { sanitizeText, skillPointName } from "../src/sanitize.js";
import {
  loadSanitizationRules,
  resetSanitizationRulesCache,
  sanitizationStatus,
} from "../src/sanitize-rules.js";
import { skillPointPayload } from "../src/vector-schema.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/sanitization.json", import.meta.url));
const MISSING = join(tmpdir(), "pi-harness-no-such-sanitization-file.json");

const originalEnv = process.env.PI_SKILL_SANITIZATION_FILE;

/** The rules of the fixture, as the mechanism reads them. */
function fixtureRules() {
  resetSanitizationRulesCache();
  process.env.PI_SKILL_SANITIZATION_FILE = FIXTURE;
  const set = loadSanitizationRules();
  resetSanitizationRulesCache();
  return set;
}

beforeEach(() => {
  resetSanitizationRulesCache();
  process.env.PI_SKILL_SANITIZATION_FILE = FIXTURE;
});

afterEach(() => {
  resetSanitizationRulesCache();
  if (originalEnv === undefined) delete process.env.PI_SKILL_SANITIZATION_FILE;
  else process.env.PI_SKILL_SANITIZATION_FILE = originalEnv;
});

describe("the sanitization of a text", () => {
	test("the name of a client is replaced", () => {
		const rules = fixtureRules();
		expect(sanitizeText("the acmecorp workflow", rules)).toBe(
			"the [Client A] workflow",
		);
		expect(sanitizeText("for globex", rules)).toBe("for [Client B]");
		expect(sanitizeText("initech step", rules)).toBe("[Insurance Project] step");
	});

	test("the name of a client is replaced in any case", () => {
		const rules = fixtureRules();
		expect(sanitizeText("ACMEcorp and Acmecorp", rules)).toBe(
			"[Client A] and [Client A]",
		);
	});

	test("a text without a client name stays the same", () => {
		const rules = fixtureRules();
		expect(sanitizeText("a plain skill", rules)).toBe("a plain skill");
	});

	test("the generic phrases are replaced", () => {
		// The generic rules hold for every installation, so they work
		// without a local file.
		process.env.PI_SKILL_SANITIZATION_FILE = MISSING;
		resetSanitizationRulesCache();
		expect(sanitizeText("Company Name")).toBe("[Client Name]");
		expect(sanitizeText("your company")).toBe("[Client]");
		expect(sanitizeText("our client")).toBe("[Client]");
	});

	test("a client name inside an identifier is replaced", () => {
		// The name of a client rarely stands alone. A word boundary would
		// miss every one of these - and an underscore is a word character,
		// so a boundary never follows one.
		const rules = fixtureRules();
		expect(sanitizeText("acmecorp_pharma", rules)).toBe("[Client A]_pharma");
		expect(sanitizeText("th_globex_erp_chart.json", rules)).toBe(
			"th_[Client B]_erp_chart.json",
		);
		expect(sanitizeText("apps/acmecorp_pharma/setup", rules)).toBe(
			"apps/[Client A]_pharma/setup",
		);
	});

	test("a client name in a sentence is replaced", () => {
		const rules = fixtureRules();
		expect(sanitizeText("integrated with Globex", rules)).toBe(
			"integrated with [Client B]",
		);
		expect(sanitizeText("Initech secrets", rules)).toBe(
			"[Insurance Project] secrets",
		);
	});
});

describe("the name of a skill in the shared collection", () => {
	test("a name of the map is renamed", () => {
		const rules = fixtureRules();
		expect(skillPointName("acmecorp-pe-approval-workflow", rules)).toBe(
			"client-a-pe-approval-workflow",
		);
		expect(skillPointName("initech-step5-slot-filter", rules)).toBe(
			"insurance-project-step-filter",
		);
	});

	test("a name without a client name stays the same", () => {
		const rules = fixtureRules();
		expect(skillPointName("code-review", rules)).toBe("code-review");
	});

	test("the name never carries a client name", () => {
		const rules = fixtureRules();
		for (const name of [
			"acmecorp-pe-approval-workflow",
			"initech-step5-slot-filter",
			"globex-channel",
		]) {
			expect(skillPointName(name, rules)).not.toMatch(
				/acmecorp|initech|globex/i,
			);
		}
	});

	test("the name is a valid skill name", () => {
		// The name of a point is the id of the skill that a search returns,
		// so it has to be a name that a skill may carry.
		const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
		const rules = fixtureRules();
		for (const name of [
			"acmecorp-pe-approval-workflow",
			"globex-channel",
			"initech-step5-slot-filter",
			"code-review",
		]) {
			expect(skillPointName(name, rules)).toMatch(NAME);
		}
	});

	test("a name that needs no sanitization stays the same", () => {
		const rules = fixtureRules();
		expect(skillPointName("code-review", rules)).toBe("code-review");
		expect(skillPointName("frappe-doctype-field-order", rules)).toBe(
			"frappe-doctype-field-order",
		);
	});
});

describe("the rules of the installation", () => {
	test("a missing file leaves the generic rules", () => {
		process.env.PI_SKILL_SANITIZATION_FILE = MISSING;
		resetSanitizationRulesCache();
		const status = sanitizationStatus();
		expect(status.configured).toBe(false);
		expect(status.ruleCount).toBeGreaterThan(0);
	});

	test("a broken file is reported and does not take the rules down", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-harness-sanitization-"));
		const path = join(dir, "rules.json");
		writeFileSync(path, "{ not json");
		process.env.PI_SKILL_SANITIZATION_FILE = path;
		resetSanitizationRulesCache();
		const status = sanitizationStatus();
		expect(status.configured).toBe(false);
		expect(status.error).toContain("not valid JSON");
		// The generic rules still hold.
		expect(sanitizeText("Company Name")).toBe("[Client Name]");
	});

	test("a broken pattern does not take the other rules down", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-harness-sanitization-"));
		const path = join(dir, "rules.json");
		writeFileSync(
			path,
			JSON.stringify({
				rules: [
					{ pattern: "acmecorp", replacement: "[Client A]" },
					{ pattern: "([unclosed", replacement: "[Broken]" },
					{ pattern: "globex", replacement: "[Client B]" },
				],
			}),
		);
		process.env.PI_SKILL_SANITIZATION_FILE = path;
		resetSanitizationRulesCache();
		const rules = loadSanitizationRules();
		expect(sanitizeText("acmecorp and globex", rules)).toBe(
			"[Client A] and [Client B]",
		);
	});

	test("the local file is read once", () => {
		process.env.PI_SKILL_SANITIZATION_FILE = FIXTURE;
		resetSanitizationRulesCache();
		const first = loadSanitizationRules();
		const second = loadSanitizationRules();
		expect(second).toBe(first);
	});
});

describe("the payload of a point is sanitized", () => {
	test("the client names of the body do not travel into the collection", () => {
		const rules = fixtureRules();
		const payload = skillPointPayload(
			{
				name: "acmecorp-pe-approval-workflow",
				description: "the workflow of acmecorp",
				body: "the approval of acmecorp for the client",
			},
			rules,
		);

		expect(payload.name).toBe("client-a-pe-approval-workflow");
		expect(payload.description).not.toMatch(/acmecorp/i);
		expect(payload.body).not.toMatch(/acmecorp/i);
		expect(payload.text).not.toMatch(/acmecorp/i);
	});

	test("the text is built from the sanitized parts", () => {
		const rules = fixtureRules();
		const payload = skillPointPayload(
			{
				name: "acmecorp-pe-approval-workflow",
				description: "the workflow",
				body: "the body",
			},
			rules,
		);

		expect(payload.text).toContain("client-a-pe-approval-workflow");
		expect(payload.text).not.toContain("acmecorp-pe-approval-workflow");
	});
});
