/**
 * Knowledge Graph - RFC-0106
 *
 * Provenance linking between skills, RFCs, and implementations.
 */

import type { KnowledgeNode, KnowledgeEdge, KnowledgeGraph } from "./types.js";

/**
 * Build provenance edges based on metadata
 */
export function buildProvenanceEdges(graph: KnowledgeGraph): KnowledgeEdge[] {
	const edges: KnowledgeEdge[] = [];
	const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

	for (const node of graph.nodes) {
		if (node.type === "skill" && node.data.tags.includes("implements")) {
			// Link to RFCs found in tags
			const rfcTag = node.data.tags.find((t) => t.startsWith("rfc-"));
			if (rfcTag) {
				edges.push({
					from: node.id,
					to: `rfc:${rfcTag.toUpperCase()}`,
					type: "implements",
					metadata: { source: "tag:implements" },
				});
			}
		}

		// Implementation -> documents -> RFC
		if (node.type === "implementation") {
			const rfcMatch = node.id.match(/implementation:RFC-(\d+)/i);
			if (rfcMatch) {
				edges.push({
					from: node.id,
					to: `rfc:RFC-${rfcMatch[1].padStart(4, "0")}`,
					type: "documents",
					metadata: { source: "id:parsing" },
				});
			}
		}
	}

	return edges;
}

/**
 * Infer additional edges from content analysis
 */
export function inferRelationships(graph: KnowledgeGraph): KnowledgeEdge[] {
	const edges: KnowledgeEdge[] = [];

	// Group skills by shared tags
	const tagGroups = new Map<string, KnowledgeNode[]>();
	for (const node of graph.nodes) {
		if (node.type !== "skill") continue;
		for (const tag of node.data.tags) {
			if (!tagGroups.has(tag)) {
				tagGroups.set(tag, []);
			}
			tagGroups.get(tag)!.push(node);
		}
	}

	// Skills sharing 3+ tags are related
	for (const [, nodes] of tagGroups) {
		if (nodes.length < 2) continue;

		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const sharedTags = nodes[i].data.tags.filter((t) =>
					nodes[j].data.tags.includes(t),
				);
				if (sharedTags.length >= 3) {
					edges.push({
						from: nodes[i].id,
						to: nodes[j].id,
						type: "related_to",
						metadata: {
							source: "inferred:shared-tags",
							confidence:
								sharedTags.length /
								Math.max(nodes[i].data.tags.length, nodes[j].data.tags.length),
						},
					});
				}
			}
		}
	}

	return edges;
}

/**
 * Complete graph with all provenance links
 */
export function completeGraph(graph: KnowledgeGraph): KnowledgeGraph {
	const provenanceEdges = buildProvenanceEdges(graph);
	const inferredEdges = inferRelationships(graph);

	return {
		nodes: graph.nodes,
		edges: [...graph.edges, ...provenanceEdges, ...inferredEdges],
	};
}
