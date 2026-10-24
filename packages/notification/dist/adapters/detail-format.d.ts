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
export declare const ERROR_EVENTS: ReadonlySet<NotificationEvent>;
export declare function isErrorEvent(event: NotificationEvent): boolean;
export interface DetailLine {
    /** "Error" for a real failure, "Trigger" for a resume trigger, "Reason" for a detail. */
    label: "Error" | "Reason" | "Trigger";
    value: string;
}
/**
 * Turn a trigger code into a human wording.
 *
 * "provider-overload" becomes "Provider overload". An unknown code keeps its
 * words, only the separators and the capitalisation are cleaned up.
 */
export declare function formatTriggerValue(value: string): string;
/**
 * Render the detail fields of a payload as footer lines.
 *
 * - `details.trigger` becomes "Trigger: ..." in a human wording.
 * - `details.reason` becomes "Reason: ..." for every event.
 * - `details.error` becomes "Error: ..." for the error events only.
 * - A legacy `details.error` on a non-error event becomes "Reason: ..." so the
 *   information survives when a producer still uses the old field.
 */
export declare function formatDetailLines(details: NotificationPayload["details"], event: NotificationEvent): DetailLine[];
/**
 * The same lines as a plain text block, one per line.
 * An empty string when there is nothing to render.
 */
export declare function formatDetailText(details: NotificationPayload["details"], event: NotificationEvent): string;
//# sourceMappingURL=detail-format.d.ts.map