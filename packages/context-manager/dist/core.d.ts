/**
 * Context Manager Core — pressure estimation, TTL, prioritization (RFC-0010)
 */
import type { PressureLevel, TriggerPolicy, ContextItem, SessionScope } from "./types.js";
export declare const DEFAULT_POLICY: TriggerPolicy;
/** Estimate context pressure as a ratio (0-1). */
export declare function estimatePressure(currentTokens: number, maxTokens: number): number;
/** Determine pressure level from a ratio. */
export declare function getPressureLevel(pressure: number, policy?: TriggerPolicy): PressureLevel;
/** Create a new session-scoped context bucket. */
export declare function createSessionScope(id: string): SessionScope;
/** Set TTL on a scope (in milliseconds). */
export declare function setTTL(scope: SessionScope, ttlMs: number): SessionScope;
/** Add an item to a session scope. */
export declare function addToScope(scope: SessionScope, item: ContextItem): SessionScope;
/** Remove expired items from a scope based on TTL. */
export declare function evictExpired(scope: SessionScope): SessionScope;
/** Prioritize items: lower priority number = higher importance. */
export declare function prioritize(items: ContextItem[], limit?: number): ContextItem[];
/** Count tokens using a simple word-based estimator (4 chars/token). */
export declare function estimateTokens(text: string): number;
/** Calculate total tokens in a list of items. */
export declare function calculateTotalTokens(items: ContextItem[]): number;
//# sourceMappingURL=core.d.ts.map