/**
 * The core of the reverse bridge.
 *
 * A worker of another vendor may address a live Pi session. The worker
 * sends a message into the mailbox of the instance, and the receiver of
 * the instance delivers it to its session. The worker reads the result of
 * the exchange from the replies of the exchange.
 *
 * The rules that must hold:
 *
 * - a message names the instance it is for: the agent id, the session id,
 *   the generation and the workspace,
 * - an instance that is not live any more never receives a message,
 * - an instance of another workspace never receives a message,
 * - the globally newest session never decides: the routing decides only
 *   when exactly one instance of the workspace is live,
 * - a message is accepted, not completed: the answer of the session comes
 *   later, as a reply of the exchange,
 * - a busy instance defers the message: it waits in the mailbox until the
 *   instance is free.
 */
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { Mailbox, RegistrationStore, ReplyStore, createPlanHandoffMessage, hashPlanPayload, isStoreName, resolveRecipient, } from "../../plan-handoff/dist/index.js";
/**
 * The actions a message may ask for.
 */
const ACTIONS = new Set(["inform", "review", "implement"]);
/**
 * Is the value an action a message may ask for?
 *
 * The arguments of a tool come from the worker, so they are checked
 * before they are used.
 */
export function isBridgeAction(value) {
    return typeof value === "string" && ACTIONS.has(value);
}
/**
 * The longest summary a message may carry.
 */
const MAX_SUMMARY_LENGTH = 2_000;
/**
 * The largest payload a message may carry.
 */
const MAX_PAYLOAD_BYTES = 1_000_000;
/**
 * The home of the plan handoff state of the user.
 */
export const BRIDGE_HOME = join(homedir(), ".pi-harness-runtime", "plan-handoff");
/**
 * The directories of the bridge.
 */
function directories(options) {
    return {
        registryDir: options.registryDir ?? join(BRIDGE_HOME, "agents"),
        mailboxDir: options.mailboxDir ?? join(BRIDGE_HOME, "mailboxes"),
        replyDir: options.replyDir ?? join(BRIDGE_HOME, "replies"),
    };
}
/**
 * The live instances of the bridge.
 */
export function listAgents(options) {
    const dirs = directories(options);
    const store = new RegistrationStore(dirs.registryDir);
    return store.live().map((registration) => describeAgent(registration));
}
/**
 * The description of one instance.
 */
function describeAgent(registration) {
    return {
        agentId: registration.agentId,
        sessionId: registration.sessionId,
        generation: registration.generation,
        workspace: registration.workspace,
        host: registration.host,
        busy: registration.busy === true,
        paused: registration.paused === true,
        modelLabel: registration.modelLabel,
        startedAt: registration.startedAt,
    };
}
/**
 * The instance a message is for.
 *
 * The caller names the instance when it knows it. The identity is checked
 * against the live registration: a session that ended, a generation that
 * was replaced and a workspace that is another project are all refused.
 */
function selectRecipient(options, input) {
    const dirs = directories(options);
    const store = new RegistrationStore(dirs.registryDir);
    const live = store.live();
    const host = options.host ?? hostname();
    if (input.agentId) {
        const registration = live.find((candidate) => candidate.agentId === input.agentId);
        if (!registration) {
            return {
                ok: false,
                reason: "no live instance has that agent id: the session it belonged to is not running any more",
            };
        }
        if (input.sessionId && input.sessionId !== registration.sessionId) {
            return {
                ok: false,
                reason: "the instance runs another session than the one the message names",
            };
        }
        if (input.generation !== undefined &&
            input.generation !== registration.generation) {
            return {
                ok: false,
                reason: "the instance runs another generation than the one the message names",
            };
        }
        if (registration.workspace !== options.workspace) {
            return {
                ok: false,
                reason: "the instance runs in another workspace than the one of the message",
            };
        }
        if (registration.host !== host) {
            return {
                ok: false,
                reason: "the instance runs on another host than this bridge",
            };
        }
        return { ok: true, registration };
    }
    // The routing decides: it selects an instance only when exactly one
    // instance of the workspace is live. Several instances are a question
    // to the caller, not a guess of the bridge.
    const resolution = resolveRecipient({
        workspace: options.workspace,
        host,
        registrations: live,
    });
    if (resolution.status === "ambiguous") {
        const names = resolution.candidates
            .map((candidate) => `${candidate.agentId} / ${candidate.sessionId}`)
            .join(", ");
        return {
            ok: false,
            reason: `several live instances share the workspace, the message has to name one of them: ${names}`,
        };
    }
    if (resolution.status === "awaiting") {
        return {
            ok: false,
            reason: "no live Pi instance runs in this workspace: the message has nowhere to go",
        };
    }
    const registration = resolution.registration;
    if (!registration) {
        return { ok: false, reason: "the routing did not select an instance" };
    }
    return { ok: true, registration };
}
/**
 * Send a message to a live instance.
 */
