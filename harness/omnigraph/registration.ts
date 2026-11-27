/**
 * The OmniGraph skills in pi.
 *
 * The integration has three parts:
 *
 * - the discovery: pi asks the extensions for their resources after the
 *   session started, and this extension answers with the directory of
 *   the stubs. The stubs are tiny SKILL.md files, so pi finds the skills
 *   of the graph with its own `/skill:<name>`,
 * - the tools: `remote_skill_search` finds a skill, `remote_skill_load`
 *   reads the real instructions of one skill, and `remote_skill_resource`
 *   fetches one supporting file of a skill,
 * - the command: `/remote-skills` shows the state of the source, searches
 *   the catalog, refreshes it and clears the cache.
 *
 * The startup must not wait for the network, and the discovery must not
 * race the catalog: the stubs of the last verified catalog are written
 * right away, and the discovery waits for the first read with a bound.
 *
 * The states of the source stay apart. A graph that refuses the
 * credential is not a graph that cannot be reached, and a refused graph
 * never falls back to the catalog of another read.
 */

import { Type } from "typebox";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import {
	clearCache,
	clearCatalog,
	clearStubs,
	isPublicationHash,
	makeRoomInCache,
	readCachedSkill,
	readCatalog,
	sha256Of,
	skillVersionDir,
	stubRoot,
	writeCachedResource,
	writeCachedSkill,
	writeCatalog,
	writeStubs,
	type CachedCatalogEntry,
} from "./cache.ts";
import {
	indexFreshness,
	readIndexManifest,
} from "../skill-index-sync.ts";
import {
	compareShadow,
	decideRollout,
	ROLLOUT_FLAG,
	type RolloutDecision,
} from "../skill-rollout.ts";
import {
	planRelations,
	type RelationReader,
} from "../skill-relations.ts";
import type { OmnigraphConfig } from "./config.ts";
import {
	parseResourceManifest,
	type OmnigraphResourceFetcher,
} from "./resources.ts";
import {
	OmnigraphSkillSource,
	type OmnigraphCatalogEntry,
	type OmnigraphPublicationExpectation,
	type OmnigraphSkillRecord,
} from "./source.ts";
import {
	searchSkills,
	skillRefOf,
	verifyCandidate,
	type CatalogEntry,
	type Candidate,
	type RetrievalOutcome,
	type VectorHit,
} from "../skill-retrieval.ts";
import { cacheNamespace } from "./config.ts";
import { OmnigraphError } from "./transport.ts";

/**
 * The state of the catalog of the source.
 *
 * - `unknown`: the catalog was not read yet,
 * - `ok`: the catalog was read and verified,
 * - `empty`: the graph holds no skill,
 * - `denied`: the graph refused the credential,
 * - `unavailable`: the graph could not be reached.
 */
export type OmnigraphCatalogState =
	| "unknown"
	| "ok"
	| "empty"
	| "denied"
	| "unavailable";

/** The report of the state of the catalog. */
export interface OmnigraphCatalogReport {
	/** The state of the source. */
	state: OmnigraphCatalogState;
	/** The number of the skills of the last verified catalog. */
	count: number;
	/** The reason of the failure, if there was one. */
	error?: string;
}

/** The options of the registration. */
export interface OmnigraphRegistrationOptions {
	/** The configuration of the client. */
	config: OmnigraphConfig;
	/** The source of the skills of the graph. */
	source: OmnigraphSkillSource;
	/** The revision that is approved. */
	approvedRevision?: string;
	/** The mechanism that reads the supporting files. */
	fetcher?: OmnigraphResourceFetcher;
	/** The function that writes a line of the report of the command. */
	log?: (message: string) => void;
	/**
	 * The stage of the rollout of the hybrid retrieval.
	 *
	 * The stage is "off" by default: the machine that does not ask for
	 * the integration keeps the behaviour it had. The stage "shadow"
	 * compares the index with the lexical search without returning its
	 * candidates, "pilot" returns the fused candidates, and "enabled"
	 * lets them enter the budgeted context.
	 */
	rolloutStage?: string;
	/**
	 * The reader of the relations of the graph.
	 *
	 * The reader expands the mandatory prerequisites of the candidates.
	 * The expansion is bounded and every dependency is verified against
	 * the catalog of the graph before it is returned.
	 */
	relationReader?: RelationReader;
	/**
	 * The report of the state of the catalog.
	 *
	 * The report is written once the catalog was read, or once the read
	 * failed. A machine that is offline reports the failure and keeps the
	 * catalog of the last verified read of the same authority.
	 */
	onCatalog?: (report: OmnigraphCatalogReport) => void;
	/**
	 * The search of the vector index.
	 *
	 * The index is a rebuildable search index: it may find a skill, but
	 * it never decides what a skill says. Every hit is verified against
	 * the catalog of the graph before it is returned. Without a provider
	 * the search runs on the catalog of the graph alone, and the status
	 * says so.
	 */
	vectorSearch?: (query: string, limit: number) => Promise<VectorHit[]>;
}

/**
 * The handle of the registration.
 *
 * The caller keeps it to learn when the first read of the catalog is
 * done, and what the state of the source is.
 */
