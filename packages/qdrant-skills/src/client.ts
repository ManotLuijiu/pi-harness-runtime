/**
 * Qdrant Skills Client
 * 
 * Manages skill embeddings in Qdrant vector database.
 * Uses REST API directly - no external dependencies.
 * 
 * Used for team-shared skill discovery across PCs.
 */

/**
 * Qdrant configuration
 */
export interface QdrantConfig {
  url: string;
  apiKey: string;
  collectionName: string;
  vectorSize: number; // 1536 for OpenAI text-embedding-3-small
}

/**
 * Skill document stored in Qdrant
 */
export interface QdrantSkillDocument {
  id: string;
  name: string;
  description: string;
  body: string;
  triggers: string[];
  author: string;
  version: string;
  confidence: number;
  source?: string; // Original path if synced from local
}

/**
 * Search result from Qdrant
 */
export interface QdrantSearchResult {
  id: string;
  score: number;
  document: QdrantSkillDocument;
}

/**
 * Check if Qdrant API key is available
 */
export function isQdrantAvailable(): boolean {
  // Check env var first
  if (process.env.QDRANT_API_KEY) {
    return true;
  }
  
  // Check keys file
  try {
    const { existsSync, readFileSync } = require("node:fs");
    const homedir = process.env.HOME || process.env.USERPROFILE || "/home/frappe";
    const keyPath = `${homedir}/.pi-harness-runtime/keys/qdrant-api-key.txt`;
    if (existsSync(keyPath)) {
      const key = readFileSync(keyPath, "utf-8").trim();
      return key.length > 0;
    }
  } catch {
    // ignore
  }
  
  return false;
}

/**
 * Get Qdrant API key
 */
export function getQdrantApiKey(): string | null {
  // Check env var first
  if (process.env.QDRANT_API_KEY) {
    return process.env.QDRANT_API_KEY;
  }
  
  // Check keys file
  try {
    const { existsSync, readFileSync } = require("node:fs");
    const homedir = process.env.HOME || process.env.USERPROFILE || "/home/frappe";
    const keyPath = `${homedir}/.pi-harness-runtime/keys/qdrant-api-key.txt`;
    if (existsSync(keyPath)) {
      return readFileSync(keyPath, "utf-8").trim();
    }
  } catch {
    // ignore
  }
  
  return null;
}

/**
 * Get Qdrant URL
 */
export function getQdrantUrl(): string {
  return process.env.QDRANT_URL || "https://api.qdrant.tech";
}

/**
 * Default collection name for skills
 */
export const DEFAULT_COLLECTION = "pi-harness-skills";

/**
 * Default vector size (OpenAI text-embedding-3-small)
 */
export const DEFAULT_VECTOR_SIZE = 1536;

/**
 * Get Qdrant config from environment
 */
export function getQdrantConfig(): QdrantConfig | null {
  const apiKey = getQdrantApiKey();
  if (!apiKey) {
    return null;
  }
  
  return {
    url: getQdrantUrl(),
    apiKey,
    collectionName: process.env.QDRANT_COLLECTION || DEFAULT_COLLECTION,
    vectorSize: parseInt(process.env.QDRANT_VECTOR_SIZE || String(DEFAULT_VECTOR_SIZE), 10),
  };
}

/**
 * Qdrant REST API client (simple implementation)
 */
export class QdrantRestClient {
  private url: string;
  private apiKey: string;

  constructor(config: QdrantConfig) {
    this.url = config.url.replace(/\/$/, ""); // Remove trailing slash
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.url}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "api-key": this.apiKey,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Qdrant API error ${response.status}: ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Create collection if not exists
   */
  async ensureCollection(name: string, vectorSize: number): Promise<void> {
    try {
      await this.request("PUT", `/collections/${name}`, {
        vectors: {
          size: vectorSize,
          distance: "Cosine",
        },
      });
      console.error(`[QdrantSkills] Created collection: ${name}`);
    } catch (err) {
      // Collection might already exist
      if (err instanceof Error && !err.message.includes("already exists")) {
        throw err;
      }
      console.error(`[QdrantSkills] Collection exists: ${name}`);
    }
  }

  /**
   * Upload points (skills) to collection
   */
  async uploadPoints(
    collectionName: string,
    points: Array<{
      id: string;
      vector: number[];
      payload: QdrantSkillDocument;
    }>
  ): Promise<void> {
    await this.request("PUT", `/collections/${collectionName}/points`, {
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      })),
    });
    console.error(`[QdrantSkills] Uploaded ${points.length} points to ${collectionName}`);
  }

  /**
   * Search for similar skills
   */
  async search(
    collectionName: string,
    query: number[],
    limit: number = 5,
    scoreThreshold?: number
  ): Promise<QdrantSearchResult[]> {
    const body: Record<string, unknown> = {
      vector: query,
      limit,
      with_payload: true,
    };

    if (scoreThreshold !== undefined) {
      body.score_threshold = scoreThreshold;
    }

    const response = await this.request<{
      result: Array<{
        id: string;
        score: number;
        payload: QdrantSkillDocument;
      }>;
    }>("POST", `/collections/${collectionName}/points/search`, body);

    return response.result.map((r) => ({
      id: r.id,
      score: r.score,
      document: r.payload,
    }));
  }

  /**
   * Delete all points from collection
   */
  async clearCollection(collectionName: string): Promise<void> {
    await this.request("POST", `/collections/${collectionName}/points/delete`, {
      filter: {}, // Match all
    });
    console.error(`[QdrantSkills] Cleared collection: ${collectionName}`);
  }

  /**
   * Get collection info
   */
  async getCollectionInfo(collectionName: string): Promise<{
    pointsCount: number;
  }> {
    const response = await this.request<{
      result: {
        points_count: number;
      };
    }>("GET", `/collections/${collectionName}`);

    return {
      pointsCount: response.result.points_count,
    };
  }
}
