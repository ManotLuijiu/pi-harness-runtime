/**
 * The saved tooling preference of a user in a workspace.
 *
 * The store is a plain JSON file under the harness runtime directory: it
 * works in every runtime (a SQLite file would not - `node:sqlite` is
 * missing in some of them) and it stays readable for the user.
 */
import type { ToolingPreference } from "./proposal.js";
export interface ToolingPreferenceRecord {
    /** The saved decision, when the user answered. */
    decision?: ToolingPreference;
    /** When the proposal was sent. */
    askedAt?: string;
    /** When the user answered. */
    decidedAt?: string;
    /** The request ID of the proposal that was sent. */
    requestId?: string;
    /** The workspace the record belongs to. */
    workspaceRoot?: string;
    /** The channel the answer came from. */
    channel?: string;
}
/**
 * The key of one record: the user and the workspace.
 */
export declare function toolingPreferenceKey(userKey: string, workspaceRoot: string): string;
/**
 * The runtime directory of the harness.
 */
export declare function harnessRuntimeDir(): string;
export declare class ToolingPreferenceStore {
    private readonly filePath;
    constructor(filePath: string);
    /**
     * The default store: `~/.pi-harness-runtime/tooling-preference.json`.
     */
    static defaultFilePath(): string;
    /**
     * The record of one user in one workspace.
     */
    read(userKey: string, workspaceRoot: string): ToolingPreferenceRecord | undefined;
    /**
     * Remember that the proposal was sent.
     */
    markAsked(userKey: string, workspaceRoot: string, requestId: string, now?: Date): void;
    /**
     * Save the answer of the user.
     */
    recordDecision(userKey: string, workspaceRoot: string, decision: ToolingPreference, requestId: string, channel?: string, now?: Date): void;
    private load;
    private save;
}
/**
 * May the proposal be sent again?
 *
 * A workspace that was asked and never answered is asked again after the
 * cooldown - the user may have missed it. A workspace with a decision is
 * never asked again.
 */
export declare function shouldAskAgain(record: ToolingPreferenceRecord | undefined, cooldownMs: number, now?: Date): boolean;
//# sourceMappingURL=store.d.ts.map