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
 * Create a Qdrant client
 */
export declare function createQdrantClient(config: QdrantConfig): QdrantClient;
/**
 * Create a collection with dense vectors
 */
export declare function createCollection(client: QdrantClient, name: string, dimensions?: number): Promise<void>;
/**
 * Get collection info (vector size, distance, point count)
 */
export declare function getCollectionInfo(client: QdrantClient, name: string): Promise<{
    exists: boolean;
    vectorsSize?: number;
    vectorsDistance?: string;
    pointsCount?: number;
} | null>;
/**
 * Whether the error means "the collection does not exist".
 *
 * Qdrant answers a missing collection with the status 404 and the text
 * "Not Found". The text is compared case-insensitively, because the
 * capitalisation differs between the client versions - a case-sensitive
 * comparison turns a collection that does not exist yet into "the
 * cluster could not be read", which hides the real cause.
 */
export declare function isNotFoundError(err: unknown): boolean;
/**
 * Validate collection schema matches expected embedding model
 */
export declare function validateCollectionSchema(client: QdrantClient, name: string, expectedDimensions: number, expectedDistance?: string): Promise<{
    valid: boolean;
    error?: string;
    actualDimensions?: number;
    actualDistance?: string;
}>;
/**
 * Delete a collection
 */
export declare function deleteCollection(client: QdrantClient, name: string): Promise<void>;
/**
 * Upsert skill points with cloud inference
 */
export declare function upsertSkills(client: QdrantClient, collectionName: string, skills: SkillPoint[], model?: string): Promise<void>;
/**
 * Search skills with semantic query
 */
export declare function searchSkills(client: QdrantClient, collectionName: string, query: string, model?: string, limit?: number): Promise<SearchResult[]>;
/**
 * Get all skills from collection
 */
export declare function getAllSkills(client: QdrantClient, collectionName: string): Promise<SearchResult[]>;
//# sourceMappingURL=client.d.ts.map