export interface OmnigraphRegistration {
	/** The first read of the catalog of the graph. */
	ready: Promise<OmnigraphCatalogReport>;
	/** The state of the catalog, as it is known now. */
	report: () => OmnigraphCatalogReport;
}

/** The details of the tool that loads a skill. */
interface LoadDetails {
	/** The id of the skill. */
	id: string;
	/** The revision of the publication. */
	revision: string;
	/** The directory of the skill on this machine. */
	directory: string;
	/** Whether the body came from the local cache. */
	offline: boolean;
}

/** The details of the tool that fetches a file of a skill. */
interface ResourceDetails {
	/** The path of the file on this machine. */
	path: string;
}

/**
 * The context of the tools.
 *
 * The tools share the state of the source: the catalog, the last known
 * report and the configuration of the client.
 */
interface OmnigraphContext {
	/** The configuration of the client. */
	config: OmnigraphConfig;
	/** The source of the skills of the graph. */
	source: OmnigraphSkillSource;
	/** The revision of the publication that is approved. */
	approvedRevision?: string;
	/** The mechanism that reads the supporting files. */
	fetcher?: OmnigraphResourceFetcher;
	/** The function that writes a line of the report. */
	log: (message: string) => void;
	/** The catalog of the graph. */
	catalog: () => Promise<OmnigraphCatalogReport>;
	/** The state of the catalog, as it is known now. */
	report: () => OmnigraphCatalogReport;
	/** Read the catalog again. */
	refresh: () => void;
	/** Empty the cache and forget the state of the source. */
	reset: () => void;
	/** The search of the vector index, when one is connected. */
	vectorSearch?: (query: string, limit: number) => Promise<VectorHit[]>;
	/** The reason the last search ran with less than the full method. */
	lastDegraded?: string;
	/** The stage of the rollout of the hybrid retrieval. */
	rollout?: RolloutDecision;
	/** The reader of the relations of the graph. */
	relationReader?: RelationReader;
}

/**
 * Register the tools, the command and the discovery of the source.
 *
 * The registration is synchronous: pi must be able to start even when the
 * graph cannot be reached, and the discovery of the skills must not wait
 * for another service.
 */
export function registerOmnigraphSkills(
	pi: ExtensionAPI,
	options: OmnigraphRegistrationOptions,
): OmnigraphRegistration {
	const { config, source } = options;
	const log = options.log ?? (() => {});
	// The approval of the operator. It bounds the catalog that is
	// advertised and the bodies that are reused, not only the records
	// that are read.
	const approvedRevision = options.approvedRevision?.trim() || undefined;

	/** The state of the catalog. */
	let report: OmnigraphCatalogReport = { state: "unknown", count: 0 };
	/** The read of the catalog. There is one read, not one per caller. */
	let catalogPromise: Promise<OmnigraphCatalogReport> | undefined;

	/**
	 * Write the stubs of the last verified catalog.
	 *
	 * The write happens before the network is touched, so a machine that
	 * starts while the graph is down still finds the skills it knows.
	 */
	const hydrateStubs = (): CachedCatalogEntry[] => {
		const cached = approvedEntries(
			readCatalog(config.cacheDir),
			approvedRevision,
		);
		if (!readCatalog(config.cacheDir).length) return cached;
		try {
			// The stubs that the approval does not allow are removed
			// as well: the tree of the discovery holds the approved
			// skills only.
			writeStubs(
				config.cacheDir,
				cached,
				config.maxAdvertisedSkills,
				config.cacheBudgetBytes,
			);
		} catch (error) {
			log(
				`[pi-harness] The stubs of the graph could not be written: ${messageOf(error)}`,
			);
		}
		return cached;
	};

	/**
	 * Read the catalog of the graph.
	 *
	 * A refusal is not an outage: a graph that denies the credential
	 * never falls back to a catalog, because that catalog would be the
	 * answer of another authority. An outage may fall back to the
	 * catalog of the last verified read - the cache of the source, in
	 * the namespace of the source.
	 */
	const readCatalogState = async (): Promise<OmnigraphCatalogReport> => {
		try {
			const entries = await source.catalog();
			const cached: CachedCatalogEntry[] = approvedEntries(
				entries.map((entry) => ({
					id: entry.id,
					name: entry.name,
					description: entry.description,
					revision: entry.revision,
					sha256: entry.sha256,
				})),
				approvedRevision,
			);
			try {
				writeCatalog(config.cacheDir, cached, config.cacheBudgetBytes);
				writeStubs(
					config.cacheDir,
					cached,
					config.maxAdvertisedSkills,
					config.cacheBudgetBytes,
				);
			} catch (writeError) {
				// The budget of the cache is not an outage of the graph:
				// the catalog was read, and it is simply too large for
				// the cache of this machine.
				log(
					`[pi-harness] The catalog of the graph does not fit the cache: ${messageOf(writeError)}`,
				);
			}
			report = {
				state: cached.length ? "ok" : "empty",
				count: cached.length,
			};
		} catch (error) {
			const reason = messageOf(error);
			const denied = error instanceof OmnigraphError && error.code === "denied";
			if (denied) {
				// The credential was refused: the names and the
				// descriptions of the skills of the graph are not
				// advertised any more, and they are not kept.
				clearStubs(config.cacheDir);
				clearCatalog(config.cacheDir);
				report = { state: "denied", count: 0, error: reason };
				log(`[pi-harness] The graph refused the read: ${reason}`);
			} else {
				const cached = hydrateStubs();
				report = {
					state: "unavailable",
					count: cached.length,
					error: reason,
				};
				log(
					`[pi-harness] The catalog of the graph could not be read: ${reason}`,
				);
			}
		}
		options.onCatalog?.(report);
		return report;
	};

	/** The catalog of the graph, read once. */
	const catalog = (): Promise<OmnigraphCatalogReport> => {
		if (!catalogPromise) catalogPromise = readCatalogState();
		return catalogPromise;
	};

	// The stubs of the last verified catalog are written right away: the
	// discovery of pi must find a tree, even when the graph is down.
	hydrateStubs();
	// The first read of the catalog starts right away: the row of the
	// graph says "ready" without waiting for a tool to be called. The
	// read is in the background, so it never blocks the start.
	const firstRead = catalog();

	const context: OmnigraphContext = {
		config,
		source,
		log,
		catalog: () => catalog(),
		report: () => report,
		refresh: () => {
			catalogPromise = undefined;
		},
		reset: () => {
			clearCache(config.cacheDir);
			report = { state: "unknown", count: 0 };
		},
	};
	if (options.fetcher) context.fetcher = options.fetcher;
	if (approvedRevision) context.approvedRevision = approvedRevision;
	if (options.vectorSearch) context.vectorSearch = options.vectorSearch;
	context.rollout = rolloutOf(options);
	applyRelationReader(context, options);

	pi.on("resources_discover", discoveryHandler(context));
	pi.registerTool(searchTool(context));
	pi.registerTool(loadTool(context));
	pi.registerTool(resourceTool(context));
	pi.registerCommand("remote-skills", remoteSkillsCommand(context));

	return { ready: firstRead, report: () => report };
}

