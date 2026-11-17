/**
 * The routing of a plan handoff to its recipient.
 *
 * The sender publishes a plan for the workspace it runs in. The recipient is
 * the Pi instance of that same workspace, addressed by its unique agent id
 * and its session id. The rules are:
 *
 * - exactly one live instance of the workspace: it is selected, without a
 *   question to the user,
 * - several live instances: an existing live pairing decides, otherwise the
 *   candidates are exposed and the user chooses,
 * - no live instance: the plan is retained as awaiting a recipient,
 * - an instance of another project never receives the plan.
 *
 * The model label never decides. The globally newest session never decides.
 */
import { canonicalizePath } from "./workspace.js";
/**
 * The registrations that live in the workspace of the sender.
 *
 * The match is an exact match of the canonical workspace and of the host. A
 * workspace that only shares a name, a repository or a branch is another
 * workspace.
 */
export function matchingRegistrations(workspace, registrations, host) {
    const target = canonicalizePath(workspace);
    return registrations.filter((registration) => {
        if (canonicalizePath(registration.workspace) !== target)
            return false;
        if (host !== undefined && registration.host !== host)
            return false;
        return true;
    });
}
/**
 * Resolve the recipient of a plan.
 */
export function resolveRecipient(options) {
    const { workspace, host, registrations, pairing } = options;
    const candidates = matchingRegistrations(workspace, registrations, host);
    if (candidates.length === 0) {
        return {
            status: "awaiting",
            candidates,
            reason: "no live Pi instance runs in this workspace: the plan is retained until one is available",
        };
    }
    if (candidates.length === 1) {
        return {
            status: "selected",
            registration: candidates[0],
            candidates,
            reason: "exactly one live instance of the workspace was found",
        };
    }
    if (pairing) {
        const paired = candidates.find((candidate) => candidate.agentId === pairing.agentId &&
            (pairing.sessionId === undefined ||
                candidate.sessionId === pairing.sessionId));
        if (paired) {
            return {
                status: "selected",
                registration: paired,
                candidates,
                reason: "the existing pairing names a live instance of the workspace",
            };
        }
    }
    return {
        status: "ambiguous",
        candidates,
        reason: "several live instances share the workspace: the recipient has to be selected",
    };
}
//# sourceMappingURL=routing.js.map