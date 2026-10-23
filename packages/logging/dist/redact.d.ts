/**
 * Secret redaction for log records.
 *
 * Two independent layers, because either one alone leaks:
 *   1. Key based - a field named `apiKey` is replaced wholesale.
 *   2. Value based - a secret embedded in free text (`Bearer abc...`) is
 *      replaced even when the key name is innocuous.
 *
 * The rules are intentionally conservative: over-redacting a log line is
 * cheap, leaking a credential is not.
 */
/**
 * The redacted shape of a log value. Everything that leaves the process is
 * JSON, so the redactor is typed against JSON instead of `unknown`.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
export interface RedactionOptions {
    /** Longest string kept verbatim before truncation. Default 2000. */
    maxStringLength?: number;
    /** Maximum nesting depth kept. Default 5. */
    maxDepth?: number;
    /** Maximum number of keys kept per object. Default 50. */
    maxKeys?: number;
    /** Maximum number of items kept per array. Default 20. */
    maxArrayItems?: number;
    /** Placeholder written instead of a redacted value. */
    placeholder?: string;
}
/** Split a key into lowercase tokens (`apiKey` -> `api`, `key`). */
export declare function splitKeyTokens(key: string): string[];
/** True when the key itself identifies a secret. */
export declare function isSecretKey(key: string): boolean;
/** True when the key holds content that must not be logged verbatim. */
export declare function isSensitiveValueKey(key: string): boolean;
/** Replace credential-looking substrings inside a free-text value. */
export declare function redactText(text: string, placeholder?: string): string;
/** Redact an arbitrary value (strings, numbers, objects, arrays). */
export declare function redactValue(value: unknown, options?: RedactionOptions, depth?: number, keyHint?: string): JsonValue;
/** Redact a flat field bag (the `fields` member of a record). */
export declare function redactFields(fields: Record<string, unknown> | undefined, options?: RedactionOptions): Record<string, JsonValue> | undefined;
//# sourceMappingURL=redact.d.ts.map