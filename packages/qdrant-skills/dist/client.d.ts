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