/**
 * A2A Discovery Server (RFC-0104)
 *
 * Advertises agent capabilities and handles agent registry.
 */

import { fetch } from "undici";
import type { AgentSearchCriteria } from "./client.js";
import { createAgentCard } from "./agent.js";
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
export function startDiscoveryAgent(config: A2ADiscoveryConfig): DiscoveryAgent {
  return new DiscoveryAgent(config);
}

export class DiscoveryAgent {
  private card: AgentCard;

  constructor(config: A2ADiscoveryConfig) {
    this.card = createAgentCard({
      name: config.agentId,
      description: config.skills[0]?.description ?? "Harness Agent",
      url: config.url,
      version: "1.0.0",
      capabilities: config.capabilities,
      skills: config.skills,
    });
  }

  getAgentCard(): AgentCard {
    return this.card;
  }
}

/**
 * Registry of known agents
 */
export class AgentRegistry {
  private agents = new Map<string, AgentCard>();

  register(card: AgentCard): void {
    this.agents.set(card.name, card);
  }

  unregister(name: string): void {
    this.agents.delete(name);
  }

  list(): AgentCard[] {
    return Array.from(this.agents.values());
  }

  find(criteria: AgentSearchCriteria): AgentCard[] {
    return this.list().filter((agent) => {
      if (criteria.skill && !agent.skills.some((s) => s.id === criteria.skill)) return false;
      return true;
    });
  }
}

/**
 * Load agent card from URL
 */
export async function loadAgentCard(url: string): Promise<AgentCard | null> {
  try {
    const response = await fetch(`${url}/.well-known/agent.json`);
    if (!response.ok) return null;
    return response.json() as Promise<AgentCard>;
  } catch {
    return null;
  }
}

/**
 * Discover agents via seed URLs
 */
export async function discoverAgents(seedUrls: string[]): Promise<AgentCard[]> {
  const results = await Promise.all(
    seedUrls.map(async (url): Promise<AgentCard | null> => {
      const card = await loadAgentCard(url);
      return card;
    }),
  );
  return results.filter((c): c is AgentCard => c !== null);
}
