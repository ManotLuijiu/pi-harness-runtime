/**
 * Unit tests for harness-footer.ts
 *
 * Tests cover the acceptance criteria of the harness footer:
 * - the MiniMax quota keeps its own row and the workspace summary gets a
 *   distinct row (never appended to the quota text)
 * - the workspace row survives narrow terminals (the quota row is truncated
 *   instead)
 * - Pi's footer information (cwd/branch, token stats, cost, context usage,
 *   model/thinking state) is still rendered
 * - other extensions' status values remain visible
 * - a stale extension context degrades gracefully instead of breaking the TUI
 *
 * Run with: bun test packages/tui/test/harness-footer.test.ts
 */

// The test file lives outside the package tsconfig (`include: src/**/*`), so
// the `bun:test` module declaration is pulled in explicitly.
/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test";
import type {
	ExtensionContext,
	ReadonlyFooterDataProvider,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	createHarnessFooter,
	formatCwdForFooter,
	renderFooterRows,
	type FooterSessionInfo,
} from "../src/harness-footer.js";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** Theme stub without ANSI escapes so assertions stay readable. */
const plainTheme = {
	fg: (_token: string, text: string) => text,
} as unknown as Theme;

function makeFooterData(statuses: Record<string, string>): ReadonlyFooterDataProvider {
	const map = new Map(Object.entries(statuses));
	return {
		getGitBranch: () => "main",
		getExtensionStatuses: () => map,
		getAvailableProviderCount: () => 1,
		onBranchChange: () => () => {},
	} as unknown as ReadonlyFooterDataProvider;
}

function makeSessionInfo(overrides: Partial<FooterSessionInfo> = {}): FooterSessionInfo {
	return {
		cwd: "/home/user/pi-harness-runtime",
		branch: "main",
		sessionName: null,
		modelId: "MiniMax-M2",
		modelProvider: "minimax",
		modelSupportsReasoning: false,
		thinkingLevel: null,
		usage: {
			input: 1200,
			output: 340,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0.12,
		},
		cacheHitRate: null,
		contextPercent: 34.2,
		contextWindow: 200000,
		providerCount: 1,
		...overrides,
	};
}

const QUOTA = "MiniMax: 5h: 98% left (resets 3 hr 15 min) - week: 85% left";
const WORKSPACE = "Workspace: DEV | dev server: running | build: explicit request | RAM: 6.4/15";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** A live-looking extension context (cwd, model, usage, context window). */
function makeLiveCtx(overrides: Record<string, unknown> = {}): ExtensionContext {
	return {
		mode: "tui",
		cwd: "/home/user/pi-harness-runtime",
		model: { id: "MiniMax-M2", provider: "minimax", contextWindow: 200000 },
		thinkingLevel: "high",
		sessionManager: {
			getCwd: () => "/home/user/pi-harness-runtime",
			getSessionName: () => "session-1",
			getEntries: () => [
				{
					type: "message",
					message: {
						role: "assistant",
						usage: {
							input: 100,
							output: 20,
							cacheRead: 0,
							cacheWrite: 0,
							cost: { total: 0.01 },
						},
					},
				},
			],
		},
		getContextUsage: () => ({ percent: 12.5, contextWindow: 200000 }),
		...overrides,
	} as unknown as ExtensionContext;
}

