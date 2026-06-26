/**
 * MirrorStore — manual sync of provider-side quota from console.
 *
 * User periodically glances at https://platform.minimax.io/console/usage
 * and runs `/usage sync` to enter:
 *   - 5h used %
 *   - 5h resets in (h, m)
 *   - weekly used %
 *   - weekly resets in (d, h)
 *
 * This is the "ground truth" since most providers (MiniMax, Anthropic, OpenAI)
 * don't expose rate limit headers publicly. Local tracking counts OUR usage
 * only; the mirror counts TOTAL quota usage across all clients.
 *
 * File: ~/.pi/usage-status/mirror.json
 */

import {
	getMirrorPath,
	readJson,
	writeJson,
} from "./cli.ts";

export interface MirrorRecord {
	synced_at: string;           // ISO 8601 UTC
	provider: string;            // e.g. "minimax"
	model?: string;              // optional, e.g. "minimax/MiniMax-M3"
	h5_used_pct?: number;        // 0-100
	h5_resets_at?: string;       // ISO 8601 UTC — provider-reported
	weekly_used_pct?: number;    // 0-100
	weekly_resets_at?: string;   // ISO 8601 UTC — provider-reported
}

const STALE_WARN_MS = 30 * 60 * 1000;   // 30 min → orange
const STALE_ERROR_MS = 2 * 60 * 60 * 1000;  // 2 h   → red

export class MirrorStore {
	private path: string;

	constructor(path: string = getMirrorPath()) {
		this.path = path;
	}

	/** Read the mirror record. Returns null if missing/corrupted. */
	read(): MirrorRecord | null {
		const raw = readJson(this.path);
		if (!raw || typeof raw !== "object") return null;
		return raw as MirrorRecord;
	}

	/** Write a new mirror record (overwrites). */
	write(record: MirrorRecord): void {
		writeJson(this.path, record);
	}

	/** Returns "fresh" | "stale" | "expired" based on age. */
	freshness(record: MirrorRecord | null, nowMs: number): "fresh" | "stale" | "expired" | "missing" {
		if (!record || !record.synced_at) return "missing";
		const syncedMs = Date.parse(record.synced_at);
		if (isNaN(syncedMs)) return "missing";
		const ageMs = nowMs - syncedMs;
		if (ageMs < STALE_WARN_MS) return "fresh";
		if (ageMs < STALE_ERROR_MS) return "stale";
		return "expired";
	}

	/** True if data is too stale to trust (> 2 hours old). */
	isExpired(record: MirrorRecord | null, nowMs: number): boolean {
		return this.freshness(record, nowMs) === "expired";
	}

	/** Convenience: human-readable age like "5 min ago" or "1 d 2 h ago". */
	ageString(record: MirrorRecord | null, nowMs: number): string {
		if (!record || !record.synced_at) return "never";
		const syncedMs = Date.parse(record.synced_at);
		if (isNaN(syncedMs)) return "unknown";
		const delta = nowMs - syncedMs;
		const sec = Math.floor(delta / 1000);
		if (sec < 60) return `${sec}s ago`;
		const min = Math.floor(sec / 60);
		if (min < 60) return `${min} min ago`;
		const hr = Math.floor(min / 60);
		if (hr < 24) return `${hr} h ago`;
		const day = Math.floor(hr / 24);
		return `${day} d ago`;
	}
}