/**
 * The discovery of the skills of the graph.
 *
 * The stubs of the last verified catalog are written before the network
 * is touched, so the tree exists even when the graph is down. The first
 * read of the catalog is awaited with a bound: pi discovers the skills
 * of the graph without a second reload, and the startup does not wait
 * longer than the timeout of the catalog.
 *
 * A source that refuses the credential advertises nothing. The stubs of
 * the last verified read hold the names and the descriptions of the
 * skills of the graph, and a credential that was refused may not hand
 * them to the discovery of the machine.
 */
function discoveryHandler(context: OmnigraphContext) {
	return async () => {
		await Promise.race([
			context.catalog(),
			new Promise((resolve) => {
				const timer = setTimeout(
					resolve,
					context.config.catalogTimeoutMs,
				);
				timer.unref?.();
			}),
		]);
		if (context.report().state === "denied") {
			// The refusal is not an outage: the tree of the stubs is
			// empty, and it is not advertised.
			return { skillPaths: [] };
		}
		// The stubs are the only thing that is advertised. The hydrated
		// skills live in another tree, so pi never discovers two skills
		// with the same name.
		return { skillPaths: [stubRoot(context.config.cacheDir)] };
	};
}

/**
 * The command of the source.
 */
function remoteSkillsCommand(context: OmnigraphContext) {
	return {
		description:
			"The skills of the shared graph: status, search, refresh, clear-cache",
		handler: async (
			args: string,
			ctx: ExtensionCommandContext,
		): Promise<void> => {
			const [command = "status", ...rest] = args.trim().split(/\s+/);
			const notify = (message: string) => {
				if (ctx?.ui?.notify) ctx.ui.notify(message, "info");
				else context.log(`[pi-harness] ${message}`);
			};
			if (command === "status") {
				const state = await context.catalog();
				notify(
					`The graph "${context.config.graph}" holds ${state.count} skill(s); the state of the source is ${describeState(state, context.config)}. ${describeRetrieval(context)}. ${describeIndex(context, state.count)}${describeDegraded(context)}`,
				);
				return;
			}
			if (command === "search") {
				const state = await context.catalog();
				if (state.state === "denied") {
					notify(
						`The graph refused the read (${state.error ?? "the credential was refused"}); no skill is listed.`,
					);
					return;
				}
				const outcome = await retrieveSkills(context, rest.join(" "), 20);
				notify(
					outcome.candidates.length
						? outcome.candidates
								.map((candidate) => `${candidate.name} (${candidate.ref.id})`)
								.join(", ")
						: "The catalog holds no skill that fits.",
				);
				return;
			}
			if (command === "refresh") {
				context.refresh();
				const state = await context.catalog();
				notify(
					`The catalog holds ${state.count} skill(s) (${describeState(state, context.config)}).`,
				);
				return;
			}
			if (command === "clear-cache") {
				context.reset();
				notify("The cache of the graph is empty.");
				return;
			}
			notify(
				"Unknown command. Use: status, search <text>, refresh, clear-cache.",
			);
		},
	};
}

/**
 * The tool that finds a skill in the catalog of the graph.
 */
