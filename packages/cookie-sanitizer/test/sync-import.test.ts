/// <reference types="bun-types" />
/**
 * The import of a cookie file into the canonical cache.
 *
 * The rules that matter:
 *  - a supported file is imported and the cache is written atomically,
 *  - a file that does not validate leaves the previous cache alone,
 *  - the cache stays private to its owner,
 *  - the diagnostics never carry a cookie value.
 *
 * Every fixture is synthetic.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	rmSync,
	existsSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sync } from "../src/sync.js";
import { parseNetscape } from "../src/parse-netscape.js";

/** A value that must never appear in a diagnostic. */
const SECRET = "synthetic-secret-4b71";

let dropDir = "";
let cachePath = "";

beforeEach(() => {
	const base = mkdtempSync(join(tmpdir(), "cookie-import-"));
	dropDir = join(base, "cookies");
	mkdirSync(dropDir, { recursive: true });
	cachePath = join(base, "config", "minimax-cookies.txt");
});

afterEach(() => {
	rmSync(join(dropDir, ".."), { recursive: true, force: true });
});

describe("a space-separated export", () => {
	it("is imported into the canonical cache", () => {
		writeFileSync(
			join(dropDir, "minimax.txt"),
			[
				"Netscape HTTP Cookie File",
				"https://example.invalid/cookie_spec.html",
				".minimax.io FALSE / FALSE 0 test_id test-id-value",
				"#HttpOnly_.minimax.io TRUE / TRUE 0 test_token test-token-value",
			].join("\n"),
		);

		const result = sync({ dropDir, cachePath, providerHint: "minimax" });
		expect(result.errors).toEqual([]);
		expect(result.wrote).toBe(true);
		expect(result.provider).toBe("minimax");
		expect(result.totalCookies).toBe(2);

		const cache = readFileSync(cachePath, "utf8");
		const cookies = parseNetscape(cache);
		expect(cookies.map((c) => c.name).sort()).toEqual([
			"test_id",
			"test_token",
		]);
		expect(cookies.find((c) => c.name === "test_token")?.httpOnly).toBe(true);
	});

	it("keeps a value that contains a space", () => {
		writeFileSync(
			join(dropDir, "minimax.txt"),
			".minimax.io FALSE / FALSE 0 test_id a value with spaces",
		);

		const result = sync({ dropDir, cachePath, providerHint: "minimax" });
		expect(result.wrote).toBe(true);
		const cookies = parseNetscape(readFileSync(cachePath, "utf8"));
		expect(cookies[0]?.value).toBe("a value with spaces");
	});

	it("writes the cache with owner-only permissions", () => {
		writeFileSync(
			join(dropDir, "minimax.txt"),
			".minimax.io FALSE / FALSE 0 test_id test-id-value",
		);

		sync({ dropDir, cachePath, providerHint: "minimax" });
		const mode = statSync(cachePath).mode & 0o777;
		expect(mode).toBe(0o600);
	});
});

describe("a file that does not validate", () => {
	it("leaves the previous cache alone", () => {
		// A good import first.
		writeFileSync(
			join(dropDir, "minimax.txt"),
			".minimax.io FALSE / FALSE 0 test_id test-id-value",
		);
		const first = sync({ dropDir, cachePath, providerHint: "minimax" });
		expect(first.wrote).toBe(true);
		const before = readFileSync(cachePath, "utf8");

		// A malformed file replaces the good one.
		writeFileSync(
			join(dropDir, "minimax.txt"),
			`a line that is not a row and holds ${SECRET}`,
		);
		const second = sync({ dropDir, cachePath, providerHint: "minimax" });
		expect(second.wrote).toBe(false);
		expect(readFileSync(cachePath, "utf8")).toBe(before);
	});

	it("reports the reason without the content", () => {
		writeFileSync(
			join(dropDir, "minimax.txt"),
			`a line that is not a row and holds ${SECRET}`,
		);

		const result = sync({ dropDir, cachePath, providerHint: "minimax" });
		expect(result.wrote).toBe(false);
		const text = JSON.stringify(result);
		expect(text).not.toContain(SECRET);
		expect(text).toContain("minimax.txt");
	});

	it("does not create a cache when there was none", () => {
		writeFileSync(
			join(dropDir, "minimax.txt"),
			"a line that is not a row",
		);

		const result = sync({ dropDir, cachePath, providerHint: "minimax" });
		expect(result.wrote).toBe(false);
		expect(existsSync(cachePath)).toBe(false);
	});
});

describe("a file whose rows are space-separated and do not validate", () => {
	it("names the file and the reason", () => {
		writeFileSync(
			join(dropDir, "minimax.txt"),
			[
				"# an export whose wording is not the canonical one",
				"nonsense words that are not a row",
			].join("\n"),
		);

		const result = sync({ dropDir, cachePath, providerHint: "minimax" });
		expect(result.wrote).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
		const message = result.errors[0]?.message ?? "";
		expect(message).toContain("minimax.txt");
		expect(message).toContain("spaces");
	});
});
