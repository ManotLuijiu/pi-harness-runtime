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
/** Events whose `details.error` really is an error. */
export const ERROR_EVENTS = new Set([
    "TaskFailed",
    "E2EFailed",
    "Error",
]);
export function isErrorEvent(event) {
    return ERROR_EVENTS.has(event);
}
/**
 * Human wording for the known resume triggers.
 *
 * The raw code stays in the structured logs; the user facing message gets a
 * wording a human can read.
 */
const TRIGGER_LABELS = {
    "post-compact": "Context compacted",
    "context-compacted": "Context compacted",
    "provider-overload": "Provider overload",
    "quota-reset": "Quota reset",
    "quota-paused": "Quota paused",
    "output-limit": "Output limit reached",
    "session-resume": "Session resumed",
    "auto-resume": "Session auto-resume",
};
/**
 * Turn a trigger code into a human wording.
 *
 * "provider-overload" becomes "Provider overload". An unknown code keeps its
 * words, only the separators and the capitalisation are cleaned up.
 */
export function formatTriggerValue(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return "";
    const known = TRIGGER_LABELS[trimmed.toLowerCase()];
    if (known)
        return known;
    const words = trimmed.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    if (!words)
        return trimmed;
    return words.charAt(0).toUpperCase() + words.slice(1);
}
function readString(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
/**
 * Render the detail fields of a payload as footer lines.
 *
 * - `details.trigger` becomes "Trigger: ..." in a human wording.
 * - `details.reason` becomes "Reason: ..." for every event.
 * - `details.error` becomes "Error: ..." for the error events only.
 * - A legacy `details.error` on a non-error event becomes "Reason: ..." so the
 *   information survives when a producer still uses the old field.
 */
export function formatDetailLines(details, event) {
    const lines = [];
    const trigger = readString(details?.trigger);
    const reason = readString(details?.reason);
    const error = readString(details?.error);
    if (trigger) {
        lines.push({ label: "Trigger", value: formatTriggerValue(trigger) });
    }
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
export function formatDetailText(details, event) {
    return formatDetailLines(details, event)
        .map((line) => `${line.label}: ${line.value}`)
        .join("\n");
}
//# sourceMappingURL=detail-format.js.map