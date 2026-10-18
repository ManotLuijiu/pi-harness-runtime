/**
 * Base schemas for pi-harness contracts
 */
import { z } from 'zod';
/**
 * Base64-encoded content
 */
export const Base64Content = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);
/**
 * ISO 8601 timestamp
 */
export const Timestamp = z.string().datetime();
/**
 * UUID v4
 */
export const UUID = z.string().uuid();
/**
 * Non-empty string
 */
export const NonEmptyString = z.string().min(1);
/**
 * Positive integer
 */
export const PositiveInt = z.number().int().positive();
/**
 * Generic success result wrapper
 */
export function success(data) {
    return { ok: true, data };
}
/**
 * Generic error result wrapper
 */
export function error(message, code) {
    return { ok: false, error: { message, code } };
}
/**
 * Base64 encode utility (pure TypeScript, no DOM dependencies)
 */
export function base64Encode(str) {
    // Use Node.js Buffer if available (most common in runtime)
    // Otherwise use manual base64 encoding
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    let i = 0;
    while (i < str.length) {
        const a = str.charCodeAt(i++);
        const b = i < str.length ? str.charCodeAt(i++) : 0;
        const c = i < str.length ? str.charCodeAt(i++) : 0;
        const triplet = (a << 16) | (b << 8) | c;
        result += chars[(triplet >> 18) & 0x3f];
        result += chars[(triplet >> 12) & 0x3f];
        result += i - 2 < str.length ? chars[(triplet >> 6) & 0x3f] : '=';
        result += i - 1 < str.length ? chars[triplet & 0x3f] : '=';
    }
    return result;
}
/**
 * Base64 decode utility (pure TypeScript, no DOM dependencies)
 */
export function base64Decode(str) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    let i = 0;
    // Remove padding
    const cleanStr = str.replace(/=/g, '');
    while (i < cleanStr.length) {
        const a = chars.indexOf(cleanStr[i++]);
        const b = i < cleanStr.length ? chars.indexOf(cleanStr[i++]) : 0;
        const c = i < cleanStr.length ? chars.indexOf(cleanStr[i++]) : 0;
        const d = i < cleanStr.length ? chars.indexOf(cleanStr[i++]) : 0;
        const triplet = (a << 18) | (b << 12) | (c << 6) | d;
        result += String.fromCharCode((triplet >> 16) & 0xff);
        if (cleanStr[i - 2] !== undefined) {
            result += String.fromCharCode((triplet >> 8) & 0xff);
        }
        if (cleanStr[i - 1] !== undefined) {
            result += String.fromCharCode(triplet & 0xff);
        }
    }
    return result;
}
