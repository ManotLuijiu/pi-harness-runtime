/**
 * The handoff of a plan from one agent to another.
 *
 * The package holds the two halves of the routing:
 *
 * - the registration of the live Pi instances and the canonical workspace
 *   they run in (`registry.ts`, `workspace.ts`),
 * - the rules that select the recipient of a plan and the message that
 *   carries it (`routing.ts`, `message.ts`).
 *
 * The rules never decide by a model label and never by the globally newest
 * session. They decide by the canonical workspace of the sender and by the
 * unique identity of the instance.
 */
export { canonicalizePath, detectWorkspace, expandHome, isInsideWorkspace, sameWorkspace, } from "./workspace.js";
export type { CanonicalWorkspace } from "./workspace.js";
export { DEFAULT_HEARTBEAT_TTL_MS, RegistrationStore } from "./registry.js";
export type { AgentRegistration } from "./registry.js";
export { matchingRegistrations, resolveRecipient } from "./routing.js";
export type { RecipientPairing, RecipientResolution, RecipientStatus, ResolveRecipientOptions, } from "./routing.js";
export { awaitingInWorkspace, DEFAULT_HANDOFF_RETENTION_MS, PendingHandoffStore, } from "./retention.js";
export type { HandoffState, PendingHandoff } from "./retention.js";
export { describeCandidates, publishPlan, recipientIdentity } from "./publish.js";
export type { PublicationOutcome, PublicationResult, PublishPlanContent, PublishPlanOptions, } from "./publish.js";
export { Mailbox, ReplyStore, isStoreName } from "./mailbox.js";
export type { HandoffReply, MailboxEntry, MailboxState } from "./mailbox.js";
export { PairingStore } from "./pairing.js";
export type { Pairing } from "./pairing.js";
export { createPlanHandoffMessage, hashPlanPayload, MAX_PLAN_PAYLOAD_BYTES, MAX_PLAN_SUMMARY_LENGTH, PLAN_HANDOFF_SCHEMA_VERSION, validatePlanHandoffMessage, validateRecipientIdentity, } from "./message.js";
export type { CreatePlanHandoffMessage, PlanHandoffAction, PlanHandoffIdentity, PlanHandoffMessage, PlanHandoffPlan, PlanHandoffRecipientIdentity, PlanHandoffScope, ValidationResult, } from "./message.js";
//# sourceMappingURL=index.d.ts.map