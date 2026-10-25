/**
 * The server-held skills.
 *
 * The vector store holds an INDEX: the name, the description and a
 * truncated body. That is enough to FIND a skill, but not to use it - a
 * complete SKILL.md (with its references and examples) is larger than a
 * vector store payload should be.
 *
 * The remote source is therefore the authoritative store of the complete
 * skill content. It is reached through an authenticated service, so the
 * SERVER decides which skills this user may see. A client never decides
 * that on its own.
 */

import type { Skill } from "./types.js";

/** A skill the server holds. */
export interface RemoteSkill {
	/** The id the server knows the skill by. */
	id: string;
	/** The name of the skill. */
	name: string;
	/** What the skill does. */
	description: string;
	/** The version of the content. */
	version?: string;
	/** When the content changed the last time. */
	updatedAt?: string;
	/** The content of the skill (the body of SKILL.md). */
	content?: string;
	/**
	 * Whether the content is the COMPLETE skill.
	 *
	 * A vector store payload carries a truncated body - that is not a
	 * complete skill. The service returns the whole thing, so it sets
	 * this flag.
	 */
	contentComplete?: boolean;
}

/** Where the server-held skills come from. */
export interface RemoteSkillSource {
	/**
	 * The skills the server holds for this user and workspace.
	 *
	 * @param options The search term and the number of skills to return.
	 */
	list(options?: { search?: string; limit?: number }): Promise<RemoteSkill[]>;
	/** The complete content of one skill. */
	get(id: string): Promise<RemoteSkill | null>;
}

/** The reasons a call to the remote source can fail. */
export type RemoteSkillFailure =
	/** The service refused the call - the token is missing or wrong. */
	| "denied"
	/** The service could not be reached. */
	| "unavailable";

/** The state of the server-held skills. */
export type RemoteSkillState =
	/** No service is configured. */
	| "not-configured"
	/** The service refused the call. */
	| "denied"
	/** The service could not be reached. */
	| "unavailable"
	/** The service holds no skill for this user. */
	| "empty"
	/** The service holds skills. */
	| "populated";

/** What the remote source knows. */
export interface RemoteSkillStats {
	/** The state of the source. */
	state: RemoteSkillState;
	/** The number of skills the source holds. */
	count: number;
	/** The reason of a failed call. */
	error?: string;
}

/**
 * A skill from a remote record.
 *
 * The record carries the content, so the skill is usable without a local
 * copy. The path stays empty: a server skill has no directory on this
 * machine.
 */
export function skillFromRemote(record: RemoteSkill): Skill {
	const version = record.version;
	return {
		id: record.id,
		path: "",
		frontmatter: {
			name: record.name,
			description: record.description,
			...(version ? { version } : {}),
		},
		body: record.content ?? "",
		references: [],
		examples: [],
		metadata: {
			name: record.name,
			description: record.description,
			...(version ? { version } : {}),
			...(record.updatedAt ? { updated_at: record.updatedAt } : {}),
		},
		loaded: true,
	};
}

/**
 * The version of a cached remote skill.
 *
 * A skill without a version cannot be compared - the cache keeps it.
 */
export function remoteVersion(skill: Skill | undefined): string | undefined {
	return skill?.frontmatter.version ?? skill?.metadata.version;
}

/**
 * The safe reason of a failed call.
 *
 * The message never carries a credential: a token that a service echoed
 * back is removed before the message leaves the process.
 */
export function describeRemoteFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const safe = raw
    .replace(/bearer\s+\S+/gi, "bearer <redacted>")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "<redacted>")
    .replace(/\s+/g, " ")
    .trim();
  return safe.slice(0, 200) || "the service could not be reached";
}

/**
 * Whether the cached skill is older than the record.
 *
 * A record without a version never replaces a cached skill: an unknown
 * version is not evidence of a change.
 */
export function isStale(cached: Skill | undefined, record: RemoteSkill): boolean {
	if (!cached) return true;
	if (!record.version) return false;
	return remoteVersion(cached) !== record.version;
}
