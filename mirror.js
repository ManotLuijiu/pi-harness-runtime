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
/**
 * Canonical lowercase provider ids — mirrors the KNOWN_AI_PROVIDERS from
 * packages/types/src/ai-providers.ts. Duplicated here to avoid import path
 * resolution issues in the root workspace.
 */
const KNOWN_PROVIDER_IDS = [
    "minimax",
    "openai",
    "anthropic",
    "glm",
    "openrouter",
    "openai-codex",
    "deepseek",
    "gemini",
    "kimi",
];
function isKnownProvider(id) {
    return KNOWN_PROVIDER_IDS.includes(id);
}
const STALE_WARN_MS = 30 * 60 * 1000; // 30 min → orange
const STALE_ERROR_MS = 2 * 60 * 60 * 1000; // 2 h   → red
/**
 * Detect whether a raw read looks like a legacy single-row shape
 * (i.e. not yet the per-provider map). Used to gate the upgrade path.
 */
function isLegacyShape(raw) {
    if (!raw || typeof raw !== "object")
        return false;
    const obj = raw;
    if ("provider" in obj && typeof obj.provider === "string") {
        // Legacy single-row shape: has flat provider string, no map-of-records structure.
        return true;
    }
    return false;
}
/** Convert a legacy single-row record to per-provider shape. */
function upgradeLegacyRecord(legacy) {
    const provider = legacy.provider ?? "minimax";
    const known = isKnownProvider(provider) ? provider : "minimax";
    const rec = {
        synced_at: legacy.synced_at ?? new Date().toISOString(),
        provider: known,
        source: "scrape", // legacy was always scrape
        model: legacy.model,
        h5_used_pct: legacy.h5_used_pct,
        h5_resets_at: legacy.h5_resets_at,
        weekly_used_pct: legacy.weekly_used_pct,
        weekly_resets_at: legacy.weekly_resets_at,
    };
    return { [known]: rec };
}
export class MirrorStore {
    path;
    constructor(path = getMirrorPath()) {
        this.path = path;
    }
    /** Read the mirror record. LEGACY: returns whatever is in the file. */
    read() {
        const raw = readJson(this.path);
        if (!raw || typeof raw !== "object")
            return null;
        return raw;
    }
    /**
     * Read the entire per-provider mirror. Auto-migrates legacy shape
     * on first read after upgrade. Returns null if the file is missing
     * or corrupted.
     */
    readAll() {
        const raw = readJson(this.path);
        if (!raw || typeof raw !== "object")
            return null;
        if (isLegacyShape(raw)) {
            const upgraded = upgradeLegacyRecord(raw);
            if (upgraded) {
                // Persist the upgrade so subsequent reads are fast.
                try {
                    writeJson(this.path, upgraded);
                }
                catch {
                    // best-effort
                }
                return upgraded;
            }
            // Unknown legacy provider — treat as absent.
            return null;
        }
        // Already per-provider shape.
        const out = {};
        for (const [k, v] of Object.entries(raw)) {
            if (v && typeof v === "object") {
                out[k] = v;
            }
        }
        return Object.keys(out).length > 0 ? out : null;
    }
    /** Read a single provider's record. Returns null if missing. */
    readProvider(provider) {
        const all = this.readAll();
        if (!all)
            return null;
        return all[provider] ?? null;
    }
    /** Write a single provider's record (overwrites just that key). */
    writeProvider(provider, record) {
        const all = this.readAll() ?? {};
        all[provider] = record;
        writeJson(this.path, all);
    }
    /** Write a new mirror record (overwrites). LEGACY: deprecated, use writeProvider. */
    write(record) {
        // If the caller passes a record that already has a provider key,
        // route through writeProvider so we keep the per-provider shape.
        if (record &&
            typeof record === "object" &&
            "provider" in record &&
            typeof record.provider === "string") {
            const r = record;
            const provider = r.provider ?? "minimax";
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
    freshness(record, nowMs) {
        if (!record || !record.synced_at)
            return "missing";
        const syncedMs = Date.parse(record.synced_at);
        if (isNaN(syncedMs))
            return "missing";
        const ageMs = nowMs - syncedMs;
        if (ageMs < STALE_WARN_MS)
            return "fresh";
        if (ageMs < STALE_ERROR_MS)
            return "stale";
        return "expired";
    }
    /** True if data is too stale to trust (> 2 hours old). */
    isExpired(record, nowMs) {
        return this.freshness(record, nowMs) === "expired";
    }
    /** Convenience: human-readable age like "5 min ago" or "1 d 2 h ago". */
    ageString(record, nowMs) {
        if (!record || !record.synced_at)
            return "never";
        const syncedMs = Date.parse(record.synced_at);
        if (isNaN(syncedMs))
            return "unknown";
        const delta = nowMs - syncedMs;
        const sec = Math.floor(delta / 1000);
        if (sec < 60)
            return `${sec}s ago`;
        const min = Math.floor(sec / 60);
        if (min < 60)
            return `${min} min ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24)
            return `${hr} h ago`;
        const day = Math.floor(hr / 24);
        return `${day} d ago`;
    }
}
