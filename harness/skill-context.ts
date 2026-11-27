/**
 * The context of a task, budgeted.
 *
 * The search is not the permission to execute a skill. This module turns
 * the candidates of a retrieval into a budgeted input of the current
 * authorized task, and it keeps the rules of the plan:
 *
 * - the room for the conversation, the tool responses, the reasoning and
 *   the required policies is reserved BEFORE the budget of the skills,
 * - a mandatory dependency counts in the cap and in the token budget, both,
 * - a skill is never truncated in the middle of an instruction: it is whole
 *   or it is not there,
 * - a complete required set that does not fit blocks the selection with a
 *   reason; it is never dropped silently,
 * - the same skill is never loaded twice: the identity and the hash decide,
 * - every selection keeps its citation: the reference, the reason and the
 *   paths of the resources.
 */

import type { SkillRef } from "./skill-retrieval.ts";
import type { RelationNode } from "./skill-relations.ts";

/** One skill that may enter the context. */
export interface ContextCandidate {
	/** The authoritative reference of the skill. */
	ref: SkillRef;
	/** The name of the skill. */
	name: string;
	/** The instructions of the skill (the verified body). */
	instructions: string;
	/** The place of the candidate in the result of the retrieval. */
	rank: number;
	/** The skill is a mandatory dependency of the selection. */
	required?: boolean;
	/** The reason the candidate was chosen. */
	reason: string;
	/** The paths of the resources of the skill. */
	resourcePaths?: string[];
}

/** One skill of the selection. */
export interface SelectedSkill {
	/** The authoritative reference of the skill. */
	ref: SkillRef;
	/** The name of the skill. */
	name: string;
	/** The reason the skill was selected. */
	reason: string;
	/** The cost of the skill in tokens. */
	tokens: number;
	/** The paths of the resources of the skill. */
	resourcePaths?: string[];
	/** The skill is a mandatory dependency. */
	required: boolean;
}

/** One skill that did not enter the context. */
export interface ExcludedSkill {
	/** The reference of the skill. */
	ref: SkillRef;
	/** The name of the skill. */
	name: string;
	/** The reason the skill was left out. */
	reason: string;
	/** The skill is a mandatory dependency of the selection. */
	required: boolean;
}

/** The budget of the selection. */
export interface ContextBudget {
	/** The budget of the whole context in tokens. */
	totalTokens: number;
	/** The room reserved for the conversation, the tools, the reasoning and the policies. */
	reservedTokens: number;
	/** The maximum number of skills that enter the context. */
	selectionCap: number;
}

/** The result of a selection. */
export interface ContextSelection {
	/** The skills that enter the context, in the order they load. */
	selected: SelectedSkill[];
	/** The skills that did not enter the context. */
	excluded: ExcludedSkill[];
	/** The budget as it was consumed. */
	budget: {
		/** The budget of the whole context. */
		totalTokens: number;
		/** The room that was reserved. */
		reservedTokens: number;
		/** The budget that was left for the skills. */
		availableTokens: number;
		/** The tokens the selected skills cost. */
		usedTokens: number;
		/** The tokens that are left. */
		remainingTokens: number;
		/** The number of the selected skills. */
		count: number;
	};
	/** The state of the verification of the selection. */
	verification: "verified" | "blocked";
	/** The reason the selection is blocked. */
	blocked?: string;
}

/**
 * The estimate of the tokens of a text.
 *
 * The estimate is the convention of the repository: one token per four
 * characters. A caller that knows the tokenizer of the active model passes
 * it in, and the estimate is only the fallback.
 */
export function estimateTokens(text: string): number {
	if (!text || text.trim() === "") return 0;
	return Math.ceil(text.length / 4);
}

/**
 * The selection of the context.
 *
 * The mandatory dependencies load first and count in both budgets. The
 * optional skills follow in the order of the retrieval, until the budget or
 * the cap is reached. The required set that does not fit blocks the whole
 * selection: a task that runs with a missing prerequisite is a task that
 * runs wrong.
 */
