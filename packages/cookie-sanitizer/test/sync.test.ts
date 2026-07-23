/**
 * End-to-end sync tests.
 *
 * Build a synthetic drop folder in a tmp dir, call sync(), assert
 * the canonical cache was written correctly. No real cookie values
 * are used.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	rmSync,
	existsSync,
	readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	sync,
	hasAnyCookieSource,
	inferCachePath,
	DEFAULT_DROP_DIR,
} from "../src/sync.js";
import { parseNetscape } from "../src/parse-netscape.js";

const NETSCAPE_FIXTURE = [
	"# Netscape HTTP Cookie File",
	"# Test fixture for sync.test.ts",
	".minimax.io\tFALSE\t/\tFALSE\t0\ttest_id\ttest-value-id",
	"#HttpOnly_.minimax.io\tFALSE\t/\tTRUE\t0\ttest_token\ttest-value-token",
	"",
].join("\n");

const JSON_FIXTURE = JSON.stringify([
	{
		domain: ".minimax.io",
		expirationDate: 1700000000,
		name: "test_json",
		value: "test-value-json",
		httpOnly: false,
		secure: true,
	},
]);

let TMP_ROOT: string;

beforeEach(() => {
	TMP_ROOT = mkdtempSync(join(tmpdir(), "cookie-sanitizer-test-"));
});

afterEach(() => {
	if (TMP_ROOT) rmSync(TMP_ROOT, { force: true, recursive: true });
});

/** Per-test drop folder under TMP_ROOT. */
function freshDropDir(): string {
	const sub = join(TMP_ROOT, "drop");
	rmSync(sub, { force: true, recursive: true });
	mkdirSync(sub, { recursive: true });
	return sub;
}

