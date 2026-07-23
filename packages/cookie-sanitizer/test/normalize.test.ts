/**
 * Normalization tests — dedupe, expire, domain-match, tag.
 */

import { describe, it, expect } from "bun:test";
import {
	normalize,
	domainMatchesProvider,
	isExpired,
} from "../src/normalize.js";
import type { CanonicalCookie } from "../src/types.js";

const NOW = 1_700_000_000;

function cookie(over: Partial<CanonicalCookie> = {}): CanonicalCookie {
	return {
		name: "n1",
		value: "v1",
		domain: ".minimax.io",
		path: "/",
		secure: false,
		httpOnly: false,
		...over,
	};
}

describe("domainMatchesProvider", () => {
	it("matches minimax subdomains", () => {
		expect(domainMatchesProvider(".minimax.io", "minimax")).toBe(true);
		expect(domainMatchesProvider("platform.minimax.io", "minimax")).toBe(true);
	});

	it("rejects unrelated domains", () => {
		expect(domainMatchesProvider(".example.com", "minimax")).toBe(false);
	});

	it("accepts all domains for unknown provider (let downstream reject)", () => {
		expect(domainMatchesProvider(".anything.tld", "weird-provider")).toBe(true);
	});
});

describe("isExpired", () => {
	it("returns false for session cookies", () => {
		expect(isExpired(cookie({ expires: undefined }), NOW)).toBe(false);
		expect(isExpired(cookie({ expires: 0 }), NOW)).toBe(false);
	});

	it("returns true for past timestamps", () => {
		expect(isExpired(cookie({ expires: NOW - 1 }), NOW)).toBe(true);
	});

	it("returns false for future timestamps", () => {
		expect(isExpired(cookie({ expires: NOW + 1 }), NOW)).toBe(false);
	});
});

describe("normalize", () => {
	it("dedupes by (domain, name); last wins", () => {
		const input: CanonicalCookie[] = [
			cookie({ name: "n", value: "v1" }),
			cookie({ name: "n", value: "v2" }),
		];
		const out = normalize(input, "minimax", NOW);
		expect(out).toHaveLength(1);
		expect(out[0]?.value).toBe("v2");
	});

	it("drops empty name/value", () => {
		const input: CanonicalCookie[] = [
			cookie({ name: "" }),
			cookie({ value: "" }),
			cookie({ name: "ok", value: "v" }),
		];
		const out = normalize(input, "minimax", NOW);
		expect(out).toHaveLength(1);
		expect(out[0]?.name).toBe("ok");
	});

	it("drops expired cookies", () => {
		const input: CanonicalCookie[] = [
			cookie({ expires: NOW - 100 }),
			cookie({ expires: NOW + 100 }),
		];
		const out = normalize(input, "minimax", NOW);
		expect(out).toHaveLength(1);
		expect(out[0]?.expires).toBe(NOW + 100);
	});

	it("drops cookies whose domain doesn't match provider", () => {
		const input: CanonicalCookie[] = [
			cookie({ domain: ".minimax.io" }),
			cookie({ domain: ".other.com", name: "other" }),
		];
		const out = normalize(input, "minimax", NOW);
		expect(out).toHaveLength(1);
		expect(out[0]?.domain).toBe(".minimax.io");
	});

	it("tags each surviving cookie with the provider", () => {
		const input: CanonicalCookie[] = [
			cookie({ name: "n1" }),
			cookie({ name: "n2" }),
		];
		const out = normalize(input, "minimax", NOW);
		for (const c of out) {
			expect(c.provider).toBe("minimax");
		}
	});

	it("returns empty array on empty input", () => {
		expect(normalize([], "minimax", NOW)).toEqual([]);
	});
});
