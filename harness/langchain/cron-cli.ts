/**
 * Cron task management CLI.
 *
 * Usage:
 *   bun harness/langchain/run.ts cron add <schedule> <request>
 *   bun harness/langchain/run.ts cron list
 *   bun harness/langchain/run.ts cron rm <task-id>
 *
 * Schedules: every-5m, every-10m, every-30m, hourly, daily, weekly
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const SCHEDULES = ["every-5m", "every-10m", "every-30m", "hourly", "daily", "weekly"] as const;
type Schedule = typeof SCHEDULES[number];

function getCronDir(workspace: string): string {
	return join(workspace, ".cron-tasks");
}

function taskIdFromPath(schedule: string, filename: string): string {
	return `${schedule}:${filename.replace(/\.json$/, "")}`;
}

function parseTaskId(id: string): { schedule: string; name: string } | null {
	const colon = id.indexOf(":");
	if (colon === -1) return null;
	return { schedule: id.slice(0, colon), name: id.slice(colon + 1) };
}

function loadWorkspace(): string {
	// Dynamically import to avoid a hard dep on herdr-bus when not needed
	try {
		const { getHerdrWorkspace } = require("../../packages/event-bus/src/herdr-bus.js");
		return getHerdrWorkspace();
	} catch {
		const home = process.env.HOME ?? "/tmp";
		return join(home, ".pi-harness");
	}
}

export async function runCron(argv: string[]): Promise<void> {
	const [subcommand, ...rest] = argv;

	if (!subcommand) {
		printCronHelp();
		process.exit(0);
	}

	const workspace = loadWorkspace();
	const cronDir = getCronDir(workspace);

	switch (subcommand) {
		case "add": {
			const [schedule, ...requestParts] = rest;
			if (!schedule || requestParts.length === 0) {
				console.error("Usage: bd cron add <schedule> <request>");
				console.error(`Schedules: ${SCHEDULES.join(", ")}`);
				process.exit(1);
			}
			if (!SCHEDULES.includes(schedule as Schedule)) {
				console.error(`Unknown schedule: ${schedule}`);
				console.error(`Valid: ${SCHEDULES.join(", ")}`);
				process.exit(1);
			}
			const request = requestParts.join(" ");
			const taskId = `task-${Date.now()}`;
			const taskPath = join(cronDir, schedule, `${taskId}.json`);

			if (!existsSync(cronDir)) mkdirSync(cronDir, { recursive: true });
			if (!existsSync(join(cronDir, schedule))) mkdirSync(join(cronDir, schedule), { recursive: true });

			writeFileSync(taskPath, JSON.stringify({ request, enabled: true }, null, 2));
			console.log(`[cron] Added task ${schedule}:${taskId}`);
			console.log(`       Request: ${request.slice(0, 80)}${request.length > 80 ? "…" : ""}`);
			break;
		}

		case "list": {
			if (!existsSync(cronDir)) {
				console.log("No cron tasks configured.");
				return;
			}
			let found = false;
			for (const schedule of SCHEDULES) {
				const schedDir = join(cronDir, schedule);
				if (!existsSync(schedDir)) continue;
				const files = readdirSync(schedDir).filter((f) => f.endsWith(".json"));
				for (const file of files) {
					found = true;
					let data: { request?: string; enabled?: boolean };
					try {
						data = JSON.parse(readFileSync(join(schedDir, file), "utf8"));
					} catch {
						continue;
					}
					const id = taskIdFromPath(schedule, file);
					const status = data.enabled === false ? " [PAUSED]" : "";
					const req = (data.request ?? "").slice(0, 70);
					console.log(`  ${id}${status}`);
					console.log(`    → ${req}${data.request && data.request.length > 70 ? "…" : ""}`);
				}
			}
			if (!found) console.log("No cron tasks configured.");
			break;
		}

		case "rm": {
			const [taskId] = rest;
			if (!taskId) {
				console.error("Usage: bd cron rm <task-id>");
				console.error("Run 'bd cron list' to see task IDs.");
				process.exit(1);
			}
			const parsed = parseTaskId(taskId);
			if (!parsed) {
				console.error(`Invalid task ID format: ${taskId}`);
				console.error("Expected: <schedule>:<task-name>  (e.g. hourly:task-1234)");
				process.exit(1);
			}
			const taskPath = join(cronDir, parsed.schedule, `${parsed.name}.json`);
			if (!existsSync(taskPath)) {
				console.error(`Task not found: ${taskId}`);
				process.exit(1);
			}
			unlinkSync(taskPath);
			console.log(`[cron] Removed ${taskId}`);
			break;
		}

		case "help": {
			printCronHelp();
			break;
		}

		default: {
			console.error(`Unknown subcommand: ${subcommand}`);
			printCronHelp();
			process.exit(1);
		}
	}
}

function printCronHelp(): void {
	console.log(`\
Cron task management.

Usage: bd cron <subcommand> [args]

Subcommands:
  add <schedule> <request>
    Schedule a task. Example:
      bd cron add hourly "Check for outdated dependencies"

    Valid schedules: ${SCHEDULES.join(", ")}

  list
    Show all scheduled tasks.

  rm <task-id>
    Remove a task. Use 'bd cron list' to find the task ID.

Examples:
  bd cron add daily "Sync docs to wiki"
  bd cron list
  bd cron rm every-5m:task-1234567890
`);
}
