/**
 * Qdrant Skills Package
 * 
 * Vector search integration for Hermes-style skill system.
 * 
 * Features:
 * - Store skills in Qdrant for team sharing
 * - Semantic search across PCs
 * - Auto-fallback when local skills not found
 */

export * from "./client.js";
export * from "./embedder.js";

// Re-export types
export type {
  QdrantConfig,
  QdrantSkillDocument,
  QdrantSearchResult,
} from "./client.js";

export type {
  EmbeddingResult,
} from "./embedder.js";
