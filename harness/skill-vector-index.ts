/**
 * The reader of the vector index of the skills.
 *
 * The index is a rebuildable copy of the catalog of the graph: the graph is
 * the authority, and a hit of the index is only a candidate until the
 * catalog verifies it. The reader therefore verifies the payload of every
 * hit before it hands it out - the canonical identity, the scope and the
 * revision - and it hands out nothing else.
 *
 * The reader is read-only. It never writes a point, never creates a
 * collection and never changes an alias: the writer credential belongs to
 * the deployed sync, and a runtime that could write could also corrupt the
 * index that the sync rebuilds.
 *
 * The configuration has its own seam (the environment and the key files of
 * the harness), so a machine without a cluster keeps the catalog of the
 * graph and says so instead of pretending that an index is connected.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { VectorHit } from "./skill-retrieval.ts";

/** The configuration of the index. */
export interface VectorIndexConfig {
	/** The url of the cluster (the REST API of Qdrant). */
	url: string;
	/** The key of the reader. */
	apiKey?: string;
	/** The collection that holds the generation of the index. */
	collection: string;
	/** The namespace of the scope the index belongs to. */
	namespace: string;
	/** The graph the index was built from. */
	graph: string;
	/** How long a read may take, in milliseconds. */
	timeoutMs?: number;
}

/** The options of the reader. */
export interface VectorIndexReaderOptions {
	/** The configuration of the index. */
	config: VectorIndexConfig;
	/** The embedding of a query. */
	embed: (text: string) => Promise<number[]>;
	/** The fetch of the request (the test uses its own). */
	fetchImpl?: typeof fetch;
	/** The log of the reader. */
	log?: (message: string) => void;
}

/** The state of the index, as the operator sees it. */
export interface VectorIndexStatus {
	/** Is the index configured at all? */
	configured: boolean;
	/** Is the index reachable? */
	available: boolean;
	/** The number of the hits of the last read. */
	hits?: number;
	/** Why the index is not usable, when it is not. */
	reason?: string;
}

/** The default time of a read, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 5_000;

/** The maximum number of hits a read asks for. */
const MAX_LIMIT = 50;

/**
 * The url of the search of a collection.
 */
function searchUrl(config: VectorIndexConfig): string {
	const base = config.url.replace(/\/+$/, "");
	return `${base}/collections/${encodeURIComponent(config.collection)}/points/search`;
}

/**
 * The headers of a read.
 *
 * The key of the reader is sent as the api-key header of Qdrant. A read
 * without a key is possible on a local cluster, and the reader does not
 * invent one.
 */
function headersOf(config: VectorIndexConfig): Record<string, string> {
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (config.apiKey) headers["api-key"] = config.apiKey;
	return headers;
}

/**
 * The payload of a hit, when it carries the contract of the index.
 *
 * The payload of the generation holds the canonical identity, the scope and
 * the revision. A hit without them belongs to another index or to another
 * version of it, and it is not a candidate of this one.
 */
function hitOf(
	value: unknown,
	config: VectorIndexConfig,
): { hit: VectorHit } | { rejected: string } {
	if (!value || typeof value !== "object") return { rejected: "the hit is not an object" };
	const point = value as {
		score?: unknown;
		payload?: unknown;
	};
	const score = typeof point.score === "number" && Number.isFinite(point.score) ? point.score : 0;
	const payload = (point.payload ?? {}) as Record<string, unknown>;
	const identity = typeof payload.identity === "string" ? payload.identity.trim() : "";
	if (!identity) return { rejected: "the hit carries no canonical identity" };
	const namespace = typeof payload.namespace === "string" ? payload.namespace : "";
	if (namespace !== config.namespace) {
		return { rejected: "the hit belongs to another namespace" };
	}
	const graph = typeof payload.graph === "string" ? payload.graph : "";
	if (graph !== config.graph) {
		return { rejected: "the hit belongs to another graph" };
	}
	const revision = typeof payload.revision === "string" ? payload.revision : undefined;
	const sha256 = typeof payload.sha256 === "string" ? payload.sha256 : undefined;
	return { hit: { id: identity, score, ...(revision ? { revision } : {}), ...(sha256 ? { sha256 } : {}) } };
}

/**
 * The reader of the vector index of the skills.
 */
export class QdrantSkillIndex {
	private readonly options: VectorIndexReaderOptions;

	constructor(options: VectorIndexReaderOptions) {
		this.options = options;
	}

	/** The configuration of the reader. */
	get config(): VectorIndexConfig {
		return this.options.config;
	}

