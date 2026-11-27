/**
 * The reader of the relationships of the graph.
 *
 * The reader is an adapter over the transport of the graph: it reads a
 * stored query of the graph and maps the rows to the edges of the
 * contract. The stored query is the seam of the schema: a graph that
 * does not hold the query yet refuses the read, and the refusal is named
 * instead of being hidden behind an empty answer.
 *
 * The reader is bounded on every side: the query asks for the types of
 * edge the caller follows, and the limit of the neighbours is part of the
 * request. A row without a type, without a provenance or without a
 * revision is not an edge: it is a broken row, and the reader names it.
 */

import {
	columnText,
	omnigraphQuery,
	type OmnigraphQueryResult,
} from "./omnigraph/transport.ts";
import type { EdgeProvenance, EdgeType, RelationReader, SkillEdge } from "./skill-relations.ts";

/** The name of the stored query that holds the relations. */
export const RELATION_QUERY = "skill_relations";

/** The options of the reader. */
export interface RelationReaderOptions {
	/** The base address of the server. */
	url: string;
	/** The graph that holds the query. */
	graph: string;
	/** The bearer credential of the reader. */
	token: string;
	/** The version of the HTTP contract of the server. */
	apiVersion: string;
	/** How long a read may take, in milliseconds. */
	timeoutMs: number;
	/** The name of the stored query. */
	query?: string;
	/** The function that performs the request. A test injects one. */
	fetchImpl?: typeof fetch;
}

/** The types of an edge the reader knows. */
const EDGE_TYPES: EdgeType[] = [
	"requires",
	"related_to",
	"supersedes",
	"conflicts_with",
];

/** The provenances of an edge the reader knows. */
const EDGE_PROVENANCES: EdgeProvenance[] = ["published", "reviewed", "inferred"];

/**
 * The reader of the relations of the graph.
 */
export function createRelationReader(
	options: RelationReaderOptions,
): RelationReader {
	return {
		async neighbors(
			identity: string,
			limits: { types: EdgeType[]; limit: number },
		): Promise<SkillEdge[]> {
			const result = await omnigraphQuery({
				url: options.url,
				graph: options.graph,
				query: options.query ?? RELATION_QUERY,
				params: {
					skill: identity,
					types: limits.types,
					limit: limits.limit,
				},
				token: options.token,
				apiVersion: options.apiVersion,
				timeoutMs: options.timeoutMs,
				...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
			});
			return edgesOf(result, limits.limit);
		},
	};
}

/**
 * The edges of an answer.
 *
 * A row that does not name a known type, a known provenance and a
 * revision is not an edge. It is dropped, because a half-known edge is
 * not a fact of the graph.
 */
export function edgesOf(
	result: OmnigraphQueryResult,
	limit: number,
): SkillEdge[] {
	const columns = result.columns ?? [];
	const edges: SkillEdge[] = [];
	for (const row of result.rows ?? []) {
		if (edges.length >= limit) break;
		const type = columnText(row, columns, "type") as EdgeType;
		const provenance = columnText(
			row,
			columns,
			"provenance",
		) as EdgeProvenance;
		const revision = columnText(row, columns, "revision");
		if (!EDGE_TYPES.includes(type)) continue;
		if (!EDGE_PROVENANCES.includes(provenance)) continue;
		if (!revision) continue;
		const from = columnText(row, columns, "from");
		const to = columnText(row, columns, "to");
		if (!from || !to) continue;
		const symmetric = columnText(row, columns, "symmetric") === "true";
		const owner = columnText(row, columns, "owner");
		const applicableVersions = columnText(row, columns, "applicable_versions");
		edges.push({
			from,
			to,
			type,
			provenance,
			revision,
			...(symmetric ? { symmetric } : {}),
			...(owner ? { owner } : {}),
			...(applicableVersions ? { applicableVersions } : {}),
		});
	}
	return edges;
}
