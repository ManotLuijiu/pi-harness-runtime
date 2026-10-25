/**
 * The collection info of Qdrant.
 *
 * Qdrant reports the vector configuration under `config.params.vectors` -
 * not at the top level. Reading `info.vectors` yields undefined for every
 * collection, which turned every schema check into "dimension mismatch:
 * got undefined" and hid the real cause of an incompatible collection.
 *
 * The client is a small double, so the test never reaches the network.
 */

import { describe, expect, it } from "bun:test";

import {
	getCollectionInfo,
	isNotFoundError,
	validateCollectionSchema,
} from "../src/client.js";

/** A client that answers with the given collection description. */
function fakeClient(description: unknown): {
	getCollection: (name: string) => Promise<unknown>;
} {
	return {
		getCollection: async () => description,
	};
}

/** The description Qdrant answers with for a 384-dimensional collection. */
const MINILM_DESCRIPTION = {
	status: "green",
	points_count: 79,
	config: {
		params: {
			vectors: { size: 384, distance: "Cosine" },
		},
	},
};

describe("the collection info", () => {
	it("reads the vector size and the distance", async () => {
		const info = await getCollectionInfo(
			fakeClient(MINILM_DESCRIPTION) as never,
			"pi-harness-skills",
		);
		expect(info).not.toBeNull();
		expect(info?.exists).toBe(true);
		expect(info?.vectorsSize).toBe(384);
		expect(info?.vectorsDistance).toBe("Cosine");
	});

	it("reads the number of points", async () => {
		const info = await getCollectionInfo(
			fakeClient(MINILM_DESCRIPTION) as never,
			"pi-harness-skills",
		);
		expect(info?.pointsCount).toBe(79);
	});

	it("reads a named vector configuration", async () => {
		const info = await getCollectionInfo(
			fakeClient({
				points_count: 3,
				config: {
					params: {
						vectors: { named: { text: { size: 1536, distance: "Dot" } } },
					},
				},
			}) as never,
			"pi-harness-skills",
		);
		expect(info?.vectorsSize).toBe(1536);
		expect(info?.vectorsDistance).toBe("Dot");
	});

	it("still reads a flat description", async () => {
		// An older proxy answers without the config wrapper.
		const info = await getCollectionInfo(
			fakeClient({ points_count: 1, vectors: { size: 1536, distance: "Cosine" } }) as never,
			"pi-harness-skills",
		);
		expect(info?.vectorsSize).toBe(1536);
		expect(info?.vectorsDistance).toBe("Cosine");
	});

	it("reports a missing collection", async () => {
		const client = {
			getCollection: async () => {
				throw new Error("Not found: Collection not found");
			},
		};
		const info = await getCollectionInfo(client as never, "pi-harness-skills");
		expect(info).toEqual({ exists: false });
	});

	it("reports a missing collection the way Qdrant really answers", async () => {
		// Qdrant answers with the status 404 and the text "Not Found" -
		// capitalised. A case-sensitive comparison turns a collection that
		// does not exist yet into "the cluster could not be read".
		const client = {
			getCollection: async () => {
				const error = new Error("Not Found") as Error & {
					status: number;
					headers: unknown;
					url: string;
				};
				error.status = 404;
				throw error;
			},
		};
		const info = await getCollectionInfo(client as never, "pi-harness-skills-openai-v1");
		expect(info).toEqual({ exists: false });
	});

	it("tells a missing collection apart from an unreachable cluster", async () => {
		const missing = new Error("Not Found") as Error & { status: number };
		missing.status = 404;
		expect(isNotFoundError(missing)).toBe(true);

		const unreachable = new Error("connection refused");
		expect(isNotFoundError(unreachable)).toBe(false);

		const forbidden = new Error("Forbidden") as Error & { status: number };
		forbidden.status = 403;
		expect(isNotFoundError(forbidden)).toBe(false);
	});

	it("reports an unreadable collection as unknown", async () => {
		const client = {
			getCollection: async () => {
				throw new Error("connection refused");
			},
		};
		expect(await getCollectionInfo(client as never, "pi-harness-skills")).toBeNull();
	});
});

describe("the schema check", () => {
	it("names the real dimensions of an incompatible collection", async () => {
		const result = await validateCollectionSchema(
			fakeClient(MINILM_DESCRIPTION) as never,
			"pi-harness-skills",
			1536,
		);
		expect(result.valid).toBe(false);
		// The message names the size the collection really has - not
		// "undefined".
		expect(result.error).toContain("384");
		expect(result.error).not.toContain("undefined");
		expect(result.actualDimensions).toBe(384);
	});

	it("accepts a collection with the expected dimensions", async () => {
		const result = await validateCollectionSchema(
			fakeClient({
				points_count: 79,
				config: { params: { vectors: { size: 1536, distance: "Cosine" } } },
			}) as never,
			"pi-harness-skills",
			1536,
		);
		expect(result.valid).toBe(true);
		expect(result.actualDimensions).toBe(1536);
	});
});
