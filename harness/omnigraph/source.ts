/**
 * The OmniGraph graph as a source of server-held skills.
 *
 * The graph holds the catalog of the skills and the instructions of every
 * skill. The client reads two stored queries: the catalog and the lookup
 * of one skill.
 *
 * The rules of this module:
 *
 * - the catalog is discovery metadata. A description is never an
 *   instruction, and it is never handed to a model as one,
 * - the instructions of a skill are only complete when their hash
 *   matches the hash of the publication. A body that does not match is
 *   refused, and the skill stays unavailable,
 * - a record of a publication that is not approved is refused as well.
 */

import { createHash } from "node:crypto";

import type {
	RemoteSkill,
	RemoteSkillSource,
} from "../../packages/skills/dist/remote-source.js";

import {
	OMNIGRAPH_CATALOG_QUERY,
	OMNIGRAPH_LOOKUP_QUERY,
	type OmnigraphConfig,
} from "./config.ts";
import {
	columnText,
	columnValue,
	OmnigraphError,
	omnigraphQuery,
	type OmnigraphRow,
} from "./transport.ts";

/** One entry of the catalog. */
export interface OmnigraphCatalogEntry {
	/** The id the graph knows the skill by. */
	id: string;
	/** The name of the skill. */
	name: string;
	/** The description of the skill (discovery metadata). */
	description: string;
	/** The revision of the publication the skill belongs to. */
	revision: string;
	/** The hash of the instructions of the skill. */
	sha256: string;
}

/** One skill of the graph, with the instructions and its resources. */
export interface OmnigraphSkillRecord extends OmnigraphCatalogEntry {
	/** The instructions of the skill (the body of SKILL.md). */
	instructions: string;
	/** The repository the skill came from. */
	repository: string;
	/** The path of the skill in that repository. */
	path: string;
	/** The manifest of the supporting files, as the graph holds it. */
	resourcesJson: string;
}

/** The options of the source. */
export interface OmnigraphSourceOptions {
	/** The configuration of the client. */
	config: OmnigraphConfig;
	/** The revision that is approved. A record of another revision is refused. */
	approvedRevision?: string;
	/** The function that performs the request. A test injects one. */
	fetchImpl?: typeof fetch;
}

/**
 * The hash of the instructions.
 *
 * The hash is over the exact bytes of the UTF-8 text, so the same text
 * always has the same hash.
 */
export function omnigraphInstructionsHash(instructions: string): string {
	return createHash("sha256").update(instructions, "utf8").digest("hex");
}

/** The graph as a source of the skills of the machine. */
export class OmnigraphSkillSource implements RemoteSkillSource {
	/** The configuration of the client. */
	private readonly config: OmnigraphConfig;
	/** The revision that is approved. */
	private readonly approvedRevision?: string;
	/** The function that performs the request. */
	private readonly fetchImpl?: typeof fetch;

	constructor(options: OmnigraphSourceOptions) {
		this.config = options.config;
		this.approvedRevision = options.approvedRevision;
		this.fetchImpl = options.fetchImpl;
	}

	/**
	 * The catalog of the graph.
	 *
	 * The catalog carries no instructions. It is the list of the skills
	 * that the graph holds, with the revision and the hash of every one.
	 */
	async catalog(): Promise<OmnigraphCatalogEntry[]> {
		const result = await this.query(OMNIGRAPH_CATALOG_QUERY);
		const entries: OmnigraphCatalogEntry[] = [];
		for (const row of result.rows) {
			const entry = catalogEntryOf(row, result.columns);
			if (!entry) continue;
			entries.push(entry);
		}
		return entries;
	}

	/**
	 * The catalog as the skills of the machine.
	 *
	 * The content is empty on purpose: the catalog does not carry the
	 * instructions, and a skill without instructions is a skill that is
	 * found, not a skill that is used.
	 */
	async list(options?: {
		search?: string;
		limit?: number;
	}): Promise<RemoteSkill[]> {
		const entries = await this.catalog();
		const search = options?.search?.trim().toLowerCase();
		const matched = search
			? entries.filter(
					(entry) =>
						entry.name.toLowerCase().includes(search) ||
						entry.description.toLowerCase().includes(search) ||
						entry.id.toLowerCase().includes(search),
				)
			: entries;
		const limited =
			options?.limit && options.limit > 0
				? matched.slice(0, options.limit)
				: matched;
		return limited.map((entry) => ({
			id: entry.id,
			name: entry.name,
			description: entry.description,
			version: entry.revision,
			content: "",
			contentComplete: false,
		}));
	}