function searchTool(context: OmnigraphContext) {
	return {
		name: "remote_skill_search",
		label: "Remote Skill Search",
		description:
			"Search the catalog of the shared skill graph. Returns the ids, the names, the descriptions and the revisions of the skills that fit. The descriptions are discovery metadata: read the instructions of a skill with remote_skill_load before you use it.",
		parameters: Type.Object({
			query: Type.Optional(
				Type.String({ description: "The text to search for" }),
			),
			limit: Type.Optional(
				Type.Number({ description: "How many skills to return (default 20)" }),
			),
		}),
		async execute(
			_toolCallId: string,
			params: { query?: string; limit?: number },
		): Promise<{
			content: Array<{ type: "text"; text: string }>;
			details: RemoteSearchDetails;
		}> {
			try {
				const state = await context.catalog();
				if (state.state === "denied") {
					return {
						content: [
							{
								type: "text" as const,
								text: `The graph refused the read (${state.error ?? "the credential was refused"}). No skill of the graph is available, and the catalog of another read is not used in its place.`,
							},
						],
						details: { mode: "denied", candidates: [], excluded: 0 },
					};
				}
				const limit = params.limit && params.limit > 0 ? params.limit : 20;
				const outcome = await retrieveSkills(
					context,
					params.query ?? "",
					limit,
				);
				const lines = outcome.candidates.map(
					(candidate) =>
						`- ${candidate.name} (${candidate.ref.id}) — ${candidate.description || "no description"} [revision ${candidate.ref.revision || "unknown"}]`,
				);
				const notices = noticesOf(state, outcome);
				const notice = notices.length > 0 ? `${notices.join("\n")}\n` : "";
				const text = outcome.candidates.length
					? `${notice}${outcome.candidates.length} skill(s) found:\n${lines.join("\n")}`
					: `${notice}The catalog holds no skill that fits.`;
				return {
					content: [{ type: "text" as const, text }],
					details: {
						mode: outcome.mode,
						candidates: outcome.candidates.map((candidate) => ({
							id: candidate.ref.id,
							revision: candidate.ref.revision,
							methods: candidate.methods,
						})),
						excluded: outcome.excluded.length,
						reasons: outcome.reasons,
						...(outcome.relations ? { relations: outcome.relations } : {}),
					},
				};
			} catch (error) {
				return {
					content: [{ type: "text" as const, text: messageOf(error) }],
					details: { mode: "failed", candidates: [], excluded: 0 },
				};
			}
		},
	};
}

/**
 * The notices of an answer.
 *
 * The notices name what the answer did NOT use: the graph that could not
 * be reached, the index that was not read and the comparison of the
 * shadow. The operator sees the limits of the answer.
 */
function noticesOf(
	state: OmnigraphCatalogReport,
	outcome: RetrievalOutcome,
): string[] {
	const notices: string[] = [];
	if (state.state === "unavailable") {
		notices.push(
			`The graph could not be reached (${state.error ?? "unknown reason"}); the catalog of the last verified read is used.`,
		);
	}
	if (outcome.reasons.degraded) {
		notices.push(
			`The vector index was not used (${outcome.reasons.degraded}); the catalog of the graph answered.`,
		);
	}
	if (outcome.reasons.shadow) {
		notices.push(
			`The index was compared with the catalog of the graph (${outcome.reasons.shadow}); its candidates did not enter the answer.`,
		);
	}
	return notices;
}

/**
 * The tool that reads the instructions of a skill.
 */
function loadTool(context: OmnigraphContext) {
	return {
		name: "remote_skill_load",
		label: "Remote Skill Load",
		description:
			"Load the complete instructions of one skill of the shared graph. The body is checked against the hash of the publication before it is returned. The response names the local directory of the skill, where its supporting files are materialized.",
		parameters: Type.Object({
			id: Type.String({ description: "The id of the skill in the graph" }),
			revision: Type.Optional(
				Type.String({ description: "The revision that is expected" }),
			),
		}),
		async execute(
			_toolCallId: string,
			params: { id?: string; revision?: string },
		): Promise<{
			content: { type: "text"; text: string }[];
			details: LoadDetails;
		}> {
			const id = (params.id ?? "").trim();
			if (!id) {
				return {
					content: [
						{ type: "text", text: "The id of the skill is missing." },
					],
					details: { id: "", revision: "", directory: "", offline: false },
				};
			}
			try {
				return await loadSkill(context, id, params.revision);
			} catch (error) {
				return {
					content: [{ type: "text", text: messageOf(error) }],
					details: { id: "", revision: "", directory: "", offline: false },
				};
			}
		},
	};
}

/**
 * The body of one skill.
 *
 * The body of the graph is the first choice. A graph that cannot be
 * reached may serve the body of the last verified read, after the hash
 * of the publication was checked again. A graph that refuses the
 * credential may not: a refusal is not an outage.
 */
