/**
 * The publication of a plan.
 *
 * The sender publishes a plan for the workspace it runs in. The publication
 * decides who receives it:
 *
 * - exactly one live instance of the workspace: the plan is addressed to it,
 * - several live instances: the existing pairing decides, otherwise the
 *   candidates are exposed and the user chooses,
 * - no live instance: the plan is retained until one appears.
 *
 * The plan is never addressed to an instance of another project, and the
 * model label never decides.
 */
import { createPlanHandoffMessage } from "./message.js";
import { matchingRegistrations, resolveRecipient, } from "./routing.js";
import { detectWorkspace } from "./workspace.js";
/**
 * The recipient identity of a registration.
 */
export function recipientIdentity(registration) {
    return {
        agentId: registration.agentId,
        sessionId: registration.sessionId,
        generation: registration.generation,
        workspace: registration.workspace,
    };
}
/**
 * Publish a plan.
 *
 * The publication never throws and never delivers to an instance that does
 * not run in the workspace of the sender.
 */
export function publishPlan(options) {
    const now = options.now ?? (() => Date.now());
    const workspace = options.sender.workspace
        ? detectWorkspace(options.sender.workspace)
        : detectWorkspace(options.cwd ?? process.cwd());
    const resolution = resolveRecipient({
        workspace: workspace.path,
        host: options.host,
        registrations: options.registrations,
        pairing: options.pairing,
    });
    if (resolution.status === "ambiguous") {
        return {
            outcome: "needs-recipient",
            candidates: resolution.candidates,
            reason: resolution.reason,
            resolution,
        };
    }
    if (resolution.status === "awaiting") {
        return {
            outcome: "retained",
            candidates: [],
            reason: resolution.reason,
            resolution,
        };
    }
    const recipient = resolution.registration;
    const message = createPlanHandoffMessage({
        ...options.plan,
        sender: {
            agentId: options.sender.agentId,
            sessionId: options.sender.sessionId,
            workspace: workspace.path,
            label: options.sender.label,
        },
        recipient: recipientIdentity(recipient),
        now,
    });
    return {
        outcome: "addressed",
        message,
        recipient,
        candidates: resolution.candidates,
        reason: resolution.reason,
        resolution,
    };
}
/**
 * The instances of the workspace that a user can choose from.
 *
 * The choice is presented with the identity of every candidate, because the
 * model label is not an identity and the user has to be able to tell the
 * instances apart.
 */
export function describeCandidates(candidates) {
    return candidates.map((candidate) => {
        const model = candidate.modelLabel ? ` (${candidate.modelLabel})` : "";
        return `${candidate.agentId} / session ${candidate.sessionId}${model}`;
    });
}
export { matchingRegistrations };
//# sourceMappingURL=publish.js.map