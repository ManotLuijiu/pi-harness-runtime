/**
 * Context Discovery — Orchestrates context collection
 */
export class ContextDiscovery {
    async discover(options) {
        return {
            context: {
                intent: options.intent ?? null,
                workspace: null,
                dependencies: null,
                knowledge: null,
                files: [],
                estimatedTokens: 0,
            },
            discovered: [],
            omitted: [],
            estimatedTokens: 0,
        };
    }
}
//# sourceMappingURL=discovery.js.map