/**
 * Local NDJSON spool - the last-resort destination for log batches.
 *
 * When every transport fails (no network, R2 down, webhook server down) the
 * batch is written to disk instead of being lost. The spool is drained on
 * the next successful flush, so a temporary outage does not cost data.
 *
 * Files are plain NDJSON, one record per line, so an operator can inspect
 * them with `tail`, `jq` or `less` without any tooling.
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import type { LogBatch, LogRecord } from "./types.js";

export interface LogSpoolOptions {
	/** Directory that holds the spool files. */
	dir: string;
	/** Rotate a file when it would exceed this size. Default 5 MB. */
	maxFileBytes?: number;
	/** Maximum number of spool files kept. Default 20. */
	maxFiles?: number;
}

const FILE_PREFIX = "logs-spool-";
const FILE_SUFFIX = ".ndjson";

export class LogSpool {
	private readonly dir: string;
	private readonly maxFileBytes: number;
	private readonly maxFiles: number;

	constructor(options: LogSpoolOptions) {
		this.dir = options.dir;
		this.maxFileBytes = Math.max(1024, options.maxFileBytes ?? 5 * 1024 * 1024);
		this.maxFiles = Math.max(1, options.maxFiles ?? 20);
	}

	/** Append a batch to the spool. Returns the file that was written. */
	append(batch: LogBatch, now: Date = new Date()): string {
		this.ensureDir();
		const file = this.currentFile(now);
		const payload = batch.records.map((record) => JSON.stringify(record)).join("\n") + "\n";

		if (this.shouldRotate(file, payload.length)) {
			this.rotate(file);
		}

		appendFileSync(file, payload, "utf8");
		this.enforceRetention();
		return file;
	}

	/** Spool files, oldest first. */
	list(): string[] {
		if (!existsSync(this.dir)) return [];
		return readdirSync(this.dir)
			.filter(
				(name) =>
					name.startsWith(FILE_PREFIX) &&
					(name.endsWith(FILE_SUFFIX) || new RegExp(`\\${FILE_SUFFIX}\\.\\d+$`).test(name)),
			)
			.map((name) => join(this.dir, name))
			.sort();
	}

	/** Read the records of a spool file. */
	read(file: string): LogRecord[] {
		if (!existsSync(file)) return [];
		const content = readFileSync(file, "utf8");
		const records: LogRecord[] = [];
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				records.push(JSON.parse(trimmed) as LogRecord);
			} catch {
				// A truncated last line is expected after a crash; skip it.
			}
		}
		return records;
	}

	/** Delete a spool file after it was shipped. */
	remove(file: string): void {
		try {
			rmSync(file, { force: true });
		} catch {
			// Nothing to do - the file stays and is retried later.
		}
	}

	private ensureDir(): void {
		if (!existsSync(this.dir)) {
			mkdirSync(this.dir, { recursive: true });
		}
	}

	private currentFile(now: Date): string {
		const day = now.toISOString().slice(0, 10);
		return join(this.dir, `${FILE_PREFIX}${day}${FILE_SUFFIX}`);
	}

	private shouldRotate(file: string, incomingBytes: number): boolean {
		if (!existsSync(file)) return false;
		try {
			return statSync(file).size + incomingBytes > this.maxFileBytes;
		} catch {
			return false;
		}
	}

	private rotate(file: string): void {
		for (let index = 1; index <= this.maxFiles; index++) {
			const candidate = `${file}.${index}`;
			if (!existsSync(candidate)) {
				renameSync(file, candidate);
				return;
			}
		}
	}

	private enforceRetention(): void {
		const files = this.list();
		const extra = files.length - this.maxFiles;
		for (let i = 0; i < extra; i++) {
			this.remove(files[i]);
		}
	}
}
