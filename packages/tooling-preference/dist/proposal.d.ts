/**
 * The tooling proposal: request IDs, buttons and the wording.
 *
 * The proposal is a decision of its own. It never travels through the
 * task-approval path, because a "No" there pauses the work and a "Yes"
 * there resumes it - neither belongs to a tooling preference.
 */
import type { ToolingContext } from "./detect.js";
/**
 * The callback action of the proposal.
 *
 * The callback data is parsed by splitting on "_", so an action must be a
 * single token: an action that carries an underscore would be read as the
 * action up to that underscore, and the rest as the target.
 */
export declare const TOOLING_ACTION = "biome";
/** The answer of the user. */
export type ToolingChoice = "yes" | "no";
/** The saved preference of a user in a workspace. */
export type ToolingPreference = "prefer_biome" | "use_project_tools";
export interface ToolingButton {
    /** The label of the button. */
    text: string;
    /** The callback action - always `TOOLING_ACTION`. */
    action: string;
    /** The choice and the request ID, e.g. `yes-biome-<hash>`. */
    targetId: string;
}
export interface ToolingTarget {
    choice: ToolingChoice;
    requestId: string;
}
/**
 * The canonical request ID of one proposal.
 *
 * The request ID is the correlation key: both channels send the same ID,
 * and the first answer wins. It only holds hex characters and dashes so it
 * survives the "_" split of the callback data.
 */
export declare function buildToolingRequestId(userKey: string, workspaceRoot: string): string;
/**
 * The key of the user the proposal is sent to.
 *
 * The identity is hashed: the store holds the key of a user, never the id
 * of the user.
 */
export declare function buildToolingUserKey(identity: string): string;
/**
 * The two buttons of the proposal.
 */
export declare function buildToolingButtons(requestId: string): ToolingButton[];
/**
 * Read the choice and the request ID out of a callback target.
 *
 * A target that does not belong to the proposal returns `null` - a click on
 * a foreign button must never resolve a preference.
 */
export declare function parseToolingTarget(targetId: string | undefined): ToolingTarget | null;
/**
 * The wording of the proposal.
 */
export declare function buildToolingProposalMessage(context: ToolingContext): string;
/**
 * The instruction the agent receives after a "Yes".
 *
 * The agent does the repository work: the harness only records the
 * decision and starts the implementation.
 */
export declare function buildToolingImplementationPrompt(context: ToolingContext, workspaceRoot: string): string;
//# sourceMappingURL=proposal.d.ts.map