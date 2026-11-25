/**
 * The supporting files of a skill.
 *
 * A skill is not only its instructions: it can need scripts, references
 * and data next to it. The graph holds a manifest of those files, and
 * the client fetches them one at a time, only when a skill is used.
 *
 * Two rules decide what this module does:
 *
 * - the manifest is not proven by its name. A file of the manifest that
 *   does not name its path, its size and its hash is marked
 *   UNSUPPORTED, and it is never fetched. A file that cannot be checked
 *   is a file that cannot be trusted,
 * - the files come from the repository at the revision of the
 *   publication. The client never falls back to a branch that moves, and
 *   it never sends the credential of the graph to the repository: the
 *   repository has its own mechanism.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";

/** The state of one file of the manifest. */
export type OmnigraphResourceState =
	/** The file can be fetched and checked. */
	| "supported"
	/** The manifest does not say enough about the file. */
	| "unsupported";

/** One file of the manifest of a skill. */
export interface OmnigraphResource {
	/** The path of the file, relative to the root of the skill. */
	path: string;
	/** The size of the file, in bytes. */
	bytes: number;
	/** The hash of the content of the file. */
	sha256: string;
	/** The revision the file belongs to. */
	revision?: string;
	/** Whether the file can be fetched. */
	state: OmnigraphResourceState;
	/** The reason a file is not supported. */
	reason?: string;
}

/**
 * The manifest of the files of a skill.
 *
 * A manifest that cannot be read is an empty manifest with a reason: a
 * skill without files is a skill whose files are not known, and that is
 * not the same as a skill without files.
 */
export interface OmnigraphResourceManifest {
	/** The files of the skill. */
	resources: OmnigraphResource[];
	/** The reason the manifest could not be read, if it could not. */
	error?: string;
}

/**
 * The manifest of the files of a skill, from the text of the graph.
 *
 * The shape of the manifest is not proven, so a few shapes are read and
 * everything else is reported as unreadable. A file that the manifest
 * does not describe well enough is marked unsupported.
 */
export function parseResourceManifest(
	resourcesJson: string,
): OmnigraphResourceManifest {
	const text = resourcesJson?.trim();
	if (!text) return { resources: [] };
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {
			resources: [],
			error: "the manifest of the files is not JSON",
		};
	}
	const list = manifestListOf(parsed);
	if (!list) {
		return {
			resources: [],
			error: "the manifest of the files has a shape that is not known",
		};
	}
	const resources: OmnigraphResource[] = [];
	for (const item of list) {
		const resource = resourceOf(item);
		if (resource) resources.push(resource);
	}
	return { resources };
}

/**
 * The list of the files of a manifest.
 *
 * The list is the list itself, or the list under a known name.
 */
function manifestListOf(parsed: unknown): unknown[] | null {
	if (Array.isArray(parsed)) return parsed;
	if (typeof parsed !== "object" || parsed === null) return null;
	const record = parsed as Record<string, unknown>;
	for (const key of ["resources", "files", "resources_json", "items"]) {
		const value = record[key];
		if (Array.isArray(value)) return value;
	}
	return null;
}

/**
 * One file of a manifest.
 *
 * A file without a path, without a size or without a hash is not
 * supported: a file that cannot be checked may not be used.
 */
function resourceOf(item: unknown): OmnigraphResource | null {
	if (typeof item !== "object" || item === null) return null;
	const record = item as Record<string, unknown>;
	const path = typeof record.path === "string" ? record.path.trim() : "";
	const rawBytes =
		typeof record.bytes === "number"
			? record.bytes
			: typeof record.size === "number"
				? record.size
				: Number.NaN;
	const sha256 =
		typeof record.sha256 === "string"
			? record.sha256.trim().toLowerCase()
			: typeof record.hash === "string"
				? record.hash.trim().toLowerCase()
				: "";
	const revision =
		typeof record.revision === "string" ? record.revision.trim() : undefined;
	if (!path) return null;
	if (!Number.isFinite(rawBytes) || rawBytes < 0) {
		return {
			path,
			bytes: 0,
			sha256,
			...(revision ? { revision } : {}),
			state: "unsupported",
			reason: "the manifest does not name the size of the file",
		};
	}
	if (!/^[0-9a-f]{64}$/.test(sha256)) {
		return {
			path,
			bytes: rawBytes,
			sha256,
			...(revision ? { revision } : {}),
			state: "unsupported",
			reason: "the manifest does not name the hash of the file",
		};
	}
	return {
		path,
		bytes: rawBytes,
		sha256,
		...(revision ? { revision } : {}),
		state: "supported",
	};
}

/**
 * How one file of a skill is fetched.
 *
 * The implementation is injected: the graph does not hold the files
 * themselves, and the mechanism that reads them belongs to the machine
 * (a local checkout, a mirror, a proxy). The client never guesses one.
 */
export interface OmnigraphResourceFetcher {
	/**
	 * The content of one file at one revision.
	 *
	 * @param resource The file of the manifest.
	 * @param revision The revision of the publication.
	 */
	fetch(
		resource: OmnigraphResource,
		revision: string,
	): Promise<Uint8Array>;
}

/** The error of a file that could not be fetched. */
export class OmnigraphResourceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OmnigraphResourceError";
	}
}

/**
 * The files of a skill, read from a local checkout of the repository.
 *
 * The checkout is the approved mechanism of the machine: it holds the
 * credentials of the repository, and the client reads the file at the
 * exact revision with git, so the content is the published content and
 * not the content of a branch that moved.
 *
 * The command is run without a shell, so a path or a revision of the
 * graph cannot become a command.
 */
export class GitCheckoutResourceFetcher implements OmnigraphResourceFetcher {
	/** The directory of the checkout. */
	private readonly repository: string;

	constructor(repository: string) {
		this.repository = repository;
	}

	async fetch(
		resource: OmnigraphResource,
		revision: string,
	): Promise<Uint8Array> {
		const content = await this.show(revision, resource.path);
		const computed = createHash("sha256").update(content).digest("hex");
		if (computed !== resource.sha256) {
			throw new OmnigraphResourceError(
				`the file "${resource.path}" of the revision "${revision}" does not match the hash of the publication`,
			);
		}
		return content;
	}

	/** The content of one file of the checkout, at one revision. */
	private show(revision: string, path: string): Promise<Buffer> {
		return new Promise((resolvePromise, rejectPromise) => {
			execFile(
				"git",
				["-C", this.repository, "show", `${revision}:${path}`],
				{ maxBuffer: 64 * 1024 * 1024, encoding: "buffer" },
				(error, stdout) => {
					if (error) {
						rejectPromise(
							new OmnigraphResourceError(
								`the file "${path}" is not in the checkout at the revision "${revision}"`,
							),
						);
						return;
					}
					resolvePromise(stdout);
				},
			);
		});
	}
}