async function loadSkill(
	context: OmnigraphContext,
	id: string,
	revision: string | undefined,
): Promise<{
	content: { type: "text"; text: string }[];
	details: LoadDetails;
}> {
	const { config, source } = context;
	// The expectation binds the request to the publication: the record of
	// another revision or another hash is refused, even when it is a
	// valid one.
	const known = approvedEntries(
		readCatalog(config.cacheDir),
		context.approvedRevision,
	).find((entry) => entry.id === id);
	const expectation: OmnigraphPublicationExpectation = {};
	if (revision) expectation.revision = revision;
	if (known?.sha256) expectation.sha256 = known.sha256;
	let record: OmnigraphSkillRecord | null;
	try {
		record = await source.record(id, expectation);
	} catch (error) {
		if (!(error instanceof OmnigraphError) || error.code !== "unavailable") {
			throw error;
		}
		const offline = offlineBody(
			config.cacheDir,
			id,
			revision,
			known,
			context.approvedRevision,
		);
		if (!offline) throw error;
		return offlineAnswer(offline, known, error.message);
	}
	if (!record) {
		return {
			content: [
				{ type: "text", text: `The graph holds no skill with the id "${id}".` },
			],
			details: { id: "", revision: "", directory: "", offline: false },
		};
	}
	const entry: CachedCatalogEntry = {
		id: record.id,
		name: record.name,
		description: record.description,
		revision: record.revision,
		sha256: record.sha256,
	};
	const directory = writeCachedSkill(
		config.cacheDir,
		entry,
		record.instructions,
		config.cacheBudgetBytes,
	);
	const manifest = parseResourceManifest(record.resourcesJson);
	const unsupported = manifest.resources.filter(
		(resource) => resource.state === "unsupported",
	);
	const header = [
		`# ${record.name}`,
		"",
		`The instructions of the skill "${record.name}" (id \`${record.id}\`) at the revision \`${record.revision}\`.`,
		"The hash of the instructions was checked against the publication.",
		`The files of the skill are materialized under \`${directory}\`.`,
		manifest.error
			? `WARNING: the manifest of the files could not be read (${manifest.error}), so the files of this skill are unknown.`
			: manifest.resources.length
				? `The skill declares ${manifest.resources.length} file(s); a file that is needed is fetched with \`remote_skill_resource\`.`
				: "The skill declares no supporting file.",
		unsupported.length
			? `WARNING: ${unsupported.length} file(s) of the manifest are not supported and cannot be fetched: ${unsupported.map((resource) => `${resource.path} (${resource.reason})`).join(", ")}.`
			: "",
		"",
	].filter((line) => line !== "");
	return {
		content: [
			{ type: "text", text: `${header.join("\n")}\n${record.instructions}` },
		],
		details: {
			id: record.id,
			revision: record.revision,
			directory,
			offline: false,
		},
	};
}

/**
 * The tool that fetches one supporting file of a skill.
 */
function resourceTool(context: OmnigraphContext) {
	return {
		name: "remote_skill_resource",
		label: "Remote Skill Resource",
		description:
			"Fetch one supporting file of a skill of the shared graph into the local directory of that skill. The content is checked against the hash of the publication. Use it when the instructions of a skill name a file that is not on the machine.",
		parameters: Type.Object({
			id: Type.String({ description: "The id of the skill in the graph" }),
			path: Type.String({
				description: "The path of the file, relative to the skill",
			}),
			revision: Type.Optional(
				Type.String({ description: "The revision that is expected" }),
			),
		}),
		async execute(
			_toolCallId: string,
			params: { id?: string; path?: string; revision?: string },
		): Promise<{
			content: { type: "text"; text: string }[];
			details: ResourceDetails;
		}> {
			const id = (params.id ?? "").trim();
			const path = (params.path ?? "").trim();
			if (!id || !path) {
				return {
					content: [
						{
							type: "text",
							text: "The id of the skill and the path of the file are needed.",
						},
					],
					details: { path: "" },
				};
			}
			if (!context.fetcher) {
				return {
					content: [
						{
							type: "text",
							text: "This machine has no approved mechanism to read the files of the skills. The instructions of the skill are readable, but its files are not.",
						},
					],
					details: { path: "" },
				};
			}
			try {
				return await fetchResource(context, id, path, params.revision);
			} catch (error) {
				return {
					content: [{ type: "text", text: messageOf(error) }],
					details: { path: "" },
				};
			}
		},
	};
}

/**
 * One supporting file of a skill.
 *
 * The file belongs to the publication of the skill: the revision that is
 * asked for, the revision of the record and the revision of the file
 * itself have to be the same. A file of another publication is never
 * fetched, and the size of the file is known before it is read.
 */
