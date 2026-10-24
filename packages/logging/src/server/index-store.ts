/**
 * Metadata index for the log query service.
 *
 * R2 is an archive, not a search API, so the server keeps a small metadata
 * index next to it: tenant, machine, session, timestamp, severity,
 * source/event, batch id and the object key of the archived batch.
 *
 * The index deliberately holds NO message text. Prompts, responses and
 * command output never enter it, and an agent asking "which errors happened
 * in this session" gets metadata, not content.
 *
 * Storage is one NDJSON file per tenant and day:
 *
 *   <dir>/<tenant>/2026-10-24.ndjson
 *
 * The index is tenant scoped by construction: every query is filtered by the
 * tenant of the authenticated caller, and the tenant of the request body is
 * never used.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LogLevel } from "../types.js";
import { safeSegment, type OutboxBatch } from "./outbox.js";

export interface LogIndexEntry {
	tenantId: string;
	installationId: string;
	sessionId?: string;
	ts: string;
	level: LogLevel;
	source: string;
	event: string;
	batchId: string;
	/** Object key of the archived batch, when it was uploaded. */
	r2Key?: string;
}

export interface LogQueryParams {
	/** Tenant of the authenticated caller. Required. */
	tenantId: string;
	installationId?: string;
	sessionId?: string;
	/** ISO timestamp, inclusive lower bound. */
	since?: string;
	/** ISO timestamp, exclusive upper bound. */
	until?: string;
	levels?: LogLevel[];
	source?: string;
	event?: string;
	/** Maximum number of entries. Default 100, hard maximum 500. */
	limit?: number;
	/** Opaque cursor of the previous page. */
	cursor?: string;
}

export interface LogQueryResult {
	entries: LogIndexEntry[];
	/** Cursor of the next page, when there is one. */
	nextCursor?: string;
	hasMore: boolean;
	/** Number of day files that were read. */
	scannedFiles: number;
	/** True when the scan hit its day budget. */
	truncated: boolean;
}

export interface LogIndexStoreOptions {
	dir: string;
	/** Days a query may scan back. Default 7, hard maximum 31. */
	maxScanDays?: number;
	/** Entries per page by default. */
	defaultLimit?: number;
	/** Hard maximum of entries per page. */
	maxLimit?: number;
}

function toIsoDay(value: Date): string {
	return value.toISOString().slice(0, 10);
}

function encodeCursor(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function decodeCursor(value: string): string | undefined {
	try {
		return Buffer.from(value, "base64url").toString("utf8");
	} catch {
		return undefined;
	}
}

export class LogIndexStore {
	private readonly dir: string;
	private readonly maxScanDays: number;
	private readonly defaultLimit: number;
	private readonly maxLimit: number;

	constructor(options: LogIndexStoreOptions) {
		this.dir = options.dir;
		this.maxScanDays = Math.min(options.maxScanDays ?? 7, 31);
		this.defaultLimit = options.defaultLimit ?? 100;
		this.maxLimit = options.maxLimit ?? 500;
	}

	/**
	 * Index the metadata of a batch.
	 *
	 * Returns the number of entries that were written. The write is best
	 * effort: a failing index must not lose the batch itself.
	 */
	append(batch: OutboxBatch, r2Key?: string): number {
		if (!Array.isArray(batch.records) || batch.records.length === 0) return 0;

		const lines: string[] = [];
		for (const record of batch.records) {
			const entry: LogIndexEntry = {
				tenantId: batch.tenantId,
				installationId: batch.installationId,
				ts: record.ts,
				level: record.level,
				source: record.source,
				event: record.event,
				batchId: batch.batchId,
			};
			if (batch.sessionId) entry.sessionId = batch.sessionId;
			else if (record.sessionId) entry.sessionId = record.sessionId;
			if (r2Key) entry.r2Key = r2Key;
			lines.push(JSON.stringify(entry));
		}

		try {
			const day = toIsoDay(new Date(batch.sentAt));
			const dir = join(this.dir, safeSegment(batch.tenantId));
			mkdirSync(dir, { recursive: true });
			appendFileSync(join(dir, `${day}.ndjson`), `${lines.join("\n")}\n`, { mode: 0o600 });
			return lines.length;
		} catch {
			return 0;
		}
	}

	/**
	 * Query the index for one tenant.
	 *
	 * The result is bounded by the page limit and by the day budget, and the
	 * caller is always a tenant: there is no way to query another tenant
	 * because the tenant comes from the parameter, which the server fills
	 * from the authenticated credential.
	 */
	query(params: LogQueryParams): LogQueryResult {
		const limit = Math.min(params.limit ?? this.defaultLimit, this.maxLimit);
		const days = this.dayRange(params);
		const dir = join(this.dir, safeSegment(params.tenantId));

		const matches: LogIndexEntry[] = [];
		let scannedFiles = 0;
		let truncated = days.truncated;

		for (const day of days.days) {
			const path = join(dir, `${day}.ndjson`);
			if (!existsSync(path)) continue;
			scannedFiles++;
			let content: string;
			try {
				content = readFileSync(path, "utf8");
			} catch {
				continue;
			}
			for (const line of content.split("\n")) {
				if (!line.trim()) continue;
				let entry: LogIndexEntry;
				try {
					entry = JSON.parse(line) as LogIndexEntry;
				} catch {
					continue;
				}
				if (!this.matches(entry, params)) continue;
				matches.push(entry);
			}
		}

		matches.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

		const cursor = params.cursor ? decodeCursor(params.cursor) : undefined;
		let start = 0;
		if (cursor) {
			const index = matches.findIndex((entry) => `${entry.ts}|${entry.batchId}` === cursor);
			start = index >= 0 ? index + 1 : 0;
		}

		const page = matches.slice(start, start + limit);
		const hasMore = start + limit < matches.length;
		const result: LogQueryResult = {
			entries: page,
			hasMore,
			scannedFiles,
			truncated,
		};
		if (hasMore && page.length > 0) {
			const last = page[page.length - 1];
			result.nextCursor = encodeCursor(`${last.ts}|${last.batchId}`);
		}
		return result;
	}

	private matches(entry: LogIndexEntry, params: LogQueryParams): boolean {
		if (entry.tenantId !== params.tenantId) return false;
		if (params.installationId && entry.installationId !== params.installationId) return false;
		if (params.sessionId && entry.sessionId !== params.sessionId) return false;
		if (params.levels && params.levels.length > 0 && !params.levels.includes(entry.level)) {
			return false;
		}
		if (params.source && entry.source !== params.source) return false;
		if (params.event && entry.event !== params.event) return false;
		if (params.since && entry.ts < params.since) return false;
		if (params.until && entry.ts >= params.until) return false;
		return true;
	}

	private dayRange(params: LogQueryParams): { days: string[]; truncated: boolean } {
		const now = new Date();
		const until = params.until ? new Date(params.until) : now;
		// The budget counts the scanned days, so the default window covers
		// exactly `maxScanDays` days including the day of `until`.
		const since = params.since
			? new Date(params.since)
			: new Date(until.getTime() - (this.maxScanDays - 1) * 86_400_000);

		const days: string[] = [];
		const cursor = new Date(since);
		let truncated = false;
		while (cursor <= until && days.length < this.maxScanDays) {
			days.push(toIsoDay(cursor));
			cursor.setUTCDate(cursor.getUTCDate() + 1);
		}
		if (cursor <= until) truncated = true;

		return { days, truncated };
	}
}
