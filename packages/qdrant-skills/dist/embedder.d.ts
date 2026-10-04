/**
 * Skill Embedder
 *
 * Creates embeddings for skill content using OpenAI.
 * Used to store skills in Qdrant for semantic search.
 */
import type { SkillPoint } from "./client.js";
/**
 * Embedding result
 */
export interface EmbeddingResult {
    embedding: number[];
    tokens: number;
}
/**
 * Get OpenAI API key for embeddings
 */
export declare function getOpenAIApiKey(): string | null;
/**
 * Create embedding for text using OpenAI
 */
export declare function createEmbedding(text: string, apiKey?: string): Promise<EmbeddingResult>;
/**
 * Create embedding for a skill document
 */
export declare function embedSkillDocument(skill: SkillPoint, apiKey?: string): Promise<{
    id: number;
    embedding: number[];
    payload: SkillPoint;
}>;
/**
 * Batch embed multiple skills
 */
export declare function embedSkillsBatch(skills: SkillPoint[], apiKey?: string, onProgress?: (index: number, total: number) => void): Promise<Array<{
    id: number;
    embedding: number[];
    payload: SkillPoint;
}>>;
//# sourceMappingURL=embedder.d.ts.map