async function fetchResource(
	context: OmnigraphContext,
	id: string,
	path: string,
	revision: string | undefined,
): Promise<{
	content: { type: "text"; text: string }[];
	details: ResourceDetails;
}> {
	const { config, source, fetcher } = context;
	if (!fetcher) throw new Error("the machine has no reader for the files");
	// One exact publication: the revision that is asked for and the
	// revision of the record must be the same. The manifest of another
	// publication is never borrowed.
	const expectation = revision ? { revision } : undefined;
	const record = await source.record(id, expectation);
	if (!record) {
		return {
			content: [
				{ type: "text", text: `The graph holds no skill with the id "${id}".` },
			],
			details: { path: "" },
		};
	}
	const manifest = parseResourceManifest(record.resourcesJson);
	const resource = manifest.resources.find((candidate) => candidate.path === path);
	if (!resource) {
		return {
			content: [
				{
					type: "text",
					text: manifest.error
						? `The manifest of the files of "${id}" could not be read (${manifest.error}), so the file "${path}" is unknown.`
						: `The skill "${id}" declares no file with the path "${path}".`,
				},
			],
			details: { path: "" },
		};
	}
	if (resource.state !== "supported") {
		return {
			content: [
				{
					type: "text",
					text: `The file "${path}" cannot be fetched: ${resource.reason}.`,
				},
			],
			details: { path: "" },
		};
	}
	if (resource.revision && resource.revision !== record.revision) {
		return {
			content: [
				{
					type: "text",
					text: `The file "${path}" belongs to the revision "${resource.revision}", and the skill is at the revision "${record.revision}".`,
				},
			],
			details: { path: "" },
		};
	}
	const limit = config.cacheBudgetBytes;
	const declared = declaredSizeRefusal(resource, limit);
	if (declared) {
		return {
			content: [{ type: "text", text: declared }],
			details: { path: "" },
		};
	}
	const content = await fetcher.fetch(resource, record.revision);
	const arrived = arrivedSizeRefusal(resource, content, limit);
	if (arrived) {
		return {
			content: [{ type: "text", text: arrived }],
			details: { path: "" },
		};
	}
	// The cache has a budget: the write is refused when it does not fit,
	// after the oldest versions that are not pinned were removed.
	makeRoomInCache(
		config.cacheDir,
		config.cacheBudgetBytes,
		content.byteLength,
		skillVersionDir(config.cacheDir, record.id, record.revision),
	);
	const target = writeCachedResource(
		config.cacheDir,
		record.id,
		record.revision,
		resource.path,
		content,
		resource.sha256,
	);
	return {
		content: [
			{
				type: "text",
				text: `The file "${path}" of the skill "${id}" is at \`${target}\` (${content.byteLength} bytes, the hash was checked).`,
			},
		],
		details: { path: target },
	};
}

/**
 * The refusal of a file whose size is known before it is read.
 *
 * The size of the publication is a number of the manifest, so the file
 * is refused before the download when it does not fit the budget of the
 * cache.
 */
function declaredSizeRefusal(
	resource: { bytes: number; path: string },
	limit: number,
): string | undefined {
	if (limit <= 0) return undefined;
	if (!(resource.bytes > 0)) return undefined;
	if (resource.bytes <= limit) return undefined;
	return `The file "${resource.path}" is ${resource.bytes} bytes, and the budget of the cache is ${limit} bytes: the file is not fetched.`;
}

/**
 * The refusal of a file whose size is not the size of the publication.
 */
function arrivedSizeRefusal(
	resource: { bytes: number; path: string },
	content: Uint8Array,
	limit: number,
): string | undefined {
	if (limit > 0 && content.byteLength > limit) {
		return `The file "${resource.path}" is ${content.byteLength} bytes, and the budget of the cache is ${limit} bytes: the file is not kept.`;
	}
	if (resource.bytes > 0 && content.byteLength !== resource.bytes) {
		return `The file "${resource.path}" is ${content.byteLength} bytes, and the publication says ${resource.bytes} bytes: the file is not the file of the publication.`;
	}
	return undefined;
}

/**
 * The entries of a catalog that fit a text.
 */
/**
 * The scope of the source of this client.
 *
 * The scope keeps the sources apart: two endpoints, two graphs, two
 * publications and two readers are four different scopes, and a skill of
 * one scope is never the skill of another one.
 */
function scopeOf(context: OmnigraphContext): string {
	return cacheNamespace({
		url: context.config.url,
		graph: context.config.graph,
		token: context.config.token,
		publication: context.approvedRevision,
	});
}

/**
 * The skills of the graph that fit a request.
 *
 * The catalog of the graph is the authority: every candidate is verified
 * against it. The vector index may add candidates, but a hit of the index
 * never replaces the reference of the catalog.
 */
async function retrieveSkills(
	context: OmnigraphContext,
	query: string,
	limit: number,
): Promise<RetrievalOutcome> {
	const catalog: CatalogEntry[] = readCatalog(context.config.cacheDir).map(
		(entry) => ({
			id: entry.id,
			name: entry.name,
			description: entry.description,
			revision: entry.revision,
			sha256: entry.sha256,
		}),
	);
	let vectorHits: VectorHit[] | undefined;
	let vectorUnavailable: string | undefined;
	const rollout = context.rollout ?? decideRollout();
	if (rollout.useVector && context.vectorSearch) {
		try {
			vectorHits = await context.vectorSearch(query, limit);
		} catch (error) {
			vectorUnavailable =
				error instanceof Error
					? `the vector index could not be read (${error.message.slice(0, 120)})`
					: "the vector index could not be read";
		}
	} else if (rollout.useVector) {
		vectorUnavailable = "no vector index generation is connected";
	}
	context.lastDegraded = vectorUnavailable;
	const base = {
		query,
		namespace: scopeOf(context),
		graph: context.config.graph,
		catalog,
		...(context.approvedRevision
			? { approvedRevision: context.approvedRevision }
			: {}),
		limit,
	};
	if (rollout.shadow) {
		// The shadow evaluation: the index is compared with the lexical
		// search, and only the lexical candidates are returned.
		const lexicalOutcome = searchSkills(base);
		const hybrid = searchSkills({
			...base,
			...(vectorHits ? { vectorHits } : {}),
		});
		const comparison = compareShadow({
			lexical: lexicalOutcome.candidates.map((candidate) => candidate.ref.id),
			index: (vectorHits ?? []).map((hit) => hit.id),
			fused: hybrid.candidates.map((candidate) => candidate.ref.id),
		});
		return {
			...lexicalOutcome,
			reasons: {
				...lexicalOutcome.reasons,
				shadow: `the index would have added ${comparison.added} candidate(s) to the ${comparison.lexicalOnly} of the lexical search`,
			},
		};
	}
	const outcome = searchSkills({
		...base,
		...(vectorHits ? { vectorHits } : {}),
		...(vectorUnavailable ? { vectorUnavailable } : {}),
	});
	return expandRelations(context, outcome);
}

