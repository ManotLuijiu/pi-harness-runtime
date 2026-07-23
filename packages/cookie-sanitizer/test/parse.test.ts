/**
 * Parser tests — Netscape + EditThisCookie JSON.
 *
 * Critical: never put real cookie VALUES in test fixtures. We use
 * obvious test values like "test-value" or short synthetic strings
 * to keep secrets hygiene.
 */

import { describe, it, expect } from "bun:test";
import { parseNetscape, serializeNetscape } from "../src/parse-netscape.js";
import { parseEditThisCookieJson } from "../src/parse-json.js";
import type { CanonicalCookie } from "../src/types.js";

describe("parseNetscape", () => {
	it("parses a standard 7-column row", () => {
		const text = [
			"# Netscape HTTP Cookie File",
			"# https://curl.haxx.se/rfc/cookie_spec.html",
			"# This is a generated file! Do not edit.",
			"",
			"#HttpOnly_.minimax.io\tTRUE\t/\tTRUE\t0\ttest_token\ttest-value",
			".minimax.io\tFALSE\t/\tFALSE\t0\ttest_id\ttest-id-value",
		].join("\n");
		const cookies = parseNetscape(text);
		expect(cookies).toHaveLength(2);
		expect(cookies[0]?.name).toBe("test_token");
		expect(cookies[0]?.value).toBe("test-value");
		expect(cookies[0]?.httpOnly).toBe(true);
		expect(cookies[0]?.secure).toBe(true);
		expect(cookies[1]?.name).toBe("test_id");
		expect(cookies[1]?.httpOnly).toBe(false);
		expect(cookies[1]?.secure).toBe(false);
	});

	it("skips malformed rows (< 7 cols)", () => {
		const text = [
			"# Netscape HTTP Cookie File",
			".minimax.io\tTRUE\t/\tTRUE", // only 4 cols
			".minimax.io\tTRUE\t/\tTRUE\t0\tname\tvalue", // OK
		].join("\n");
		const cookies = parseNetscape(text);
		expect(cookies).toHaveLength(1);
		expect(cookies[0]?.name).toBe("name");
	});

	it("skips blank lines and comment-only lines", () => {
		const text = [
			"",
			"# comment",
			"#HttpOnly_.minimax.io\tTRUE\t/\tTRUE\t0\tn1\tv1",
			"",
		].join("\n");
		const cookies = parseNetscape(text);
		expect(cookies).toHaveLength(1);
		expect(cookies[0]?.name).toBe("n1");
	});

	it("returns empty array for empty input", () => {
		expect(parseNetscape("")).toEqual([]);
		expect(parseNetscape("not a real file")).toEqual([]);
	});

	it("treats expires=0 as session cookie (undefined)", () => {
		const text = ".minimax.io\tFALSE\t/\tFALSE\t0\tn1\tv1";
		const cookies = parseNetscape(text);
		expect(cookies[0]?.expires).toBeUndefined();
	});

	it("preserves non-zero expires as a number", () => {
		const text = ".minimax.io\tFALSE\t/\tFALSE\t1700000000\tn1\tv1";
		const cookies = parseNetscape(text);
		expect(cookies[0]?.expires).toBe(1700000000);
	});
});

describe("serializeNetscape", () => {
	it("round-trips a single cookie", () => {
		const cookies: CanonicalCookie[] = [
			{
				name: "n1",
				value: "v1",
				domain: ".minimax.io",
				path: "/",
				secure: true,
				httpOnly: true,
				expires: 0,
			},
		];
		const out = serializeNetscape(cookies);
		const back = parseNetscape(out);
		expect(back).toHaveLength(1);
		expect(back[0]?.name).toBe("n1");
		expect(back[0]?.value).toBe("v1");
		expect(back[0]?.httpOnly).toBe(true);
	});

	it("emits the canonical header on every output", () => {
		const out = serializeNetscape([]);
		expect(out).toContain("# Netscape HTTP Cookie File");
	});

	it("drops cookies with empty name or value", () => {
		const cookies: CanonicalCookie[] = [
			{
				name: "",
				value: "v",
				domain: ".x.io",
				path: "/",
				secure: false,
				httpOnly: false,
			},
			{
				name: "n",
				value: "",
				domain: ".x.io",
				path: "/",
				secure: false,
				httpOnly: false,
			},
			{
				name: "ok",
				value: "v",
				domain: ".x.io",
				path: "/",
				secure: false,
				httpOnly: false,
			},
		];
		const out = serializeNetscape(cookies);
		const back = parseNetscape(out);
		expect(back).toHaveLength(1);
		expect(back[0]?.name).toBe("ok");
	});
});

describe("parseEditThisCookieJson", () => {
	it("parses a Chrome devtools / EditThisCookie export array", () => {
		const text = JSON.stringify([
			{
				domain: ".minimax.io",
				expirationDate: 1700000000,
				hostOnly: false,
				httpOnly: true,
				name: "test_token",
				path: "/",
				secure: true,
				session: false,
				value: "test-value",
			},
		]);
		const cookies = parseEditThisCookieJson(text);
		expect(cookies).toHaveLength(1);
		expect(cookies[0]?.name).toBe("test_token");
		expect(cookies[0]?.httpOnly).toBe(true);
		expect(cookies[0]?.expires).toBe(1700000000);
	});

	it("parses a single object (not array)", () => {
		const text = JSON.stringify({
			domain: ".minimax.io",
			expirationDate: 1700000000,
			name: "n1",
			value: "v1",
			secure: true,
			httpOnly: false,
		});
		const cookies = parseEditThisCookieJson(text);
		expect(cookies).toHaveLength(1);
		expect(cookies[0]?.name).toBe("n1");
	});

	it("treats millisecond timestamps as such (>1e12)", () => {
		const ms = 1700000000000; // ms, not sec
		const text = JSON.stringify([
			{ name: "n", value: "v", expirationDate: ms },
		]);
		const cookies = parseEditThisCookieJson(text);
		expect(cookies[0]?.expires).toBe(Math.floor(ms / 1000));
	});

	it("treats session=true as undefined expires", () => {
		const text = JSON.stringify([
			{ name: "n", value: "v", session: true, expirationDate: 9999 },
		]);
		const cookies = parseEditThisCookieJson(text);
		expect(cookies[0]?.expires).toBeUndefined();
	});

	it("skips records with empty name or value", () => {
		const text = JSON.stringify([
			{ name: "", value: "v", domain: ".x.io" },
			{ name: "n", value: "", domain: ".x.io" },
			{ name: "ok", value: "v", domain: ".x.io" },
		]);
		const cookies = parseEditThisCookieJson(text);
		expect(cookies).toHaveLength(1);
		expect(cookies[0]?.name).toBe("ok");
	});

	it("returns [] on invalid JSON", () => {
		expect(parseEditThisCookieJson("not json")).toEqual([]);
		expect(parseEditThisCookieJson("")).toEqual([]);
	});
});