export function sendToAgent(options, input) {
    const correlationId = input.correlationId ?? `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    // The id of an exchange is a name, never a path: a message of a
    // caller that names a folder of the parent never reaches a mailbox.
    if (!isStoreName(correlationId)) {
        return {
            status: "refused",
            correlationId,
            reason: "the id of the exchange is not a name: the mailbox is never written outside of itself",
        };
    }
    if (!ACTIONS.has(String(input.action))) {
        return {
            status: "refused",
            correlationId,
            reason: `the action ${String(input.action)} is not one of inform, review, implement`,
        };
    }
    if (!input.summary || input.summary.length > MAX_SUMMARY_LENGTH) {
        return {
            status: "refused",
            correlationId,
            reason: `the summary has to be there and at most ${MAX_SUMMARY_LENGTH} characters long`,
        };
    }
    if (input.payload !== undefined &&
        Buffer.byteLength(input.payload, "utf8") > MAX_PAYLOAD_BYTES) {
        return {
            status: "refused",
            correlationId,
            reason: `the payload is larger than ${MAX_PAYLOAD_BYTES} bytes`,
        };
    }
    const selected = selectRecipient(options, input);
    if (!selected.ok) {
        return { status: "refused", correlationId, reason: selected.reason };
    }
    const registration = selected.registration;
    const message = createPlanHandoffMessage({
        correlationId,
        action: input.action,
        sender: {
            agentId: options.sender.agentId,
            sessionId: options.sender.sessionId,
            workspace: options.workspace,
            label: options.sender.label,
        },
        recipient: {
            agentId: registration.agentId,
            sessionId: registration.sessionId,
            generation: registration.generation,
            workspace: registration.workspace,
        },
        plan: {
            revision: "bridge-1",
            hash: hashPlanPayload(input.payload ?? input.reference ?? input.summary),
            summary: input.summary,
            ...(input.payload === undefined ? {} : { payload: input.payload }),
            ...(input.reference === undefined ? {} : { reference: input.reference }),
        },
        ...(input.paths && input.paths.length > 0 ? { scope: { paths: input.paths } } : {}),
        ...(options.now ? { now: options.now } : {}),
    });
    const dirs = directories(options);
    const mailbox = new Mailbox(join(dirs.mailboxDir, registration.agentId));
    const entry = mailbox.publish(message);
    const identity = {
        agentId: registration.agentId,
        sessionId: registration.sessionId,
        generation: registration.generation,
        workspace: registration.workspace,
        host: registration.host,
    };
    return {
        // A message that was published is accepted, never completed: the
        // answer of the session comes later, as a reply of the exchange.
        status: registration.busy ? "deferred" : "accepted",
        correlationId,
        messageId: message.id,
        recipient: identity,
        reason: registration.busy
            ? "the message is in the mailbox of the instance; the instance is busy and receives it when it is free"
            : "the message is in the mailbox of the instance",
        ...(entry.state === "cancelled" ? { status: "refused" } : {}),
    };
}
/**
 * The state of an exchange.
 */
function statusOf(replies) {
    if (replies.length === 0)
        return "pending";
    const events = new Set(replies.map((reply) => reply.event));
    if (events.has("completed"))
        return "completed";
    if (events.has("blocked"))
        return "blocked";
    if (events.has("question"))
        return "question";
    if (events.has("received") || events.has("started") || events.has("result")) {
        return "accepted";
    }
    return "pending";
}
/**
 * Read the result of an exchange.
 */
export function readResult(options, correlationId) {
    if (!correlationId) {
        return {
            correlationId,
            status: "unknown",
            replies: [],
            reason: "the exchange has no id",
        };
    }
    // The id of an exchange is a name, never a path. A caller that names
    // a folder of the parent does not read outside of the store of the
    // replies.
    if (!isStoreName(correlationId)) {
        return {
            correlationId,
            status: "unknown",
            replies: [],
            reason: "the id of the exchange is not a name: the store of the replies is never read outside of itself",
        };
    }
    const dirs = directories(options);
    const replies = new ReplyStore(dirs.replyDir).read(correlationId);
    const mapped = replies.map((reply) => ({
        event: reply.event,
        createdAt: reply.createdAt,
        detail: reply.detail,
    }));
    const status = statusOf(replies);
    return {
        correlationId,
        status,
        replies: mapped,
        reason: status === "pending"
            ? "the instance did not answer yet"
            : `the exchange is ${status}`,
    };
}
/**
 * Cancel a message that was sent.
 *
 * The message is cancelled in the mailbox of the instance it was sent to.
 * A message that was already delivered is not cancelled: the session has
 * it already.
 */
export function cancelMessage(options, input) {
    if (!input.agentId) {
        return { status: "refused", reason: "the instance of the message has to be named" };
    }
    // The id of an instance is a name, never a path: the mailbox of the
    // instance is never read outside of the mailboxes of the bridge.
    if (!isStoreName(input.agentId)) {
        return {
            status: "refused",
            reason: "the instance of the message is not named by a name: the mailboxes are never read outside of themselves",
        };
    }
    const dirs = directories(options);
    const mailbox = new Mailbox(join(dirs.mailboxDir, input.agentId));
    let messageId = input.messageId;
    if (!messageId && input.correlationId) {
        const found = mailbox
            .entries()
            .find((entry) => entry.message.correlationId === input.correlationId);
        messageId = found?.message.id;
    }
    if (!messageId) {
        return { status: "unknown", reason: "no message of that exchange is in the mailbox" };
    }
    const entry = mailbox.read(messageId);
    if (!entry) {
        return { status: "unknown", reason: "the message is not in the mailbox" };
    }
    if (entry.state === "delivered") {
        return {
            status: "refused",
            reason: "the message was delivered already: the session has it",
        };
    }
    const cancelled = mailbox.cancel(messageId);
    return {
        status: cancelled?.state === "cancelled" ? "cancelled" : "refused",
        reason: cancelled?.state === "cancelled"
            ? "the message was cancelled before it was delivered"
            : "the message could not be cancelled",
    };
}
//# sourceMappingURL=bridge.js.map