/**
 * The expansion of the relations of the candidates.
 *
 * The mandatory prerequisites of the candidates join the answer, and every
 * one of them is verified against the catalog of the graph first. A
 * dependency that the graph does not hold, or that the approval does not
 * allow, is named instead of being returned.
 */
async function expandRelations(
	context: OmnigraphContext,
	outcome: RetrievalOutcome,
): Promise<RetrievalOutcome> {
	const reader = context.relationReader;
	if (!reader || outcome.candidates.length === 0) return outcome;
	const plan = await planRelations({
		roots: outcome.candidates.map((candidate) => ({
			identity: candidate.ref.id,
			name: candidate.name,
			required: false,
		})),
		reader,
		types: ["requires", "conflicts_with"],
		limits: { depth: 2, nodes: 12, neighbours: 6, tokens: 4000 },
	});
	const catalog: CatalogEntry[] = readCatalog(context.config.cacheDir).map(
		(entry) => ({
			id: entry.id,
			name: entry.name,
			description: entry.description,
			revision: entry.revision,
			sha256: entry.sha256,
		}),
	);
	const candidates: Candidate[] = [...outcome.candidates];
	for (const node of plan.nodes) {
		if (!node.required) continue;
		if (candidates.some((candidate) => candidate.ref.id === node.identity)) continue;
		if (!catalog.some((entry) => entry.id === node.identity)) {
			plan.missing.push({
				identity: node.identity,
				reason: "the graph does not hold the skill",
			});
			continue;
		}
		const verified = verifyCandidate(
			node.identity,
			catalog,
			context.approvedRevision,
		);
		if (!verified.entry) {
			plan.missing.push({
				identity: node.identity,
				reason: verified.reason ?? "not allowed",
			});
			continue;
		}
		candidates.push({
			ref: skillRefOf(verified.entry, {
				namespace: scopeOf(context),
				graph: context.config.graph,
			}),
			name: verified.entry.name,
			description: verified.entry.description,
			methods: ["relation"],
			scores: { fused: 0 },
			rank: candidates.length + 1,
		});
	}
	return {
		...outcome,
		candidates,
		relations: {
			nodes: plan.nodes.map((node) => ({
				identity: node.identity,
				required: node.required,
				depth: node.depth,
			})),
			cycles: plan.cycles,
			conflicts: plan.conflicts,
			missing: plan.missing,
		},
	};
}

/**
 * The reader of the relations, when one is connected.
 */
function applyRelationReader(
	context: OmnigraphContext,
	options: OmnigraphRegistrationOptions,
): void {
	if (options.relationReader) context.relationReader = options.relationReader;
}

/**
 * The stage of the rollout.
 *
 * The stage comes from the options of the registration, and the
 * environment names it when the options do not.
 */
function rolloutOf(options: OmnigraphRegistrationOptions): RolloutDecision {
	return decideRollout({
		value: options.rolloutStage ?? process.env[ROLLOUT_FLAG],
	});
}

/**
 * The state of the retrieval, as the operator sees it.
 *
 * The status names the mode of the retrieval and the reason when it runs
 * with less than the full method. A health check of a vector store is not
 * a proof that the index is synchronized, so the status never claims that
 * it is.
 */
function describeRetrieval(context: OmnigraphContext): string {
	const rollout = context.rollout ?? decideRollout();
	if (rollout.stage === "off") {
		return `The retrieval runs on the catalog of the graph alone (${rollout.reason}).`;
	}
	if (rollout.stage === "shadow") {
		return "The retrieval runs on the catalog of the graph alone; the index is compared with it in the shadow.";
	}
	if (!context.vectorSearch) {
		return "The retrieval runs on the catalog of the graph alone (no vector index generation is connected).";
	}
	return "The retrieval runs on the catalog of the graph and on the vector index; every candidate is verified against the catalog.";
}

/**
 * The active index generation, as the operator sees it.
 *
 * The status names the generation, the number of its records and its age.
 * It never claims that the index is synchronized: the facts it holds are
 * the count and the age, and the lag is named when the counts differ.
 */
