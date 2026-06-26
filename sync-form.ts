/**
 * Sync form — opens an interactive form for the user to mirror provider-side
 * quota from console.minimax.io (or any provider dashboard).
 *
 * Uses ctx.ui.custom() to build a small TUI form with 4 fields:
 *   - 5h used %   (number 0-100)
 *   - 5h resets in (h, m)
 *   - weekly %    (number 0-100)
 *   - weekly resets in (d, h)
 *
 * On submit, writes a MirrorRecord to disk.
 */

import type { MirrorRecord } from "./mirror.ts";
import type { MirrorStore } from "./mirror.ts";

export interface SyncFormValues {
	h5_used_pct: number;
	h5_resets_h: number;
	h5_resets_m: number;
	weekly_used_pct: number;
	weekly_resets_d: number;
	weekly_resets_h: number;
}

/** Compute ISO 8601 reset time from "in Hh Mm" relative to now. */
export function computeResetIso(nowMs: number, h: number, m: number): string {
	return new Date(nowMs + h * 3600_000 + m * 60_000).toISOString();
}

/** Build a MirrorRecord from form values. */
export function buildMirrorRecord(
	values: SyncFormValues,
	provider: string,
	nowMs: number,
): MirrorRecord {
	return {
		synced_at: new Date(nowMs).toISOString(),
		provider,
		h5_used_pct: values.h5_used_pct,
		h5_resets_at: computeResetIso(nowMs, values.h5_resets_h, values.h5_resets_m),
		weekly_used_pct: values.weekly_used_pct,
		weekly_resets_at: computeResetIso(nowMs, values.weekly_resets_d * 24 + values.weekly_resets_h, 0),
	};
}

/**
 * Open the sync form. Implemented as a thin wrapper around ctx.ui.custom()
 * — the actual TUI component lives in sync-form-ui.ts (or inline here).
 *
 * For simplicity (and testability), this file exports the pure form-data
 * conversion. The actual TUI rendering is handled in index.ts which has
 * access to ExtensionContext.
 */
export async function handleSyncSubmit(
	values: SyncFormValues,
	mirrorStore: MirrorStore,
	provider: string = "minimax",
): Promise<MirrorRecord> {
	const now = Date.now();
	const record = buildMirrorRecord(values, provider, now);
	mirrorStore.write(record);
	return record;
}

/**
 * Parse a mirror record from raw form input strings (validates).
 * Returns null if invalid.
 */
export function parseSyncValues(input: {
	h5_used_pct: string;
	h5_resets_h: string;
	h5_resets_m: string;
	weekly_used_pct: string;
	weekly_resets_d: string;
	weekly_resets_h: string;
}): SyncFormValues | null {
	const h5_used = Number(input.h5_used_pct);
	const h5_h = Number(input.h5_resets_h);
	const h5_m = Number(input.h5_resets_m);
	const wk_used = Number(input.weekly_used_pct);
	const wk_d = Number(input.weekly_resets_d);
	const wk_h = Number(input.weekly_resets_h);

	if (
		!Number.isFinite(h5_used) || h5_used < 0 || h5_used > 100 ||
		!Number.isFinite(h5_h) || h5_h < 0 || h5_h > 24 ||
		!Number.isFinite(h5_m) || h5_m < 0 || h5_m > 59 ||
		!Number.isFinite(wk_used) || wk_used < 0 || wk_used > 100 ||
		!Number.isFinite(wk_d) || wk_d < 0 || wk_d > 7 ||
		!Number.isFinite(wk_h) || wk_h < 0 || wk_h > 23
	) {
		return null;
	}

	return {
		h5_used_pct: h5_used,
		h5_resets_h: h5_h,
		h5_resets_m: h5_m,
		weekly_used_pct: wk_used,
		weekly_resets_d: wk_d,
		weekly_resets_h: wk_h,
	};
}