/**
 * Base schemas for pi-harness contracts
 */
import { z } from 'zod';
/**
 * Base64-encoded content
 */
export declare const Base64Content: z.ZodString;
/**
 * ISO 8601 timestamp
 */
export declare const Timestamp: z.ZodString;
/**
 * UUID v4
 */
export declare const UUID: z.ZodString;
/**
 * Non-empty string
 */
export declare const NonEmptyString: z.ZodString;
/**
 * Positive integer
 */
export declare const PositiveInt: z.ZodNumber;
/**
 * Generic success result wrapper
 */
export declare function success<T>(data: T): {
    readonly ok: true;
    readonly data: T;
};
/**
 * Generic error result wrapper
 */
export declare function error(message: string, code?: string): {
    readonly ok: false;
    readonly error: {
        readonly message: string;
        readonly code: string | undefined;
    };
};
/**
 * Result type for operations that can fail
 */
export type Result<T, E = {
    message: string;
    code?: string;
}> = {
    ok: true;
    data: T;
} | {
    ok: false;
    error: E;
};
/**
 * Pagination cursor
 */
export interface PageCursor {
    after?: string;
    before?: string;
    limit?: number;
}
/**
 * Paginated response
 */
export interface Page<T> {
    items: T[];
    nextCursor?: string;
    total?: number;
}
/**
 * Base64 encode utility (pure TypeScript, no DOM dependencies)
 */
export declare function base64Encode(str: string): string;
/**
 * Base64 decode utility (pure TypeScript, no DOM dependencies)
 */
export declare function base64Decode(str: string): string;
