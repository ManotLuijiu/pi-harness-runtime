/**
 * Harness custom footer — Pi footer information plus dedicated harness rows.
 *
 * Why a custom footer component is required:
 *
 * Pi's built-in footer renders EVERY `ctx.ui.setStatus()` value on ONE shared
 * line (all keys are joined with a space and the result is truncated to the
 * terminal width). Separate status keys therefore do NOT create separate rows:
 * the harness publishes its quota under `harness-runtime` and the workspace
 * environment under `harness-workspace`, so both ended up appended to the same
 * line, and a narrow terminal truncated the workspace summary away.
 *
 * This component mirrors Pi's built-in footer layout (working directory and
 * branch, token/cost/context stats, model and thinking state, other
 * extensions' status values) and then renders each harness-owned status on its
 * OWN row, so the quota keeps a dedicated row and the workspace summary can
 * never be hidden by the quota text.
 *
 * Reference for the replicated layout: pi-coding-agent 1.3.0
 * `dist/modes/interactive/components/footer.js`.
 */

import type {
	ExtensionContext,
	ReadonlyFooterDataProvider,
	Theme,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { isAbsolute, relative, sep } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Component, TUI } from "@earendil-works/pi-tui";

/** Status key that carries the harness quota summary. */
export const HARNESS_QUOTA_STATUS_KEY = "harness-runtime";

/** Status key that carries the workspace environment summary. */
export const HARNESS_WORKSPACE_STATUS_KEY = "harness-workspace";

/** Status key that carries the auto-continue state. */
export const HARNESS_AUTO_CONTINUE_STATUS_KEY = "harness-auto-continue";

export interface HarnessFooterOptions {
	/** Status key holding the quota summary (own row). */
	quotaStatusKey?: string;
	/** Status key holding the workspace environment summary (own row). */
	workspaceStatusKey?: string;
	/** Status key holding the auto-continue state (own row). */
	autoContinueStatusKey?: string;
	/**
	 * Supplies the live extension context. May throw when the session was
	 * replaced — the footer degrades to status-only rows in that case.
	 */
	getContext?: () => ExtensionContext | null;
	/**
	 * Whether the session auto-compacts. Pi's footer only appends " (auto)" to
	 * the context indicator when auto-compaction is enabled.
	 *
	 * NOTE: Pi's ExtensionContext does not expose the session's auto-compact
	 * setting, so the harness cannot read it. The default matches Pi's own
	 * default (`autoCompactEnabled = true` in Pi's footer component); a caller
	 * that knows the real setting can override it.
	 */
	autoCompactEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Session information
// ---------------------------------------------------------------------------

export interface FooterUsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export interface FooterSessionInfo {
	cwd: string;
	branch: string | null;
	sessionName: string | null;
	modelId: string;
	modelProvider: string;
	modelSupportsReasoning: boolean;
	thinkingLevel: string | null;
	usage: FooterUsageTotals;
	cacheHitRate: number | null;
	contextPercent: number | null;
	contextWindow: number;
	providerCount: number;
}

interface RawUsage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { total?: number };
}

function readUsage(raw: unknown): RawUsage | null {
	if (!raw || typeof raw !== "object") return null;
	return raw as RawUsage;
}

function addUsage(totals: FooterUsageTotals, raw: unknown): void {
	const usage = readUsage(raw);
	if (!usage) return;
	totals.input += usage.input ?? 0;
	totals.output += usage.output ?? 0;
	totals.cacheRead += usage.cacheRead ?? 0;
	totals.cacheWrite += usage.cacheWrite ?? 0;
	totals.cost += usage.cost?.total ?? 0;
}

/**
 * Collect cumulative usage from the session entries.
 * Mirrors Pi's footer: usage entries, assistant/tool-result messages,
 * branch summaries and compactions all contribute.
 */
