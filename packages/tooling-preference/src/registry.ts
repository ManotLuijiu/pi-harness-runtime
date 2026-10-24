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

export class ToolingRequestRegistry {
	private readonly pending = new Map<string, ToolingRequest>();
	private readonly resolved = new Map<string, ToolingResolution>();

	/**
	 * Register a proposal. A request ID that is already known is refused.
	 */
	register(request: ToolingRequest): boolean {
		if (this.pending.has(request.requestId) || this.resolved.has(request.requestId)) {
			return false;
		}
		this.pending.set(request.requestId, request);
		return true;
	}

	/**
	 * Is the request still waiting for an answer?
	 */
	has(requestId: string): boolean {
		return this.pending.has(requestId);
	}

	/**
	 * Claim a request for an answer.
	 *
	 * The claim removes the request, so a second click finds nothing and the
	 * first answer stays the one that counts.
	 */
	claim(
		requestId: string,
		choice: ToolingChoice,
		channel?: string,
	): { request: ToolingRequest; resolution: ToolingResolution } | null {
		const request = this.pending.get(requestId);
		if (!request) return null;
		this.pending.delete(requestId);
		const resolution: ToolingResolution = {
			choice,
			preference: choice === "yes" ? "prefer_biome" : "use_project_tools",
			...(channel ? { channel } : {}),
		};
		this.resolved.set(requestId, resolution);
		return { request, resolution };
	}

	/**
	 * The answer of a request that was already resolved.
	 */
	resolutionOf(requestId: string): ToolingResolution | undefined {
		return this.resolved.get(requestId);
	}
}
