/**
 * MirrorStore — cached per-provider quota snapshot.
 *
 * Auto refresh writes per-provider data to ~/.pi/usage-status/mirror.json so
 * the footer status and `/usage` can render the latest provider-side
 * usage. Local tracking counts OUR usage; the mirror counts what's
 * currently knowable from the provider (continuous for MiniMax via
 * scrape; one-shot TUI signal for OpenAI / GLM / etc.).
 *
 * Shape (per-provider map):
 *
 * ```jsonc
 * {
 *   "minimax": {
 *     "synced_at": "2026-07-23T06:20:04Z",
 *     "source": "scrape" | "tui-signal",
 *     "h5_used_pct": 15,
 *     "h5_resets_at": "3 hr 39 min",
 *     "weekly_used_pct": 21,
 *     "weekly_resets_at": "3 days 17 hr 39 min"
 *   },
 *   "openai": { ... }
 * }
 * ```
 *
 * Back-compat: legacy single-row files are read and upgraded in place
 * on the first `readAll()` call after upgrade. Old rows that match a
 * known provider (have a `provider` field) are placed under that key.
 *
 * Models live here: `~/.pi/usage-status/mirror.json`.
 */

import { getMirrorPath, readJson, writeJson } from "./cli.ts";

/** Where a piece of data came from. */
export type MirrorSource = "scrape" | "tui-signal" | "manual";

/** Per-provider mirror record. */
export interface ProviderMirrorRecord {
	/** ISO-8601 UTC timestamp when this row was last updated. */
	synced_at: string;
	/** Provider id (e.g. "minimax", "openai", "glm"). Must match the key. */
	provider: string;
	/** Source of the data — used for diagnostics. */
	source: MirrorSource;
	/** Optional model id the data was captured for. */
	model?: string;
	/** 5h window used percent (0-100). Provider-reported when available. */
	h5_used_pct?: number;
	/** When the 5h window resets — human-readable or ISO. */
	h5_resets_at?: string;
	/** Weekly used percent. */
	weekly_used_pct?: number;
	/** When the weekly window resets. */
	weekly_resets_at?: string;
	/** Set when a limit was hit and we have the exhaustion signal. */
	exhausted?: boolean;
	/** Limit type from TUI signal: tokens, context_window, rate_limit, unknown. */
	limitType?: "tokens" | "context_window" | "rate_limit" | "unknown";
	/** Remaining pct (0-100) at exhaustion — 0 means exactly exhausted. */
	remainingPct?: number;
	/** ISO-8601 reset timestamp from TUI signal, if absolute. */
	resets_at?: string;
}

/** Map of provider id → its mirror record. */
export type PerProviderMirror = Record<string, ProviderMirrorRecord>;

/**
 * Legacy single-row shape — accepted on read and migrated forward on
 * the first `readAll()` call after upgrade. Writers should use the
 * per-provider shape via `writeProvider(provider, record)`.
 */
export interface MirrorRecord {
	synced_at: string;
	provider?: string;
	model?: string;
	h5_used_pct?: number;
	h5_resets_at?: string;
	weekly_used_pct?: number;
	weekly_resets_at?: string;
}

/** Known provider ids used as keys in the per-provider map. */
export type KnownProviderId =
	| "minimax"
	| "openai"
	| "openai-codex"
	| "glm"
	| "anthropic"
	| "openrouter"
	| (string & {}); // allow extension

const STALE_WARN_MS = 30 * 60 * 1000; // 30 min → orange
const STALE_ERROR_MS = 2 * 60 * 60 * 1000; // 2 h   → red

/**
 * Detect whether a raw read looks like a legacy single-row shape
 * (i.e. not yet the per-provider map). Used to gate the upgrade path.
 */
function isLegacyShape(raw: unknown): raw is MirrorRecord & {
	provider: string;
	[key: string]: unknown;
} {
	if (!raw || typeof raw !== "object") return false;
	const obj = raw as Record<string, unknown>;
	if ("provider" in obj && typeof obj.provider === "string") {
		// Legacy single-row shape: has flat provider string, no map-of-records structure.
		return true;
	}
	return false;
}

