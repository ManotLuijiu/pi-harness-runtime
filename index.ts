/**
 * pi-harness-runtime — Codex-style /usage status for pi.
 *
 * Slash commands:
 *   /usage         — show full status (model, local tracking, provider mirror)
 *   /usage today   — focused: this 5h + today (UTC)
 *   /usage week    — focused: this week + lifetime
 *   /usage reset   — clear mirror (forces a fresh auto fetch)
 *
 * Auto-tracks every assistant message via the message_end event.
 * Stores data in ~/.pi/usage-status/  (override with PI_USAGE_DIR for testing).
 *
 * Runs directly from Bun.
 */

import type {
	CompactOptions,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { UsageTracker } from "./tracker.ts";
import { MirrorStore, type MirrorRecord } from "./mirror.ts";
import { MiniMaxQuotaScraper } from "./harness/e2e/minimax-quota-scraper.js";
import { parseMiniMaxQuotaText } from "./harness/e2e/minimax-quota-parser.js";
import { buildFooterStatusValue } from "./footer-status.ts";
import {
	MAX_PROACTIVE_COMPACT_FAILURES,
	OUTPUT_LIMIT_RESUME_PROMPT,
	PROACTIVE_COMPACT_COOLDOWN_MS,
	shouldQueueOutputLimitResume,
	shouldQueuePostCompactionResume,
	shouldTriggerProactiveCompact,
} from "./proactive-compact.ts";
import { aggregateWindows } from "./windows.ts";
import { renderStatus } from "./renderer.ts";
import {
	JobStateMachine,
	type CheckpointManager,
} from "./harness/job-state-machine.ts";
import {
	createTaskGraphManager,
	type TaskGraphManager,
} from "./harness/task-graph.js";
import { MasterPlanner } from "./harness/master-planner.ts";
import { RepairEngine } from "./harness/repair-engine.ts";
import {
	type SharedBlackboard,
	createBlackboard,
} from "./harness/blackboard.ts";
import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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
			role?: string;
			stopReason?: unknown;
			errorMessage?: unknown;
			usage?: {
				input?: number;
				output?: number;
				cacheRead?: number;
				cacheWrite?: number;
				cost?: { total?: number };
			};
		};

		if (
			shouldQueueOutputLimitResume(
				m,
				outputLimitResumeAttempts,
				ctx.hasPendingMessages(),
			)
		) {
			outputLimitResumeAttempts += 1;
			pendingOutputLimitResumeAfterCompact = true;
			queueAutoResume("output-limit", OUTPUT_LIMIT_RESUME_PROMPT, "steer");
		} else if (m.stopReason === "stop") {
			outputLimitResumeAttempts = 0;
		}

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

	// ─── Smart quota fetch for MiniMax status ────────────────────────
	const MINIMAX_REFRESH_MIN_INTERVAL_MS = 15 * 60 * 1000;
	const MINIMAX_REFRESH_TOKEN_THRESHOLD = 200_000;
	const MINIMAX_REFRESH_REQUEST_THRESHOLD = 12;
	const quotaScraper = process.env.QUOTA_COOKIE_FILE
		? new MiniMaxQuotaScraper({ cookieFile: process.env.QUOTA_COOKIE_FILE })
		: new MiniMaxQuotaScraper();
	const cookieQuotaAutoFetchAvailable = quotaScraper.hasCookieFile();
	let footerStatusCtx: {
		ui: { setStatus: (key: string, value: string) => void };
	} | null = null;
	let lastQuotaAutoFetchAt = 0;
	let quotaAutoFetchInFlight = false;
	let proactiveCompactInFlight = false;
	let lastProactiveCompactAt = 0;
	let consecutiveCompactFailures = 0;
	let proactiveCompactCircuitReported = false;
	let outputLimitResumeAttempts = 0;
	let pendingOutputLimitResumeAfterCompact = false;

	function writeMirrorRecord(record: MirrorRecord): void {
		mirrorStore.write(record);
		if (footerStatusCtx) {
			refreshFooterStatus(footerStatusCtx, tracker, mirrorStore);
		}
	}

	async function hasBrowserProfileAutoFetchSource(): Promise<boolean> {
		try {
			const { getLiveSessionPath, getStatusPath } = await import(
				"./packages/auth/src/minimax-browser-auth.ts"
			);
			return existsSync(getLiveSessionPath()) || existsSync(getStatusPath());
		} catch {
			return false;
		}
	}

	function isMiniMaxModel(modelId: string | null | undefined): boolean {
		return /minimax/i.test(modelId ?? "");
	}

	function getMiniMaxUsageSince(sinceMs: number): {
		tokens: number;
		requests: number;
	} {
		const records = tracker
			.since(sinceMs)
			.filter((record) => isMiniMaxModel(record.model));
		return {
			tokens: records.reduce(
				(sum, record) => sum + record.input + record.output,
				0,
			),
			requests: records.length,
		};
	}

	async function autoFetchQuotaFromBrowserProfile(
		suppressErrors = false,
	): Promise<MirrorRecord | null> {
		if (!(await hasBrowserProfileAutoFetchSource())) {
			return null;
		}

		try {
			const { scrapeWithExistingProfile } = await import(
				"./packages/auth/src/minimax-browser-auth.ts"
			);
			const status = await scrapeWithExistingProfile({ quiet: true });
			if (
				status.page_url.includes("unified-login") ||
				status.page_url.includes("login")
			) {
				return null;
			}
			const rawText =
				status.usage_lines?.join("\n")?.trim() ||
				status.detected_text_sample?.trim() ||
				"";
			if (!rawText) {
				return null;
			}

			const parsed = parseMiniMaxQuotaText(rawText);
			if (
				parsed.h5UsedPct === undefined &&
				parsed.weeklyUsedPct === undefined
			) {
				return null;
			}

			return {
				synced_at: status.checked_at,
				provider: "minimax",
				h5_used_pct: parsed.h5UsedPct,
				h5_resets_at: parsed.h5ResetsAt,
				weekly_used_pct: parsed.weeklyUsedPct,
				weekly_resets_at: parsed.weeklyResetsAt,
			};
		} catch (error) {
			if (!suppressErrors) {
				console.error(
					"[pi-harness] Browser-profile quota fetch skipped:",
					error instanceof Error ? error.message : String(error),
				);
			}
			return null;
		}
	}

	async function autoFetchQuota(options?: {
		suppressErrors?: boolean;
	}): Promise<boolean> {
		const suppressErrors = options?.suppressErrors === true;
		const profileRecord =
			await autoFetchQuotaFromBrowserProfile(suppressErrors);
		if (profileRecord) {
			writeMirrorRecord(profileRecord);
			return true;
		}

		if (!cookieQuotaAutoFetchAvailable) {
			return false;
		}

		try {
			const data = await quotaScraper.scrape();
			writeMirrorRecord({
				synced_at: data.scrapedAt,
				provider: "minimax",
				h5_used_pct: data.h5UsedPct,
				h5_resets_at: data.h5ResetsAt,
				weekly_used_pct: data.weeklyUsedPct,
				weekly_resets_at: data.weeklyResetsAt,
			});
			return true;
		} catch (error) {
			if (!suppressErrors) {
				console.error(
					"[pi-harness] Quota auto-fetch skipped:",
					error instanceof Error ? error.message : String(error),
				);
			}
			return false;
		}
	}

	async function maybeAutoFetchQuota(
		modelId: string | null | undefined,
	): Promise<void> {
		if (!isMiniMaxModel(modelId) || quotaAutoFetchInFlight) {
			return;
		}

		const nowMs = Date.now();
		if (nowMs - lastQuotaAutoFetchAt < MINIMAX_REFRESH_MIN_INTERVAL_MS) {
			return;
		}

		const mirror = mirrorStore.read();
		const freshness = mirrorStore.freshness(mirror, nowMs);
		const shouldFetchBaseline = !mirror || freshness === "expired";
		const usageSinceSync = getMiniMaxUsageSince(
			mirror?.synced_at ? Date.parse(mirror.synced_at) : 0,
		);
		const shouldFetchFromUsage =
			usageSinceSync.tokens >= MINIMAX_REFRESH_TOKEN_THRESHOLD ||
			usageSinceSync.requests >= MINIMAX_REFRESH_REQUEST_THRESHOLD ||
			(freshness === "stale" && usageSinceSync.requests > 0);

		if (!shouldFetchBaseline && !shouldFetchFromUsage) {
			return;
		}

		quotaAutoFetchInFlight = true;
		lastQuotaAutoFetchAt = nowMs;
		try {
			await autoFetchQuota({ suppressErrors: true });
		} finally {
			quotaAutoFetchInFlight = false;
		}
	}

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
			const autoFetchAvailable =
				cookieQuotaAutoFetchAvailable ||
				(await hasBrowserProfileAutoFetchSource());
			if (!autoFetchAvailable) {
				ctx.ui.notify(
					"Quota auto-fetch is unavailable. Set `QUOTA_COOKIE_FILE` or run `bun packages/auth/src/run-minimax-auth.ts auth` first.",
					"info",
				);
				return;
			}
			ctx.ui.notify("Fetching quota from MiniMax console...", "info");
			const refreshed = await autoFetchQuota();
			ctx.ui.notify(
				refreshed
					? "Quota refreshed. Run `/usage` to see updated status."
					: "Quota refresh skipped. Check cookie validity or MiniMax auth profile, then run `/usage` again.",
				"info",
			);
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
				" Run `/usage` for full status with the latest auto-fetched provider quota.",
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
				" Run `/usage` for full status with provider mirror.",
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
					"Mirror cleared. The next auto refresh will repopulate it.",
					"info",
				);
				footerStatusCtx = ctx;
				refreshFooterStatus(ctx, tracker, mirrorStore);
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
					graph: createTaskGraphManager(),
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
				lines.push(`[${task.id}] ${status} ${task.title}`);
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
					`Run \`/harness start\` to begin a new job.`,
				"info",
			);
		},
	});

	// ─── Footer status (persistent badge) ────────────────────────────────
	pi.on("session_start", (_event, ctx) => {
		footerStatusCtx = ctx;
		refreshFooterStatus(ctx, tracker, mirrorStore);
	});

	pi.on("turn_end", (_event, ctx) => {
		footerStatusCtx = ctx;
		refreshFooterStatus(ctx, tracker, mirrorStore);
		void maybeAutoFetchQuota(ctx.model?.id ?? null);
		maybeTriggerProactiveCompact(ctx);
	});

	pi.on("session_compact", (event, ctx) => {
		footerStatusCtx = ctx;
		proactiveCompactInFlight = false;
		lastProactiveCompactAt = Date.now();
		consecutiveCompactFailures = 0;
		proactiveCompactCircuitReported = false;
		refreshFooterStatus(ctx, tracker, mirrorStore);

		const forceOutputLimitResume = pendingOutputLimitResumeAfterCompact;
		pendingOutputLimitResumeAfterCompact = false;

		if (
			!shouldQueuePostCompactionResume(event, ctx.hasPendingMessages(), {
				force: forceOutputLimitResume,
			})
		) {
			return;
		}

		if (forceOutputLimitResume) {
			queueAutoResume(
				"post-compact-output-limit",
				OUTPUT_LIMIT_RESUME_PROMPT,
				event.willRetry ? "steer" : "followUp",
			);
			return;
		}

		outputLimitResumeAttempts = 0;
		// pi.dev expects the literal "resume" command to continue after compaction.
		queueAutoResume("post-compact", "resume", "followUp");
	});

	function queueAutoResume(
		reason: string,
		content: string,
		deliverAs: "steer" | "followUp",
	): void {
		try {
			pi.sendUserMessage(content, { deliverAs });
		} catch (error) {
			console.error(
				`[pi-harness] Failed to queue ${reason} auto-resume:`,
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	function maybeTriggerProactiveCompact(ctx: ExtensionContext): void {
		if (proactiveCompactInFlight) {
			return;
		}
		if (consecutiveCompactFailures >= MAX_PROACTIVE_COMPACT_FAILURES) {
			if (!proactiveCompactCircuitReported) {
				proactiveCompactCircuitReported = true;
				console.error(
					`[pi-harness] Proactive compact disabled after ${consecutiveCompactFailures} consecutive failures`,
				);
			}
			return;
		}
		if (!ctx.isIdle() || ctx.hasPendingMessages()) {
			return;
		}
		const usage = ctx.getContextUsage();
		if (!shouldTriggerProactiveCompact(usage)) {
			return;
		}
		if (Date.now() - lastProactiveCompactAt < PROACTIVE_COMPACT_COOLDOWN_MS) {
			return;
		}

		proactiveCompactInFlight = true;
		lastProactiveCompactAt = Date.now();

		const compactOptions: CompactOptions = {
			customInstructions:
				"Preserve the current task, recent code changes, pending work, exact next step, and any unresolved errors. This compaction was triggered proactively near the context limit. After compaction, continue seamlessly without asking the user to resume or recap.",
			onComplete: () => {
				proactiveCompactInFlight = false;
				lastProactiveCompactAt = Date.now();
				consecutiveCompactFailures = 0;
				proactiveCompactCircuitReported = false;
			},
			onError: (error) => {
				proactiveCompactInFlight = false;
				consecutiveCompactFailures += 1;
				console.error("[pi-harness] Proactive compact failed:", error.message);
			},
		};
		ctx.compact(compactOptions);
	}
}

// ──────────────────────────────────────────────────────────────────────
// Helper: refresh persistent footer status with one-line summary
// ──────────────────────────────────────────────────────────────────────
function refreshFooterStatus(
	ctx: { ui: { setStatus: (key: string, value: string) => void } },
	tracker: UsageTracker,
	mirrorStore: MirrorStore,
) {
	const nowMs = Date.now();
	const local = aggregateWindows(tracker.all());
	const mirror = mirrorStore.read();
	const freshness = mirrorStore.freshness(mirror, nowMs);
	ctx.ui.setStatus(
		"harness-runtime",
		buildFooterStatusValue(local, mirror, freshness),
	);
}
