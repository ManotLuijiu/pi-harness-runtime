/**
 * The pending proposals of this session.
 *
 * The first answer wins: a second click on the other button changes
 * nothing. The registry is in memory only - a proposal that was never
 * answered simply disappears with the session.
 */
import type { ToolingChoice, ToolingPreference } from "./proposal.js";
export interface ToolingRequest {
    /** The canonical request ID of the proposal. */
    requestId: string;
    /** The workspace the proposal belongs to. */
    workspaceRoot: string;
    /** The user the proposal was sent to. */
    userKey: string;
    /** The tooling facts of the workspace. */
    frameworks: string[];
}
export interface ToolingResolution {
    choice: ToolingChoice;
    preference: ToolingPreference;
    channel?: string;
}
export declare class ToolingRequestRegistry {
    private readonly pending;
    private readonly resolved;
    /**
     * Register a proposal. A request ID that is already known is refused.
     */
    register(request: ToolingRequest): boolean;
    /**
     * Is the request still waiting for an answer?
     */
    has(requestId: string): boolean;
    /**
     * Claim a request for an answer.
     *
     * The claim removes the request, so a second click finds nothing and the
     * first answer stays the one that counts.
     */
    claim(requestId: string, choice: ToolingChoice, channel?: string): {
        request: ToolingRequest;
        resolution: ToolingResolution;
    } | null;
    /**
     * The answer of a request that was already resolved.
     */
    resolutionOf(requestId: string): ToolingResolution | undefined;
}
//# sourceMappingURL=registry.d.ts.map