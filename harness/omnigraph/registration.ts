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
 * The startup must not wait for the network. The discovery answers with
 * the stubs of the last verified catalog, and the catalog is refreshed
 * in the background.
 */

import { Type } from "typebox";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import {
	cacheUsage,
	clearCache,
	readCatalog,
	readCachedSkill,
	stubRoot,
	writeCachedResource,
	writeCachedSkill,
	writeCatalog,
	writeStubs,
	type CachedCatalogEntry,
} from "./cache.ts";
import {
	type OmnigraphConfig,
} from "./config.ts";
import {
	parseResourceManifest,
	type OmnigraphResourceFetcher,
} from "./resources.ts";
import {
	OmnigraphSkillSource,
	type OmnigraphCatalogEntry,
} from "./source.ts";
import { OmnigraphError } from "./transport.ts";

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
	 * The report of the state of the catalog.
	 *
	 * The report is written once the catalog was read, or once the read
	 * failed. A machine that is offline reports the failure and keeps the
	 * catalog of the last verified read.
	 */
	onCatalog?: (state: { count: number; error?: string }) => void;
}

/** The state of the source, as the command shows it. */
export interface OmnigraphStatus {
	/** Whether the source is configured. */
	configured: boolean;
	/** The graph that holds the skills. */
	graph: string;
	/** The number of the skills of the last verified catalog. */
	catalogCount: number;
	/** The size of the local cache, in bytes. */
	cacheBytes: number;
	/** The budget of the local cache, in bytes. */
	cacheBudgetBytes: number;
	/** The reason the source cannot be used, if it cannot. */
	error?: string;
}

/** The details of the tool that loads a skill. */
interface LoadDetails {
	/** The id of the skill. */
	id: string;
	/** The revision of the publication. */
	revision: string;
	/** The directory of the skill on this machine. */
	directory: string;
}

/** The details of the tool that fetches a file of a skill. */
interface ResourceDetails {
	/** The path of the file on this machine. */
	path: string;
}

/**
 * Register the tools, the command and the discovery of the source.
 *
 * The registration is synchronous: pi must be able to start even when the
 * graph cannot be reached. The first catalog is read in the background.
 */
