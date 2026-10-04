/**
 * A2A Discovery Server (RFC-0104)
 *
 * Advertises agent capabilities and handles agent registry.
 */
import type { AgentSearchCriteria } from "./client.js";
import type { AgentCard, AgentCapabilities, Skill, Authentication } from "./types.js";
/**
 * Discovery configuration
 */
export interface A2ADiscoveryConfig {
    /** Agent ID */
    agentId: string;
    /** Agent URL */
    url: string;
    /** Capabilities */
    capabilities: AgentCapabilities;
    /** Skills this agent provides */
    skills: Skill[];
    /** Authentication */
    authentication?: Authentication;
    /** Metadata */
    metadata?: Record<string, string>;
}
/**
 * Start a local A2A discovery agent
 */
export declare function startDiscoveryAgent(config: A2ADiscoveryConfig): DiscoveryAgent;
export declare class DiscoveryAgent {
    private card;
    constructor(config: A2ADiscoveryConfig);
    getAgentCard(): AgentCard;
}
/**
 * Registry of known agents
 */
export declare class AgentRegistry {
    private agents;
    register(card: AgentCard): void;
    unregister(name: string): void;
    list(): AgentCard[];
    find(criteria: AgentSearchCriteria): AgentCard[];
}
/**
 * Load agent card from URL
 */
export declare function loadAgentCard(url: string): Promise<AgentCard | null>;
/**
 * Discover agents via seed URLs
 */
export declare function discoverAgents(seedUrls: string[]): Promise<AgentCard[]>;
//# sourceMappingURL=discovery.d.ts.map