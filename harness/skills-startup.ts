/**
 * The startup line of the skill system.
 *
 * The line carries TWO counts: the skills on this machine and the skills in
 * the vector store. They are different things - a machine without local
 * skill files can still reach a shared skill - and a single "N discovered"
 * hides exactly that difference.
 *
 * The vector store has states that must not be flattened into "0": no
 * credentials, an unreachable cluster and an empty collection are three
 * different situations and need three different actions.
 */

/** What the vector store is in this run. */
export type QdrantSkillState =
	/** No credentials for the vector store on this machine. */
	| "not-configured"
	/** The cluster is configured but cannot be reached. */
	| "unavailable"
	/** The cluster is reachable but the collection does not exist yet. */
	| "missing"
	/** The collection exists but holds no skill. */
	| "empty"
	/** The collection holds skills. */
	| "populated";

/** The state of the skill vector store. */
export interface QdrantSkillStats {
	/** What the vector store is in this run. */
	state: QdrantSkillState;
	/** The number of skill vectors in the collection. */
	count: number;
	/** The collection the numbers belong to. */
	collection?: string;
	/** The vector size the collection was created with. */
	dimensions?: number;
	/** The distance the collection was created with. */
	distance?: string;
	/** Why the collection could not be read. Never a credential. */
	error?: string;
	/** The collection does not match the schema of the runtime. */
	schemaMismatch?: string;
}

export interface SkillsStartupReport {
	/** The text of the line. */
	text: string;
	/** The status of the line. */
	status: "wait" | "ok" | "info" | "warn";
	/** The fix instructions below the line. */
	details: string[];
}

/**
 * The state of the service that holds the server-side skills.
 *
 * The vector store is the INDEX. The service holds the authoritative
 * files, so it is the one that can hand out a complete skill.
 */
export interface RemoteSkillStats {
	/** What the service is in this run. */
	state:
		/** No service is configured. */
		| "not-configured"
		/** The service refused the call - the token or the plan. */
		| "denied"
		/** The service could not be reached. */
		| "unavailable"
		/** The service holds no skill for this user. */
		| "empty"
		/** The service holds skills. */
		| "populated";
	/** The number of skills the service holds. */
	count: number;
	/** Why the service could not be reached. Never a credential. */
	error?: string;
}

/**
 * The line before the vector store has answered.
 *
 * The count of the local skills is known immediately; the count of the
 * vector store needs the cluster, so the line waits for it.
 */
export function localSkillsReport(localCount: number): SkillsStartupReport {
	return {
		text: `Local Skills ${localCount} | Qdrant Skills ...`,
		status: "wait",
		details: [],
	};
}

/**
 * The line with the state of the vector store.
 *
 * The number is only shown when it is known: a cluster that cannot be
 * reached has no count, and "0" would be a lie.
 */
export function skillsReport(
	localCount: number,
	stats: QdrantSkillStats,
	remote?: RemoteSkillStats,
): SkillsStartupReport {
	const details: string[] = [];

	if (stats.schemaMismatch) {
		details.push(
			`The vector schema does not match: ${stats.schemaMismatch}.`,
			"A collection with a different vector size cannot be searched with these vectors, so the vector search finds nothing.",
			`The runtime uses the collection ${stats.collection ?? "pi-harness-skills-openai-v1"} - move the shared skills into it.`,
		);
	}
	if (stats.state === "unavailable") {
		details.push(
			stats.error
				? `The vector store could not be reached: ${stats.error}`
				: "The vector store could not be reached.",
		);
	}
	details.push(...remoteDetails(remote));

	return {
		text: `Local Skills ${localCount} | Qdrant Skills ${describeQdrantState(stats)}`,
		status: startupStatus(stats, remote),
		details,
	};
}

/**
 * The lines below the count.
 *
 * The service is reported separately from the vector store: it holds the
 * complete skills, the vector store only the index.
 */
function remoteDetails(remote: RemoteSkillStats | undefined): string[] {
	if (!remote || remote.state === "not-configured") return [];

	if (remote.state === "populated") {
		return [
			`The skill service holds ${remote.count} skill${remote.count === 1 ? "" : "s"} - they can be loaded without a local copy.`,
		];
	}
	if (remote.state === "denied") {
		return [
			remote.error
				? `The skill service refused the call: ${remote.error}`
				: "The skill service refused the call - the token or the plan does not allow it.",
			"Fix: check SKILLS_SAAS_API_KEY and the plan of the account.",
		];
	}
	if (remote.state === "unavailable") {
		return [
			remote.error
				? `The skill service could not be reached: ${remote.error}`
				: "The skill service could not be reached.",
		];
	}
	return [];
}

/**
 * The status of the line.
 *
 * A vector store that is not configured is not a problem - most machines
 * do not have one - so it is an information. An unreachable cluster and an
 * incompatible collection are warnings: something is broken there.
 */
function startupStatus(
	stats: QdrantSkillStats,
	remote?: RemoteSkillStats,
): "ok" | "info" | "warn" {
	if (stats.state === "unavailable" || stats.schemaMismatch) return "warn";
	if (remote && (remote.state === "denied" || remote.state === "unavailable")) {
		return "warn";
	}
	if (stats.state === "not-configured") return "info";
	return "ok";
}

/**
 * The short form of the vector store state.
 *
 * "0" means "the remote set is empty" - whether the collection does not
 * exist yet or holds no skill. The other states say what is wrong.
 */
function describeQdrantState(stats: QdrantSkillStats): string {
	switch (stats.state) {
		case "not-configured":
			return "not configured";
		case "unavailable":
			return "unavailable";
		case "missing":
		case "empty":
			return "0";
		case "populated":
			return String(stats.count);
		default:
			// An unknown state is treated like an unreachable cluster: no
			// count is shown, because a wrong number is worse than none.
			return "unavailable";
	}
}
