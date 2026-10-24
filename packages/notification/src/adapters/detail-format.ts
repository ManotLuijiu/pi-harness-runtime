/**
 * Shared rendering of the notification detail fields.
 *
 * `details.error` is reserved for events that represent an actual failure. A
 * resume trigger ("provider-overload", "post-compact") or a quota detail is a
 * reason, not an error, and must never be rendered under the "Error:" footer.
 *
 * Every adapter renders the detail fields through this module so the labels
 * stay consistent across Telegram, LINE, ntfy and email.
 */

import type { NotificationEvent, NotificationPayload } from "../types.js";

/** Events whose `details.error` really is an error. */
export const ERROR_EVENTS: ReadonlySet<NotificationEvent> = new Set<NotificationEvent>([
	"TaskFailed",
	"E2EFailed",
	"Error",
]);

export function isErrorEvent(event: NotificationEvent): boolean {
	return ERROR_EVENTS.has(event);
}

export interface DetailLine {
	/** "Error" for a real failure, "Reason" for a trigger or a detail. */
	label: "Error" | "Reason";
	value: string;
}

function readString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Render the detail fields of a payload as footer lines.
 *
 * - `details.reason` becomes "Reason: ..." for every event.
 * - `details.error` becomes "Error: ..." for the error events only.
 * - A legacy `details.error` on a non-error event becomes "Reason: ..." so the
 *   information survives when a producer still uses the old field.
 */
export function formatDetailLines(
	details: NotificationPayload["details"],
	event: NotificationEvent,
): DetailLine[] {
	const lines: DetailLine[] = [];
	const reason = readString(details?.reason);
	const error = readString(details?.error);

	if (reason) {
		lines.push({ label: "Reason", value: reason });
	}
	if (error) {
		lines.push({ label: isErrorEvent(event) ? "Error" : "Reason", value: error });
	}

	return lines;
}

/**
 * The same lines as a plain text block, one per line.
 * An empty string when there is nothing to render.
 */
export function formatDetailText(
	details: NotificationPayload["details"],
	event: NotificationEvent,
): string {
	return formatDetailLines(details, event)
		.map((line) => `${line.label}: ${line.value}`)
		.join("\n");
}
