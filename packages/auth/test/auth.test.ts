/**
 * Auth Tests — Filesystem helpers and pure functions (no browser required)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
	detectUsagePage,
	extractUsageLines,
	getRuntimeDir,
	getProfileDir,
	getStatusPath,
	getLiveSessionPath,
	saveAuthStatus,
	loadLiveBrowserSession,
} from "../src/minimax-browser-auth";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TMP = join(process.cwd(), ".test-auth-tmp");

function tmpStatus() { return join(TMP, "auth-status.json"); }
function tmpLiveSession() { return join(TMP, "live-session.json"); }

beforeEach(() => {
	rmSync(TMP, { force: true, recursive: true });
	mkdirSync(TMP, { recursive: true });
});

describe("path helpers", () => {
	it("getRuntimeDir returns a path with pi-harness-runtime", () => {
		expect(getRuntimeDir()).toContain(".pi-harness-runtime");
	});

	it("getProfileDir is under runtime dir", () => {
		expect(getProfileDir()).toStartWith(getRuntimeDir());
		expect(getProfileDir()).toContain("minimax");
	});

	it("getStatusPath is under runtime dir", () => {
		expect(getStatusPath()).toStartWith(getRuntimeDir());
		expect(getStatusPath()).toContain("auth");
	});

	it("getLiveSessionPath contains session file name", () => {
		expect(getLiveSessionPath()).toContain("minimax-live-browser");
	});
});

describe("saveAuthStatus", () => {
	beforeEach(() => {
		rmSync(TMP, { force: true, recursive: true });
		mkdirSync(TMP, { recursive: true });
	});

	it("writes a status file", () => {
		const status = {
			provider: "minimax" as const,
			authenticated: true,
			checked_at: "2025-01-15T10:00:00Z",
			page_url: "https://platform.minimax.io/console/usage",
			detected_text_sample: "Usage details",
			profile_path: "/fake/profile",
			usage_lines: ["Token Plan", "Monthly Plus", "Used 71%"],
		};
		saveAuthStatus(status, { statusPath: tmpStatus() });
		expect(existsSync(tmpStatus())).toBe(true);
		let loaded: any;
		try { loaded = JSON.parse(readFileSync(tmpStatus(), "utf-8")); }
		catch { throw new Error("saveAuthStatus did not write valid JSON"); }
		expect(loaded.authenticated).toBe(true);
		expect(loaded.provider).toBe("minimax");
		expect(loaded.usage_lines).toHaveLength(3);
	});

	it("round-trips an unauthenticated status", () => {
		const status = {
			provider: "minimax" as const,
			authenticated: false,
			checked_at: "2025-01-15T10:00:00Z",
			page_url: "",
			detected_text_sample: null,
			profile_path: "/fake/profile",
			error_message: "Session expired",
		};
		saveAuthStatus(status, { statusPath: tmpStatus() });
		let loaded: any;
		try { loaded = JSON.parse(readFileSync(tmpStatus(), "utf-8")); }
		catch { throw new Error("saveAuthStatus did not write valid JSON"); }
		expect(loaded.authenticated).toBe(false);
		expect(loaded.error_message).toBe("Session expired");
	});

	it("creates parent directories", () => {
		const nestedPath = join(TMP, "deeply", "nested", "status.json");
		saveAuthStatus({ provider: "minimax" as const, authenticated: false, checked_at: "", page_url: "", detected_text_sample: null, profile_path: "/" } as any, { statusPath: nestedPath });
		expect(existsSync(nestedPath)).toBe(true);
	});
});

describe("loadLiveBrowserSession", () => {
	beforeEach(() => {
		rmSync(TMP, { force: true, recursive: true });
		mkdirSync(TMP, { recursive: true });
	});

	it("loads a saved session", () => {
		const session = {
			profile_path: "/tmp/chrome-profile",
			target_url: "https://platform.minimax.io/console/usage",
			chrome_path: "/usr/bin/google-chrome",
			debugging_port: 9222,
			pid: 12345,
			started_at: "2025-01-15T10:00:00Z",
		};
		writeFileSync(tmpLiveSession(), JSON.stringify(session));
		const loaded = loadLiveBrowserSession(tmpLiveSession());
		expect(loaded?.debugging_port).toBe(9222);
		expect(loaded?.pid).toBe(12345);
		expect(loaded?.profile_path).toBe("/tmp/chrome-profile");
	});

	it("returns null for missing file", () => {
		const loaded = loadLiveBrowserSession(join(TMP, "not-found.json"));
		expect(loaded).toBeNull();
	});

	it("returns null for corrupted JSON", () => {
		writeFileSync(tmpLiveSession(), "not json {");
		const loaded = loadLiveBrowserSession(tmpLiveSession());
		expect(loaded).toBeNull();
	});
});

describe("detectUsagePage", () => {
	it("detects page with usage keywords", () => {
		const body = "Your Usage: 5h limit, resets in 1 hour. Weekly limit used 71%. Token Plan · Monthly Plus";
		const result = detectUsagePage(body);
		expect(result.detected).toBe(true);
		expect(result.sample).not.toBeNull();
		expect(result.sample!.length).toBeGreaterThan(0);
	});

	it("does not detect page with few keywords", () => {
		const body = "Welcome to our website. This is a generic page with no usage information.";
		const result = detectUsagePage(body);
		expect(result.detected).toBe(false);
		expect(result.sample).toBeNull();
	});

	it("triggers on 2+ matching keywords", () => {
		const body = "Usage Quota limit exceeded";
		const result = detectUsagePage(body);
		expect(result.detected).toBe(true);
	});

	it("sample is truncated to 200 chars", () => {
		const body = "A".repeat(300) + " special_usage_keyword_here and another_token";
		const result = detectUsagePage(body);
		expect(result.detected).toBe(true);
		expect(result.sample!.length).toBeLessThanOrEqual(200);
	});

	it("case insensitive matching", () => {
		const body = "USAGE QUOTA TOKEN PLAN CREDITS";
		const result = detectUsagePage(body);
		expect(result.detected).toBe(true);
	});

	it("empty body returns not detected", () => {
		const result = detectUsagePage("");
		expect(result.detected).toBe(false);
	});
});

describe("extractUsageLines", () => {
	it("extracts lines with usage keywords", () => {
		const body = "<div>Your Token Plan</div><span>Monthly Plus</span><p>Used 71%</p>";
		const lines = extractUsageLines(body);
		expect(lines.length).toBeGreaterThan(0);
	});

	it("strips script and style tags", () => {
		const body = "<script>{\"secret\": true}</script><style>body{}</style>Visible content usage quota 71%";
		const lines = extractUsageLines(body);
		expect(lines.some((l) => l.includes("secret"))).toBe(false);
	});

	it("filters out overly short parts", () => {
		const body = "ab cd ef gh ij usage token";
		const lines = extractUsageLines(body);
		for (const l of lines) {
			expect(l.length).toBeGreaterThanOrEqual(3);
		}
	});

	it("returns array for content-free input", () => {
		const lines = extractUsageLines("<html><body></body></html>");
		expect(Array.isArray(lines)).toBe(true);
	});

	it("deduplicates results", () => {
		const body = "usage token 71% usage token 71%";
		const lines = extractUsageLines(body);
		const unique = [...new Set(lines)];
		expect(lines.length).toBe(unique.length);
	});
});
