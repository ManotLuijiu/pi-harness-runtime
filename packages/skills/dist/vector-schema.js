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
import { sanitizeText, skillPointName } from "./sanitize.js";
/**
 * The collection the runtime indexes into and searches.
 *
 * `QDRANT_COLLECTION` overrides it, so a cluster that already holds a
 * collection under another name keeps working.
 */
export const SKILL_COLLECTION = "pi-harness-skills-openai-v1";
/**
 * The collection that was used before the schema was versioned.
 *
 * It holds 384-dimensional vectors - the model that
 * `scripts/sync-to-qdrant.ts` used - and is NOT compatible with the
 * runtime. It is named here so a mismatch can name the real cause instead
 * of only the numbers.
 */
export const LEGACY_SKILL_COLLECTION = "pi-harness-skills";
/** The model of the legacy collection. */
export const LEGACY_SKILL_COLLECTION_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
/** The vector size of the legacy collection. */
export const LEGACY_SKILL_COLLECTION_DIMENSIONS = 384;
/**
 * The score below which a hit of the runtime collection is not a hit.
 *
 * The score of a vector search is a cosine between two vectors, and its
 * scale belongs to the model that produced them. Measured against the
 * runtime collection (123 skills, `text-embedding-3-small`):
 *
 *   - a query that names a skill scores 0.31 to 0.56,
 *   - a query about something else scores 0.10 to 0.23, and the wrong
 *     skill that it matched tops out at 0.2305.
 *
 * The threshold sits between the two (0.27). The old value of 0.5 belonged
 * to the MiniLM collection, whose vectors are not comparable, and it
 * threw away even a clear match (0.47) - so a search of the runtime
 * collection returned nothing at all.
 *
 * It lives here, next to the model and the collection, so that the two
 * cannot drift apart.
 */
export const SKILL_MIN_SCORE = 0.27;
/**
 * The score below which a hit of the legacy collection is not a hit.
 *
 * The legacy collection holds MiniLM vectors. Their scale was never
 * measured against a query, so the old value is kept. It is named here
 * so it is not mistaken for the threshold of the runtime.
 */
export const LEGACY_SKILL_MIN_SCORE = 0.5;
/**
 * The body of a payload is truncated.
 *
 * A payload is an index, not a file store - the complete skill comes from
 * the skill service.
 */
export const SKILL_PAYLOAD_BODY_LIMIT = 2000;
/** The text of a payload is truncated as well. */
export const SKILL_PAYLOAD_TEXT_LIMIT = 1500;
/**
 * A stable hash of a string.
 *
 * The same string always produces the same number, in every process and
 * on every machine - a point id has to survive a restart.
 *
 * Two uses:
 * - the id of a point is the hash of the name its payload carries, so the
 *   point id and the payload name always belong together. Two writers
 *   that store the same name address the same point.
 * - the hash of the text of a skill says whether its content changed.
 */
export function stableHash(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}
/**
 * The text a skill vector is built from.
 *
 * The title is added when it differs from the name: a skill whose
 * directory is named differently from its title carries both.
 */
export function skillPointText(input) {
    const parts = [input.name];
    if (input.title && input.title !== input.name)
        parts.push(input.title);
    parts.push(input.description);
    parts.push(input.body.slice(0, SKILL_PAYLOAD_TEXT_LIMIT));
    return parts.join(" ");
}
/**
 * The point of a skill.
 *
 * The runtime registry and `scripts/sync-to-qdrant.ts` both build their
 * points here, so they cannot drift apart. A writer that used its own id
 * would leave a second point for every skill the other one indexes, and
 * an id that happens to collide with a foreign one would overwrite an
 * unrelated skill.
 */
export function skillQdrantPoint(payload) {
    return { id: stableHash(payload.name), payload };
}
/**
 * The payload of a skill point.
 *
 * The payload is sanitized: the collection is shared, so the client names
 * of a user must not travel into it. Both writers use this function, so
 * both write the same sanitized payload for the same skill.
 */
export function skillPointPayload(input, 
/**
 * The rules of the installation. They default to the rules of this
 * machine, and a test passes its own rules in.
 */
rules) {
    const name = skillPointName(input.name, rules);
    const title = input.title ? skillPointName(input.title, rules) : undefined;
    const description = sanitizeText(input.description, rules);
    const body = sanitizeText(input.body, rules).slice(0, SKILL_PAYLOAD_BODY_LIMIT);
    return {
        name,
        description,
        body,
        text: skillPointText({ name, title, description, body }),
    };
}
export function describeSkillSchemaMismatch(actual, expected) {
    if (actual.dimensions !== undefined && actual.dimensions !== expected.dimensions) {
        const model = expected.model ? ` (${expected.model})` : "";
        return `the collection holds ${actual.dimensions}-dimensional vectors, the runtime embeds with ${expected.dimensions}${model}`;
    }
    if (actual.distance !== undefined && actual.distance !== expected.distance) {
        return `the collection uses the ${actual.distance} distance, the runtime expects ${expected.distance}`;
    }
    return null;
}
//# sourceMappingURL=vector-schema.js.map