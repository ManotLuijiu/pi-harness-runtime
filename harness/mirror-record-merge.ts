/**
 * The merge of a mirror record with the row it replaces.
 *
 * The mirror holds one row per provider, and a row holds everything the
 * harness knows about the quota of that provider: the used percentage of
 * the five-hour window, the used percentage of the weekly window, the
 * moments of their resets and the source of the data.
 *
 * Not every write knows all of it. A capture of the quota of the console
 * knows every window. A signal of the TUI knows only that the provider
 * reported a limit, and it carries the remaining percentage of a window it
 * does not name. Such a write replaces the row as it stands, and the
 * evidence of the windows is gone - at the very moment the recovery needs
 * it, because the signal arrives with the failure of the provider.
 *
 * The merge keeps the evidence of the windows and the moment it was
 * observed. A row that carries evidence from an earlier capture is as old
 * as that capture: nothing in the row claims to be fresher than the
 * numbers it holds.
 */

import type { ProviderMirrorRecord } from "../mirror.ts";

/**
 * Does the record know about a quota window?
 */
function hasWindowEvidence(
	record: ProviderMirrorRecord | null | undefined,
): boolean {
	if (!record) return false;
	return (
		typeof record.h5_used_pct === "number" ||
		typeof record.weekly_used_pct === "number"
	);
}

/**
 * Merge a new record with the row it replaces.
 *
 * A record that knows a window is a full observation: it replaces the row
 * as it stands, because it is newer than the row and it knows more. A
 * record that knows no window is a reduced observation: it adds what it
 * knows and keeps the evidence of the windows.
 */
export function mergeMirrorRecord(
	previous: ProviderMirrorRecord | null | undefined,
	next: ProviderMirrorRecord,
): ProviderMirrorRecord {
	if (!previous) return next;
	if (hasWindowEvidence(next) || !hasWindowEvidence(previous)) {
		// A full observation replaces the row. The model of the provider is
		// kept when the new observation does not name one.
		return { ...next, model: next.model ?? previous.model };
	}
	// A reduced observation: the windows of the row stay, and the row is as
	// old as the evidence it carries.
	return {
		...previous,
		...next,
		synced_at: previous.synced_at,
		source: previous.source,
		model: next.model ?? previous.model,
	};
}
