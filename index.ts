/**
 * pi-harness-runtime — Codex-style /usage status for pi.
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

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { UsageTracker } from "./tracker.ts";
import { MirrorStore, type MirrorRecord } from "./mirror.ts";
import { MiniMaxQuotaScraper } from "./harness/e2e/minimax-quota-scraper.js";
import { aggregateWindows } from "./windows.ts";
import { renderStatus } from "./renderer.ts";
import { buildMirrorRecord, parseSyncValues } from "./sync-form.ts";
import {
	JobStateMachine,
	type CheckpointManager,
} from "./harness/job-state-machine.ts";
import { TaskGraphManager } from "./harness/task-graph.js";
import { MasterPlanner } from "./harness/master-planner.ts";
import { RepairEngine } from "./harness/repair-engine.ts";
import {
	type SharedBlackboard,
	createBlackboard,
} from "./harness/blackboard.ts";
import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PROVIDER_DEFAULT = "minimax"; // can be changed via /usage sync form

// ─── Harness Runtime State ────────────────────────────────────────────
const HARNESS_ROOT_DIR = join(homedir(), ".pi", "harness");

interface HarnessSession {
	jobId: string;
	machine: JobStateMachine;
	graph: TaskGraphManager;
	blackboard: SharedBlackboard;
	repairEngine: RepairEngine;
	createdAt: string;
}

let currentSession: HarnessSession | null = null;

function ensureHarnessDir() {
	if (!existsSync(HARNESS_ROOT_DIR)) {
		mkdirSync(HARNESS_ROOT_DIR, { recursive: true });
	}
}

async function getCheckpointManager(): Promise<CheckpointManager> {
	const { JsonCheckpointManager } = await import(
		"./packages/checkpoint/src/checkpoint-manager.ts"
	);
	return new JsonCheckpointManager(
		HARNESS_ROOT_DIR,
	) as unknown as CheckpointManager;
}

export default function (pi: ExtensionAPI) {
	const tracker = new UsageTracker();
	const mirrorStore = new MirrorStore();
	ensureHarnessDir();

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

	// ─── Auto-fetch quota on startup ─────────────────────────────────
	let _quotaRefreshTimer: ReturnType<typeof setInterval> | undefined;
	const QUOTA_REFRESH_MS = 5 * 60 * 1000; // 5 min

	async function autoFetchQuota(): Promise<void> {
		const scraper = new MiniMaxQuotaScraper({
			cookieFile: process.env.QUOTA_COOKIE_FILE,
		});

		try {
			const data = await scraper.scrape();
			// Convert scraped data to MirrorRecord format
			const record: MirrorRecord = {
				synced_at: data.scrapedAt,
				provider: "minimax",
				h5_used_pct: data.h5UsedPct,
				weekly_used_pct: data.weeklyUsedPct,
			};
			mirrorStore.write(record);
			console.log(
				"[pi-harness] Quota auto-fetched:",
				data.h5UsedPct + "%, weekly: " + data.weeklyUsedPct + "%",
			);
		} catch (error) {
			// Silent fail - manual sync still available
			console.log(
				"[pi-harness] Quota auto-fetch skipped:",
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	// Try to auto-fetch on startup (if cookies available)
	autoFetchQuota();

	// Periodic refresh
	_quotaRefreshTimer = setInterval(autoFetchQuota, QUOTA_REFRESH_MS);

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

	// ─── /usage refresh — force auto-fetch ────────────────────────────
	pi.registerCommand("usage-refresh", {
		description: "Force refresh quota from provider console",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			ctx.ui.notify("Fetching quota from MiniMax console...", "info");
			await autoFetchQuota();
			ctx.ui.notify(
				"Quota refreshed. Run /usage to see updated status.",
				"info",
			);
		},
	});

	// ─── /usage sync — open form ─────────────────────────────────────────
	pi.registerCommand("usage-sync", {
		description:
			"Sync provider quota: /usage sync [provider] [h5%,h,h,m,wk%,d,h]",
		getArgumentCompletions: (prefix: string) => {
			const opts = ["minimax", "anthropic", "openai", "openrouter"];
			const filtered = opts.filter((o) => o.startsWith(prefix));
			return filtered.length > 0
				? filtered.map((o) => ({ value: o, label: o }))
				: null;
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
				ctx.ui.notify(
					"Mirror cleared. Run /usage sync to set a new one.",
					"info",
				);
			} catch (e) {
				ctx.ui.notify(`Failed to clear mirror: ${e}`, "error");
			}
		},
	});

	// ─── /harness start — Start a new harness job ──────────────────────
	pi.registerCommand("harness-start", {
		description: "Start a new harness job: /harness start <requirement>",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /harness start <requirement>", "error");
				return;
			}

			const jobId = `job-${Date.now()}`;
			const requirement = args.trim();

			ctx.ui.notify(`Starting harness job ${jobId}...`, "info");

			try {
				const cm = await getCheckpointManager();
				const machine = new JobStateMachine({ checkpointManager: cm });
				const result = await machine.createJob(jobId, requirement);

				if (!result.success) {
					ctx.ui.notify(`Failed to create job: ${result.error}`, "error");
					return;
				}

				// Create task graph using heuristic planner
				const planner = new MasterPlanner();
				const planResult = await planner.createPlan(
					requirement,
					jobId,
					HARNESS_ROOT_DIR,
				);

				if (!planResult.success) {
					ctx.ui.notify(`Failed to create plan: ${planResult.error}`, "error");
					return;
				}

				// Create blackboard
				const blackboard = createBlackboard(
					jobId,
					HARNESS_ROOT_DIR,
					planResult.graph!,
				);

				// Create repair engine
				const repairEngine = new RepairEngine(HARNESS_ROOT_DIR);

				// Store session
				currentSession = {
					jobId,
					machine,
					graph: new TaskGraphManager({ jobId }),
					blackboard,
					repairEngine,
					createdAt: new Date().toISOString(),
				};

				const taskCount = planResult.graph?.nodes
					? Object.keys(planResult.graph.nodes).length
					: 0;
				ctx.ui.notify(
					`Job ${jobId} created with ${taskCount} tasks.\n` +
						`Requirement: ${requirement}\n\n` +
						`Run /harness status to see tasks, or /harness tasks to list them.`,
					"info",
				);
			} catch (e) {
				ctx.ui.notify(`Error starting harness: ${e}`, "error");
			}
		},
	});

	// ─── /harness status — Show harness job status ─────────────────────
	pi.registerCommand("harness-status", {
		description: "Show current harness job status",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!currentSession) {
				ctx.ui.notify(
					"No active harness job. Run /harness start <requirement> to begin.",
					"info",
				);
				return;
			}

			const summary = currentSession.machine.getStatusSummary();
			if (!summary) {
				ctx.ui.notify("Failed to get job status.", "error");
				return;
			}

			const progress = currentSession.graph.getProgressSummary();
			const lines = [
				`Harness Job Status`,
				`${"─".repeat(40)}`,
				`Job ID:     ${currentSession.jobId}`,
				`Status:     ${summary.status}`,
				`Terminal:   ${summary.isTerminal ? "Yes" : "No"}`,
				`Can Resume: ${summary.canResume ? "Yes" : "No"}`,
				`${"─".repeat(40)}`,
				`Tasks:      ${progress.done}/${progress.total} done, ${progress.running} running, ${progress.failed} failed`,
				`Created:    ${currentSession.createdAt}`,
				`${"─".repeat(40)}`,
				`Run /harness tasks for task list`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// ─── /harness tasks — List all tasks ───────────────────────────────
	pi.registerCommand("harness-tasks", {
		description: "List all tasks in the current harness job",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!currentSession) {
				ctx.ui.notify(
					"No active harness job. Run /harness start <requirement> to begin.",
					"info",
				);
				return;
			}

			const tasks = currentSession.graph.getAllTasks();
			if (tasks.length === 0) {
				ctx.ui.notify(
					"No tasks found. The job may not have been planned yet.",
					"info",
				);
				return;
			}

			const lines = [
				`Tasks for Job ${currentSession.jobId}`,
				`${"─".repeat(50)}`,
			];

			for (const task of tasks) {
				const status = task.status.padEnd(10);
				const retry = task.retryCount ? ` (${task.retryCount} retries)` : "";
				lines.push(`[${task.id}] ${status} ${task.title}${retry}`);
				if (task.dependencies.length > 0) {
					lines.push(`  deps: ${task.dependencies.join(", ")}`);
				}
			}

			lines.push(`${"─".repeat(50)}`);
			const ready = currentSession.graph.getReadyTasks();
			lines.push(`${ready.length} tasks ready to execute.`);
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// ─── /harness pause — Pause the harness job ───────────────────────
	pi.registerCommand("harness-pause", {
		description: "Pause the current harness job",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!currentSession) {
				ctx.ui.notify("No active harness job to pause.", "info");
				return;
			}

			const checkpoint = currentSession.machine.getCheckpoint();
			if (!checkpoint) {
				ctx.ui.notify("Failed to get checkpoint.", "error");
				return;
			}

			const result = await currentSession.machine.transition("paused_quota");
			if (!result.success) {
				ctx.ui.notify(`Failed to pause: ${result.error}`, "error");
				return;
			}

			ctx.ui.notify(
				`Job ${currentSession.jobId} paused.\n` +
					`Current status: paused_quota\n` +
					`Run /harness resume to continue.`,
				"info",
			);
		},
	});

	// ─── /harness resume — Resume the harness job ───────────────────────
	pi.registerCommand("harness-resume", {
		description: "Resume a paused harness job",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!currentSession) {
				ctx.ui.notify("No active harness job to resume.", "info");
				return;
			}

			const checkpoint = currentSession.machine.getCheckpoint();
			if (!checkpoint || checkpoint.status !== "paused_quota") {
				ctx.ui.notify(
					"Job is not paused. Run /harness start to begin a new job.",
					"info",
				);
				return;
			}

			const result = await currentSession.machine.transition("running");
			if (!result.success) {
				ctx.ui.notify(`Failed to resume: ${result.error}`, "error");
				return;
			}

			ctx.ui.notify(
				`Job ${currentSession.jobId} resumed.\n` +
					`Current status: running\n` +
					`Run /harness status to monitor progress.`,
				"info",
			);
		},
	});

	// ─── /harness cancel — Cancel the harness job ──────────────────────
	pi.registerCommand("harness-cancel", {
		description: "Cancel the current harness job",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!currentSession) {
				ctx.ui.notify("No active harness job to cancel.", "info");
				return;
			}

			const ok = await ctx.ui.confirm(
				`Cancel job ${currentSession.jobId}?`,
				"This will mark the job as cancelled. Task state is preserved but work stops.",
			);

			if (!ok) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}

			const result = await currentSession.machine.transition("cancelled");
			if (!result.success) {
				ctx.ui.notify(`Failed to cancel: ${result.error}`, "error");
				return;
			}

			const sessionJobId = currentSession.jobId;
			currentSession = null;

			ctx.ui.notify(
				`Job ${sessionJobId} cancelled.\n` +
					`Run /harness start to begin a new job.`,
				"info",
			);
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

	ctx.ui.setStatus("harness-runtime", summary);
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
function parseInlineArgs(
	s: string,
): [number, number, number, number, number, number] | null {
	const trimmed = s.trim();
	if (!trimmed) return null;
	const parts = trimmed.split(/[,\s]+/).filter(Boolean);
	if (parts.length !== 6) return null;
	const nums = parts.map((p) => Number(p));
	if (nums.some((n) => !Number.isFinite(n))) return null;
	return nums as [number, number, number, number, number, number];
}
