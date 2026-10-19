/**
 * Relay Types - Two-way Streaming Communication
 */
import { randomUUID } from "node:crypto";
// ============================================================================
// Typed Streaming Protocol
// ============================================================================
/**
 * Protocol version for typed streaming
 */
export const PROTOCOL_VERSION = 1;
/**
 * Generate a unique message ID
 */
export function generateMessageId() {
    return randomUUID();
}
/**
 * Create a timestamp
 */
export function createTimestamp() {
    return new Date().toISOString();
}
