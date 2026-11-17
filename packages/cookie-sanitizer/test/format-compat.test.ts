/// <reference types="bun-types" />
/**
 * Format compatibility tests.
 *
 * The sanitizer promised forgiving input: "any cookie file (any name, any
 * format)". The strict parser split on tabs only, so an export whose rows
 * are separated by spaces was rejected. These tests pin the supported
 * inputs and the rejections.
 *
 * Every fixture is synthetic. No real cookie value, name, header or
 * account appears here, and the diagnostics are checked for the absence of
 * the synthetic secrets.
 */

import { describe, it, expect } from "bun:test";
import { detectFormat, diagnoseFormat } from "../src/detect-format.js";
import {
	parseNetscape,
	parseNetscapeDetailed,
} from "../src/parse-netscape.js";
import {
	parseNetscapeSpace,
	parseCompatibleRow,
} from "../src/parse-netscape-space.js";
import { parseEditThisCookieJson } from "../src/parse-json.js";
import { normalize } from "../src/normalize.js";

/** A value that must never appear in a diagnostic. */
const SECRET = "synthetic-secret-value-9f2c";

describe("the tab-separated Netscape format", () => {
	const text = [
		"# Netscape HTTP Cookie File",
		"# https://curl.haxx.se/rfc/cookie_spec.html",
		"",
		"#HttpOnly_.minimax.io\tTRUE\t/\tTRUE\t0\ttest_token\ttest-value",
		".minimax.io\tFALSE\t/\tFALSE\t0\ttest_id\ttest-id-value",
	].join("\n");

	it("is detected", () => {
		expect(detectFormat(text)).toBe("netscape");
	});

	it("is parsed with its values intact", () => {
		const cookies = parseNetscape(text);
		expect(cookies).toHaveLength(2);
		expect(cookies[0]?.name).toBe("test_token");
		expect(cookies[0]?.value).toBe("test-value");
		expect(cookies[0]?.httpOnly).toBe(true);
		expect(cookies[1]?.name).toBe("test_id");
		expect(cookies[1]?.secure).toBe(false);
	});
});

describe("the EditThisCookie JSON format", () => {
	const text = JSON.stringify([
		{
			domain: ".minimax.io",
			expirationDate: Math.floor(Date.now() / 1000) + 3600,
			name: "test_json",
			value: "test-value-json",
			httpOnly: false,
			secure: true,
		},
	]);

	it("is detected", () => {
		expect(detectFormat(text)).toBe("edit-this-cookie-json");
	});

	it("is parsed", () => {
		const cookies = parseEditThisCookieJson(text);
		expect(cookies).toHaveLength(1);
		expect(cookies[0]?.name).toBe("test_json");
	});
});

describe("a header that does not match the canonical wording", () => {
	it("is still a Netscape file when the rows are tab-separated", () => {
		const text = [
			"# Netscape HTTP Cookie File (exported by a browser extension)",
			"# another comment",
			".minimax.io\tFALSE\t/\tFALSE\t0\ttest_id\ttest-value",
		].join("\n");

		expect(detectFormat(text)).toBe("netscape");
		const cookies = parseNetscape(text);
		expect(cookies).toHaveLength(1);
		expect(cookies[0]?.name).toBe("test_id");
	});
});

describe("the space-separated Netscape variant", () => {
	const text = [
		"# Netscape HTTP Cookie File",
		"# exported by a tool that writes spaces",
		".minimax.io FALSE / FALSE 0 test_id test-value",
		"#HttpOnly_.minimax.io TRUE / TRUE 0 test_token test-token-value",
	].join("\n");

	it("is detected", () => {
		expect(detectFormat(text)).toBe("netscape-space");
	});

	it("is parsed with its values intact", () => {
		const result = parseNetscapeSpace(text);
		expect(result.accepted).toBe(2);
		expect(result.rejected).toBe(0);
		expect(result.cookies).toHaveLength(2);
		expect(result.cookies[0]?.name).toBe("test_id");
		expect(result.cookies[0]?.value).toBe("test-value");
		expect(result.cookies[0]?.domain).toBe(".minimax.io");
		expect(result.cookies[1]?.httpOnly).toBe(true);
		expect(result.cookies[1]?.secure).toBe(true);
	});

	it("keeps a value that contains spaces", () => {
		const row = ".minimax.io FALSE / FALSE 0 test_id a value with spaces";
		const outcome = parseCompatibleRow(row);
		expect(outcome?.kind).toBe("accepted");
		if (outcome?.kind !== "accepted") return;
		expect(outcome.cookie.value).toBe("a value with spaces");
		expect(outcome.cookie.name).toBe("test_id");
	});

	it("keeps a value that contains a tab", () => {
		const row = ".minimax.io\tFALSE\t/\tFALSE\t0\ttest_id\ttest\tvalue";
		const outcome = parseCompatibleRow(row);
		expect(outcome?.kind).toBe("accepted");
		if (outcome?.kind !== "accepted") return;
		expect(outcome.cookie.value).toBe("test\tvalue");
	});

	it("rejects a row whose domain is not a host", () => {
		const outcome = parseCompatibleRow("not_a_domain FALSE / FALSE 0 n v");
		expect(outcome?.kind).toBe("rejected");
		if (outcome?.kind !== "rejected") return;
		expect(outcome.reason).toBe("invalid-domain");
	});

	it("rejects a row whose expiry is not a number", () => {
		const outcome = parseCompatibleRow(".minimax.io FALSE / FALSE later n v");
		expect(outcome?.kind).toBe("rejected");
		if (outcome?.kind !== "rejected") return;
		expect(outcome.reason).toBe("invalid-expiry");
	});

	it("rejects a row whose path is not a path", () => {
		const outcome = parseCompatibleRow(".minimax.io FALSE not-a-path FALSE 0 n v");
		expect(outcome?.kind).toBe("rejected");
		if (outcome?.kind !== "rejected") return;
		expect(outcome.reason).toBe("invalid-path");
	});

	it("rejects a row whose secure marker is not TRUE or FALSE", () => {
		const outcome = parseCompatibleRow(".minimax.io FALSE / MAYBE 0 n v");
		expect(outcome?.kind).toBe("rejected");
		if (outcome?.kind !== "rejected") return;
		expect(outcome.reason).toBe("invalid-secure");
	});

	it("rejects a row without a value", () => {
		const outcome = parseCompatibleRow(".minimax.io FALSE / FALSE 0 test_id");
		expect(outcome?.kind).toBe("rejected");
		if (outcome?.kind !== "rejected") return;
		expect(outcome.reason).toBe("missing-value");
	});

	it("rejects a row that is not a row at all", () => {
		const outcome = parseCompatibleRow("just some words here");
		expect(outcome?.kind).toBe("rejected");
		if (outcome?.kind !== "rejected") return;
		expect(outcome.reason).toBe("not-a-row");
	});

	it("counts the rejected rows without their content", () => {
		const result = parseNetscapeSpace(
			[
				".minimax.io FALSE / FALSE 0 test_id test-value",
				"not_a_domain FALSE / FALSE 0 broken broken",
			].join("\n"),
		);
		expect(result.accepted).toBe(1);
		expect(result.rejected).toBe(1);
		expect(result.rejections["invalid-domain"]).toBe(1);
	});
});

