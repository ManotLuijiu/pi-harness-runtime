/** Cache of session-level approval decisions. */
const approved = new Map();
/** Map from class id → its policy. */
const classes = new Map();
function cacheKey(capability, actor) {
    return `${actor}::${capability}`;
}
/**
 * Register an approval class by id.
 * Must be called before any checkApproval() call.
 */
export function registerApprovalClass(cls) {
    classes.set(cls.id, cls);
}
/**
 * Check if a capability is approved for an actor.
 * Asks the human via requestor() on first use; caches for the session.
 */
export async function checkApproval(capability, actor, requestor) {
    const key = cacheKey(capability, actor);
    if (approved.has(key)) {
        return approved.get(key);
    }
    // Find the approval class for this capability
    const cls = classes.get(capability);
    if (!cls) {
        // No approval class registered — default deny
        approved.set(key, "denied");
        return "denied";
    }
    try {
        const decision = await cls.prompt(capability, actor, `Allow capability "${capability}" for actor "${actor}"?`);
        approved.set(key, decision);
        return decision;
    }
    catch {
        approved.set(key, "error");
        return "error";
    }
}
/** Clear the approval cache (e.g., at session start). */
export function clearApprovalCache() {
    approved.clear();
}
//# sourceMappingURL=approval.js.map