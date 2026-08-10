/**
 * Knowledge Graph - RFC-0106
 *
 * MCP tools for knowledge graph queries.
 */

import type {
	KnowledgeNode,
	KnowledgeEdge,
	KnowledgeGraph,
	SearchOptions,
	SearchResult,
	TencentDBConfig,
} from "./types.js";

/**
 * Sync graph to TencentDB Knowledge Service
 */
export async function syncGraphToKnowledgeService(
	graph: KnowledgeGraph,
	config: TencentDBConfig,
): Promise<{ synced: number; errors: string[] }> {
	const response = await fetch(
		`${config.knowledgeUrl}/v3/knowledge/graph/sync`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-tdai-user-key": config.userKey,
				"x-tdai-service-id": config.serviceId,
			},
			body: JSON.stringify({
				nodes: graph.nodes.map((n) => ({
					id: n.id,
					type: n.type,
					...n.data,
				})),
				edges: graph.edges.map((e) => ({
					from: e.from,
					to: e.to,
					type: e.type,
				})),
			}),
		},
	);

	if (!response.ok) {
		const error = await response.text();
		return { synced: 0, errors: [error] };
	}

	return { synced: graph.nodes.length, errors: [] };
}

/**
 * Search knowledge graph
 */
export async function searchGraph(
	query: string,
	config: TencentDBConfig,
	options: SearchOptions = {},
): Promise<SearchResult[]> {
	const limit = options.limit ?? 10;

	const response = await fetch(
		`${config.knowledgeUrl}/v3/knowledge/graph/search`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-tdai-user-key": config.userKey,
				"x-tdai-service-id": config.serviceId,
			},
			body: JSON.stringify({
				query,
				limit,
				type: options.type,
				tags: options.tags,
			}),
		},
	);

	if (!response.ok) {
		throw new Error(`Search failed: ${response.statusText}`);
	}

	const data = (await response.json()) as {
		results: Array<{
			id: string;
			type: string;
			title: string;
			description?: string;
			tags: string[];
			score: number;
		}>;
	};

	return data.results.map((r) => ({
		node: {
			id: r.id,
			type: r.type as KnowledgeNode["type"],
			data: {
				title: r.title,
				description: r.description,
				tags: r.tags,
			},
		},
		score: r.score,
	}));
}

/**
 * Query graph by relationship type
 */
export async function queryRelationships(
	config: TencentDBConfig,
	options: {
		type?: KnowledgeEdge["type"];
		from?: string;
		to?: string;
	},
): Promise<KnowledgeEdge[]> {
	const response = await fetch(
		`${config.knowledgeUrl}/v3/knowledge/graph/query`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-tdai-user-key": config.userKey,
				"x-tdai-service-id": config.serviceId,
			},
			body: JSON.stringify(options),
		},
	);

	if (!response.ok) {
		throw new Error(`Query failed: ${response.statusText}`);
	}

	const data = (await response.json()) as {
		edges: Array<{
			from: string;
			to: string;
			type: string;
		}>;
	};

	return data.edges.map((e) => ({
		from: e.from,
		to: e.to,
		type: e.type as KnowledgeEdge["type"],
	}));
}

/**
 * Get a specific node by ID
 */
export async function getNode(
	nodeId: string,
	config: TencentDBConfig,
): Promise<KnowledgeNode | null> {
	const response = await fetch(
		`${config.knowledgeUrl}/v3/knowledge/graph/node/${encodeURIComponent(nodeId)}`,
		{
			headers: {
				"x-tdai-user-key": config.userKey,
				"x-tdai-service-id": config.serviceId,
			},
		},
	);

	if (response.status === 404) {
		return null;
	}

	if (!response.ok) {
		throw new Error(`Get node failed: ${response.statusText}`);
	}

	const data = (await response.json()) as {
		id: string;
		type: string;
		title: string;
		description?: string;
		tags: string[];
		source?: string;
	};

	return {
		id: data.id,
		type: data.type as KnowledgeNode["type"],
		data: {
			title: data.title,
			description: data.description,
			tags: data.tags,
			source: data.source,
		},
	};
}

/**
 * Find skills that implement a specific RFC
 */
export async function findByRFC(
	rfcId: string,
	config: TencentDBConfig,
): Promise<KnowledgeNode[]> {
	const edges = await queryRelationships(config, {
		type: "implements",
		to: rfcId.startsWith("rfc:") ? rfcId : `rfc:${rfcId}`,
	});

	const nodes: KnowledgeNode[] = [];
	for (const edge of edges) {
		const node = await getNode(edge.from, config);
		if (node) {
			nodes.push(node);
		}
	}

	return nodes;
}

/**
 * Find related skills
 */
export async function findRelated(
	skillId: string,
	config: TencentDBConfig,
	maxResults = 5,
): Promise<KnowledgeNode[]> {
	const edges = await queryRelationships(config, {
		type: "related_to",
		from: skillId.startsWith("skill:") ? skillId : `skill:${skillId}`,
	});

	const nodes: KnowledgeNode[] = [];
	for (const edge of edges.slice(0, maxResults)) {
		const node = await getNode(edge.to, config);
		if (node) {
			nodes.push(node);
		}
	}

	return nodes;
}
