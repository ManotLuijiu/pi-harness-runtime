/**
 * The rollout of the hybrid retrieval.
 *
 * The integration starts behind an opt-in flag. The stages are:
 *
 * - "off": the retrieval runs on the catalog of the graph alone. This is
 *   the default, because a machine that does not ask for the integration
 *   must not change its behaviour,
 * - "shadow": the vector index is asked, its candidates are compared with
 *   the lexical ones, and only the lexical ones are returned. The
 *   comparison is the evidence of the pilot; nothing enters the context,
 * - "pilot": the hybrid retrieval returns the fused candidates,
 * - "enabled": the hybrid retrieval runs and its candidates may enter the
 *   budgeted context.
 *
 * The rollback is the stage "off": the hybrid retrieval is disabled and
 * the graph publications are untouched. A rollback never rewrites the
 * graph, and it never removes the index.
 */

/** The stage of the rollout. */
export type RolloutStage = "off" | "shadow" | "pilot" | "enabled";

/** The decision of the rollout. */
export interface RolloutDecision {
	/** The stage the flag names. */
	stage: RolloutStage;
	/** The vector index is asked for its candidates. */
	useVector: boolean;
	/** The candidates of the vector index do not enter the result. */
	shadow: boolean;
	/** The reason of the decision. */
	reason: string;
}

/** The name of the variable that names the stage. */
export const ROLLOUT_FLAG = "PI_SKILL_HYBRID_STAGE";

/** The stages the flag accepts. */
export const ROLLOUT_STAGES: RolloutStage[] = ["off", "shadow", "pilot", "enabled"];

/**
 * The decision of the flag.
 *
 * An unknown value is "off": a flag that cannot be read never opens the
 * integration.
 */
export function decideRollout(options?: {
	/** The value of the flag. */
	value?: string | undefined;
}): RolloutDecision {
	const raw = (options?.value ?? "").trim().toLowerCase();
	if (!raw) {
		return {
			stage: "off",
			useVector: false,
			shadow: false,
			reason: "the hybrid retrieval is off by default",
		};
	}
	if (!ROLLOUT_STAGES.includes(raw as RolloutStage)) {
		return {
			stage: "off",
			useVector: false,
			shadow: false,
			reason: `the flag names an unknown stage ("${raw}"), so the hybrid retrieval stays off`,
		};
	}
	if (raw === "off") {
		return {
			stage: "off",
			useVector: false,
			shadow: false,
			reason: "the hybrid retrieval is disabled",
		};
	}
	if (raw === "shadow") {
		return {
			stage: "shadow",
			useVector: true,
			shadow: true,
			reason: "the index is compared with the lexical search, and only the lexical candidates are returned",
		};
	}
	if (raw === "pilot") {
		return {
			stage: "pilot",
			useVector: true,
			shadow: false,
			reason: "the hybrid retrieval returns the fused candidates of the pilot",
		};
	}
	return {
		stage: "enabled",
		useVector: true,
		shadow: false,
		reason: "the hybrid retrieval is enabled",
	};
}

/**
 * The comparison of the shadow evaluation.
 *
 * The comparison is the evidence of the pilot: how many candidates the
 * lexical search found, how many the index added, and how many the fusion
 * kept.
 */
export interface ShadowComparison {
	/** The candidates of the lexical search. */
	lexicalOnly: number;
	/** The candidates of the index. */
	indexOnly: number;
	/** The candidates of the fusion. */
	fused: number;
	/** The candidates the index added to the lexical ones. */
	added: number;
}

/**
 * The comparison of the shadow evaluation.
 */
export function compareShadow(options: {
	/** The candidates of the lexical search. */
	lexical: string[];
	/** The candidates of the index. */
	index: string[];
	/** The candidates of the fusion. */
	fused: string[];
}): ShadowComparison {
	const lexical = new Set(options.lexical);
	const index = new Set(options.index);
	const fused = new Set(options.fused);
	const indexOnly = [...index].filter((id) => !lexical.has(id)).length;
	return {
		lexicalOnly: lexical.size,
		indexOnly,
		fused: fused.size,
		added: [...fused].filter((id) => !lexical.has(id)).length,
	};
}
