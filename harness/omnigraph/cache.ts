/**
 * The local cache of the skills of the graph.
 *
 * The cache holds three things, and they live in three trees:
 *
 * - the catalog (the last verified one), so a machine that is offline
 *   still knows which skills exist,
 * - the stubs: tiny SKILL.md files that make pi discover the skills of
 *   the graph natively. A stub is NOT a skill: it holds the id, the
 *   revision and the hash of a skill, and it asks the loader for the
 *   body,
 * - the hydrated skills: the real instructions, under the revision they
 *   were published with.
 *
 * The trees stay apart. A hydrated skill and a stub of the same skill in
 * one tree would give pi two skills with the same name, and pi would
 * load the wrong one.
 *
 * Every write is atomic (a temporary file and a rename), so an
 * interrupted download never leaves a half-written skill behind. Every
 * file is checked against the hash of the publication, and every path is
 * checked against the tree it belongs to.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** One entry of the catalog that is cached. */
export interface CachedCatalogEntry {
	/** The id of the skill. */
	id: string;
	/** The name of the skill. */
	name: string;
	/** The description of the skill. */
	description: string;
	/** The revision of the publication. */
	revision: string;
	/** The hash of the instructions. */
	sha256: string;
}

/** The name of the file that holds the catalog. */
const CATALOG_FILE = "catalog.json";

/** The tree of the stubs. */
const STUB_DIR = "stubs";

/** The tree of the hydrated skills. */
const SKILL_DIR = "skills";

/**
 * The directory of the stubs.
 *
 * The stubs are the tree that pi discovers. It holds no instructions.
 */
export function stubRoot(cacheDir: string): string {
	return join(cacheDir, STUB_DIR);
}

/**
 * The directory of the hydrated skills.
 */
export function skillRoot(cacheDir: string): string {
	return join(cacheDir, SKILL_DIR);
}

/**
 * The directory of one skill, under the revision it was published with.
 *
 * A skill of another revision lives in another directory: the body of a
 * skill is only ever read with the revision it belongs to.
 */
export function skillVersionDir(
	cacheDir: string,
	id: string,
	revision: string,
): string {
	return join(skillRoot(cacheDir), safeSegment(id), safeSegment(revision));
}

/**
 * A segment of a path that cannot leave its tree.
 *
 * An id or a revision of the graph is a name of a directory, so it may
 * not be a path. A name with a slash, a dot or a separator in it is
 * replaced: the tree it belongs to is the boundary.
 */
export function safeSegment(value: string): string {
	const cleaned = value
		.trim()
		.replace(/[^A-Za-z0-9._-]/g, "_")
		.replace(/^\.+/, "_");
	return cleaned.length ? cleaned.slice(0, 120) : "_";
}

/**
 * The error of a path that leaves its tree.
 */
export class CachePathError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CachePathError";
	}
}

/**
 * The path of a resource inside a tree.
 *
 * The path of a resource comes from the graph, so it is untrusted. An
 * absolute path, a path with a ".." in it, or a path that leaves the
 * tree after it is resolved, is refused.
 */
export function containedPath(root: string, relativePath: string): string {
	const cleaned = relativePath.trim().replace(/\\/g, "/");
	if (!cleaned) {
		throw new CachePathError("the resource has no path");
	}
	if (isAbsolute(cleaned) || cleaned.startsWith("/")) {
		throw new CachePathError("the resource has an absolute path");
	}
	if (cleaned.split("/").some((part) => part === "..")) {
		throw new CachePathError("the resource leaves the tree of its skill");
	}
	const rootPath = resolve(root);
	const target = resolve(rootPath, cleaned);
	const relation = relative(rootPath, target);
	if (relation.startsWith("..") || relation.startsWith(`..${sep}`)) {
		throw new CachePathError("the resource leaves the tree of its skill");
	}
	if (isAbsolute(relation)) {
		throw new CachePathError("the resource leaves the tree of its skill");
	}
	return target;
}

/**
 * Write a file atomically.
 *
 * The file is written next to its place and renamed into it, so a
 * reader never sees a half-written file, and an interrupted write never
 * replaces a good file with a broken one.
 */
export function writeFileAtomic(
	target: string,
	content: string | Uint8Array,
): void {
	mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
	const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
	try {
		writeFileSync(temporary, content, { mode: 0o600 });
		renameSync(temporary, target);
	} catch (error) {
		try {
			rmSync(temporary, { force: true });
		} catch {
			// The temporary file is already gone.
		}
		throw error;
	}
}

/**
 * The hash of bytes.
 */
export function sha256Of(content: string | Uint8Array): string {
	return createHash("sha256").update(content).digest("hex");
}

/**
 * Write the catalog.
 *
 * The catalog is the last verified list of the skills. It is written
 * after a verified read, so a machine that starts while the network is
 * down still knows the skills of the graph.
 */
export function writeCatalog(
	cacheDir: string,
	entries: CachedCatalogEntry[],
): void {
	writeFileAtomic(
		join(cacheDir, CATALOG_FILE),
		`${JSON.stringify({ entries }, null, 2)}\n`,
	);
}

/**
 * The last verified catalog.
 *
 * A cache without a catalog is not an error: it is a machine that has
 * not read the graph yet.
 */
export function readCatalog(cacheDir: string): CachedCatalogEntry[] {
	const file = join(cacheDir, CATALOG_FILE);
	if (!existsSync(file)) return [];
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as {
			entries?: unknown;
		};
		if (!Array.isArray(parsed.entries)) return [];
		return parsed.entries.filter(isCatalogEntry);
	} catch {
		return [];
	}
}