export function registerOmnigraphSkills(
	pi: ExtensionAPI,
	options: OmnigraphRegistrationOptions,
): void {
	const { config, source } = options;
	const log = options.log ?? (() => {});

	/**
	 * The catalog of the source.
	 *
	 * The last verified catalog is used when the graph cannot be read:
	 * a machine that is offline still knows the skills of the graph.
	 */
	const readCatalogEntries = async (): Promise<CachedCatalogEntry[]> => {
		try {
			const entries = await source.catalog();
			const cached: CachedCatalogEntry[] = entries.map((entry) => ({
				id: entry.id,
				name: entry.name,
				description: entry.description,
				revision: entry.revision,
				sha256: entry.sha256,
			}));
			writeCatalog(config.cacheDir, cached);
			writeStubs(config.cacheDir, cached);
			options.onCatalog?.({ count: cached.length });
			return cached;
		} catch (error) {
			const reason = messageOf(error);
			log(`[pi-harness] The catalog of the graph could not be read: ${reason}`);
			const cached = readCatalog(config.cacheDir);
			options.onCatalog?.({ count: cached.length, error: reason });
			return cached;
		}
	};

	// The first catalog is read in the background: the startup of pi does
	// not wait for the network.
	void readCatalogEntries();

	pi.on("resources_discover", () => {
		// The stubs are the only thing that is advertised. The hydrated
		// skills live in another tree, so pi never discovers two skills
		// with the same name.
		const root = stubRoot(config.cacheDir);
		return { skillPaths: [root] };
	});

	pi.registerTool({
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
		async execute(_toolCallId, params) {
			try {
				const entries = await readCatalogEntries();
				const query = (params.query ?? "").trim().toLowerCase();
				const matched = query
					? entries.filter(
							(entry) =>
								entry.name.toLowerCase().includes(query) ||
								entry.description.toLowerCase().includes(query) ||
								entry.id.toLowerCase().includes(query),
						)
					: entries;
				const limit = params.limit && params.limit > 0 ? params.limit : 20;
				const lines = matched.slice(0, limit).map(
					(entry) =>
						`- ${entry.name} (${entry.id}) — ${entry.description || "no description"} [revision ${entry.revision || "unknown"}]`,
				);
				const text = matched.length
					? `${matched.length} skill(s) found:\n${lines.join("\n")}`
					: "The catalog holds no skill that fits.";
				return { content: [{ type: "text", text }], details: {} };
			} catch (error) {
				return {
					content: [{ type: "text", text: messageOf(error) }],
					details: {},
				};
			}
		},
	});

	pi.registerTool({
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
		async execute(_toolCallId, params): Promise<{
			content: { type: "text"; text: string }[];
			details: LoadDetails;
		}> {
			const id = (params.id ?? "").trim();
			if (!id) {
				return {
					content: [{ type: "text", text: "The id of the skill is missing." }],
					details: { id: "", revision: "", directory: "" },
				};
			}
			try {
				const record = await source.record(id);
				if (!record) {
					return {
						content: [
							{ type: "text", text: `The graph holds no skill with the id "${id}".` },
						],
						details: { id: "", revision: "", directory: "" },
					};
				}
				if (params.revision && params.revision !== record.revision) {
					return {
						content: [
							{
								type: "text",
								text: `The skill "${id}" is at the revision "${record.revision}", and the revision "${params.revision}" was asked for.`,
							},
						],
						details: {
							id: record.id,
							revision: record.revision,
							directory: "",
						},
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
				);
				const manifest = parseResourceManifest(record.resourcesJson);
				const unsupported = manifest.resources.filter(
					(resource) => resource.state === "unsupported",
				);
				const header = [
					`# ${record.name}`,
					"",
					`The instructions of the skill "${record.name}" (id \`${record.id}\`) at the revision \`${record.revision}\`.`,
					`The hash of the instructions was checked against the publication.`,
					`The files of the skill are materialized under \`${directory}\`.`,
					manifest.resources.length
						? `The skill declares ${manifest.resources.length} file(s); a file that is needed is fetched with \`remote_skill_resource\`.`
						: "The skill declares no supporting file.",
					unsupported.length
						? `WARNING: ${unsupported.length} file(s) of the manifest are not supported and cannot be fetched: ${unsupported.map((resource) => `${resource.path} (${resource.reason})`).join(", ")}.`
						: "",
					"",
				].filter((line) => line !== "");
				return {
					content: [{ type: "text", text: `${header.join("\n")}\n${record.instructions}` }],
					details: {
						id: record.id,
						revision: record.revision,
						directory,
					},
				};
			} catch (error) {
				return {
					content: [{ type: "text", text: messageOf(error) }],
					details: { id: "", revision: "", directory: "" },
				};
			}
		},
	});

	pi.registerTool({
		name: "remote_skill_resource",
		label: "Remote Skill Resource",
		description:
			"Fetch one supporting file of a skill of the shared graph into the local directory of that skill. The content is checked against the hash of the publication. Use it when the instructions of a skill name a file that is not on the machine.",
		parameters: Type.Object({
			id: Type.String({ description: "The id of the skill in the graph" }),
			path: Type.String({ description: "The path of the file, relative to the skill" }),
			revision: Type.Optional(
				Type.String({ description: "The revision that is expected" }),
			),
		}),
		async execute(_toolCallId, params): Promise<{
			content: { type: "text"; text: string }[];
			details: ResourceDetails;
		}> {
			const id = (params.id ?? "").trim();
			const path = (params.path ?? "").trim();
			if (!id || !path) {
				return {
					content: [
						{ type: "text", text: "The id of the skill and the path of the file are needed." },
					],
					details: { path: "" },
				};
			}
			if (!options.fetcher) {
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
				const record = await source.record(id);
				if (!record) {
					return {
						content: [
							{ type: "text", text: `The graph holds no skill with the id "${id}".` },
						],
						details: { path: "" },
					};
				}
				const revision = params.revision || record.revision;
				const manifest = parseResourceManifest(record.resourcesJson);
				const resource = manifest.resources.find(
					(candidate) => candidate.path === path,
				);
				if (!resource) {
					return {
						content: [
							{
								type: "text",
								text: `The skill "${id}" declares no file with the path "${path}".`,
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
				const content = await options.fetcher.fetch(resource, revision);
				const target = writeCachedResource(
					config.cacheDir,
					record.id,
					revision,
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
			} catch (error) {
				return {
					content: [{ type: "text", text: messageOf(error) }],
					details: { path: "" },
				};
			}
		},
	});

	pi.registerCommand("remote-skills", {
		description: "The skills of the shared graph: status, search, refresh, clear-cache",
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const [command = "status", ...rest] = args.trim().split(/\s+/);
			const notify = (message: string) => {
				if (ctx?.ui?.notify) ctx.ui.notify(message, "info");
				else log(`[pi-harness] ${message}`);
			};
			if (command === "status") {
				const status = await omnigraphStatus(options);
				notify(
					`The graph "${status.graph}" holds ${status.catalogCount} skill(s); the cache holds ${status.cacheBytes} of ${status.cacheBudgetBytes} bytes.`,
				);
				return;
			}
			if (command === "search") {
				const query = rest.join(" ");
				const entries = await readCatalogEntries();
				const needle = query.trim().toLowerCase();
				const matched = needle
					? entries.filter(
							(entry) =>
								entry.name.toLowerCase().includes(needle) ||
								entry.description.toLowerCase().includes(needle) ||
								entry.id.toLowerCase().includes(needle),
						)
					: entries;
				notify(
					matched.length
						? matched
								.slice(0, 20)
								.map((entry) => `${entry.name} (${entry.id})`)
								.join(", ")
						: "The catalog holds no skill that fits.",
				);
				return;
			}
			if (command === "refresh") {
				const entries = await readCatalogEntries();
				notify(`The catalog holds ${entries.length} skill(s).`);
				return;
			}
			if (command === "clear-cache") {
				clearCache(config.cacheDir);
				notify("The cache of the graph is empty.");
				return;
			}
			notify(
				"Unknown command. Use: status, search <text>, refresh, clear-cache.",
			);
		},
	});
}

/**
 * The state of the source.
 */
export async function omnigraphStatus(
	options: OmnigraphRegistrationOptions,
): Promise<OmnigraphStatus> {
	const { config } = options;
	const status: OmnigraphStatus = {
		configured: true,
		graph: config.graph,
		catalogCount: readCatalog(config.cacheDir).length,
		cacheBytes: cacheUsage(config.cacheDir),
		cacheBudgetBytes: config.cacheBudgetBytes,
	};
	try {
		const entries = await options.source.catalog();
		status.catalogCount = entries.length;
	} catch (error) {
		status.error = messageOf(error);
	}
	return status;
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
