/**
 * pi-usage-status — Codex-style /usage status for pi.
 *
 * Slash commands:
 *   /usage         — show full status (model, local tracking, provider mirror)
 *   /usage sync    — open form to manually mirror provider-side quota
 *   /usage today   — focused: this 5h + today (UTC)
 *   /usage week    — focused: this week + lifetime
 *   /usage reset   — clear mirror (forces re-sync)
 *
 * Auto-tracks every assistant message via the message_end event.
 * Stores data in ~/.pi/usage-status/  (override with PI_USAGE_DIR for testing).
 *
 * No build step — Bun runs this .ts file directly.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { UsageTracker } from "./tracker.ts";
import { MirrorStore, type MirrorRecord } from "./mirror.ts";
import { aggregateWindows } from "./windows.ts";
import { renderStatus } from "./renderer.ts";
import { buildMirrorRecord, parseSyncValues } from "./sync-form.ts";

const PROVIDER_DEFAULT = "minimax";      // can be changed via /usage sync form

export default function (pi: ExtensionAPI) {
	const tracker = new UsageTracker();
	const mirrorStore = new MirrorStore();

	// ─── Auto-track every assistant message ──────────────────────────────
	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		const m = event.message as {
			usage?: {
				input?: number;
				output?: number;
				cacheRead?: number;
				cacheWrite?: number;
				cost?: { total?: number };
			};
		};
		if (!m.usage) return;
		tracker.append({
			ts: Date.now(),
			model: ctx.model?.id ?? "unknown",
			input: m.usage.input ?? 0,
			output: m.usage.output ?? 0,
			cache_read: m.usage.cacheRead ?? 0,
			cache_write: m.usage.cacheWrite ?? 0,
			cost: m.usage.cost?.total ?? 0,
		});
	});

	// ─── /usage — show full status ───────────────────────────────────────
	pi.registerCommand("usage", {
		description: "Show Codex-style usage status (local + provider mirror)",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const local = aggregateWindows(tracker.all());
			const mirror = mirrorStore.read();
			const output = renderStatus({
				model: ctx.model?.id ?? null,
				cwd: ctx.cwd ?? process.cwd(),
				local,
				mirror,
				mirrorStore,
				nowMs: Date.now(),
			});
			ctx.ui.notify(output, "info");
		},
	});

	// ─── /usage sync — open form ─────────────────────────────────────────
	pi.registerCommand("usage-sync", {
		description: "Sync provider quota: /usage sync [provider] [h5%,h,h,m,wk%,d,h]",
		getArgumentCompletions: (prefix: string) => {
			const opts = ["minimax", "anthropic", "openai", "openrouter"];
			const filtered = opts.filter((o) => o.startsWith(prefix));
			return filtered.length > 0 ? filtered.map((o) => ({ value: o, label: o })) : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const parts = (args || "").trim().split(/\s+/).filter(Boolean);
			let provider = PROVIDER_DEFAULT;
			let inlineValues = "";
			if (parts.length > 0 && !/^\d/.test(parts[0])) {
				provider = parts[0];
				inlineValues = parts.slice(1).join(" ");
			} else if (parts.length > 0) {
				inlineValues = parts.join(" ");
			}
			await openSyncForm(ctx, mirrorStore, provider, inlineValues);
		},
	});

	// ─── /usage today — focused view ─────────────────────────────────────
	pi.registerCommand("usage-today", {
		description: "Show today's usage + 5h window",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const local = aggregateWindows(tracker.all());
			const lines = [
				" Today's usage",
				"─────────────────────────────────────",
				` Model:       ${ctx.model?.id ?? "unknown"}`,
				` Today:       ${local.today.tokens} tokens · ${local.today.requests} requests · $${local.today.cost.toFixed(4)}`,
				` This 5h:     ${local.five_h.tokens} tokens · ${local.five_h.requests} requests · $${local.five_h.cost.toFixed(4)}`,
				"",
				" Run /usage for full status or /usage sync to mirror provider quota.",
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// ─── /usage week — focused view ──────────────────────────────────────
	pi.registerCommand("usage-week", {
		description: "Show this week's usage + lifetime totals",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const local = aggregateWindows(tracker.all());
			const lines = [
				" This week's usage",
				"─────────────────────────────────────",
				` Model:       ${ctx.model?.id ?? "unknown"}`,
				` This week:   ${local.weekly.tokens} tokens · ${local.weekly.requests} requests · $${local.weekly.cost.toFixed(4)}`,
				` Lifetime:    ${local.lifetime.tokens} tokens · ${local.lifetime.requests} requests · $${local.lifetime.cost.toFixed(4)}`,
				"",
				" Run /usage for full status with provider mirror.",
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// ─── /usage reset — clear mirror ─────────────────────────────────────
	pi.registerCommand("usage-reset", {
		description: "Clear the provider mirror (force re-sync next time)",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const ok = await ctx.ui.confirm(
				"Clear provider mirror?",
				"This will delete ~/.pi/usage-status/mirror.json. Local usage log is preserved.",
			);
			if (!ok) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}
			// Delete mirror file
			try {
				const { unlinkSync, existsSync } = await import("node:fs");
				if (existsSync(mirrorStore["path"] ?? "")) {
					// The path is private; use the JSON path getter via internal logic
					// Cleaner: just unlink the known mirror path
				}
				// Simpler: import getMirrorPath and unlink
				const { getMirrorPath } = await import("./cli.ts");
				unlinkSync(getMirrorPath());
				ctx.ui.notify("Mirror cleared. Run /usage sync to set a new one.", "info");
			} catch (e) {
				ctx.ui.notify(`Failed to clear mirror: ${e}`, "error");
			}
		},
	});

	// ─── Footer status (persistent badge) ────────────────────────────────
	pi.on("session_start", async (_event, ctx) => {
		await refreshFooterStatus(ctx, mirrorStore, tracker);
	});

	pi.on("turn_end", async (_event, ctx) => {
		await refreshFooterStatus(ctx, mirrorStore, tracker);
	});
}

// ──────────────────────────────────────────────────────────────────────
// Helper: refresh persistent footer status with one-line summary
// ──────────────────────────────────────────────────────────────────────
async function refreshFooterStatus(
	ctx: ExtensionCommandContext,
	mirrorStore: MirrorStore,
	tracker: UsageTracker,
) {
	const local = aggregateWindows(tracker.all());
	const mirror = mirrorStore.read();
	const now = Date.now();

	const todayStr = `${(local.today.tokens / 1000).toFixed(1)}k tok · $${local.today.cost.toFixed(3)}`;
	let summary = `today: ${todayStr}`;

	if (mirror?.h5_used_pct !== undefined) {
		const left = Math.max(0, 100 - mirror.h5_used_pct);
		summary += ` · 5h: ${left}% left`;
	}
	if (mirror?.weekly_used_pct !== undefined) {
		const left = Math.max(0, 100 - mirror.weekly_used_pct);
		summary += ` · week: ${left}% left`;
	}

	ctx.ui.setStatus("usage-status", summary);
}

// ──────────────────────────────────────────────────────────────────────
// Helper: open sync form using ctx.ui
//
// Usage:
//   /usage sync                          → prompts for values
//   /usage sync minimax                  → prompts for values
//   /usage sync minimax 6,4,8,73,2,13    → no prompts, uses inline values
//
// Inline format: h5_pct, h5_h, h5_m, weekly_pct, weekly_d, weekly_h
// ──────────────────────────────────────────────────────────────────────
async function openSyncForm(
	ctx: ExtensionCommandContext,
	mirrorStore: MirrorStore,
	provider: string,
	args: string,
) {
	let parsed = parseInlineArgs(args);

	if (!parsed) {
		// Single prompt with comma-separated values
		const placeholder = "e.g. 6,4,8,73,2,13 (h5%, h5h, h5m, wk%, wkd, wkh)";
		const answer = await ctx.ui.input(
			`Sync ${provider} usage — paste as: h5%, h5 reset h, h5 reset m, weekly%, weekly reset d, weekly reset h`,
			placeholder,
		);
		if (!answer) {
			ctx.ui.notify("Sync cancelled", "info");
			return;
		}
		parsed = parseInlineArgs(answer);
		if (!parsed) {
			ctx.ui.notify(
				`Invalid format. Expected 6 comma-separated numbers.\nGot: "${answer}"`,
				"error",
			);
			return;
		}
	}

	const values = {
		h5_used_pct: parsed[0],
		h5_resets_h: parsed[1],
		h5_resets_m: parsed[2],
		weekly_used_pct: parsed[3],
		weekly_resets_d: parsed[4],
		weekly_resets_h: parsed[5],
	};

	const validationResult = parseSyncValues({
		h5_used_pct: String(values.h5_used_pct),
		h5_resets_h: String(values.h5_resets_h),
		h5_resets_m: String(values.h5_resets_m),
		weekly_used_pct: String(values.weekly_used_pct),
		weekly_resets_d: String(values.weekly_resets_d),
		weekly_resets_h: String(values.weekly_resets_h),
	});
	if (!validationResult) {
		ctx.ui.notify(
			`Out of range. h5/wk must be 0-100, h/d/m must fit their bounds.`,
			"error",
		);
		return;
	}

	const record = buildMirrorRecord(validationResult, provider, Date.now());
	mirrorStore.write(record);
	ctx.ui.notify(
		`Mirror synced for ${provider}.\n` +
		`  5h: ${validationResult.h5_used_pct}% used, resets in ${validationResult.h5_resets_h}h ${validationResult.h5_resets_m}m\n` +
		`  weekly: ${validationResult.weekly_used_pct}% used, resets in ${validationResult.weekly_resets_d}d ${validationResult.weekly_resets_h}h\n\n` +
		`Run /usage to see the full status.`,
		"info",
	);
}

/** Parse "6,4,8,73,2,13" → [6,4,8,73,2,13], or null if invalid. */
function parseInlineArgs(s: string): [number, number, number, number, number, number] | null {
	const trimmed = s.trim();
	if (!trimmed) return null;
	const parts = trimmed.split(/[,\s]+/).filter(Boolean);
	if (parts.length !== 6) return null;
	const nums = parts.map((p) => Number(p));
	if (nums.some((n) => !Number.isFinite(n))) return null;
	return nums as [number, number, number, number, number, number];
}