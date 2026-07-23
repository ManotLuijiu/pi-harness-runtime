/**
 * Approval Class — RFC-0101 §8
 *
 * Replaces runtime-wide `require-approval` flag with per-capability policies.
 * Human approves or denies on first use; decision is cached for subsequent uses
 * within the same session.
 */
import type { ApprovalClass, CapabilityName } from "./types.js";
/** Result of an approval check. */
export type ApprovalResult = "granted" | "denied" | "error";
/**
 * Register an approval class by id.
 * Must be called before any checkApproval() call.
 */
export declare function registerApprovalClass(cls: ApprovalClass): void;
/**
 * Check if a capability is approved for an actor.
 * Asks the human via requestor() on first use; caches for the session.
 */
export declare function checkApproval(capability: CapabilityName, actor: string, requestor: (msg: string) => Promise<boolean>): Promise<ApprovalResult>;
/** Clear the approval cache (e.g., at session start). */
export declare function clearApprovalCache(): void;
//# sourceMappingURL=approval.d.ts.map