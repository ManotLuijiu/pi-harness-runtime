/**
 * Context Compiler - Compiler
 *
 * Main entry point for context compilation.
 * Pipeline: collect → policy filter → score → deduplicate → fit budget → source graph.
 */

import type {
	ContextCompileRequest,
	ContextSourceEdge,
	OmissionReason,
	OmittedItem,
} from "./types.js";
import { ContextCompileError } from "./types.js";

import { estimateTokens, fitToBudget, toCompiledItems } from "./budget.js";
import { generateCacheKey } from "./cache.js";
import { deduplicateCandidates, mergeFileSlices } from "./deduplicate.js";
import { applyPolicyFilter, mergePolicy } from "./filter.js";
import { mergeWeights, rankCandidates } from "./score.js";

/**
 * Default clock for generating timestamps.
 */
export function createClock() {
	return { now: () => new Date() };
}

export interface Clock {
	now: () => Date;
}

/**
 * Compile context from candidates.
 *
 * Pipeline:
 * 1. Apply policy filter (deny patterns, size limits)
 * 2. Score optional candidates
 * 3. Merge file slices
 * 4. Deduplicate
 * 5. Fit to token budget
 * 6. Generate source graph
 * 7. Return CompiledContext
 */
export async function compileContext(
	request: ContextCompileRequest,
	clock: Clock = createClock(),
): Promise<CompiledContextOutput> {
	const {
		taskId,
		taskObjective,
		maximumTokens,
		candidates,
		scoringWeights,
		policy,
	} = request;

	// 0. Validate required sources exist
	const missingRequired = candidates
		.filter((c) => c.required)
		.filter((c) => !c.content.trim());

	if (missingRequired.length > 0) {
		const first = missingRequired[0];
		if (!first)
			throw new Error("Internal: missingRequired should not be empty");
		throw new ContextCompileError(
			"MISSING_REQUIRED_SOURCE",
			`Required source "${first.source}" has no content`,
			{
				missingSources: missingRequired.map((c) => c.source),
			},
		);
	}

	// 1. Apply policy filter
	const resolvedPolicy = mergePolicy(policy);
	const { passed: policyPassed, denied: policyDenied } = applyPolicyFilter(
		candidates,
		resolvedPolicy,
	);

	const policyOmitted: OmittedItem[] = policyDenied.map(
		({ candidate, reason }) => ({
			id: candidate.id,
			kind: candidate.kind,
			reason: "policy_denied" as OmissionReason,
			reasonDetail: reason,
			estimatedTokens: estimateTokens(candidate.content),
			deniedBy: reason,
		}),
	);

	// 2. Score optional candidates
	const weights = mergeWeights(scoringWeights);
	const scoreContext = {
		directFileReferences: extractDirectReferences(taskObjective),
		taskDependencies: extractDependencies(taskObjective),
	};

	// 3. Merge file slices (before scoring)
	const merged = mergeFileSlices(policyPassed);

	// 4. Deduplicate
	const { unique: deduped, duplicates: dupIds } = deduplicateCandidates(merged);

	const dedupOmitted: OmittedItem[] = dupIds.map((id) => {
		const c = candidates.find((x) => x.id === id);
		return {
			id,
			kind: c?.kind ?? "source_file",
			reason: "duplicate" as OmissionReason,
			reasonDetail: `duplicate of ${c?.source ?? id}`,
			estimatedTokens: estimateTokens(c?.content ?? ""),
		};
	});

	// 5. Rank by score
	const ranked = rankCandidates(deduped, weights, scoreContext);

	// 6. Fit to budget
	const { included, omitted: budgetOmitted } = fitToBudget(
		ranked,
		maximumTokens,
	);

	// 7. Convert to compiled items
	const compiledItems = toCompiledItems(included);

	// 8. Generate source graph
	const sourceGraph = buildSourceGraph(compiledItems);

	// 9. Generate cache key
	const cacheKey = generateCacheKey(taskId, compiledItems, taskObjective);

	// 10. Build mapping
	const mapping: Record<string, string> = {};
	for (const c of candidates) {
		const compiled = compiledItems.find((i) => i.id === c.id);
		if (compiled) {
			mapping[c.id] = compiled.id;
		}
	}

	const totalOmitted = [...policyOmitted, ...dedupOmitted, ...budgetOmitted];

	return {
		taskId,
		items: compiledItems,
		omitted: totalOmitted,
		estimatedTokens: compiledItems.reduce(
			(sum, item) => sum + item.estimatedTokens,
			0,
		),
		sourceGraph,
		generatedAt: clock.now().toISOString(),
		mapping,
		cacheKey,
	};
}

/**
 * Compiled context output (extended with cache key).
 */
export interface CompiledContextOutput {
	taskId: string;
	items: ReturnType<typeof toCompiledItems>[number][];
	omitted: OmittedItem[];
	estimatedTokens: number;
	sourceGraph: ContextSourceEdge[];
	generatedAt: string;
	mapping: Record<string, string>;
	cacheKey: string;
}

/**
 * Extract direct file references from task objective.
 * Looks for quoted paths, file patterns.
 */
function extractDirectReferences(objective: string): Set<string> {
	const refs = new Set<string>();
	// Match quoted paths
	const quotedMatches = objective.matchAll(/(["'`])([^`1]+)\1/g);
	for (const match of quotedMatches) {
		const path = match[2];
		if (path) refs.add(path);
	}
	// Match common file patterns
	const filePattern =
		/[a-zA-Z][a-zA-Z0-9_/-]*\.(ts|tsx|js|jsx|py|go|rs|java|cpp|h|c|md|json|yaml|yml|toml)\b/g;
	for (const match of objective.matchAll(filePattern)) {
		const path = match[0];
		if (path) refs.add(path);
	}
	return refs;
}

/**
 * Extract dependency references from task objective.
 */
function extractDependencies(objective: string): string[] {
	const deps: string[] = [];
	// Match "depends on X", "related to Y"
	const depPatterns = [
		/(?:depends on|related to|imports from)\s+([A-Za-z][A-Za-z0-9_.-]*)/gi,
	];
	for (const pattern of depPatterns) {
		for (const match of objective.matchAll(pattern)) {
			const name = match[1];
			if (name) deps.push(name);
		}
	}
	return [...new Set(deps)];
}

/**
 * Build source graph edges between related items.
 */
function buildSourceGraph(
	items: ReturnType<typeof toCompiledItems>[number][],
): ContextSourceEdge[] {
	const edges: ContextSourceEdge[] = [];

	const okfItems = items.filter((i) => i.kind === "okf_concept");
	const sourceItems = items.filter((i) => i.kind === "source_file");
	const testItems = items.filter((i) => i.kind === "test_failure");

	// OKF concepts → source files they reference
	for (const okf of okfItems) {
		for (const src of sourceItems) {
			if (
				okf.content.includes(src.source) ||
				(src.filePath && okf.content.includes(src.filePath))
			) {
				edges.push({
					from: okf.id,
					to: src.id,
					label: "references",
					weight: 3,
				});
			}
		}
	}

	// Source files → test failures they relate to
	for (const src of sourceItems) {
		for (const test of testItems) {
			if (
				test.content.includes(src.source) ||
				(src.filePath && test.content.includes(src.filePath))
			) {
				edges.push({
					from: src.id,
					to: test.id,
					label: "causes_failure",
					weight: 5,
				});
			}
		}
	}

	// Sort edges deterministically
	edges.sort((a, b) => {
		const keyA = `${a.from}:${a.to}:${a.label}`;
		const keyB = `${b.from}:${b.to}:${b.label}`;
		return keyA.localeCompare(keyB);
	});

	return edges;
}
