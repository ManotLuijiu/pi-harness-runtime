/**
 * Qdrant Client - Official @qdrant/js-client-rest wrapper
 */
import { QdrantClient } from "@qdrant/js-client-rest";
/**
 * Parse host:port from URL
 */
function parseHostPort(url) {
    const match = url.match(/https?:\/\/([^:]+)(?::(\d+))?/);
    return {
        host: match?.[1] || url,
        port: parseInt(match?.[2] || "6333"),
    };
}
/**
 * Create a Qdrant client
 */
export function createQdrantClient(config) {
    const { host, port } = parseHostPort(config.url);
    return new QdrantClient({ host, port, apiKey: config.apiKey });
}
/**
 * Create a collection with dense vectors
 */
export async function createCollection(client, name, dimensions = 384 // all-MiniLM-L6-v2
) {
    try {
        await client.createCollection(name, {
            vectors: { size: dimensions, distance: "Cosine" },
        });
    }
    catch (err) {
        // Ignore "already exists" / "Conflict" — both mean the collection already exists
        if (err instanceof Error) {
            const msg = err.message.toLowerCase();
            if (msg.includes("already exists") || msg.includes("conflict") || msg.includes("already_exists")) {
                return;
            }
        }
        throw err;
    }
}
/**
 * Get collection info (vector size, distance, point count)
 */
export async function getCollectionInfo(client, name) {
    try {
        const info = await client.getCollection(name);
        // Vectors config can be a named config or default { size, distance }
        const vectorsConfig = info.vectors;
        let vectorsSize;
        let vectorsDistance;
        if (vectorsConfig) {
            // Handle both { size: number, distance: string } and named config { config: { size, distance } }
            vectorsSize = (vectorsConfig.size ?? vectorsConfig.config?.size);
            vectorsDistance = (vectorsConfig.distance ?? vectorsConfig.config?.distance);
        }
        // Points count might be in different locations depending on Qdrant version
        const pointsCount = (info.points ?? info.num_points ?? info.points_count);
        return {
            exists: true,
            vectorsSize,
            vectorsDistance,
            pointsCount,
        };
    }
    catch (err) {
        if (err instanceof Error && (err.message.includes("not found") || err.message.includes("404"))) {
            return { exists: false };
        }
        // Return null on other errors
        return null;
    }
}
/**
 * Validate collection schema matches expected embedding model
 */
export async function validateCollectionSchema(client, name, expectedDimensions, expectedDistance = "Cosine") {
    const info = await getCollectionInfo(client, name);
    if (!info) {
        return { valid: false, error: "Could not retrieve collection info" };
    }
    if (!info.exists) {
        return { valid: false, error: "Collection does not exist" };
    }
    if (info.vectorsSize !== expectedDimensions) {
        return {
            valid: false,
            error: `Dimension mismatch: expected ${expectedDimensions}, got ${info.vectorsSize}`,
            actualDimensions: info.vectorsSize,
            actualDistance: info.vectorsDistance,
        };
    }
    if (info.vectorsDistance && info.vectorsDistance !== expectedDistance) {
        return {
            valid: false,
            error: `Distance mismatch: expected ${expectedDistance}, got ${info.vectorsDistance}`,
            actualDimensions: info.vectorsSize,
            actualDistance: info.vectorsDistance,
        };
    }
    return {
        valid: true,
        actualDimensions: info.vectorsSize,
        actualDistance: info.vectorsDistance,
    };
}
/**
 * Delete a collection
 */
export async function deleteCollection(client, name) {
    try {
        await client.deleteCollection(name);
    }
    catch {
        // Ignore if not exists
    }
}
/**
 * Upsert skill points with cloud inference
 */
export async function upsertSkills(client, collectionName, skills, model = "sentence-transformers/all-MiniLM-L6-v2") {
    const points = skills.map((skill, idx) => ({
        id: skill.id || idx + 1,
        payload: {
            name: skill.name,
            description: skill.description,
            body: skill.body.slice(0, 2000),
        },
        vector: {
            text: skill.text,
            model,
        },
    }));
    await client.upsert(collectionName, { wait: true, points });
}
/**
 * Search skills with semantic query
 */
export async function searchSkills(client, collectionName, query, model = "sentence-transformers/all-MiniLM-L6-v2", limit = 5) {
    const results = await client.query(collectionName, {
        query: { text: query, model },
        limit,
        with_payload: true,
    });
    // Parse response: SDK already unwraps HTTP response, QueryResponse has points directly
    const typedResults = results;
    const points = typedResults?.points || [];
    return points.map((point) => ({
        id: point.id,
        name: point.payload?.name || `skill-${point.id}`,
        description: point.payload?.description || "",
        score: point.score,
    }));
}
/**
 * Get all skills from collection
 */
export async function getAllSkills(client, collectionName) {
    const results = await client.query(collectionName, {
        filter: {}, // Empty filter = all
        limit: 100,
        with_payload: true,
    });
    // Parse response: SDK already unwraps HTTP response, QueryResponse has points directly
    const typedResults = results;
    const points = typedResults?.points || [];
    return points.map((point) => ({
        id: point.id,
        name: point.payload?.name || `skill-${point.id}`,
        description: point.payload?.description || "",
        score: point.score || 0,
    }));
}
//# sourceMappingURL=client.js.map