function describeIndex(context: OmnigraphContext, sourceCount: number): string {
	const manifest = readIndexManifest(context.config.cacheDir);
	if (!manifest) {
		return "No index generation is active.";
	}
	const freshness = indexFreshness({
		manifest,
		sourceCount,
		now: new Date().toISOString(),
	});
	const behind = freshness.behind
		? ` The index is behind the source: ${freshness.reason}.`
		: "";
	return `The active index generation "${manifest.runId}" holds ${manifest.indexedCount} record(s) and was activated ${describeAge(freshness.ageMs)} ago.${behind}`;
}

/**
 * The reason the last search ran with less than the full method.
 */
function describeDegraded(context: OmnigraphContext): string {
	if (!context.lastDegraded) return "";
	return ` The last search degraded: ${context.lastDegraded}.`;
}

/**
 * An age in words.
 */
function describeAge(ms: number): string {
	if (ms < 60_000) return "a moment";
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 60) return `${minutes} minute(s)`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} hour(s)`;
	return `${Math.floor(hours / 24)} day(s)`;
}

/**
 * The details of a search.
 *
 * The details name the mode of the retrieval and the candidates that were
 * found, so that the caller can see which method answered without reading
 * the text.
 */
interface RemoteSearchDetails {
	/** The mode of the retrieval. */
	mode: RetrievalOutcome["mode"] | "denied" | "failed";
	/** The candidates that were found. */
	candidates: Array<{
		id: string;
		revision: string;
		methods: string[];
	}>;
	/** The number of the candidates that were left out. */
	excluded: number;
	/** The reasons of the outcome. */
	reasons?: RetrievalOutcome["reasons"];
	/** The expansion of the relations, when one was read. */
	relations?: RetrievalOutcome["relations"];
}

/**
 * The entries of the catalog that the approval allows.
 *
 * A skill of another revision is not advertised, and a skill without a
 * revision is not advertised either: it cannot be approved. Without an
 * approval every entry of the catalog is allowed.
 */
function approvedEntries(
	entries: CachedCatalogEntry[],
	approvedRevision?: string,
): CachedCatalogEntry[] {
	if (!approvedRevision) return entries;
	return entries.filter((entry) => entry.revision === approvedRevision);
}

/**
 * The body of the last verified read, for a graph that cannot be
 * reached.
 *
 * The body is only used when it matches the hash of the publication of
 * the catalog of this source: a body that cannot be checked is not a
 * body.
 */
function offlineBody(
	cacheDir: string,
	id: string,
	revision: string | undefined,
	known: CachedCatalogEntry | undefined,
	approvedRevision?: string,
): { body: string; revision: string } | null {
	if (!known || !known.revision) return null;
	if (revision && revision !== known.revision) return null;
	// The approval of the operator bounds the reuse of a body: a body
	// of another revision is not served, even when its hash is good.
	if (approvedRevision && known.revision !== approvedRevision) return null;
	if (!isPublicationHash(known.sha256)) return null;
	const body = readCachedSkill(cacheDir, id, known.revision);
	if (!body) return null;
	if (sha256Of(body) !== known.sha256.toLowerCase()) return null;
	return { body, revision: known.revision };
}

/**
 * The answer of a load that was served from the local cache.
 */
function offlineAnswer(
	offline: { body: string; revision: string },
	known: CachedCatalogEntry | undefined,
	reason: string,
): {
	content: { type: "text"; text: string }[];
	details: LoadDetails;
} {
	const header = [
		`# ${known?.name ?? "The skill"}`,
		"",
		`The graph could not be reached (${reason}); the instructions of the last verified read are used.`,
		"The hash of the instructions was checked against the publication.",
		`The revision of the publication: \`${offline.revision}\`.`,
		"",
	].join("\n");
	return {
		content: [{ type: "text", text: `${header}\n${offline.body}` }],
		details: {
			id: known?.id ?? "",
			revision: offline.revision,
			directory: "",
			offline: true,
		},
	};
}

/**
 * The state of the source, in words.
 */
function describeState(
	report: OmnigraphCatalogReport,
	config: OmnigraphConfig,
): string {
	switch (report.state) {
		case "ok":
			return "ready";
		case "empty":
			return "ready, the graph holds no skill";
		case "denied":
			return `the graph refused the read (${report.error ?? "the credential was refused"})`;
		case "unavailable":
			return `the graph could not be reached (${report.error ?? "unknown reason"}); the cache of the last verified read is used`;
		default:
			return `not read yet (the graph "${config.graph}" at ${config.url})`;
	}
}

/**
 * The message of a failure.
 *
 * The credential never appears in it.
 */
function messageOf(error: unknown): string {
	if (error instanceof OmnigraphError) return error.message;
	if (error instanceof Error) return error.message;
	return String(error ?? "the source could not be read");
}

/**
 * The skills of the graph that are already on the machine.
 *
 * The cached body of a skill is only used when the revision is the one
 * that is cached: the body of a skill belongs to its revision.
 */
export function cachedSkillOf(
	config: OmnigraphConfig,
	id: string,
	revision: string,
): string | null {
	return readCachedSkill(config.cacheDir, id, revision);
}

/** The entries of the catalog that the source knows. */
export type CatalogEntries = OmnigraphCatalogEntry[];
