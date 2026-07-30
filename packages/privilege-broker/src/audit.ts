/**
 * Audit Logger — RFC-0101 §7
 *
 * Logs every capability grant/denial with actor, target, reason, and outcome.
 * Built-in implementations: Console, File, NoOp.
 * Replace with your preferred audit backend (syslog, PostgreSQL, Loki, etc.)
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { AuditEntry, AuditLogger } from "./types.js";

/** No-op logger — discards all events. */
export class NoOpAuditLogger implements AuditLogger {
	log(_entry: AuditEntry): void {
		// no-op
	}
}

/** Console logger — writes human-readable lines to stdout/stderr. */
export class ConsoleAuditLogger implements AuditLogger {
	log(entry: AuditEntry): void {
		const prefix =
			entry.outcome === "granted"
				? "✅"
				: entry.outcome === "denied"
					? "❌"
					: "⚠️";
		const line = [
			prefix,
			`${entry.outcome.toUpperCase()}`,
			`actor=${entry.actor}`,
			`capability=${entry.capability}`,
			`reason=${entry.reason}`,
			entry.error ? `error=${entry.error}` : "",
		]
			.filter(Boolean)
			.join(" ");
		if (entry.outcome === "error") {
			console.error(`[AUDIT] ${line}`);
		} else {
			console.log(`[AUDIT] ${line}`);
		}
	}
}

/**
 * JSON Lines file logger — appends one JSON object per event.
 * Auto-creates parent directory. Auto-rotates when file exceeds maxSizeBytes.
 */
export class FileAuditLogger implements AuditLogger {
	private readonly logPath: string;
	private readonly maxSizeBytes: number;
	private readonly maxRotations: number;

	constructor(
		options: {
			logPath?: string;
			maxSizeBytes?: number;
			maxRotations?: number;
		} = {},
	) {
		const home = process.env["HOME"] ?? "/tmp";
		this.logPath =
			options.logPath ?? join(home, ".pi", "harness", "broker-audit.logl");
		this.maxSizeBytes = options.maxSizeBytes ?? 10 * 1024 * 1024; // 10 MB
		this.maxRotations = options.maxRotations ?? 5;
		this._ensureDir();
	}

	log(entry: AuditEntry): void {
		this._rotateIfNeeded();
		const line = JSON.stringify(entry) + "\n";
		writeFileSync(this.logPath, line, { flag: "a" });
	}

	private _ensureDir(): void {
		const dir = dirname(this.logPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
	}

	private _rotateIfNeeded(): void {
		if (!existsSync(this.logPath)) return;
		try {
			const { statSync } = require("node:fs");
			const stat = statSync(this.logPath);
			if (stat.size < this.maxSizeBytes) return;

			// Rotate: broker-audit.log → broker-audit.log.1 → ...
			const { renameSync, existsSync: exists } = require("node:fs");
			for (let i = this.maxRotations - 1; i >= 1; i--) {
				const from = `${this.logPath}.${i}`;
				const to = `${this.logPath}.${i + 1}`;
				if (exists(to)) unlinkSync(to);
				if (exists(from)) renameSync(from, to);
			}
			renameSync(this.logPath, `${this.logPath}.1`);
		} catch {
			// If rotation fails, continue writing to the existing file
		}
	}

	/**
	 * Read recent audit entries.
	 * Returns newest entries last.
	 */
	query(options?: {
		workerId?: string;
		taskId?: string;
		capability?: string;
		success?: boolean;
		limit?: number;
	}): AuditEntry[] {
		if (!existsSync(this.logPath)) return [];
		const raw = readFileSync(this.logPath, "utf8");
		const entries: AuditEntry[] = [];
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;
			try {
				const e = JSON.parse(line) as AuditEntry;
				if (options?.workerId && e.workerId !== options.workerId) continue;
				if (options?.taskId && e.taskId !== options.taskId) continue;
				if (options?.capability && e.capability !== options.capability)
					continue;
				if (options?.success !== undefined && e.success !== options.success)
					continue;
				entries.push(e);
			} catch {
				// Skip malformed lines
			}
		}
		const result = options?.limit ? entries.slice(-options.limit) : entries;
		return result;
	}
}
