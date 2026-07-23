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

/** Cache of session-level approval decisions. */
const approved = new Map<string, ApprovalResult>();

/** Map from class id → its policy. */
const classes = new Map<string, ApprovalClass>();

function cacheKey(capability: CapabilityName, actor: string): string {
	return `${actor}::${capability}`;
}

/**
 * Register an approval class by id.
 * Must be called before any checkApproval() call.
 */
export function registerApprovalClass(cls: ApprovalClass): void {
	classes.set(cls.id, cls);
}

/**
 * Check if a capability is approved for an actor.
 * Asks the human via requestor() on first use; caches for the session.
 */
export async function checkApproval(
	capability: CapabilityName,
	actor: string,
	requestor: (msg: string) => Promise<boolean>,
): Promise<ApprovalResult> {
	const key = cacheKey(capability, actor);
	if (approved.has(key)) {
		return approved.get(key)!;
	}

	// Find the approval class for this capability
	const cls = classes.get(capability);
	if (!cls) {
		// No approval class registered — default deny
		approved.set(key, "denied");
		return "denied";
	}

	try {
		const decision = await cls.prompt(
			capability,
			actor,
			`Allow capability "${capability}" for actor "${actor}"?`,
		);
		approved.set(key, decision);
		return decision;
	} catch {
		approved.set(key, "error");
		return "error";
	}
}

/** Clear the approval cache (e.g., at session start). */
export function clearApprovalCache(): void {
	approved.clear();
}
