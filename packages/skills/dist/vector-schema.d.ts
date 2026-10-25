/**
 * The vector schema of the skill collection.
 *
 * A Qdrant collection holds vectors of exactly ONE size. Two different
 * embedding models produce two different vector sizes, so they must never
 * write into the same collection: the second writer is rejected by the
 * server with a dimension error, and the data of the first writer becomes
 * unsearchable by the second.
 *
 * The collection name carries the model and a version, so a change of the
 * model leads to a NEW collection instead of a silent mix of two vector
 * spaces.
 *
 * The model itself lives in the Qdrant package (the embedder owns it). This
 * module owns the collection - that is a decision of the skills domain, not
 * of the vector store.
 */
/**
 * The collection the runtime indexes into and searches.
 *
 * `QDRANT_COLLECTION` overrides it, so a cluster that already holds a
 * collection under another name keeps working.
 */
export declare const SKILL_COLLECTION = "pi-harness-skills-openai-v1";
/**
 * The collection that was used before the schema was versioned.
 *
 * It holds 384-dimensional vectors - the model that
 * `scripts/sync-to-qdrant.ts` used - and is NOT compatible with the
 * runtime. It is named here so a mismatch can name the real cause instead
 * of only the numbers.
 */
export declare const LEGACY_SKILL_COLLECTION = "pi-harness-skills";
/** The model of the legacy collection. */
export declare const LEGACY_SKILL_COLLECTION_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
/** The vector size of the legacy collection. */
export declare const LEGACY_SKILL_COLLECTION_DIMENSIONS = 384;
/** The schema a skill collection is expected to have. */
export interface SkillVectorSchema {
    /** The vector size. */
    dimensions: number;
    /** The distance metric. */
    distance: string;
    /** The embedding model, when it is known. */
    model?: string;
}
/**
 * Why the collection does not match the expected schema - or null when it
 * does.
 *
 * The message names the numbers, so the reader can tell WHICH schema the
 * collection was built with.
 */
export declare function describeSkillSchemaMismatch(actual: {
    dimensions?: number;
    distance?: string;
}, expected: SkillVectorSchema): string | null;
//# sourceMappingURL=vector-schema.d.ts.map