export function collectUsageTotals(entries: readonly unknown[]): {
	usage: FooterUsageTotals;
	cacheHitRate: number | null;
} {
	const usage: FooterUsageTotals = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
	};
	let latestCacheHitRate: number | null = null;

	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const typed = entry as {
			type?: string;
			usage?: unknown;
			message?: { role?: string; usage?: unknown };
		};
		if (typed.type === "usage") {
			addUsage(usage, typed.usage);
			continue;
		}
		if (typed.type === "message") {
			const message = typed.message;
			if (!message || typeof message !== "object") continue;
			if (message.role !== "assistant" && message.role !== "toolResult") continue;
			addUsage(usage, message.usage);
			if (message.role !== "assistant") continue;
			const assistantUsage = readUsage(message.usage);
			if (!assistantUsage) continue;
			// NOTE: the parentheses are load-bearing. Without them this parses as
			// `input ?? (0 + cacheRead + cacheWrite)`, which drops the cached
			// tokens from the denominator and reports a wrong cache-hit rate.
			const promptTokens =
				(assistantUsage.input ?? 0) +
				(assistantUsage.cacheRead ?? 0) +
				(assistantUsage.cacheWrite ?? 0);
			if (promptTokens > 0) {
				latestCacheHitRate = ((assistantUsage.cacheRead ?? 0) / promptTokens) * 100;
			}
			continue;
		}
		if (typed.type === "branch_summary" || typed.type === "compaction") {
			addUsage(usage, typed.usage);
		}
	}

	return { usage, cacheHitRate: latestCacheHitRate };
}

/**
 * Read the session information the footer needs. Every access is guarded:
 * a stale extension context (session replaced / reloaded) must never break
 * the footer rendering.
 */
export function collectSessionInfo(
	ctx: ExtensionContext | null,
	footerData: ReadonlyFooterDataProvider,
): FooterSessionInfo | null {
	if (!ctx) return null;

	// Probe the context for staleness ONCE. A stale extension context throws
	// on property access; reading ctx.mode is the cheapest probe available.
	// When it throws, the whole info is unusable (every field would be empty)
	// and the caller must keep the last known values instead.
	try {
		const mode = ctx.mode;
		if (!mode) return null;
	} catch {
		return null;
	}

	let cwd = "";
	try {
		// Pi's footer uses the session cwd: after a session switch the process
		// cwd can point at a different directory.
		cwd = ctx.sessionManager?.getCwd?.() ?? "";
	} catch {
		// The session cwd is unavailable (stale or not provided) - fall back to
		// the process cwd in its own try.
		cwd = "";
	}
	if (!cwd) {
		try {
			cwd = ctx.cwd ?? "";
		} catch {
			cwd = "";
		}
	}

	let branch: string | null = null;
	try {
		branch = footerData.getGitBranch();
	} catch {
		branch = null;
	}

	let sessionName: string | null = null;
	let entries: readonly unknown[] = [];
	try {
		sessionName = ctx.sessionManager?.getSessionName?.() ?? null;
		entries = ctx.sessionManager?.getEntries?.() ?? [];
	} catch {
		sessionName = null;
		entries = [];
	}

	let modelId = "no-model";
	let modelProvider = "";
	let modelSupportsReasoning = false;
	let contextWindow = 0;
	try {
		const model = ctx.model;
		if (model) {
			modelId = model.id;
			modelProvider = model.provider ?? "";
			modelSupportsReasoning = Boolean((model as { reasoning?: boolean }).reasoning);
			contextWindow = model.contextWindow ?? 0;
		}
	} catch {
		// keep defaults
	}

	let thinkingLevel: string | null = null;
	try {
		thinkingLevel = ctx.thinkingLevel ?? null;
	} catch {
		thinkingLevel = null;
	}

	let contextPercent: number | null = null;
	let contextWindowFromUsage = 0;
	try {
		const contextUsage = ctx.getContextUsage?.();
		if (contextUsage) {
			contextPercent =
				typeof contextUsage.percent === "number" ? contextUsage.percent : null;
			contextWindowFromUsage = contextUsage.contextWindow ?? 0;
		}
	} catch {
		contextPercent = null;
	}

	let providerCount = 1;
	try {
		providerCount = footerData.getAvailableProviderCount() || 1;
	} catch {
		providerCount = 1;
	}

	const { usage, cacheHitRate } = collectUsageTotals(entries);

	// A session replacement between the staleness probe and these reads
	// produces a degenerate info (no cwd, no model). Returning null keeps the
	// caller's last known values instead of blanking the rows.
	if (!cwd && modelId === "no-model") {
		return null;
	}

	return {
		cwd,
		branch,
		sessionName,
		modelId,
		modelProvider,
		modelSupportsReasoning,
		thinkingLevel,
		usage,
		cacheHitRate,
		contextPercent,
		contextWindow: contextWindowFromUsage || contextWindow,
		providerCount,
	};
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Format a token count the way Pi's footer does. */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/**
 * Replace the home directory with `~`, like Pi's footer does.
 *
 * A plain `startsWith(home)` test is wrong: with home `/home/user` the path
 * `/home/userX` is not inside the home directory but would be rendered as
 * `~/X`. Use a relative-path test instead.
 */
export function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home || !cwd) return cwd;
	if (cwd === home) return "~";
	const rel = relative(home, cwd);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return cwd;
	return `~${sep}${rel}`;
}

