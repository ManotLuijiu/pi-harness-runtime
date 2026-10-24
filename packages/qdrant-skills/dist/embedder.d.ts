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
 * The result of a batch embedding: one vector per input text, in the order
 * of the input.
 */
export interface BatchEmbeddingResult {
    embeddings: number[][];
    tokens: number;
}
/**
 * Get the OpenAI API key for embeddings.
 *
 * Only a key of OpenAI belongs here: the embeddings endpoint of OpenAI does
 * not accept the key of another provider. A TypeSafe or an OpenRouter key is
 * a different credential and must never be sent to that endpoint.
 */
export declare function getOpenAIApiKey(): string | null;
/**
 * Create embedding for text using OpenAI
 */
export declare function createEmbedding(text: string, apiKey?: string): Promise<EmbeddingResult>;
/**
 * The options of an embeddings request.
 */
export interface EmbeddingRequestOptions {
    /**
     * The HTTP client of the request. The default is the global `fetch`; a
     * caller (a test) can pass its own, so no global has to be replaced.
     */
    fetchImpl?: typeof fetch;
}
/**
 * Create embeddings for many texts with as few requests as possible.
 *
 * One request per text exhausts the sockets of the process when a registry
 * holds hundreds of skills: every request opens its own connection and the
 * process then cannot talk to anything else. The endpoint of OpenAI accepts
 * an array of inputs, so a batch stays one request per chunk.
 */
export declare function createEmbeddingsBatch(texts: string[], apiKey?: string, options?: EmbeddingRequestOptions): Promise<BatchEmbeddingResult>;
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