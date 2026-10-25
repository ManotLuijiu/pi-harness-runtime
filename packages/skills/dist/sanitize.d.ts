/**
 * The sanitization of a skill for the shared collection.
 *
 * The collection is shared, so a client name must not travel into it. The
 * rules lived in `scripts/sync-to-qdrant.ts` - the only writer that could
 * reach them. The runtime registry writes into the same collection, so it
 * needs them too: a writer that skipped the rules would leave the raw
 * name and the raw body of a client skill in a shared cluster.
 *
 * Both writers therefore build their points with the same rules, and the
 * name of a point is the sanitized name. One skill, one point.
 */
/**
 * Replace the client specific names of a text.
 *
 * The text stays the same length, so a vector that was built from it
 * keeps its shape.
 */
export declare function sanitizeText(text: string): string;
/**
 * The name of a skill in the shared collection.
 *
 * The name is the identity of the point, so it has to be the same for
 * every writer: the map first, then the pattern rules.
 */
export declare function skillPointName(name: string): string;
//# sourceMappingURL=sanitize.d.ts.map