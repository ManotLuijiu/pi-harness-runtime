/**
 * Qdrant Skills Package
 *
 * Vector search integration for Hermes-style skill system.
 * Uses Qdrant Cloud with built-in sentence-transformers inference.
 *
 * @example
 * ```typescript
 * import { createQdrantClient, searchSkills, upsertSkills } from '@pi-harness/qdrant-skills';
 *
 * const client = createQdrantClient({
 *   url: process.env.QDRANT_CLUSTER_ENDPOINT!,
 *   apiKey: process.env.QDRANT_API_KEY!,
 * });
 *
 * // Search for skills
 * const results = await searchSkills(client, 'my-skills', 'frappe permissions');
 *
 * // Upload skills
 * await upsertSkills(client, 'my-skills', [{ id: 1, name: 'test', description: '...', body: '...', text: '...' }]);
 * ```
 */
export { createQdrantClient, createCollection, deleteCollection, getCollectionInfo, validateCollectionSchema, upsertSkills, searchSkills, getAllSkills, type QdrantConfig, type SkillPoint, type SearchResult, } from './client.js';
export { createEmbedding, embedSkillDocument, embedSkillsBatch, getOpenAIApiKey, type EmbeddingResult, } from './embedder.js';
//# sourceMappingURL=index.d.ts.map