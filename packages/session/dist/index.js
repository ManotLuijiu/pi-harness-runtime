/**
 * Session Manager
 *
 * Session management system with message history, token accounting,
 * policy enforcement, and session persistence.
 */
// ─── Manager ────────────────────────────────────────────────────────────
export { SessionManager, createSessionManager } from "./manager.js";
// ─── Store ────────────────────────────────────────────────────────────
export { SessionStore, createSessionStore } from "./store.js";
// ─── History ─────────────────────────────────────────────────────────
export { MessageHistory, MessageSearch, ContextWindowManager, } from "./history.js";
// ─── Policy ──────────────────────────────────────────────────────────
export { PolicyEngine, RateLimiter, BudgetTracker, createPolicyEngine, } from "./policy.js";
// ─── Types ───────────────────────────────────────────────────────────
export { SDK_VERSION, } from "./types.js";
//# sourceMappingURL=index.js.map