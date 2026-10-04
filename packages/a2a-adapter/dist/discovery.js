/**
 * A2A Discovery Server (RFC-0104)
 *
 * Advertises agent capabilities and handles agent registry.
 */
import { fetch } from "undici";
import { createAgentCard } from "./agent.js";
/**
 * Start a local A2A discovery agent
 */
export function startDiscoveryAgent(config) {
    return new DiscoveryAgent(config);
}
export class DiscoveryAgent {
    card;
    constructor(config) {
        this.card = createAgentCard({
            name: config.agentId,
            description: config.skills[0]?.description ?? "Harness Agent",
            url: config.url,
            version: "1.0.0",
            capabilities: config.capabilities,
            skills: config.skills,
        });
    }
    getAgentCard() {
        return this.card;
    }
}
/**
 * Registry of known agents
 */
export class AgentRegistry {
    agents = new Map();
    register(card) {
        this.agents.set(card.name, card);
    }
    unregister(name) {
        this.agents.delete(name);
    }
    list() {
        return Array.from(this.agents.values());
    }
    find(criteria) {
        return this.list().filter((agent) => {
            if (criteria.skill && !agent.skills.some((s) => s.id === criteria.skill))
                return false;
            return true;
        });
    }
}
/**
 * Load agent card from URL
 */
export async function loadAgentCard(url) {
    try {
        const response = await fetch(`${url}/.well-known/agent.json`);
        if (!response.ok)
            return null;
        return response.json();
    }
    catch {
        return null;
    }
}
/**
 * Discover agents via seed URLs
 */
export async function discoverAgents(seedUrls) {
    const results = await Promise.all(seedUrls.map(async (url) => {
        const card = await loadAgentCard(url);
        return card;
    }));
    return results.filter((c) => c !== null);
}
//# sourceMappingURL=discovery.js.map