/**
 * Qdrant Client - Official @qdrant/js-client-rest wrapper
 */

import { QdrantClient } from "@qdrant/js-client-rest";

export interface QdrantConfig {
  /** Qdrant cluster URL (e.g., https://xxx.qdrant.tech) */
  url: string;
  /** API key for authentication */
  apiKey: string;
  /** Collection name (default: 'pi-harness-skills') */
  collection?: string;
}

export interface SkillPoint {
  id: number;
  name: string;
  description: string;
  body: string;
  /** Full text to embed */
  text: string;
}

export interface SearchResult {
  id: number;
  name: string;
  description: string;
  score: number;
}

/**
 * Parse host:port from URL
 */
function parseHostPort(url: string): { host: string; port: number } {
  const match = url.match(/https?:\/\/([^:]+)(?::(\d+))?/);
  return {
    host: match?.[1] || url,
    port: parseInt(match?.[2] || "6333"),
  };
}

/**
 * Create a Qdrant client
 */
export function createQdrantClient(config: QdrantConfig): QdrantClient {
  const { host, port } = parseHostPort(config.url);
  return new QdrantClient({ host, port, apiKey: config.apiKey });
}

/**
 * Create a collection with dense vectors
 */
export async function createCollection(
  client: QdrantClient,
  name: string,
  dimensions: number = 384 // all-MiniLM-L6-v2
): Promise<void> {
  try {
    await client.createCollection(name, {
      vectors: { size: dimensions, distance: "Cosine" },
    });
  } catch (err) {
    // Ignore "already exists" errors
    if (err instanceof Error && !err.message.includes("already exists")) {
      throw err;
    }
  }
}

/**
 * Delete a collection
 */
export async function deleteCollection(
  client: QdrantClient,
  name: string
): Promise<void> {
  try {
    await client.deleteCollection(name);
  } catch {
    // Ignore if not exists
  }
}

/**
 * Upsert skill points with cloud inference
 */
export async function upsertSkills(
  client: QdrantClient,
  collectionName: string,
  skills: SkillPoint[],
  model: string = "sentence-transformers/all-MiniLM-L6-v2"
): Promise<void> {
  const points = skills.map((skill, idx) => ({
    id: skill.id || idx + 1,
    payload: {
      name: skill.name,
      description: skill.description,
      body: skill.body.slice(0, 2000),
    },
    vector: {
      text: skill.text,
      model,
    },
  }));

  await client.upsert(collectionName, { wait: true, points });
}

/**
 * Search skills with semantic query
 */
export async function searchSkills(
  client: QdrantClient,
  collectionName: string,
  query: string,
  model: string = "sentence-transformers/all-MiniLM-L6-v2",
  limit: number = 5
): Promise<SearchResult[]> {
  const results = await client.query(collectionName, {
    query: { text: query, model },
    limit,
    with_payload: true,
  } as Parameters<typeof client.query>[1]);

  // Parse response: { result: { points: [...] } }
  const typedResults = results as {
    result?: {
      points?: Array<{
        id: number;
        score: number;
        payload?: Record<string, unknown>;
      }>;
    };
  };

  const points = typedResults?.result?.points || [];

  return points.map((point) => ({
    id: point.id,
    name: (point.payload?.name as string) || `skill-${point.id}`,
    description: (point.payload?.description as string) || "",
    score: point.score,
  }));
}

/**
 * Get all skills from collection
 */
export async function getAllSkills(
  client: QdrantClient,
  collectionName: string
): Promise<SearchResult[]> {
  const results = await client.query(collectionName, {
    filter: {}, // Empty filter = all
    limit: 100,
    with_payload: true,
  } as Parameters<typeof client.query>[1]);

  const typedResults = results as {
    result?: {
      points?: Array<{
        id: number;
        score: number;
        payload?: Record<string, unknown>;
      }>;
    };
  };

  const points = typedResults?.result?.points || [];

  return points.map((point) => ({
    id: point.id,
    name: (point.payload?.name as string) || `skill-${point.id}`,
    description: (point.payload?.description as string) || "",
    score: point.score || 0,
  }));
}