export function selectContext(options: {
	/** The candidates of the retrieval. */
	candidates: ContextCandidate[];
	/** The budget of the context. */
	budget: ContextBudget;
	/** The nodes of the relation closure (the mandatory dependencies). */
	relations?: RelationNode[];
	/** The tokenizer of the active model. */
	countTokens?: (text: string) => number;
}): ContextSelection {
	const count = options.countTokens ?? estimateTokens;
	const budget = options.budget;
	const availableTokens = Math.max(
		0,
		budget.totalTokens - Math.max(0, budget.reservedTokens),
	);
	const excluded: ExcludedSkill[] = [];
	const selected: SelectedSkill[] = [];
	const requiredIdentities = new Set(
		(options.relations ?? [])
			.filter((node) => node.required)
			.map((node) => node.identity),
	);
	const ordered = orderCandidates(options.candidates, requiredIdentities);

	const seen = new Set<string>();
	let usedTokens = 0;

	for (const candidate of ordered) {
		const identity = identityOf(candidate.ref);
		const key = `${identity}@${candidate.ref.sha256}`;
		const required =
			candidate.required === true || requiredIdentities.has(identity);
		if (seen.has(key)) {
			excluded.push({
				ref: candidate.ref,
				name: candidate.name,
				reason: "the skill is already in the context",
				required,
			});
			continue;
		}
		const tokens = count(candidate.instructions);
		const reason = reasonFor({
			required,
			selected: selected.length,
			cap: budget.selectionCap,
			wouldUse: usedTokens + tokens,
			availableTokens,
		});
		if (reason) {
			excluded.push({
				ref: candidate.ref,
				name: candidate.name,
				reason,
				required,
			});
			continue;
		}
		usedTokens += tokens;
		seen.add(key);
		selected.push({
			ref: candidate.ref,
			name: candidate.name,
			reason: candidate.reason,
			tokens,
			required,
			...(candidate.resourcePaths ? { resourcePaths: candidate.resourcePaths } : {}),
		});
	}

	const state = {
		totalTokens: budget.totalTokens,
		reservedTokens: budget.reservedTokens,
		availableTokens,
		usedTokens,
		remainingTokens: availableTokens - usedTokens,
		count: selected.length,
	};
	const blocked = blockedReason(selected, excluded, options.relations ?? []);
	if (blocked) {
		return {
			selected,
			excluded,
			budget: state,
			verification: "blocked",
			blocked,
		};
	}

	return {
		selected,
		excluded,
		budget: state,
		verification: "verified",
	};
}

/**
 * The order of the candidates.
 *
 * The mandatory dependencies load first, the other candidates follow in the
 * order of the retrieval.
 */
function orderCandidates(
	candidates: ContextCandidate[],
	requiredIdentities: Set<string>,
): ContextCandidate[] {
	return [...candidates].sort((a, b) => {
		const aRequired =
			a.required === true || requiredIdentities.has(identityOf(a.ref));
		const bRequired =
			b.required === true || requiredIdentities.has(identityOf(b.ref));
		if (aRequired === bRequired) return a.rank - b.rank;
		return aRequired ? -1 : 1;
	});
}

/**
 * The reason a candidate does not enter the context.
 *
 * A candidate that fits has no reason: it enters the context whole.
 */
function reasonFor(options: {
	required: boolean;
	selected: number;
	cap: number;
	wouldUse: number;
	availableTokens: number;
}): string | undefined {
	if (options.selected >= options.cap) {
		return options.required
			? "the cap of the selection is reached and the skill is mandatory"
			: `the cap of ${options.cap} skills is reached`;
	}
	if (options.wouldUse > options.availableTokens) {
		return options.required
			? "the skill does not fit the budget of the context and it is mandatory"
			: `the budget of ${options.availableTokens} tokens is reached`;
	}
	return undefined;
}

/**
 * The reason the selection is blocked.
 *
 * A mandatory skill that did not fit and a mandatory dependency that is
 * not among the candidates both block the selection: a task that runs with
 * a missing prerequisite is a task that runs wrong.
 */
function blockedReason(
	selected: SelectedSkill[],
	excluded: ExcludedSkill[],
	relations: RelationNode[],
): string | undefined {
	const missingRequired = excluded.find((skill) => skill.required);
	if (missingRequired) {
		return `the mandatory skill "${missingRequired.name}" did not enter the context: ${missingRequired.reason}`;
	}
	const missingDependency = relations
		.filter((node) => node.required)
		.find(
			(node) =>
				!selected.some((skill) => identityOf(skill.ref) === node.identity) &&
				!excluded.some((skill) => identityOf(skill.ref) === node.identity),
		);
	if (missingDependency) {
		return `the mandatory dependency "${missingDependency.identity}" did not enter the context`;
	}
	return undefined;
}

/**
 * The identity of a reference.
 */
function identityOf(ref: SkillRef): string {
	return `${ref.namespace}/${ref.graph}/${ref.id}`;
}