/** Sanitize a status value so it cannot break the single-line layout. */
export function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

/** A footer row that owns its own line. */
/**
 * Colorize text without ever throwing.
 *
 * Pi's `theme.fg()` throws `Unknown theme color: <name>` for colors that a
 * custom theme does not define. A footer must never break the TUI, so unknown
 * colors degrade to plain text.
 */
function safeFg(theme: Theme, color: ThemeColor, text: string): string {
	try {
		return theme.fg(color, text);
	} catch {
		return text;
	}
}

export interface FooterRow {
	/** Short label used for diagnostics; not rendered. */
	label: string;
	/** Text rendered on the row. */
	text: string;
}

function renderPwdRow(info: FooterSessionInfo, width: number, theme: Theme): string {
	let pwd = formatCwdForFooter(
		info.cwd,
		process.env.HOME || process.env.USERPROFILE,
	);
	if (info.branch) {
		pwd = `${pwd} (${info.branch})`;
	}
	if (info.sessionName) {
		pwd = `${pwd} • ${info.sessionName}`;
	}
	return truncateToWidth(safeFg(theme, "dim", pwd), width, safeFg(theme, "dim", "..."));
}

function renderStatsRow(
	info: FooterSessionInfo,
	width: number,
	theme: Theme,
	autoCompactEnabled: boolean,
): string {
	const statsParts: string[] = [];
	const { usage } = info;
	if (usage.input) statsParts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) statsParts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) statsParts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) statsParts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (
		(usage.cacheRead > 0 || usage.cacheWrite > 0) &&
		info.cacheHitRate !== null
	) {
		statsParts.push(`CH${info.cacheHitRate.toFixed(1)}%`);
	}
	if (usage.cost) statsParts.push(`$${usage.cost.toFixed(3)}`);

	const autoIndicator = autoCompactEnabled ? " (auto)" : "";
	const contextDisplay =
		info.contextPercent === null
			? `?/${formatTokens(info.contextWindow)}${autoIndicator}`
			: `${info.contextPercent.toFixed(1)}%/${formatTokens(info.contextWindow)}${autoIndicator}`;
	let contextPercentStr = contextDisplay;
	if (info.contextPercent !== null) {
		if (info.contextPercent > 90) {
			contextPercentStr = safeFg(theme, "error", contextPercentStr);
		} else if (info.contextPercent > 70) {
			contextPercentStr = safeFg(theme, "warning", contextPercentStr);
		}
	}
	statsParts.push(contextPercentStr);

	let statsLeft = statsParts.join(" ");
	let statsLeftWidth = visibleWidth(statsLeft);
	if (statsLeftWidth > width) {
		statsLeft = truncateToWidth(statsLeft, width, "...");
		statsLeftWidth = visibleWidth(statsLeft);
	}

	const modelName = info.modelId || "no-model";
	let rightSideWithoutProvider = modelName;
	if (info.modelSupportsReasoning) {
		const thinkingLevel = info.thinkingLevel || "off";
		rightSideWithoutProvider =
			thinkingLevel === "off"
				? `${modelName} • thinking off`
				: `${modelName} • ${thinkingLevel}`;
	}

	const minPadding = 2;
	let rightSide = rightSideWithoutProvider;
	if (info.providerCount > 1 && info.modelProvider) {
		rightSide = `(${info.modelProvider}) ${rightSideWithoutProvider}`;
		if (statsLeftWidth + minPadding + visibleWidth(rightSide) > width) {
			rightSide = rightSideWithoutProvider;
		}
	}

	const rightSideWidth = visibleWidth(rightSide);
	const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;
	let statsLine: string;
	if (totalNeeded <= width) {
		const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
		statsLine = statsLeft + padding + rightSide;
	} else {
		const availableForRight = width - statsLeftWidth - minPadding;
		if (availableForRight > 0) {
			const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
			const truncatedRightWidth = visibleWidth(truncatedRight);
			const padding = " ".repeat(
				Math.max(0, width - statsLeftWidth - truncatedRightWidth),
			);
			statsLine = statsLeft + padding + truncatedRight;
		} else {
			statsLine = statsLeft;
		}
	}

	const dimStatsLeft = safeFg(theme, "dim", statsLeft);
	const remainder = statsLine.slice(statsLeft.length);
	const dimRemainder = safeFg(theme, "dim", remainder);
	return dimStatsLeft + dimRemainder;
}