/** Whether a value is an entry of the catalog. */
function isCatalogEntry(value: unknown): value is CachedCatalogEntry {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Partial<CachedCatalogEntry>;
	return (
		typeof entry.id === "string" &&
		typeof entry.name === "string" &&
		typeof entry.description === "string" &&
		typeof entry.revision === "string" &&
		typeof entry.sha256 === "string"
	);
}

/**
 * The SKILL.md of a stub.
 *
 * The stub makes pi discover the skill of the graph natively. It holds
 * the id, the revision and the hash, and it tells the model that the
 * real instructions have to be loaded before the skill is used.
 */
export function stubSkillMarkdown(entry: CachedCatalogEntry): string {
	return `---
name: ${entry.name}
description: ${entry.description || `The skill "${entry.name}" of the shared graph.`}
---

# The skill "${entry.name}" of the shared graph

This is a stub, not the skill. The skill lives in the shared graph
(OmniGraph) and is not installed on this machine.

- The id of the skill: \`${entry.id}\`
- The revision of the publication: \`${entry.revision}\`
- The hash of the instructions: \`${entry.sha256 || "(not published)"}\`

**Load the real instructions before you use this skill.** Call the tool
\`remote_skill_load\` with the id \`${entry.id}\` (and the revision
\`${entry.revision}\`) and read the instructions it returns. The
instructions of the skill are the ones of that revision, and they come
with the files that the skill needs.

Do not act on this stub, and do not guess what the skill says: the
stub holds no instructions of the skill.
`;
}

/**
 * Write the stub of one skill.
 *
 * The stub is written under the id of the skill, so a catalog that
 * changes replaces the stub of that skill and not the stubs of others.
 */
export function writeStub(
	cacheDir: string,
	entry: CachedCatalogEntry,
): string {
	const directory = join(stubRoot(cacheDir), safeSegment(entry.id));
	writeFileAtomic(join(directory, "SKILL.md"), stubSkillMarkdown(entry));
	return directory;
}

/**
 * Write every stub of a catalog.
 *
 * The stubs that the catalog does not hold any more are removed, so a
 * skill that was withdrawn is not advertised any more.
 */
export function writeStubs(
	cacheDir: string,
	entries: CachedCatalogEntry[],
): string[] {
	const directory = stubRoot(cacheDir);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const written: string[] = [];
	const keep = new Set<string>();
	for (const entry of entries) {
		const segment = safeSegment(entry.id);
		keep.add(segment);
		written.push(writeStub(cacheDir, entry));
	}
	for (const name of readdirSync(directory)) {
		if (!keep.has(name)) {
			rmSync(join(directory, name), { recursive: true, force: true });
		}
	}
	return written;
}

/**
 * The instructions of a cached skill.
 *
 * A skill that is not in the cache is nothing: the caller asks the
 * graph for it.
 */
export function readCachedSkill(
	cacheDir: string,
	id: string,
	revision: string,
): string | null {
	const file = join(skillVersionDir(cacheDir, id, revision), "SKILL.md");
	if (!existsSync(file)) return null;
	try {
		return readFileSync(file, "utf8");
	} catch {
		return null;
	}
}

/**
 * Write the instructions of a skill, under the revision it belongs to.
 *
 * The hash of the publication is checked before the body is written: a
 * body that does not match is refused, and the cache keeps the good one
 * it already has.
 */
export function writeCachedSkill(
	cacheDir: string,
	entry: CachedCatalogEntry,
	instructions: string,
): string {
	const directory = skillVersionDir(cacheDir, entry.id, entry.revision);
	const target = join(directory, "SKILL.md");
	if (entry.sha256) {
		const computed = sha256Of(instructions);
		if (computed !== entry.sha256.toLowerCase()) {
			throw new CachePathError(
				`the instructions of the skill "${entry.id}" do not match the hash of the publication`,
			);
		}
	}
	writeFileAtomic(target, instructions);
	return directory;
}

/**
 * Write one supporting file of a skill.
 *
 * The path of the file comes from the graph, so it is checked against
 * the tree of the skill. The hash of the publication is checked against
 * the content that arrived.
 */
export function writeCachedResource(
	cacheDir: string,
	id: string,
	revision: string,
	resourcePath: string,
	content: Uint8Array,
	expectedSha256?: string,
): string {
	const directory = skillVersionDir(cacheDir, id, revision);
	const target = containedPath(directory, resourcePath);
	if (expectedSha256) {
		const computed = sha256Of(content);
		if (computed !== expectedSha256.toLowerCase()) {
			throw new CachePathError(
				`the resource "${resourcePath}" does not match the hash of the publication`,
			);
		}
	}
	writeFileAtomic(target, content);
	return target;
}

/**
 * The size of the cache, in bytes.
 *
 * The budget of the cache is a number of bytes, and this is the number
 * that counts.
 */
export function cacheUsage(cacheDir: string): number {
	if (!existsSync(cacheDir)) return 0;
	let total = 0;
	const walk = (directory: string) => {
		let names: string[];
		try {
			names = readdirSync(directory);
		} catch {
			return;
		}
		for (const name of names) {
			const path = join(directory, name);
			let stats: ReturnType<typeof statSync>;
			try {
				stats = statSync(path);
			} catch {
				continue;
			}
			if (stats.isDirectory()) walk(path);
			else total += stats.size;
		}
	};
	walk(cacheDir);
	return total;
}

/**
 * Remove the cache.
 *
 * Only the tree of the cache is removed: a file outside of it is not
 * touched, and the skills of the machine are not touched.
 */
export function clearCache(cacheDir: string): void {
	rmSync(cacheDir, { recursive: true, force: true });
}