describe("harness footer rows", () => {
	it("puts the quota and the workspace summary on separate rows", () => {
		const footer = createHarnessFooter(
			{} as never,
			plainTheme,
			makeFooterData({
				"harness-runtime": QUOTA,
				"harness-workspace": WORKSPACE,
			}),
		);

		const lines = footer.render(120);
		const quotaLine = lines.find((line) => line.includes("MiniMax: 5h:"));
		const workspaceLine = lines.find((line) => line.includes("Workspace:"));

		expect(quotaLine).toBeDefined();
		expect(workspaceLine).toBeDefined();
		expect(quotaLine).not.toBe(workspaceLine);
		expect(quotaLine).not.toContain("Workspace:");
		expect(workspaceLine).not.toContain("MiniMax:");
		expect(workspaceLine).toContain("Workspace:");
		expect(workspaceLine).toContain("dev server:");
		expect(workspaceLine).toContain("build:");
		expect(workspaceLine).toContain("RAM:");
	});

	it("keeps Pi's footer information (cwd, branch, stats, model)", () => {
		const footer = createHarnessFooter(
			{} as never,
			plainTheme,
			makeFooterData({ "harness-runtime": QUOTA }),
			{ getContext: () => makeLiveCtx() },
		);

		const lines = footer.render(160);
		// Row 0: working directory + branch (+ session name).
		expect(lines[0]).toContain("pi-harness-runtime");
		expect(lines[0]).toContain("main");
		expect(lines[0]).toContain("session-1");
		// Row 1: token/cost/context stats + model.
		expect(lines[1]).toContain("↑100");
		expect(lines[1]).toContain("↓20");
		expect(lines[1]).toContain("$0.010");
		expect(lines[1]).toContain("12.5%");
		expect(lines[1]).toContain("MiniMax-M2");
		// The quota still gets its own row.
		expect(lines[2]).toContain("MiniMax:");
	});

	it("keeps the harness status keys out of the shared extensions row", () => {
		const footer = createHarnessFooter(
			{} as never,
			plainTheme,
			makeFooterData({
				"harness-runtime": QUOTA,
				"harness-workspace": WORKSPACE,
				"harness-auto-continue": "auto-continue: CONTINUING",
				"other-extension": "other-extension-status",
			}),
		);

		const lines = footer.render(200);
		const sharedRow = lines.find((line) =>
			line.includes("other-extension-status"),
		);
		expect(sharedRow).toBeDefined();
		// The shared row carries only the OTHER extensions' values.
		expect(sharedRow).not.toContain("MiniMax:");
		expect(sharedRow).not.toContain("Workspace:");
		expect(sharedRow).not.toContain("CONTINUING");
		// Each harness value has its own row.
		expect(lines.some((line) => line.includes("MiniMax:"))).toBe(true);
		expect(lines.some((line) => line.includes("Workspace:"))).toBe(true);
		const autoRow = lines.find((line) => line.includes("CONTINUING"));
		expect(autoRow).toBeDefined();
		expect(autoRow).not.toContain("other-extension-status");
	});

	it("computes the cache-hit rate from input + cached tokens", () => {
		// Regression: `input ?? 0 + cacheRead + cacheWrite` parses as
		// `input ?? (0 + cacheRead + cacheWrite)` and reported CH9000.0%.
		const ctx = makeLiveCtx({
			sessionManager: {
				getCwd: () => "/home/user/pi-harness-runtime",
				getSessionName: () => "session-1",
				getEntries: () => [
					{
						type: "message",
						message: {
							role: "assistant",
							usage: {
								input: 100,
								output: 20,
								cacheRead: 9000,
								cacheWrite: 0,
								cost: { total: 0.01 },
							},
						},
					},
				],
			},
		});

		const footer = createHarnessFooter(
			{} as never,
			plainTheme,
			makeFooterData({}),
			{ getContext: () => ctx },
		);

		const lines = footer.render(200);
		expect(lines[1]).toContain("CH98.9%");
		expect(lines[1]).not.toContain("CH9000");
	});

	it("keeps the last known session rows when the context goes stale", () => {
		let stale = false;
		const footer = createHarnessFooter(
			{} as never,
			plainTheme,
			makeFooterData({ "harness-runtime": QUOTA }),
			{
				getContext: () => {
					if (stale) throw new Error("This extension ctx is stale");
					return makeLiveCtx();
				},
			},
		);

		const before = footer.render(160);
		expect(before[0]).toContain("pi-harness-runtime");

		stale = true;
		const after = footer.render(160);
		// The cwd/model rows survive the stale context.
		expect(after[0]).toContain("pi-harness-runtime");
		expect(after[1]).toContain("MiniMax-M2");
		expect(after.some((line) => line.includes("MiniMax:"))).toBe(true);
	});

	it("keeps the last known rows when the context throws on property access", () => {
		// The real stale-ctx case: the ctx object still exists but every
		// property access throws ("This extension ctx is stale after session
		// replacement or reload"). The footer must not blank the rows.
		const staleCtx = makeLiveCtx();
		let broken = false;
		const ctxProxy = new Proxy(staleCtx, {
			get(target, prop, receiver) {
				if (broken && prop !== "then") {
					throw new Error("This extension ctx is stale after session replacement or reload...");
				}
				return Reflect.get(target, prop, receiver);
			},
		}) as ExtensionContext;

		const footer = createHarnessFooter(
			{} as never,
			plainTheme,
			makeFooterData({ "harness-runtime": QUOTA }),
			{ getContext: () => ctxProxy },
		);

		const before = footer.render(160);
		expect(before[0]).toContain("pi-harness-runtime");
		expect(before[1]).toContain("MiniMax-M2");

		broken = true;
		const after = footer.render(160);
		expect(after[0]).toContain("pi-harness-runtime");
		expect(after[1]).toContain("MiniMax-M2");
	});

	it("keeps the workspace row visible when the terminal is narrow", () => {
		const footer = createHarnessFooter(
			{} as never,
			plainTheme,
			makeFooterData({
				"harness-runtime": QUOTA,
				"harness-workspace": WORKSPACE,
			}),
		);

		const lines = footer.render(40);
		const workspaceLine = lines.find((line) => line.includes("Workspace:"));
		expect(workspaceLine).toBeDefined();
		// The quota row is truncated instead of eating the workspace row.
		const quotaLine = lines.find((line) => line.includes("MiniMax:"));
		expect(quotaLine).toBeDefined();
		expect(quotaLine!.length).toBeGreaterThan(0);
		expect(visibleWidth(quotaLine!)).toBeLessThanOrEqual(40);
	});

	it("still shows other extensions' status values", () => {
		const footer = createHarnessFooter(
			{} as never,
			plainTheme,
			makeFooterData({
				"harness-runtime": QUOTA,
				"harness-workspace": WORKSPACE,
				"other-extension": "other-extension-status",
			}),
		);

		const lines = footer.render(200);
		expect(lines.some((line) => line.includes("other-extension-status"))).toBe(
			true,
		);
	});

	it("degrades gracefully when the extension context is stale", () => {
		const footer = createHarnessFooter(
			{} as never,
			plainTheme,
			makeFooterData({
				"harness-runtime": QUOTA,
				"harness-workspace": WORKSPACE,
			}),
			{
				getContext: () => {
					throw new Error("This extension ctx is stale");
				},
			},
		);

		const lines = footer.render(120);
		expect(lines.some((line) => line.includes("MiniMax:"))).toBe(true);
		expect(lines.some((line) => line.includes("Workspace:"))).toBe(true);
	});

	it("survives a custom theme that does not define every color", () => {
		const strictTheme = {
			fg: (token: string, text: string) => {
				if (token !== "accent") throw new Error(`Unknown theme color: ${token}`);
				return text;
			},
		} as unknown as Theme;

		const footer = createHarnessFooter(
			{} as never,
			strictTheme,
			makeFooterData({
				"harness-runtime": QUOTA,
				"harness-workspace": WORKSPACE,
			}),
			{ getContext: () => ({}) as ExtensionContext },
		);

		const lines = footer.render(120);
		expect(lines.some((line) => line.includes("MiniMax:"))).toBe(true);
		expect(lines.some((line) => line.includes("Workspace:"))).toBe(true);
	});

	it("renders the session rows from the live context", () => {
		const ctx = makeLiveCtx();

		const footer = createHarnessFooter(
			{} as never,
			plainTheme,
			makeFooterData({ "harness-runtime": QUOTA }),
			{ getContext: () => ctx },
		);

		const lines = footer.render(160);
		expect(lines[0]).toContain("pi-harness-runtime");
		expect(lines[0]).toContain("main");
		expect(lines[1]).toContain("↑100");
		expect(lines[1]).toContain("$0.010");
		expect(lines[1]).toContain("12.5%");
		expect(lines[1]).toContain("MiniMax-M2");
	});
});

