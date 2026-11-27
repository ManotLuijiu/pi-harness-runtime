/**
 * The relationships of the graph, bounded.
 *
 * The graph owns the published skills and the relationships between them.
 * The edges are read with a bounded query, and the expansion of a
 * selection is bounded by a depth, a number of nodes and a budget of
 * tokens. The rules of the plan are the rules of this module:
 *
 * - the edge types are reviewed: requires (a mandatory prerequisite),
 *   related_to (an optional discovery), supersedes (a version lineage) and
 *   conflicts_with (incompatible instructions),
 * - a prerequisite names a COMPATIBLE published target, never an ambiguous
 *   name,
 * - a model-inferred edge is never trusted: it is evidence, not a fact,
 * - the expansion starts with one hop and a declared neighbour cap,
 * - the cycles, the missing or denied dependencies and the conflicting
 *   requirements are detected and named,
 * - a required dependency that cannot be verified or cannot fit BLOCKS the
 *   selection with a reason. It is never dropped silently,
 * - the prerequisites load before the dependents.
 */

/** The types of an edge of the graph. */
export type EdgeType = "requires" | "related_to" | "supersedes" | "conflicts_with";

/** How an edge was established. */
export type EdgeProvenance = "published" | "reviewed" | "inferred";

/** One edge of the graph. */
export interface SkillEdge {
	/** The identity of the skill the edge starts at. */
	from: string;
	/** The identity of the skill the edge points at. */
	to: string;
	/** The type of the edge. */
	type: EdgeType;
	/** The edge holds in both directions. */
	symmetric?: boolean;
	/** How the edge was established. */
	provenance: EdgeProvenance;
	/** The revision of the publication the edge belongs to. */
	revision: string;
	/** The owner of the edge. */
	owner?: string;
	/** The versions of the skill the edge applies to. */
	applicableVersions?: string;
}

/** The reader of the neighbours of a skill. */
export interface RelationReader {
	/**
	 * The neighbours of a skill.
	 *
	 * The reader is bounded: it never returns more than the limit it was
	 * given, and it never returns an edge of a type that was not asked for.
	 */
	neighbors(
		identity: string,
		options: { types: EdgeType[]; limit: number },
	): Promise<SkillEdge[]>;
}

/** One node of the expansion. */
export interface RelationNode {
	/** The identity of the skill. */
	identity: string;
	/** The name of the skill. */
	name?: string;
	/** The edge that reached the node. */
	via?: EdgeType;
	/** The skill is a mandatory prerequisite of the selection. */
	required: boolean;
	/** The depth the node was found at. */
	depth: number;
}

/** The conflict of two mandatory instructions. */
export interface RelationConflict {
	/** The first identity of the conflict. */
	a: string;
	/** The second identity of the conflict. */
	b: string;
	/** The reason of the conflict. */
	reason: string;
}

/** The plan of the expansion. */
export interface RelationPlan {
	/** The nodes of the expansion, in the order they load. */
	nodes: RelationNode[];
	/** The edges the expansion used. */
	edges: SkillEdge[];
	/** The cycles the expansion found. */
	cycles: string[][];
	/** The required dependencies that are missing or denied. */
	missing: Array<{ identity: string; reason: string }>;
	/** The conflicts of the mandatory instructions. */
	conflicts: RelationConflict[];
	/** The nodes that were left out because of a bound. */
	truncated: Array<{ identity: string; reason: string }>;
	/** The number of the tokens the expansion costs. */
	tokens: number;
	/** The plan is complete. */
	ok: boolean;
}

/** The defaults of the expansion. */
export const DEFAULT_RELATION_LIMITS = {
	/** The number of hops of the expansion. */
	depth: 2,
	/** The number of nodes of the expansion. */
	nodes: 24,
	/** The number of neighbours of one hop. */
	neighbours: 8,
	/** The budget of the tokens of the expansion. */
	tokens: 4000,
};

/**
 * The edges that may be trusted.
 *
 * An edge that a model inferred is evidence about the graph, not a fact of
 * it: it never becomes a mandatory prerequisite.
 */
export function trustedEdges(edges: SkillEdge[]): SkillEdge[] {
	return edges.filter((edge) => edge.provenance !== "inferred");
}

/**
 * The expansion of a selection.
 *
 * The expansion is bounded: a depth, a number of nodes, a number of
 * neighbours per hop and a budget of tokens. The required dependencies
 * always count against the bounds, the optional ones are left out first.
 */