describe("sync()", () => {
	it("writes a canonical cache from a Netscape drop file", () => {
		const drop = freshDropDir();
		const cache = join(drop, "out.txt");
		writeFileSync(join(drop, "minimax.txt"), NETSCAPE_FIXTURE);

		const result = sync({ dropDir: drop, cachePath: cache });

		expect(result.provider).toBe("minimax");
		expect(result.processedFiles).toContain("minimax.txt");
		expect(result.skippedFiles).toEqual([]);
		expect(result.wrote).toBe(true);
		expect(result.totalCookies).toBe(2);
		expect(result.cachePath).toBe(cache);
		expect(existsSync(cache)).toBe(true);

		const back = parseNetscape(readFileSync(cache, "utf8"));
		expect(back).toHaveLength(2);
		const names = back.map((c) => c.name).sort();
		expect(names).toEqual(["test_id", "test_token"]);
	});

	it("writes a canonical cache from a JSON drop file", () => {
		const drop = freshDropDir();
		const cache = join(drop, "out.txt");
		writeFileSync(join(drop, "minimax.json"), JSON_FIXTURE);

		const result = sync({ dropDir: drop, cachePath: cache });

		expect(result.provider).toBe("minimax");
		expect(result.totalCookies).toBe(1);
		expect(result.wrote).toBe(true);
		const back = parseNetscape(readFileSync(cache, "utf8"));
		expect(back[0]?.name).toBe("test_json");
	});

	it("merges multiple files (Netscape + JSON) and dedupes", () => {
		const drop = freshDropDir();
		const cache = join(drop, "out.txt");
		writeFileSync(join(drop, "minimax.txt"), NETSCAPE_FIXTURE);
		writeFileSync(join(drop, "extra.json"), JSON_FIXTURE);

		const result = sync({ dropDir: drop, cachePath: cache });
		expect(result.totalCookies).toBe(3);
		expect(result.processedFiles.sort()).toEqual(["extra.json", "minimax.txt"]);
	});

	it("skips files with unknown format and reports them", () => {
		const drop = freshDropDir();
		const cache = join(drop, "out.txt");
		writeFileSync(join(drop, "minimax.txt"), NETSCAPE_FIXTURE);
		writeFileSync(join(drop, "garbage.txt"), "this is not a cookie file");

		const result = sync({ dropDir: drop, cachePath: cache });
		expect(result.wrote).toBe(true);
		expect(result.totalCookies).toBe(2);
		expect(
			result.skippedFiles.find((f) => f.basename === "garbage.txt"),
		).toBeTruthy();
	});

	it("skips editor temp files and dotfiles", () => {
		const drop = freshDropDir();
		const cache = join(drop, "out.txt");
		writeFileSync(join(drop, "minimax.txt"), NETSCAPE_FIXTURE);
		writeFileSync(join(drop, ".hidden"), NETSCAPE_FIXTURE);
		writeFileSync(join(drop, "minimax.swp"), NETSCAPE_FIXTURE);
		writeFileSync(join(drop, "minimax~"), NETSCAPE_FIXTURE);

		const result = sync({ dropDir: drop, cachePath: cache });
		expect(result.processedFiles).toEqual(["minimax.txt"]);
	});

	it("excludes the canonical cache file from input", () => {
		const drop = freshDropDir();
		const cache = join(drop, "out.txt");
		writeFileSync(join(drop, "minimax.txt"), NETSCAPE_FIXTURE);
		// Pre-write the cache to simulate a previous run.
		writeFileSync(cache, NETSCAPE_FIXTURE);

		const result = sync({ dropDir: drop, cachePath: cache });
		// The cache file itself was excluded from input; only minimax.txt was read.
		expect(result.processedFiles).toEqual(["minimax.txt"]);
	});

	it("returns null provider when inference fails", () => {
		const drop = freshDropDir();
		const cache = join(drop, "out.txt");
		// Name and domain that don't match any known provider.
		writeFileSync(
			join(drop, "random.txt"),
			"# Netscape HTTP Cookie File\n.example.com\tFALSE\t/\tFALSE\t0\tn1\tv1\n",
		);
		const result = sync({ dropDir: drop, cachePath: cache });
		expect(result.provider).toBe(null);
		expect(result.wrote).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it("dryRun=true does not write the cache", () => {
		const drop = freshDropDir();
		const cache = join(drop, "out.txt");
		writeFileSync(join(drop, "minimax.txt"), NETSCAPE_FIXTURE);
		const result = sync({ dropDir: drop, cachePath: cache, dryRun: true });
		expect(result.wrote).toBe(false);
		expect(result.totalCookies).toBe(2);
		expect(existsSync(cache)).toBe(false);
	});

	it("empty drop folder returns an empty result with no errors", () => {
		const drop = freshDropDir();
		const result = sync({ dropDir: drop, cachePath: join(drop, "out.txt") });
		expect(result.processedFiles).toEqual([]);
		expect(result.totalCookies).toBe(0);
		expect(result.wrote).toBe(false);
	});

	it("filters out expired cookies", () => {
		const drop = freshDropDir();
		const cache = join(drop, "out.txt");
		const past = 1; // 1970-01-01
		const text = [
			"# Netscape HTTP Cookie File",
			`.minimax.io\tFALSE\t/\tFALSE\t${past}\texpired\texpired-value`,
			".minimax.io\tFALSE\t/\tFALSE\t0\talive\talive-value",
		].join("\n");
		writeFileSync(join(drop, "minimax.txt"), text);
		const result = sync({ dropDir: drop, cachePath: cache });
		expect(result.totalCookies).toBe(1);
		const back = parseNetscape(readFileSync(cache, "utf8"));
		expect(back[0]?.name).toBe("alive");
	});
});

describe("hasAnyCookieSource", () => {
	it("returns false for empty folder", () => {
		const drop = freshDropDir();
		expect(hasAnyCookieSource(drop)).toBe(false);
	});
	it("returns true when files exist", () => {
		const drop = freshDropDir();
		writeFileSync(join(drop, "minimax.txt"), NETSCAPE_FIXTURE);
		expect(hasAnyCookieSource(drop)).toBe(true);
	});
});

describe("inferCachePath", () => {
	it("returns null for empty folder", () => {
		const drop = freshDropDir();
		expect(inferCachePath(drop)).toBe(null);
	});
	it("returns the canonical path for the dominant provider", () => {
		const drop = freshDropDir();
		writeFileSync(join(drop, "minimax.txt"), NETSCAPE_FIXTURE);
		const cachePath = inferCachePath(drop);
		expect(cachePath).toBe(
			join(process.env.HOME ?? "/tmp", ".config", "minimax-cookies.txt"),
		);
	});
});

describe("DEFAULT_DROP_DIR", () => {
	it("defaults to ~/.pi-harness-runtime/cookies/", () => {
		const home = process.env.HOME ?? "/tmp";
		expect(DEFAULT_DROP_DIR).toBe(join(home, ".pi-harness-runtime", "cookies"));
	});
});
