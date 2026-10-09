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
    // Ignore "already exists" / "Conflict" — both mean the collection already exists
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes("already exists") || msg.includes("conflict") || msg.includes("already_exists")) {
        return;
      }
    }
    throw err;
  }
}

/**
 * Get collection info (vector size, distance, point count)
 */
export async function getCollectionInfo(
  client: QdrantClient,
  name: string
): Promise<{
  exists: boolean;
  vectorsSize?: number;
  vectorsDistance?: string;
  pointsCount?: number;
} | null> {
  try {
    const info = await client.getCollection(name) as Record<string, unknown>;
    // Vectors config can be a named config or default { size, distance }
    const vectorsConfig = info.vectors as Record<string, unknown> | undefined;
    let vectorsSize: number | undefined;
    let vectorsDistance: string | undefined;

    if (vectorsConfig) {
      // Handle both { size: number, distance: string } and named config { config: { size, distance } }
      vectorsSize = (vectorsConfig.size ?? (vectorsConfig.config as Record<string, unknown>)?.size) as number | undefined;
      vectorsDistance = (vectorsConfig.distance ?? (vectorsConfig.config as Record<string, unknown>)?.distance) as string | undefined;
    }

    // Points count might be in different locations depending on Qdrant version
    const pointsCount = (info.points ?? info.num_points ?? info.points_count) as number | undefined;

    return {
      exists: true,
      vectorsSize,
      vectorsDistance,
      pointsCount,
    };
  } catch (err) {
    if (err instanceof Error && (err.message.includes("not found") || err.message.includes("404"))) {
      return { exists: false };
    }
    // Return null on other errors
    return null;
  }
}

/**
 * Validate collection schema matches expected embedding model
 */
export async function validateCollectionSchema(
  client: QdrantClient,
  name: string,
  expectedDimensions: number,
  expectedDistance: string = "Cosine"
): Promise<{
  valid: boolean;
  error?: string;
  actualDimensions?: number;
  actualDistance?: string;
}> {
  const info = await getCollectionInfo(client, name);

  if (!info) {
    return { valid: false, error: "Could not retrieve collection info" };
  }

  if (!info.exists) {
    return { valid: false, error: "Collection does not exist" };
  }

  if (info.vectorsSize !== expectedDimensions) {
    return {
      valid: false,
      error: `Dimension mismatch: expected ${expectedDimensions}, got ${info.vectorsSize}`,
      actualDimensions: info.vectorsSize,
      actualDistance: info.vectorsDistance,
    };
  }

  if (info.vectorsDistance && info.vectorsDistance !== expectedDistance) {
    return {
      valid: false,
      error: `Distance mismatch: expected ${expectedDistance}, got ${info.vectorsDistance}`,
      actualDimensions: info.vectorsSize,
      actualDistance: info.vectorsDistance,
    };
  }

  return {
    valid: true,
    actualDimensions: info.vectorsSize,
    actualDistance: info.vectorsDistance,
  };
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

  // Parse response: SDK already unwraps HTTP response, QueryResponse has points directly
  const typedResults = results as {
    points?: Array<{
      id: number;
      score: number;
      payload?: Record<string, unknown>;
    }>;
  };

  const points = typedResults?.points || [];

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

  // Parse response: SDK already unwraps HTTP response, QueryResponse has points directly
  const typedResults = results as {
    points?: Array<{
      id: number;
      score: number;
      payload?: Record<string, unknown>;
    }>;
  };

  const points = typedResults?.points || [];

  return points.map((point) => ({
    id: point.id,
    name: (point.payload?.name as string) || `skill-${point.id}`,
    description: (point.payload?.description as string) || "",
    score: point.score || 0,
  }));
}