	/**
	 * The complete skill of one id.
	 *
	 * The body is only complete when its hash matches the hash of the
	 * publication. A body that does not match is refused: a client that
	 * hands a changed body to a model teaches it something the graph did
	 * not publish.
	 */
	async get(id: string): Promise<RemoteSkill | null> {
		const record = await this.record(id);
		if (!record) return null;
		return {
			id: record.id,
			name: record.name,
			description: record.description,
			version: record.revision,
			updatedAt: undefined,
			content: record.instructions,
			contentComplete: true,
		};
	}

	/**
	 * The full record of one skill, with the instructions and the
	 * manifest of the supporting files.
	 */
	async record(id: string): Promise<OmnigraphSkillRecord | null> {
		const trimmed = id?.trim();
		if (!trimmed) return null;
		const result = await this.query(OMNIGRAPH_LOOKUP_QUERY, { id: trimmed });
		const row = result.rows[0];
		if (!row) return null;
		const record = skillRecordOf(row, result.columns);
		if (!record) {
			throw new OmnigraphError(
				`the graph answered a record of "${trimmed}" without the fields of a skill`,
				"invalid",
			);
		}
		this.checkApproved(record);
		this.checkHash(record);
		return record;
	}

	/** The record of a publication that is not approved is refused. */
	private checkApproved(record: OmnigraphSkillRecord): void {
		if (!this.approvedRevision) return;
		if (record.revision === this.approvedRevision) return;
		throw new OmnigraphError(
			`the skill "${record.id}" belongs to the revision "${record.revision}", and the approved revision is "${this.approvedRevision}"`,
			"invalid",
		);
	}

	/** Instructions whose hash does not match are refused. */
	private checkHash(record: OmnigraphSkillRecord): void {
		if (!record.sha256) return;
		const computed = omnigraphInstructionsHash(record.instructions);
		if (computed === record.sha256.toLowerCase()) return;
		throw new OmnigraphError(
			`the instructions of the skill "${record.id}" do not match the hash of the publication`,
			"invalid",
		);
	}

	/** One stored query of the graph. */
	private query(
		query: string,
		params?: Record<string, unknown>,
	): Promise<{ columns: string[]; rows: OmnigraphRow[]; rowCount: number }> {
		return omnigraphQuery({
			url: this.config.url,
			graph: this.config.graph,
			query,
			params,
			token: this.config.token,
			apiVersion: this.config.apiVersion,
			timeoutMs: this.config.timeoutMs,
			fetchImpl: this.fetchImpl,
		});
	}
}

/**
 * The catalog entry of a row.
 *
 * A row without an id or a name is not a skill, and it is skipped: a
 * catalog with a broken row must not stop the other skills from being
 * found.
 */
export function catalogEntryOf(
	row: OmnigraphRow,
	columns: string[],
): OmnigraphCatalogEntry | null {
	const id = columnText(row, columns, "id").trim();
	const name = columnText(row, columns, "name").trim();
	if (!id || !name) return null;
	return {
		id,
		name,
		description: columnText(row, columns, "description"),
		revision: columnText(row, columns, "revision"),
		sha256: columnText(row, columns, "sha256").trim().toLowerCase(),
	};
}

/**
 * The full record of a row.
 *
 * The record needs the instructions: a lookup without them is a broken
 * answer, and it is refused instead of being read as a skill without a
 * body.
 */
export function skillRecordOf(
	row: OmnigraphRow,
	columns: string[],
): OmnigraphSkillRecord | null {
	const entry = catalogEntryOf(row, columns);
	if (!entry) return null;
	const instructions = columnValue(row, columns, "instructions");
	if (typeof instructions !== "string") return null;
	return {
		...entry,
		instructions,
		repository: columnText(row, columns, "repository"),
		path: columnText(row, columns, "path"),
		resourcesJson: columnText(row, columns, "resources_json"),
	};
}
