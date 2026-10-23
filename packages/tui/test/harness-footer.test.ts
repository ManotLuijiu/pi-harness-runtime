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
	wrapStatusText,
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
		cwd: "/home/frappe/pi-harness-runtime",
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
const WORKSPACE =
	"Workspace: ~/pi-harness-runtime | OS: Linux | mode: UNKNOWN (no explicit NODE_ENV)" +
	" | dev server: not detected | dev script: unavailable | build script: available | RAM: 6.4/15";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** A live-looking extension context (cwd, model, usage, context window). */
function makeLiveCtx(overrides: Record<string, unknown> = {}): ExtensionContext {
	return {
		mode: "tui",
		cwd: "/home/frappe/pi-harness-runtime",
		model: { id: "MiniMax-M2", provider: "minimax", contextWindow: 200000 },
		thinkingLevel: "high",
		sessionManager: {
			getCwd: () => "/home/frappe/pi-harness-runtime",
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
		const workspaceIndex = lines.findIndex((line) => line.includes("Workspace:"));
		// The workspace value can wrap over several lines - the fields must
		// all be there.
		const workspaceText = lines.slice(workspaceIndex).join(" ");

		expect(quotaLine).toBeDefined();
		expect(workspaceIndex).toBeGreaterThanOrEqual(0);
		expect(quotaLine).not.toContain("Workspace:");
		expect(workspaceText).not.toContain("MiniMax:");
		expect(workspaceText).toContain("Workspace:");
		expect(workspaceText).toContain("OS: Linux");
		expect(workspaceText).toContain("dev server:");
		expect(workspaceText).toContain("build script:");
		expect(workspaceText).toContain("RAM:");
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
				getCwd: () => "/home/frappe/pi-harness-runtime",
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
		// The quota row is still there.
		const quotaLine = lines.find((line) => line.includes("MiniMax:"));
		expect(quotaLine).toBeDefined();
		expect(quotaLine?.length ?? 0).toBeGreaterThan(0);
	});

	it("wraps the workspace row instead of hiding the fields that do not fit", () => {
		const footer = createHarnessFooter(
			{} as never,
			plainTheme,
			makeFooterData({
				"harness-runtime": QUOTA,
				"harness-workspace": WORKSPACE,
			}),
		);

		const lines = footer.render(40);
		const start = lines.findIndex((line) => line.includes("Workspace:"));
		expect(start).toBeGreaterThanOrEqual(0);
		// The workspace value continues on the following lines until the
		// quota row starts - no field may be cut away.
		const workspaceLines: string[] = [];
		for (let i = start; i < lines.length; i++) {
			if (lines[i].includes("MiniMax:")) break;
			workspaceLines.push(lines[i]);
		}
		const joined = workspaceLines.join(" ");
		expect(joined).toContain("OS: Linux");
		expect(joined).toContain("dev server: not detected");
		expect(joined).toContain("RAM: 6.4/15");
		// Every line stays inside the terminal width.
		for (const line of workspaceLines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(40);
		}
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
	it("keeps a short status on one line", () => {
		expect(wrapStatusText("Workspace: ~/app | OS: Linux", 120)).toEqual([
			"Workspace: ~/app | OS: Linux",
		]);
	});

	it("breaks a long status at the field borders and keeps every line inside the width", () => {
		const lines = wrapStatusText("Workspace: ~/app | OS: Linux | RAM: 4/15", 24);

		expect(lines.length).toBeGreaterThan(1);
		expect(lines[0]).toContain("Workspace:");
		expect(lines.slice(1).join(" ")).toContain("RAM: 4/15");
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(24);
		}
	});

	it("breaks a word that is longer than the width", () => {
		const lines = wrapStatusText(
			"Workspace: /home/frappe/a-very-long-directory-name/pi-harness-runtime",
			20,
			0,
		);

		expect(lines.length).toBeGreaterThan(1);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(20);
		}
		expect(lines.join("")).toContain("pi-harness-runtime");
	});

	it("caps the number of lines and truncates the last one", () => {
		const lines = wrapStatusText(
			"Workspace: ~/app | OS: Linux | mode: UNKNOWN (no explicit NODE_ENV) | RAM: 4/15",
			24,
			2,
		);

		expect(lines.length).toBe(2);
		expect(visibleWidth(lines[1]!)).toBeLessThanOrEqual(24);
	});

	it("says that the summary is incomplete when lines are dropped", () => {
		const lines = wrapStatusText(
			"Workspace: ~/app | OS: Linux | mode: UNKNOWN (no explicit NODE_ENV) | dev server: not detected | RAM: 4/15",
			24,
			2,
		);

		expect(lines.length).toBe(2);
		// The marker survives the truncation - the user must be able to see
		// that the summary is incomplete.
		expect(lines[1]).toContain("more)");
		expect(visibleWidth(lines[1]!)).toBeLessThanOrEqual(24);
	});

	it("wraps a single field that is longer than the width", () => {
		const lines = wrapStatusText("mode: UNKNOWN (no explicit NODE_ENV)", 20);

		expect(lines.length).toBeGreaterThan(1);
		expect(lines.join(" ")).toContain("NODE_ENV");
	});

	it("renders one row per harness status", () => {
		const lines = renderFooterRows(
			makeSessionInfo(),
			[
				{ label: "quota", text: QUOTA },
				{ label: "workspace", text: WORKSPACE, maxLines: 8 },
			],
			120,
			plainTheme,
		);

		// pwd + stats + quota + workspace (the workspace value wraps when it
		// does not fit into the width).
		expect(lines.length).toBeGreaterThanOrEqual(4);
		expect(lines[2]).toBe(QUOTA);
		expect(lines[3]).toContain("Workspace:");
		expect(lines.slice(3).join(" ")).toContain("RAM: 6.4/15");
	});

	it("keeps a short row on one line", () => {
		const lines = renderFooterRows(
			makeSessionInfo(),
			[
				{
					label: "quota",
					text: `${QUOTA} ${"x".repeat(200)}`,
				},
			],
			40,
			plainTheme,
		);

		// pwd + stats + ONE quota row (truncated, not wrapped).
		expect(lines.length).toBe(3);
		expect(visibleWidth(lines[2]!)).toBeLessThanOrEqual(40);
	});

	it("collapses the home directory to ~", () => {
		expect(formatCwdForFooter("/home/frappe/project", "/home/frappe")).toBe(
			"~/project",
		);
		expect(formatCwdForFooter("/home/frappe", "/home/frappe")).toBe("~");
		expect(formatCwdForFooter("/opt/work", "/home/frappe")).toBe("/opt/work");
		// A sibling directory that merely shares the home prefix is NOT in home.
		expect(formatCwdForFooter("/home/frappeX", "/home/frappe")).toBe(
			"/home/frappeX",
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