describe("harness footer helpers", () => {
	it("renders one row per harness status", () => {
		const lines = renderFooterRows(
			makeSessionInfo(),
			[
				{ label: "quota", text: QUOTA },
				{ label: "workspace", text: WORKSPACE },
			],
			120,
			plainTheme,
		);

		expect(lines.length).toBe(4); // pwd + stats + quota + workspace
		expect(lines[2]).toBe(QUOTA);
		expect(lines[3]).toBe(WORKSPACE);
	});

	it("collapses the home directory to ~", () => {
		expect(formatCwdForFooter("/home/user/project", "/home/user")).toBe(
			"~/project",
		);
		expect(formatCwdForFooter("/home/user", "/home/user")).toBe("~");
		expect(formatCwdForFooter("/opt/work", "/home/user")).toBe("/opt/work");
		// A sibling directory that merely shares the home prefix is NOT in home.
		expect(formatCwdForFooter("/home/userX", "/home/user")).toBe(
			"/home/userX",
		);
	});

	it("renders the context percent with one decimal", () => {
		const lines = renderFooterRows(
			makeSessionInfo({ contextPercent: 34.267 }),
			[],
			160,
			plainTheme,
		);
		expect(lines[1]).toContain("34.3%");
		expect(lines[1]).not.toContain("34.267%");
	});

	it("appends the (auto) indicator only when auto-compact is enabled", () => {
		const withAuto = renderFooterRows(makeSessionInfo(), [], 160, plainTheme, true);
		const withoutAuto = renderFooterRows(
			makeSessionInfo(),
			[],
			160,
			plainTheme,
			false,
		);
		expect(withAuto[1]).toContain("(auto)");
		expect(withoutAuto[1]).not.toContain("(auto)");
	});
});