/**
 * Build the footer rows.
 *
 * Row order:
 *   1. working directory (+ branch, session name)
 *   2. token/cost/context stats (+ model, thinking state)
 *   3. harness quota (own row)
 *   4. workspace environment (own row)
 *   5. auto-continue state (own row, when present)
 *   6. other extensions' status values (shared row, as in Pi)
 */
export function renderFooterRows(
	info: FooterSessionInfo | null,
	rows: readonly FooterRow[],
	width: number,
	theme: Theme,
	autoCompactEnabled = true,
): string[] {
	const lines: string[] = [];

	if (info) {
		lines.push(renderPwdRow(info, width, theme));
		lines.push(renderStatsRow(info, width, theme, autoCompactEnabled));
	}

	for (const row of rows) {
		const text = sanitizeStatusText(row.text);
		if (!text) continue;
		lines.push(truncateToWidth(text, width, safeFg(theme, "dim", "...")));
	}

	return lines;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Create the harness footer component.
 *
 * The component reads the live extension context on every render (through
 * `options.getContext`) so it never holds a stale session, and reads the
 * harness status values from the footer data provider so the quota and the
 * workspace summary are always rendered from the same source the built-in
 * footer would use.
 */
export function createHarnessFooter(
	_tui: TUI,
	theme: Theme,
	footerData: ReadonlyFooterDataProvider,
	options: HarnessFooterOptions = {},
): Component & { dispose?(): void } {
	const quotaKey = options.quotaStatusKey ?? HARNESS_QUOTA_STATUS_KEY;
	const workspaceKey = options.workspaceStatusKey ?? HARNESS_WORKSPACE_STATUS_KEY;
	const autoContinueKey =
		options.autoContinueStatusKey ?? HARNESS_AUTO_CONTINUE_STATUS_KEY;
	const getContext = options.getContext ?? (() => null);
	const autoCompactEnabled = options.autoCompactEnabled ?? true;

	// Last successfully collected session info. A stale extension context
	// (session replaced / reloaded) must not blank the footer rows - the last
	// known values are kept until a fresh context is available.
	let lastGoodInfo: FooterSessionInfo | null = null;

	return {
		render(width: number): string[] {
			let statuses: ReadonlyMap<string, string>;
			try {
				statuses = footerData.getExtensionStatuses();
			} catch {
				statuses = new Map();
			}

			let info: FooterSessionInfo | null = null;
			try {
				info = collectSessionInfo(getContext(), footerData);
			} catch {
				info = null;
			}
			if (info) {
				lastGoodInfo = info;
			} else {
				info = lastGoodInfo;
			}

			const rows: FooterRow[] = [];
			const quota = statuses.get(quotaKey);
			if (quota) rows.push({ label: "quota", text: quota });
			const workspace = statuses.get(workspaceKey);
			if (workspace) rows.push({ label: "workspace", text: workspace });
			const autoContinue = statuses.get(autoContinueKey);
			if (autoContinue) rows.push({ label: "auto-continue", text: autoContinue });

			const otherStatuses = Array.from(statuses.entries())
				.filter(
					([key]) =>
						key !== quotaKey &&
						key !== workspaceKey &&
						key !== autoContinueKey,
				)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text))
				.filter(Boolean)
				.join(" ");
			if (otherStatuses) {
				rows.push({ label: "extensions", text: otherStatuses });
			}

			try {
				return renderFooterRows(info, rows, width, theme, autoCompactEnabled);
			} catch {
				// Last-resort: never let the footer break the TUI.
				return rows.map((row) =>
					truncateToWidth(sanitizeStatusText(row.text), width, "..."),
				);
			}
		},
		invalidate(): void {
			// The footer reads live state on every render.
		},
		dispose(): void {
			// No persistent resources.
		},
	};
}
