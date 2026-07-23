/**
 * Provider inference tests.
 *
 * Three inference passes:
 *   1. filename hint
 *   2. dominant domain (>= 80%)
 *   3. null
 *
 * The `hint` parameter overrides all of the above.
 */

import { describe, it, expect } from "bun:test";
import {
	inferProvider,
	inferProviderFromFilename,
	inferProviderFromCookies,
	knownProviders,
} from "../src/infer-provider.js";
import type { CanonicalCookie } from "../src/types.js";

function cookie(domain: string, name = "n"): CanonicalCookie {
	return {
		name,
		value: "v",
		domain,
		path: "/",
		secure: false,
		httpOnly: false,
	};
}

describe("inferProviderFromFilename", () => {
	it("matches known providers by name fragment", () => {
		expect(inferProviderFromFilename("minimax-cookies.txt")).toBe("minimax");
		expect(inferProviderFromFilename("anthropic-session.json")).toBe(
			"anthropic",
		);
		expect(inferProviderFromFilename("openai-tokens.json")).toBe("openai");
		expect(inferProviderFromFilename("glm-export.json")).toBe("glm");
	});

	it("returns null for unknown names", () => {
		expect(inferProviderFromFilename("random-export.json")).toBe(null);
		expect(inferProviderFromFilename("")).toBe(null);
	});
});

describe("inferProviderFromCookies", () => {
	it("returns provider when ≥ 80% of cookies match one domain", () => {
		const cookies = [
			cookie(".minimax.io"),
			cookie("platform.minimax.io"),
			cookie(".minimax.io"),
			cookie(".minimax.io"),
			cookie(".other.com", "x"),
		];
		// 4/5 = 80% → matches minimax
		expect(inferProviderFromCookies(cookies)).toBe("minimax");
	});

	it("returns null when no single provider dominates", () => {
		const cookies = [
			cookie(".minimax.io", "a"),
			cookie(".anthropic.com", "b"),
			cookie(".openai.com", "c"),
		];
		expect(inferProviderFromCookies(cookies)).toBe(null);
	});

	it("returns null for empty input", () => {
		expect(inferProviderFromCookies([])).toBe(null);
	});
});

describe("inferProvider (combined)", () => {
	it("explicit hint wins over everything", () => {
		const cookies = [cookie(".minimax.io")];
		expect(inferProvider("anthropic.json", cookies, "openai")).toBe("openai");
	});

	it("filename hint wins over domain inference", () => {
		const cookies = [cookie(".openai.com")];
		expect(inferProvider("minimax-2026.json", cookies)).toBe("minimax");
	});

	it("falls through to domain inference when no filename match", () => {
		const cookies = [
			cookie(".anthropic.com"),
			cookie(".anthropic.com"),
			cookie(".anthropic.com"),
			cookie(".anthropic.com"),
		];
		expect(inferProvider("random.txt", cookies)).toBe("anthropic");
	});

	it("returns null when nothing matches", () => {
		expect(inferProvider("random.txt", [cookie(".other.com")])).toBe(null);
	});
});

describe("knownProviders", () => {
	it("returns at least the bundled providers", () => {
		const providers = knownProviders();
		expect(providers).toContain("minimax");
		expect(providers).toContain("anthropic");
		expect(providers).toContain("openai");
		expect(providers).toContain("glm");
		expect(providers).toContain("openrouter");
	});
});