/** Convert a legacy single-row record to per-provider shape. */
function upgradeLegacyRecord(legacy: MirrorRecord): PerProviderMirror {
	const provider = legacy.provider ?? "minimax";
	const rec: ProviderMirrorRecord = {
		synced_at: legacy.synced_at ?? new Date().toISOString(),
		provider,
		source: "scrape", // legacy was always scrape
		model: legacy.model,
		h5_used_pct: legacy.h5_used_pct,
		h5_resets_at: legacy.h5_resets_at,
		weekly_used_pct: legacy.weekly_used_pct,
		weekly_resets_at: legacy.weekly_resets_at,
	};
	return { [provider]: rec };
}

export class MirrorStore {
	private path: string;

	constructor(path: string = getMirrorPath()) {
		this.path = path;
	}

	/** Read the mirror record. LEGACY: returns whatever is in the file. */
	read(): MirrorRecord | null {
		const raw = readJson(this.path);
		if (!raw || typeof raw !== "object") return null;
		return raw as MirrorRecord;
	}

	/**
	 * Read the entire per-provider mirror. Auto-migrates legacy shape
	 * on first read after upgrade. Returns null if the file is missing
	 * or corrupted.
	 */
	readAll(): PerProviderMirror | null {
		const raw = readJson(this.path);
		if (!raw || typeof raw !== "object") return null;

		if (isLegacyShape(raw)) {
			const upgraded = upgradeLegacyRecord(raw as MirrorRecord);
			// Persist the upgrade so subsequent reads are fast.
			try {
				writeJson(this.path, upgraded);
			} catch {
				// best-effort
			}
			return upgraded;
		}

		// Already per-provider shape.
		const out: PerProviderMirror = {};
		for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
			if (v && typeof v === "object") {
				out[k] = v as ProviderMirrorRecord;
			}
		}
		return Object.keys(out).length > 0 ? out : null;
	}

	/** Read a single provider's record. Returns null if missing. */
	readProvider(provider: string): ProviderMirrorRecord | null {
		const all = this.readAll();
		if (!all) return null;
		return all[provider] ?? null;
	}

	/** Write a single provider's record (overwrites just that key). */
	writeProvider(provider: string, record: ProviderMirrorRecord): void {
		const all = this.readAll() ?? {};
		all[provider] = record;
		writeJson(this.path, all);
	}

	/** Write a new mirror record (overwrites). LEGACY: deprecated, use writeProvider. */
	write(record: MirrorRecord): void {
		// If the caller passes a record that already has a provider key,
		// route through writeProvider so we keep the per-provider shape.
		if (
			record &&
			typeof record === "object" &&
			"provider" in record &&
			typeof (record as { provider: unknown }).provider === "string"
		) {
			const r = record as MirrorRecord;
			const provider = (r.provider as string) ?? "minimax";
			const prev = this.readProvider(provider);
			this.writeProvider(provider, {
				synced_at: r.synced_at ?? new Date().toISOString(),
				provider,
				source: prev?.source ?? "scrape",
				model: r.model ?? prev?.model,
				h5_used_pct: r.h5_used_pct ?? prev?.h5_used_pct,
				h5_resets_at: r.h5_resets_at ?? prev?.h5_resets_at,
				weekly_used_pct: r.weekly_used_pct ?? prev?.weekly_used_pct,
				weekly_resets_at: r.weekly_resets_at ?? prev?.weekly_resets_at,
			});
			return;
		}
		writeJson(this.path, record);
	}

	/** Returns "fresh" | "stale" | "expired" based on age. */
	freshness(
		record: ProviderMirrorRecord | MirrorRecord | null,
		nowMs: number,
	): "fresh" | "stale" | "expired" | "missing" {
		if (!record || !record.synced_at) return "missing";
		const syncedMs = Date.parse(record.synced_at);
		if (isNaN(syncedMs)) return "missing";
		const ageMs = nowMs - syncedMs;
		if (ageMs < STALE_WARN_MS) return "fresh";
		if (ageMs < STALE_ERROR_MS) return "stale";
		return "expired";
	}

	/** True if data is too stale to trust (> 2 hours old). */
	isExpired(
		record: ProviderMirrorRecord | MirrorRecord | null,
		nowMs: number,
	): boolean {
		return this.freshness(record, nowMs) === "expired";
	}

	/** Convenience: human-readable age like "5 min ago" or "1 d 2 h ago". */
	ageString(
		record: ProviderMirrorRecord | MirrorRecord | null,
		nowMs: number,
	): string {
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
