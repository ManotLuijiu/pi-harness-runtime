/**
 * Secret Masking Utility
 *
 * Masks sensitive values in strings before sending to Telegram/other channels.
 * Shows first 4 + last 4 characters for identification.
 */
/**
 * Mask a value showing first and last characters
 */
export declare function maskValue(value: string): string;
/**
 * Check if a field name is sensitive
 */
export declare function isSensitiveField(fieldName: string): boolean;
/**
 * Mask sensitive patterns in a string
 */
export declare function maskString(input: string): string;
/**
 * Mask JSON object fields that are sensitive
 */
export declare function maskObject(obj: unknown, depth?: number): Record<string, unknown> | unknown[] | string | number | boolean | null;
/**
 * Mask a message/notification payload
 */
export declare function maskPayload(obj: unknown): Record<string, unknown> | unknown[] | string | number | boolean | null;
/**
 * Format a value for display, masking if sensitive
 */
export declare function formatValue(key: string, value: unknown): string;
//# sourceMappingURL=mask-secrets.d.ts.map