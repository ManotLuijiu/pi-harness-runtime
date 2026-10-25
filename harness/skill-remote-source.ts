/**
 * The skill service as a source of server-held skills.
 *
 * The service holds the authoritative skill files. It applies the access
 * rules of the user, so a refusal is an ANSWER of the service and not a
 * failure of the client - the two need different fixes and must stay
 * apart.
 *
 * The vector store is an index: it says WHICH skill fits a question, but
 * its payload carries only a truncated body. The service delivers the
 * complete skill, so a machine without a local copy can still use it.
 */

import { getSkillFromSaaS, syncSkillsFromSaaS } from "./skill-sync.js";
import type {
	RemoteSkill,
	RemoteSkillSource,
} from "../packages/skills/dist/remote-source.js";

/** Why a call to the service failed. */
export type SkillServiceFailure = "denied" | "unavailable";

/** The error a failed call to the service raises. */
export class SkillServiceError extends Error {
	/**
	 * @param message The reason of the failure. Never a credential.
	 * @param code Whether the service refused the call or could not be
	 *   reached. The two need different fixes.
	 */
	constructor(
		message: string,
		readonly code: SkillServiceFailure,
	) {
		super(message);
		this.name = "SkillServiceError";
	}
}

/** The parts of the sync result the source needs. */
interface SyncOutcome {
	source: "saas" | "cache" | "none";
	skills?: Array<{
		id: string;
		name: string;
		description: string;
		version?: string;
		updatedAt?: string;
	}>;
	error?: string;
	failure?: SkillServiceFailure;
}

/** The parts of the sync module the source needs. */
export interface SkillServiceGateway {
	syncSkillsFromSaaS(options?: {
		forceRefresh?: boolean;
	}): Promise<SyncOutcome>;
	getSkillFromSaaS(identifier: {
		id?: string;
		slug?: string;
	}): Promise<{
		id: string;
		name: string;
		description: string;
		version?: string;
		updatedAt?: string;
		prompt?: string;
	} | null>;
}

/**
 * The service as a source of remote skills.
 *
 * The gateway is injected, so the source can be tested without a service
 * and without a network.
 */
export class SkillServiceSource implements RemoteSkillSource {
	/** @param gateway The sync module. The real one by default. */
	constructor(
		private readonly gateway: SkillServiceGateway = {
			syncSkillsFromSaaS,
			getSkillFromSaaS,
		},
	) {}

	/**
	 * The skills the service holds.
	 *
	 * A service that refuses the call raises a `SkillServiceError` with
	 * the code "denied" - the caller can tell that apart from a service
	 * that could not be reached.
	 */
	async list(options?: {
		search?: string;
		limit?: number;
	}): Promise<RemoteSkill[]> {
		const outcome = await this.gateway.syncSkillsFromSaaS();

		if (outcome.source === "none") {
			throw new SkillServiceError(
				outcome.error ?? "the skill service could not be reached",
				outcome.failure ?? "unavailable",
			);
		}

		const skills = outcome.skills ?? [];
		const searched = options?.search
			? skills.filter((skill) => matches(skill, options.search as string))
			: skills;
		const limited = options?.limit ? searched.slice(0, options.limit) : searched;

		return limited.map((skill) => ({
			id: skill.id,
			name: skill.name,
			description: skill.description,
			version: skill.version,
			updatedAt: skill.updatedAt,
		}));
	}

	/**
	 * The complete content of one skill.
	 *
	 * The service returns the whole skill, so the content is complete -
	 * unlike the truncated body of a vector store payload.
	 */
	async get(id: string): Promise<RemoteSkill | null> {
		const skill = await this.gateway.getSkillFromSaaS({ id });
		if (!skill) return null;
		return {
			id: skill.id,
			name: skill.name,
			description: skill.description,
			version: skill.version,
			updatedAt: skill.updatedAt,
			content: skill.prompt,
			contentComplete: true,
		};
	}
}

/**
 * Whether a skill matches a search term.
 *
 * The service does the real search; this filter only narrows what the
 * service already returned.
 */
function matches(
	skill: { name: string; description: string },
	term: string,
): boolean {
	const needle = term.toLowerCase();
	return (
		skill.name.toLowerCase().includes(needle) ||
		skill.description.toLowerCase().includes(needle)
	);
}
