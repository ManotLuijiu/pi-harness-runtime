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
import type { LogRecord } from "./types.js";
export interface ClassificationPolicy {
    /** Events that may go remote. */
    remoteEvents: RegExp[];
    /** Events that never go remote, whatever the level is. */
    localEvents: RegExp[];
    /** Keep a message even when it does not look sanitized. */
    allowRawMessages: boolean;
    /** Maximum length of a message that is kept. */
    maxMessageLength: number;
}
/**
 * Events that stay local.
 *
 * `harness.log` is the mirror of the catch-all local log line - it carries
 * whatever the harness printed, so it is never remote.
 */
export declare const DEFAULT_LOCAL_EVENTS: RegExp[];
/**
 * Events that may go remote.
 *
 * They are structured: a service state change, a session lifecycle event, a
 * validation tier, a provider or quota event.
 */
export declare const DEFAULT_REMOTE_EVENTS: RegExp[];
export declare const DEFAULT_CLASSIFICATION_POLICY: ClassificationPolicy;
/**
 * True when a message looks like a sanitized summary and may travel.
 */
export declare function isSanitizedMessage(message: string, policy: ClassificationPolicy): boolean;
/**
 * Classify one record.
 *
 * "remote" means the record may be shipped; "local" means it must stay on
 * the machine.
 */
export declare function classifyRecord(record: LogRecord, policy?: ClassificationPolicy): "remote" | "local";
/**
 * Build the version of a record that may leave the machine.
 *
 * Returns null when the record must stay local.
 */
export declare function prepareRemoteRecord(record: LogRecord, policy?: ClassificationPolicy): LogRecord | null;
/** Keep only the records that may leave the machine. */
export declare function filterRemoteRecords(records: LogRecord[], policy?: ClassificationPolicy): LogRecord[];
//# sourceMappingURL=classification.d.ts.map