/**
 * Event Store — JSONL-backed immutable event store
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	createReadStream,
	createWriteStream,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type {
	SessionEvent,
	SessionEventType,
	WriteResult,
	ReadOptions,
	SearchOptions,
	StoreOptions,
	StoreStats,
} from "./types.js";

export class EventStore {
	private readonly sessionsDir: string;

	constructor(opts: StoreOptions = {}) {
		this.sessionsDir = opts.sessionsDir ?? join(homedir(), ".pi", "sessions");
		if (!existsSync(this.sessionsDir)) {
			mkdirSync(this.sessionsDir, { recursive: true });
		}
	}

	getPath(sessionId: string): string {
		return join(this.sessionsDir, `${sessionId}.jsonl`);
	}

	async append(
		event: Omit<SessionEvent, "id" | "timestamp">,
	): Promise<WriteResult> {
		const id = randomUUID();
		const timestamp = new Date().toISOString();
		const full: SessionEvent = { ...event, id, timestamp };
		const line = JSON.stringify(full) + "\n";
		const path = this.getPath(full.sessionId);
		const dir = dirname(path);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		appendFileSync(path, line, "utf8");
		return { id, timestamp, bytesWritten: Buffer.byteLength(line, "utf8") };
	}

	async read(opts: ReadOptions = {}): Promise<SessionEvent[]> {
		const events: SessionEvent[] = [];
		const limit = opts.limit ?? Infinity;
		const offset = opts.offset ?? 0;
		let skipped = 0;

		const sessionIds = opts.sessionId ? [opts.sessionId] : this.list();

		for (const sid of sessionIds) {
			const path = this.getPath(sid);
			if (!existsSync(path)) continue;

			const stream = createReadStream(path, {
				encoding: "utf8",
				highWaterMark: 64 * 1024,
			});
			let buffer = "";

			for await (const chunk of stream) {
				buffer += chunk;
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const evt = JSON.parse(line) as SessionEvent;
						if (opts.since && evt.timestamp <= opts.since) continue;
						if (opts.types && !opts.types.includes(evt.type)) continue;
						if (skipped < offset) {
							skipped++;
							continue;
						}
						events.push(evt);
						if (events.length >= limit) {
							stream.destroy();
							return events;
						}
					} catch {
						// skip corrupt lines
					}
				}
			}
		}

		return events;
	}

	async search(opts: SearchOptions): Promise<SessionEvent[]> {
		const events: SessionEvent[] = [];
		const limit = opts.limit ?? 100;
		const query = opts.query.toLowerCase();

		const sessionIds = opts.sessionId ? [opts.sessionId] : this.list();

		for (const sid of sessionIds) {
			const path = this.getPath(sid);
			if (!existsSync(path)) continue;

			const stream = createReadStream(path, { encoding: "utf8" });
			for await (const chunk of stream) {
				const lines = String(chunk).split("\n");
				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const evt = JSON.parse(line) as SessionEvent;
						if (evt.content?.toLowerCase().includes(query)) {
							events.push(evt);
							if (events.length >= limit) {
								stream.destroy();
								return events;
							}
						}
					} catch {
						// skip
					}
				}
			}
		}

		return events;
	}

	stats(sessionId: string): StoreStats {
		const path = this.getPath(sessionId);
		if (!existsSync(path)) {
			return { sessionId, totalEvents: 0, sizeBytes: 0, lastEventAt: null };
		}
		const st = statSync(path);
		const events = readFileSync(path, "utf8").split("\n").filter(Boolean);
		const last =
			events.length > 0
				? (JSON.parse(events[events.length - 1]) as SessionEvent).timestamp
				: null;
		return {
			sessionId,
			totalEvents: events.length,
			sizeBytes: st.size,
			lastEventAt: last,
		};
	}

	list(): string[] {
		try {
			const { readdirSync } = require("node:fs");
			return readdirSync(this.sessionsDir)
				.filter((f: string) => f.endsWith(".jsonl"))
				.map((f: string) => f.replace(".jsonl", ""));
		} catch {
			return [];
		}
	}
}