	/**
	 * The hits of the index for a query.
	 *
	 * The hits that do not carry the contract of the index are dropped: the
	 * catalog of the graph verifies the rest. A read that fails throws, and
	 * the caller decides what an unreadable index means.
	 */
	async search(query: string, limit: number): Promise<VectorHit[]> {
		const config = this.options.config;
		const bounded = Math.max(1, Math.min(Math.floor(limit) || 1, MAX_LIMIT));
		const vector = await this.options.embed(query);
		if (!Array.isArray(vector) || vector.length === 0) {
			throw new Error("the query could not be embedded");
		}
		const fetchImpl = this.options.fetchImpl ?? fetch;
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(),
			config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		);
		try {
			const response = await fetchImpl(searchUrl(config), {
				method: "POST",
				headers: headersOf(config),
				body: JSON.stringify({
					vector,
					limit: bounded,
					with_payload: true,
					with_vector: false,
				}),
				signal: controller.signal,
			});
			if (!response.ok) {
				throw new Error(
					`the index answered with the status ${response.status} ${response.statusText}`,
				);
			}
			const body = (await response.json()) as { result?: unknown };
			const points = Array.isArray(body?.result) ? body.result : [];
			const hits: VectorHit[] = [];
			for (const point of points) {
				const outcome = hitOf(point, config);
				if ("hit" in outcome) {
					hits.push(outcome.hit);
					continue;
				}
				this.options.log?.(`a hit of the index was dropped: ${outcome.rejected}`);
			}
			return hits;
		} finally {
			clearTimeout(timeout);
		}
	}

	/**
	 * The state of the index.
	 *
	 * The status never claims that the index is synchronized: it reports
	 * that the index is reachable and how many hits the last read found.
	 */
	async status(): Promise<VectorIndexStatus> {
		const config = this.options.config;
		if (!config.url || !config.collection) {
			return {
				configured: false,
				available: false,
				reason: "the vector index is not configured",
			};
		}
		const fetchImpl = this.options.fetchImpl ?? fetch;
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(),
			config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		);
		try {
			const response = await fetchImpl(
				`${config.url.replace(/\/+$/, "")}/collections/${encodeURIComponent(config.collection)}`,
				{ headers: headersOf(config), signal: controller.signal },
			);
			if (!response.ok) {
				return {
					configured: true,
					available: false,
					reason: `the index answered with the status ${response.status}`,
				};
			}
			return { configured: true, available: true };
		} catch (error) {
			return {
				configured: true,
				available: false,
				reason:
					error instanceof Error
						? `the index could not be read (${error.message.slice(0, 120)})`
						: "the index could not be read",
			};
		} finally {
			clearTimeout(timeout);
		}
	}
}

/**
 * The value of a key file of the machine.
 *
 * The name of the environment variable names the file of the key: the
 * name in lower case with dashes. The file is read from the directory of
 * the keys of the harness, and a file that is not there is nothing.
 */
function readKeyFile(name: string): string | undefined {
	try {
		const dir = join(
			process.env.PI_HARNESS_HOME ?? join(homedir(), ".pi-harness-runtime"),
			"keys",
		);
		const file = join(dir, `${name.toLowerCase().replace(/_/g, "-")}.txt`);
		if (!existsSync(file)) return undefined;
		const value = readFileSync(file, "utf8").trim();
		return value.length > 0 ? value : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The configuration of the index, from the environment and the key files.
 *
 * The environment wins over the key files, and a value that is missing
 * leaves the configuration empty: the reader is not created and the
 * retrieval runs on the catalog of the graph alone.
 */
export function readVectorIndexConfig(options: {
	env?: Record<string, string | undefined>;
	readKey?: (name: string) => string | undefined;
	namespace: string;
	graph: string;
	timeoutMs?: number;
}): VectorIndexConfig | null {
	const env = options.env ?? process.env;
	const readKey = options.readKey ?? readKeyFile;
	const url = (env.QDRANT_CLUSTER_ENDPOINT ?? readKey("QDRANT_CLUSTER_ENDPOINT") ?? "").trim();
	const collection = (env.QDRANT_COLLECTION ?? readKey("QDRANT_COLLECTION") ?? "").trim();
	if (!url || !collection) return null;
	const apiKey = (env.QDRANT_API_KEY ?? readKey("QDRANT_API_KEY") ?? "").trim();
	return {
		url,
		collection,
		namespace: options.namespace,
		graph: options.graph,
		...(apiKey ? { apiKey } : {}),
		...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
	};
}
