/**
 * UsageTracker — append-only JSONL log of every assistant message.
 *
 * Stores one record per assistant message with: timestamp, model id,
 * input/output tokens, cache read/write tokens, total cost USD.
 *
 * File: ~/.pi/usage-status/usage.jsonl (one JSON object per line)
 *
 * No locking — single-process pi uses single-writer. Multi-process safety
 * is not a goal; SQLite would be needed for that.
 */

import {
	appendJsonl,
	ensureUsageDir,
	getUsageLogPath,
	readJsonl,
} from "./cli.ts";
import { unlinkSync } from "node:fs";

export interface UsageRecord {
	ts: number;          // unix ms
	model: string;       // model id, e.g. "minimax/MiniMax-M3"
	input: number;
	output: number;
	cache_read: number;
	cache_write: number;
	cost: number;        // USD total
}

export class UsageTracker {
	private path: string;

	constructor(path: string = getUsageLogPath()) {
		this.path = path;
		ensureUsageDir();
	}

	/** Append one usage record. */
	append(record: UsageRecord): void {
		appendJsonl(this.path, record);
	}

	/** Read all records (newest last). Returns [] if file missing. */
	all(): UsageRecord[] {
		return readJsonl<UsageRecord>(this.path);
	}

	/** Filter records newer than `sinceMs` (inclusive). */
	since(sinceMs: number): UsageRecord[] {
		return this.all().filter((r) => r.ts >= sinceMs);
	}

	/** Filter records within [fromMs, toMs). */
	between(fromMs: number, toMs: number): UsageRecord[] {
		return this.all().filter((r) => r.ts >= fromMs && r.ts < toMs);
	}

	/** Clear all records (testing only). */
	clear(): void {
		try {
			unlinkSync(this.path);
		} catch {
			// ignore
		}
	}

	/** Total record count. */
	count(): number {
		return this.all().length;
	}
}