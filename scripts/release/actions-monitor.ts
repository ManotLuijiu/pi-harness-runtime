#!/usr/bin/env bun
/**
 * GitHub Actions Monitor
 *
 * Polls a GitHub Actions run and watches it to completion.
 * Uses gh CLI which must be authenticated: gh auth login
 *
 * Usage:
 *   bun scripts/release/actions-monitor.ts --owner user --repo repo --run 123
 *   bun scripts/release/actions-monitor.ts --owner user --repo repo (latest run on current branch)
 *   bun scripts/release/actions-monitor.ts --detach         → fire and forget
 */

import { execSync } from "node:child_process";

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const MAX_POLL_MINUTES = 60;

/** Raw action run from GitHub API */
interface ActionRun {
	id: number;
	name: string;
	status: "queued" | "in_progress" | "completed";
	conclusion:
		| "success"
		| "failure"
		| "cancelled"
		| "skipped"
		| "timed_out"
		| "action_required"
		| null;
	html_url: string;
	created_at: string;
	updated_at: string;
	head_branch: string;
	run_number: number;
	event: string;
}

interface MonitorOptions {
	owner?: string;
	repo?: string;
	runId?: number;
	pollIntervalMs?: number;
	maxMinutes?: number;
	verbose?: boolean;
	detach?: boolean;
}

interface RunStatus {
	status: string;
	conclusion: string | null;
	url: string;
	runId: number;
	name: string;
	branch: string;
	runNumber: number;
	createdAt: string;
	updatedAt: string;
}

// ── gh CLI helpers ────────────────────────────────────────────────────────────

/** Execute gh command, return { stdout, status }. Never throws. */
function ghQuiet(args: string[]): { stdout: string; status: number } {
	try {
		const stdout = execSync(`gh ${args.join(" ")}`, {
			encoding: "utf-8",
			timeout: 15_000,
			maxBuffer: 10 * 1024 * 1024,
		}).trim();
		return { stdout, status: 0 };
	} catch (e) {
		const err = e as { status?: number; stderr?: string };
		return { stdout: err.stderr ?? "", status: err.status ?? 1 };
	}
}

/** Call gh api and parse JSON. Returns null on failure. */
function ghApi<T>(path: string, extraArgs: string[] = []): T | null {
	const { stdout, status } = ghQuiet(["api", path, ...extraArgs]);
	if (status !== 0 || !stdout) return null;
	try {
		return JSON.parse(stdout) as T;
	} catch {
		return null;
	}
}

// ── Repo / branch detection ────────────────────────────────────────────────────

function getCurrentBranch(): string {
	try {
		return execSync("git branch --show-current", {
			encoding: "utf-8",
			timeout: 5000,
		}).trim();
	} catch {
		return "develop";
	}
}

function getRemoteRepo(): { owner: string; repo: string } | null {
	const { stdout, status } = ghQuiet([
		"repo",
		"view",
		"--json",
		"owner,name",
		"-q",
		"{owner:.owner.login,repo:.name}",
	]);
	if (status !== 0) return null;
	try {
		const parsed = JSON.parse(stdout);
		return { owner: parsed.owner, repo: parsed.repo };
	} catch {
		return null;
	}
}

// ── Action run queries ─────────────────────────────────────────────────────────

function getLatestRun(
	owner: string,
	repo: string,
	branch?: string,
): ActionRun | null {
	const runs = ghApi<{ workflow_runs: ActionRun[] }>(
		`repos/${owner}/${repo}/actions/runs`,
		["-F", "per_page=1", ...(branch ? ["-F", `branch=${branch}`] : [])],
	);
	return runs?.workflow_runs?.[0] ?? null;
}

function getRunStatus(
	owner: string,
	repo: string,
	runId: number,
): RunStatus | null {
	const run = ghApi<ActionRun>(
		`repos/${owner}/${repo}/actions/runs/${runId}`,
	);
	if (!run) return null;
	return {
		status: run.status,
		conclusion: run.conclusion,
		url: run.html_url,
		runId: run.id,
		name: run.name,
		branch: run.head_branch,
		runNumber: run.run_number,
		createdAt: run.created_at,
		updatedAt: run.updated_at,
	};
}

// ── Formatting ─────────────────────────────────────────────────────────────────