export async function planRelations(options: {
	/** The roots of the expansion. */
	roots: Array<{ identity: string; name?: string; required?: boolean }>;
	/** The reader of the neighbours. */
	reader: RelationReader;
	/** The edge types the expansion follows. */
	types?: EdgeType[];
	/** The bounds of the expansion. */
	limits?: Partial<typeof DEFAULT_RELATION_LIMITS>;
	/** The cost of a node in tokens. */
	costOf?: (identity: string) => number;
}): Promise<RelationPlan> {
	const limits = { ...DEFAULT_RELATION_LIMITS, ...(options.limits ?? {}) };
	const types: EdgeType[] = options.types ?? ["requires", "conflicts_with"];
	const costOf = options.costOf ?? (() => 0);

	const nodes: RelationNode[] = [];
	const edges: SkillEdge[] = [];
	const seen = new Map<string, RelationNode>();
	const cycles: string[][] = [];
	const missing: Array<{ identity: string; reason: string }> = [];
	const conflicts: RelationConflict[] = [];
	const truncated: Array<{ identity: string; reason: string }> = [];
	let tokens = 0;

	const addNode = (
		identity: string,
		depth: number,
		via: EdgeType | undefined,
		required: boolean,
		name?: string,
	): { node: RelationNode; created: boolean } | undefined => {
		const known = seen.get(identity);
		if (known) {
			if (required && !known.required) {
				known.required = true;
			}
			return { node: known, created: false };
		}
		if (nodes.length >= limits.nodes) {
			truncated.push({
				identity,
				reason: `the expansion reached the limit of ${limits.nodes} nodes`,
			});
			return undefined;
		}
		const cost = costOf(identity);
		if (tokens + cost > limits.tokens) {
			truncated.push({
				identity,
				reason: `the expansion reached the budget of ${limits.tokens} tokens`,
			});
			return undefined;
		}
		tokens += cost;
		const node: RelationNode = { identity, depth, required, ...(via ? { via } : {}), ...(name ? { name } : {}) };
		seen.set(identity, node);
		nodes.push(node);
		return { node, created: true };
	};

	// The queue of the expansion: the roots first, then the neighbours.
	// Every entry carries the chain of the ancestors, so a cycle is seen
	// even when the expansion runs breadth first.
	const queue: Array<{
		identity: string;
		depth: number;
		via?: EdgeType;
		required: boolean;
		name?: string;
		chain: string[];
	}> = [];
	for (const root of options.roots) {
		addNode(root.identity, 0, undefined, root.required ?? true, root.name);
		queue.push({
			identity: root.identity,
			depth: 0,
			required: root.required ?? true,
			chain: [root.identity],
			...(root.name ? { name: root.name } : {}),
		});
	}

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) break;
		if (current.depth >= limits.depth) {
			truncated.push({
				identity: current.identity,
				reason: `the expansion reached the depth of ${limits.depth}`,
			});
			continue;
		}
		const chain = current.chain;
		let neighbours: SkillEdge[];
		try {
			neighbours = await options.reader.neighbors(current.identity, {
				types,
				limit: limits.neighbours,
			});
		} catch (error) {
			missing.push({
				identity: current.identity,
				reason: `the neighbours could not be read: ${messageOf(error)}`,
			});
			continue;
		}
		for (const edge of trustedEdges(neighbours).slice(0, limits.neighbours)) {
			const isFrom = edge.from === current.identity;
			const isTo = edge.to === current.identity;
			if (!isFrom && !isTo) continue;

			if (edge.type === "conflicts_with") {
				const other = isFrom ? edge.to : edge.from;
				conflicts.push({
					a: current.identity,
					b: other,
					reason: "the two skills carry incompatible instructions",
				});
				continue;
			}
			if (edge.type === "supersedes") {
				edges.push(edge);
				continue;
			}
			if (edge.type === "related_to") {
				const target = isFrom ? edge.to : edge.from;
				const added = addNode(target, current.depth + 1, "related_to", false);
				if (!added) continue;
				edges.push(edge);
				if (added.created) {
					queue.push({
						identity: target,
						depth: current.depth + 1,
						via: "related_to",
						required: false,
						chain: [...chain, target],
					});
				}
				continue;
			}
			// A mandatory prerequisite. The edge is read from the side of
			// the skill that requires it: the other side names a
			// dependent, not a prerequisite.
			if (!isFrom) continue;
			const target = edge.to;
			if (chain.includes(target)) {
				cycles.push([...chain, target]);
				continue;
			}
			const added = addNode(target, current.depth + 1, "requires", true);
			if (!added) {
				missing.push({
					identity: target,
					reason: "the prerequisite does not fit the bounds of the expansion",
				});
				continue;
			}
			edges.push(edge);
			if (added.created) {
				queue.push({
					identity: target,
					depth: current.depth + 1,
					via: "requires",
					required: true,
					chain: [...chain, target],
				});
			}
		}
	}

	const order = loadOrder(nodes, edges);
	return {
		nodes: order,
		edges,
		cycles,
		missing,
		conflicts,
		truncated,
		tokens,
		ok: missing.length === 0 && conflicts.length === 0 && cycles.length === 0,
	};
}

/**
 * The order the skills load in.
 *
 * A prerequisite loads before the skill that requires it.
 */
export function loadOrder(nodes: RelationNode[], edges: SkillEdge[]): RelationNode[] {
	const byIdentity = new Map(nodes.map((node) => [node.identity, node]));
	const requires = edges.filter((edge) => edge.type === "requires");
	const ordered: RelationNode[] = [];
	const placed = new Set<string>();
	const visiting = new Set<string>();

	const place = (node: RelationNode): void => {
		if (placed.has(node.identity)) return;
		if (visiting.has(node.identity)) return;
		visiting.add(node.identity);
		for (const edge of requires) {
			if (edge.from !== node.identity) continue;
			const target = byIdentity.get(edge.to);
			if (target) place(target);
		}
		visiting.delete(node.identity);
		placed.add(node.identity);
		ordered.push(node);
	};

	for (const node of nodes) place(node);
	return ordered;
}

/**
 * The message of a failure.
 */
function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
