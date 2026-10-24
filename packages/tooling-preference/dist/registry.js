/**
 * The pending proposals of this session.
 *
 * The first answer wins: a second click on the other button changes
 * nothing. The registry is in memory only - a proposal that was never
 * answered simply disappears with the session.
 */
export class ToolingRequestRegistry {
    pending = new Map();
    resolved = new Map();
    /**
     * Register a proposal. A request ID that is already known is refused.
     */
    register(request) {
        if (this.pending.has(request.requestId) || this.resolved.has(request.requestId)) {
            return false;
        }
        this.pending.set(request.requestId, request);
        return true;
    }
    /**
     * Is the request still waiting for an answer?
     */
    has(requestId) {
        return this.pending.has(requestId);
    }
    /**
     * Claim a request for an answer.
     *
     * The claim removes the request, so a second click finds nothing and the
     * first answer stays the one that counts.
     */
    claim(requestId, choice, channel) {
        const request = this.pending.get(requestId);
        if (!request)
            return null;
        this.pending.delete(requestId);
        const resolution = {
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
    resolutionOf(requestId) {
        return this.resolved.get(requestId);
    }
}
//# sourceMappingURL=registry.js.map