function formatDuration(startIso: string): string {
	const start = new Date(startIso).getTime();
	const elapsed = Date.now() - start;
	const min = Math.floor(elapsed / 60_000);
	const sec = Math.floor((elapsed % 60_000) / 1000);
	return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

function formatConclusion(c: string | null): string {
	switch (c) {
		case "success":
			return "✅ Success";
		case "failure":
			return "❌ Failed";
		case "cancelled":
			return "🚫 Cancelled";
		case "timed_out":
			return "⏱ Timed out";
		case "skipped":
			return "⏭ Skipped";
		case "action_required":
			return "⚠ Action required";
		default:
			return `? ${c ?? "unknown"}`;
	}
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];

async function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// ── Monitor ────────────────────────────────────────────────────────────────────

/**
 * Poll a GitHub Actions run until completion.
 * Returns { conclusion, duration } when done (success, failure, or timeout).
 */
export async function monitorRun(
	owner: string,
	repo: string,
	runId: number,
	options: MonitorOptions = {},
): Promise<{ conclusion: string | null; duration: number }> {
	const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const maxMs = (options.maxMinutes ?? MAX_POLL_MINUTES) * 60 * 1000;
	const startTime = Date.now();
	let spin = 0;
	let lastStatus = "";

	while (Date.now() - startTime < maxMs) {
		const status = getRunStatus(owner, repo, runId);
		if (!status) {
			console.warn(`[actions-monitor] Run ${runId} not found`);
			break;
		}

		const elapsed = formatDuration(status.createdAt);

		if (status.status !== lastStatus) {
			if (options.verbose) {
				console.log(`[actions-monitor] Status: ${status.status}`);
			}
			lastStatus = status.status;
		}

		if (status.status === "completed") {
			const dur = Date.now() - startTime;
			console.log(
				`\n${formatConclusion(status.conclusion)} in ${elapsed} — ${status.url}`,
			);
			return { conclusion: status.conclusion, duration: dur };
		}

		// Still running
		const dots = ".".repeat((spin % 3) + 1);
		process.stdout.write(
			`\r${SPINNER[spin++ % SPINNER.length]} [${elapsed}] ${status.name} #${status.runNumber} (${status.branch}) ${status.status}${dots}   `,
		);

		await sleep(pollMs);
	}

	// Timeout
	const dur = Date.now() - startTime;
	console.warn(`\n[actions-monitor] Timeout after ${MAX_POLL_MINUTES}m`);
	return { conclusion: "timed_out", duration: dur };
}

/**
 * Find and monitor the latest run for a repo/branch.
 */
export async function monitorLatest(
	owner: string,
	repo: string,
	branch: string,
	options: MonitorOptions = {},
): Promise<{ runId: number; conclusion: string | null; duration: number } | null> {
	const run = getLatestRun(owner, repo, branch);
	if (!run) {
		console.warn(`[actions-monitor] No runs found for ${branch}`);
		return null;
	}
	console.log(
		`Found run #${run.run_number} (${run.id}) — ${run.name} on ${run.head_branch}`,
	);
	return {
		runId: run.id,
		...(await monitorRun(owner, repo, run.id, options)),
	};
}

// ── CLI ────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	const opts: MonitorOptions = {
		pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
		maxMinutes: MAX_POLL_MINUTES,
		verbose: args.includes("--verbose"),
		detach: args.includes("--detach"),
	};

	// Parse flags
	for (const arg of args) {
		const m = arg.match(/^--owner=(.+)$/);
		if (m) { opts.owner = m[1]; continue; }
		const r = arg.match(/^--repo=(.+)$/);
		if (r) { opts.repo = r[1]; continue; }
		const runM = arg.match(/^--run=(\d+)$/);
		if (runM) { opts.runId = parseInt(runM[1], 10); continue; }
		const pollM = arg.match(/^--poll=(\d+)$/);
		if (pollM) { opts.pollIntervalMs = parseInt(pollM[1], 10) * 1000; }
	}

	// Resolve owner/repo from git remote if not provided
	if (!opts.owner || !opts.repo) {
		const remote = getRemoteRepo();
		if (!remote) {
			console.error(
				"Error: No GitHub repo found. Use --owner and --repo flags, or run from a git repo.",
			);
			process.exit(1);
		}
		opts.owner ??= remote.owner;
		opts.repo ??= remote.repo;
	}

	if (!opts.owner || !opts.repo) {
		console.error("Error: --owner and --repo required");
		process.exit(1);
	}

	// --detach: just show the run info and exit
	if (opts.detach) {
		const branch = getCurrentBranch();
		const run = getLatestRun(opts.owner, opts.repo, branch);
		if (run) {
			console.log(
				`Run #${run.run_number} (${run.id}) — ${run.name} [${run.status}]`,
			);
		} else {
			console.log("No runs found");
		}
		return;
	}

	if (opts.runId) {
		console.log(`Monitoring run #${opts.runId}...`);
		const result = await monitorRun(
			opts.owner,
			opts.repo,
			opts.runId,
			opts,
		);
		process.exit(result.conclusion === "success" ? 0 : 1);
	} else {
		const branch = getCurrentBranch();
		console.log(`Monitoring latest run on branch '${branch}'...`);
		const result = await monitorLatest(
			opts.owner,
			opts.repo,
			branch,
			opts,
		);
		if (!result) {
			console.error("No runs found");
			process.exit(1);
		}
		process.exit(result.conclusion === "success" ? 0 : 1);
	}
}

main().catch((err) => {
	console.error("Error:", (err as Error).message);
	process.exit(1);
});
