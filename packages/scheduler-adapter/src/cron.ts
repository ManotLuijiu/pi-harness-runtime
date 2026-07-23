/**
 * Cron Scheduler Adapter — RFC-0101 §6
 *
 * Writes crontab entries for scheduled tasks.
 * Entries are managed via a marker block so unschedule() is clean.
 */
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SchedulerAdapter } from "./interface.js";
import type { ScheduledTask } from "./interface.js";

export class CronAdapter implements SchedulerAdapter {
	readonly name = "cron" as const;
	private readonly runtimeBin: string;

	constructor(options: { runtimeBin?: string } = {}) {
		this.runtimeBin = options.runtimeBin ?? "/usr/local/bin/pi-harness-runtime";
	}

	async install(): Promise<void> {
		// Idempotent — verify cron is available
		try {
			execSync("crontab -l >/dev/null 2>&1", { stdio: "pipe" });
		} catch {
			// No existing crontab — that's fine
		}
	}

	async schedule(task: ScheduledTask): Promise<void> {
		const cronExpr = this._toCronExpr(task);
		const marker = `# PI-HARNESS-RUNTIME: ${task.id}`;
		const line = `${cronExpr} ${this.runtimeBin} run-scheduled --task-id ${task.id}`;
		const existing = this._getCrontab();

		// Remove any existing entry for this task
		const cleaned = existing.filter(
			(l) => !l.includes(`PI-HARNESS-RUNTIME: ${task.id}`),
		);
		const updated = [...cleaned, marker, line].join("\n") + "\n";
		this._setCrontab(updated);
	}

	async unschedule(taskId: string): Promise<void> {
		const existing = this._getCrontab();
		const cleaned = existing.filter(
			(l) => !l.includes(`PI-HARNESS-RUNTIME: ${taskId}`),
		);
		if (cleaned.length === 0) {
			try {
				execSync("crontab -r 2>/dev/null", { stdio: "pipe" });
			} catch {
				// No crontab to remove — that's fine
			}
		} else {
			this._setCrontab(cleaned.join("\n") + "\n");
		}
	}

	async listScheduled(): Promise<ScheduledTask[]> {
		const lines = this._getCrontab();
		return lines
			.filter((l) => l.includes("PI-HARNESS-RUNTIME: "))
			.map((l) => {
				const match = l.match(/PI-HARNESS-RUNTIME: ([\w-]+)/);
				return {
					id: match?.[1] ?? "unknown",
					taskTemplate: {},
					schedule: { kind: "cron" as const, expression: "" },
					enabled: true,
				} as unknown as ScheduledTask;
			});
	}

	async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
		try {
			execSync("crontab -l >/dev/null 2>&1", { stdio: "pipe" });
			return { healthy: true };
		} catch {
			return { healthy: false, error: "crontab not accessible" };
		}
	}

	private _getCrontab(): string[] {
		try {
			const out = execSync("crontab -l 2>/dev/null", { encoding: "utf8" });
			return out.split("\n").filter((l) => l.trim());
		} catch {
			return [];
		}
	}

	private _setCrontab(content: string): void {
		const tmpFile = join(tmpdir(), `pi-harness-cron-${Date.now()}.tmp`);
		try {
			writeFileSync(tmpFile, content);
			execSync(`crontab "${tmpFile}"`, { stdio: "pipe" });
		} finally {
			try { unlinkSync(tmpFile); } catch { /* ignore */ }
		}
	}

	private _toCronExpr(task: ScheduledTask): string {
		if (task.schedule.kind === "cron") return task.schedule.expression;
		if (task.schedule.kind === "interval") {
			const ms = task.schedule.intervalMs;
			const minutes = Math.round(ms / 60_000);
			if (minutes < 60) return `*/${minutes} * * * *`;
			const hours = Math.round(ms / 3_600_000);
			return `${minutes % 60} */${hours} * * *`;
		}
		if (task.schedule.kind === "once") {
			const d = new Date(task.schedule.at);
			return `${d.getUTCMinutes()} ${d.getUTCHours()} ${d.getUTCDate()} ${d.getUTCMonth() + 1} *`;
		}
		return "* * * * *";
	}
}