describe("a file whose rows are space-separated and do not validate", () => {
	const text = [
		"# an export whose wording is not the canonical one",
		"nonsense words that are not a row",
	].join("\n");

	it("is not a supported format", () => {
		expect(detectFormat(text)).toBeNull();
	});

	it("says why, without a line of the file", () => {
		const diagnosis = diagnoseFormat(text);
		expect(diagnosis.reason).toBe("space-rows-not-valid");
		expect(JSON.stringify(diagnosis)).not.toContain("nonsense");
	});
});

describe("a file with the canonical header and no readable row", () => {
	it("claims the Netscape format and parses to nothing", () => {
		const text = [
			"# Netscape HTTP Cookie File",
			"nonsense words that are not a row",
		].join("\n");
		expect(detectFormat(text)).toBe("netscape");
		const parsed = parseNetscapeDetailed(text, { compatibleFallback: true });
		expect(parsed.cookies).toHaveLength(0);
		expect(parsed.rejected).toBe(1);
	});
});

describe("a file with no rows at all", () => {
	it("says that it holds no rows", () => {
		const diagnosis = diagnoseFormat("# only a comment\n");
		expect(diagnosis.format).toBeNull();
		expect(diagnosis.reason).toBe("no-rows");
	});
});

describe("a file that holds both kinds of rows", () => {
	it("reads the tab rows and the space rows", () => {
		const text = [
			"# Netscape HTTP Cookie File",
			".minimax.io\tFALSE\t/\tFALSE\t0\ttest_tab\ttab-value",
			".minimax.io FALSE / FALSE 0 test_space space-value",
		].join("\n");

		expect(detectFormat(text)).toBe("netscape");
		const parsed = parseNetscapeDetailed(text, { compatibleFallback: true });
		expect(parsed.accepted).toBe(2);
		const names = parsed.cookies.map((c) => c.name).sort();
		expect(names).toEqual(["test_space", "test_tab"]);
	});
});

describe("the strict parser without the fallback", () => {
	it("keeps its documented behaviour", () => {
		const text = ".minimax.io FALSE / FALSE 0 test_space space-value";
		const parsed = parseNetscapeDetailed(text);
		expect(parsed.cookies).toHaveLength(0);
		expect(parsed.rejected).toBe(1);
	});
});

describe("the normalizer", () => {
	it("drops an expired cookie of the space variant", () => {
		const result = parseNetscapeSpace(
			".minimax.io FALSE / FALSE 100 test_old old-value",
		);
		const normalized = normalize(result.cookies, "minimax", 1_000_000);
		expect(normalized).toHaveLength(0);
	});

	it("drops a cookie whose domain belongs to another provider", () => {
		const result = parseNetscapeSpace(
			".example.com FALSE / FALSE 0 test_other other-value",
		);
		const normalized = normalize(result.cookies, "minimax", 1_000);
		expect(normalized).toHaveLength(0);
	});

	it("keeps a valid cookie of the space variant", () => {
		const result = parseNetscapeSpace(
			".minimax.io FALSE / FALSE 0 test_ok ok-value",
		);
		const normalized = normalize(result.cookies, "minimax", 1_000);
		expect(normalized).toHaveLength(1);
		expect(normalized[0]?.value).toBe("ok-value");
		expect(normalized[0]?.provider).toBe("minimax");
	});
});

describe("the diagnostics", () => {
	it("never carry a cookie value", () => {
		const text = [
			"# Netscape HTTP Cookie File",
			`nonsense row with ${SECRET} inside`,
		].join("\n");
		const diagnosis = diagnoseFormat(text);
		expect(JSON.stringify(diagnosis)).not.toContain(SECRET);
	});

	it("never carry a cookie name", () => {
		const text = [
			"# Netscape HTTP Cookie File",
			"broken_row_without_a_valid_domain value",
		].join("\n");
		const diagnosis = diagnoseFormat(text);
		expect(JSON.stringify(diagnosis)).not.toContain("broken_row_without_a_valid_domain");
	});
});
