/**
 * Agent Worker Interface — RFC-0030
 *
 * Common interface for all agent workers (Codex, MiniMax, GLM, GPT, DeepAgents).
 * Runtime remains the orchestrator; agents are pluggable workers.
 */
/**
 * Registry of agent worker factories
 */
export class AgentWorkerRegistry {
    factories = new Map();
    /**
     * Register a worker factory
     */
    register(provider, factory) {
        this.factories.set(provider.toLowerCase(), factory);
    }
    /**
     * Create a worker for a provider
     */
    create(config) {
        const factory = this.factories.get(config.provider.toLowerCase());
        if (!factory) {
            return undefined;
        }
        return factory(config);
    }
    /**
     * Check if a provider is supported
     */
    supports(provider) {
        return this.factories.has(provider.toLowerCase());
    }
    /**
     * List all supported providers
     */
    listProviders() {
        return Array.from(this.factories.keys());
    }
}
//# sourceMappingURL=agent-worker-types.js.map