/**
 * What may leave the machine.
 *
 * The local log file keeps everything. The centralized archive keeps what an
 * operator actually needs: service state, event codes, sanitized errors,
 * durations and opaque identifiers.
 *
 * Two rules decide:
 *
 *   1. The event decides. A catch-all mirror of a local log line
 *      (`harness.log`) or anything that smells like a prompt, a response or
 *      command output never leaves the machine.
 *   2. The payload decides. A message only travels when it looks like a
 *      sanitized summary: short, one line, no path and no URL with a query
 *      string. Fields with a private key name are dropped.
 *
 * The diagnostic mode (`PI_LOG_DIAGNOSTIC=1`) relaxes rule 2 for a user who
 * explicitly asked for more, and nothing else.
 */
import { isLocalOnlyFieldKey } from "./sensitive-keys.js";
/**
 * Events that stay local.
 *
 * `harness.log` is the mirror of the catch-all local log line - it carries
 * whatever the harness printed, so it is never remote.
 */
export const DEFAULT_LOCAL_EVENTS = [
    /^harness\.log$/,
    /prompt/i,
    /response/i,
    /transcript/i,
    /output/i,
    /command/i,
    /content/i,
    /message\.text/i,
    /notification\.text/i,
];
/**
 * Events that may go remote.
 *
 * They are structured: a service state change, a session lifecycle event, a
 * validation tier, a provider or quota event.
 */
export const DEFAULT_REMOTE_EVENTS = [
    /^harness\.service-diagnostics\./,
    /^harness\.session\./,
    /^harness\.startup\./,
    /^harness\.shutdown\./,
    /^harness\.planner\.decision$/,
    /^harness\.glm-quota\.quota$/,
    /^validation\./,
    /^tier\./,
    /^service\./,
    /^session\./,
    /^startup\./,
    /^config\./,
    /^provider\./,
    /^quota\./,
    /^logging\./,
    /^jest\./,
];
export const DEFAULT_CLASSIFICATION_POLICY = {
    remoteEvents: DEFAULT_REMOTE_EVENTS,
    localEvents: DEFAULT_LOCAL_EVENTS,
    allowRawMessages: false,
    maxMessageLength: 200,
};
const ABSOLUTE_PATH = /(?:^|\s)\/(?:[\w.-]+\/)+[\w.-]+/;
const URL_WITH_QUERY = /https?:\/\/\S+\?\S+/;
/**
 * True when a message looks like a sanitized summary and may travel.
 */
export function isSanitizedMessage(message, policy) {
    if (policy.allowRawMessages)
        return true;
    if (message.length > policy.maxMessageLength)
        return false;
    if (message.includes("\n"))
        return false;
    if (ABSOLUTE_PATH.test(message))
        return false;
    if (URL_WITH_QUERY.test(message))
        return false;
    return true;
}
/**
 * Classify one record.
 *
 * "remote" means the record may be shipped; "local" means it must stay on
 * the machine.
 */
export function classifyRecord(record, policy = DEFAULT_CLASSIFICATION_POLICY) {
    for (const pattern of policy.localEvents) {
        if (pattern.test(record.event))
            return "local";
    }
    for (const pattern of policy.remoteEvents) {
        if (pattern.test(record.event))
            return "remote";
    }
    // Errors stay valuable even when the event is unknown: the message and
    // the fields are sanitized anyway.
    if (record.level === "warn" || record.level === "error")
        return "remote";
    // Unknown events are local by default: an allowlist is safer than a
    // denylist.
    return "local";
}
/**
 * Build the version of a record that may leave the machine.
 *
 * Returns null when the record must stay local.
 */
export function prepareRemoteRecord(record, policy = DEFAULT_CLASSIFICATION_POLICY) {
    if (classifyRecord(record, policy) === "local")
        return null;
    const remote = {
        ts: record.ts,
        level: record.level,
        source: record.source,
        event: record.event,
    };
    if (record.message !== undefined && isSanitizedMessage(record.message, policy)) {
        remote.message = record.message;
    }
    if (record.sessionId)
        remote.sessionId = record.sessionId;
    if (typeof record.durationMs === "number")
        remote.durationMs = record.durationMs;
    if (record.fields) {
        const fields = {};
        for (const [key, value] of Object.entries(record.fields)) {
            if (isLocalOnlyFieldKey(key))
                continue;
            fields[key] = value;
        }
        if (Object.keys(fields).length > 0)
            remote.fields = fields;
    }
    if (record.error) {
        remote.error = { ...record.error };
    }
    return remote;
}
/** Keep only the records that may leave the machine. */
export function filterRemoteRecords(records, policy = DEFAULT_CLASSIFICATION_POLICY) {
    const remote = [];
    for (const record of records) {
        const prepared = prepareRemoteRecord(record, policy);
        if (prepared)
            remote.push(prepared);
    }
    return remote;
}
//# sourceMappingURL=classification.js.map