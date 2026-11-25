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
 *
 * The path of the graph is untrusted, and so is the machine that holds
 * the cache. A link inside the cache must never become a way out of it:
 * every component of a path is checked with lstat before it is used, the
 * real path of the tree is the boundary, and a file is created without
 * following a link. The check of the path is not a check of the spelling
 * of the path - it is a check of the machine.
 */

import {
	closeSync,
	constants,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** One entry of the catalog that is cached. */
export interface CachedCatalogEntry {
	/** The id of the skill. */
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
 * The state of a path of the machine.
 */
function lstatOrUndefined(path: string): ReturnType<typeof lstatSync> | undefined {
	try {
		return lstatSync(path);
	} catch {
		return undefined;
	}
}

/**
 * The real path of the tree that holds the cache.
 *
 * The tree is created when it is not there, and its real path is the
 * boundary: every file of the cache is inside it, and the check is made
 * against the machine and not against the spelling of a path.
 */
export function realRootOf(root: string): string {
	mkdirSync(root, { recursive: true, mode: 0o700 });
	try {
		return realpathSync(root);
	} catch {
		return resolve(root);
	}
}

/**
 * Check that no component of a path is a link.
 *
 * A link inside the cache is a way out of the cache: the path looks
 * local and lands somewhere else. Every component that exists is
 * therefore read with lstat, and a link is refused.
 */
function assertNoLink(root: string, relativePath: string): void {
	let current = root;
	for (const part of relativePath.split("/").filter(Boolean)) {
		current = join(current, part);
		const state = lstatOrUndefined(current);
		// A component that does not exist yet cannot be a link.
		if (!state) return;
		if (state.isSymbolicLink()) {
			throw new CachePathError(
				`the path "${relativePath}" of the cache goes through a link ("${part}")`,
			);
		}
	}
}

/**
 * The path of a resource inside a tree.
 *
 * The path of a resource comes from the graph, so it is untrusted. An
 * absolute path, a path with a ".." in it, or a path that leaves the
 * tree after it is resolved, is refused. A path that leaves the tree
 * through a link is refused as well.
 */
export function containedPath(root: string, relativePath: string): string {
	const rootPath = realRootOf(root);
	const cleaned = containedRelative("", relativePath);
	// The links of the machine are checked before the path is used: a
	// spelling that stays inside the tree may still land outside it.
	assertNoLink(rootPath, cleaned);
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
 * The path of a resource inside a tree that is named relatively.
 *
 * The tree of the cache is the only boundary of a write, so the path of
 * a resource is joined to it and never resolved on its own: a tree that
 * is a link cannot become the way out of the cache.
 *
 * @param rootRelative The tree, relative to the cache.
 * @param relativePath The path of the resource inside the tree.
 */
export function containedRelative(
	rootRelative: string,
	relativePath: string,
): string {
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
	return rootRelative ? `${rootRelative}/${cleaned}` : cleaned;
}

/**
 * Write a file atomically, inside a tree.
 *
 * The file is written next to its place and renamed into it, so a
 * reader never sees a half-written file, and an interrupted write never
 * replaces a good file with a broken one.
 *
 * The temporary file is created without following a link, and the
 * components of the path are checked again after the directories were
 * made: a link that was put in place while the write ran must not
 * become the destination of the write.
 *
 * @param root The tree the file belongs to.
 * @param relativePath The path of the file inside the tree.
 * @param content The bytes of the file.
 */
export function writeFileAtomic(
	root: string,
	relativePath: string,
	content: string | Uint8Array,
): string {
	const rootPath = realRootOf(root);
	const cleaned = relativePath.trim().replace(/\\/g, "/");
	if (!cleaned) throw new CachePathError("the file has no path");
	if (isAbsolute(cleaned) || cleaned.startsWith("/")) {
		throw new CachePathError("the file has an absolute path");
	}
	if (cleaned.split("/").some((part) => part === "..")) {
		throw new CachePathError("the file leaves the tree of the cache");
	}
	assertNoLink(rootPath, cleaned);
	const target = resolve(rootPath, cleaned);
	const relation = relative(rootPath, target);
	if (relation.startsWith("..") || relation.startsWith(`..${sep}`)) {
		throw new CachePathError("the file leaves the tree of the cache");
	}
	mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
	// The directories were just made: the chain is checked again, so a
	// link that appeared in the meantime is refused.
	assertNoLink(rootPath, cleaned);
	const temporary = join(
		dirname(target),
		`.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
	);
	let handle: number | undefined;
	try {
		handle = openSync(
			temporary,
			constants.O_WRONLY |
				constants.O_CREAT |
				constants.O_EXCL |
				constants.O_NOFOLLOW,
			0o600,
		);
		if (typeof content === "string") {
			writeSync(handle, content);
		} else {
			writeSync(handle, content);
		}
		closeSync(handle);
		handle = undefined;
		renameSync(temporary, target);
	} catch (error) {
		if (handle !== undefined) {
			try {
				closeSync(handle);
			} catch {
				// The handle is already closed.
			}
		}
		try {
			rmSync(temporary, { force: true });
		} catch {
			// The temporary file is already gone.
		}
		throw error;
	}
	return target;
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
	writeFileAtomic(cacheDir, CATALOG_FILE, `${JSON.stringify({ entries }, null, 2)}\n`);
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
 * A value of the frontmatter of a stub, quoted.
 *
 * The name and the description come from the graph, so they are not
 * trusted to be a valid YAML value. A name with a colon, a quote or a
 * newline would break the frontmatter and the stub would not be read at
 * all - or it would hold something else.
 */
export function yamlValue(value: string): string {
	const flattened = value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
	return `"${flattened.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * A name of a skill that pi can read.
 *
 * The name of a skill is a name of a directory and a key of the front
 * matter: it may not hold a space, a colon or an upper case letter.
 * The name of the graph is used when it fits, and the id otherwise.
 *
 * The rules are the rules of the reader of pi: a name holds only lower
 * case letters, digits and single hyphens, and it is at most 64
 * characters long. A name that breaks them is read with a warning, and
 * it may collide with another skill.
 */
export function skillNameOf(entry: CachedCatalogEntry): string {
	const candidate = entry.name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
	const cleaned = candidate.replace(/^-+|-+$/g, "");
	if (cleaned) return cleaned.replace(/-+/g, "-").slice(0, 64).replace(/-+$/, "");
	const fallback = entry.id.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
	return (
		fallback.replace(/^-+|-+$/g, "").replace(/-+/g, "-").slice(0, 64).replace(/-+$/, "") ||
		"remote-skill"
	);
}

/**
 * The names of the skills of a catalog, without a collision.
 *
 * Two skills of the graph may carry the same name. The reader of pi
 * knows them by their name, so the second one gets a name of its own:
 * the name of the skill stays stable, and the name of the stub does not
 * collide with another stub.
 */
function skillNamesOf(
	entries: CachedCatalogEntry[],
): Map<string, string> {
	const names = new Map<string, string>();
	const taken = new Set<string>();
	for (const entry of entries) {
		const base = skillNameOf(entry);
		let name = base;
		if (taken.has(name)) {
			const suffix = createHash("sha256")
				.update(entry.id)
				.digest("hex")
				.slice(0, 6);
			name = `${base}-${suffix}`.slice(0, 64).replace(/-+$/, "");
			let counter = 2;
			while (taken.has(name)) {
				name = `${base}-${counter}`.slice(0, 64).replace(/-+$/, "");
				counter += 1;
			}
		}
		taken.add(name);
		names.set(entry.id, name);
	}
	return names;
}

/**
 * The SKILL.md of a stub.
 *
 * The stub makes pi discover the skill of the graph natively. It holds
 * the id, the revision and the hash, and it tells the model that the
 * real instructions have to be loaded before the skill is used.
 */
export function stubSkillMarkdown(
	entry: CachedCatalogEntry,
	name?: string,
): string {
	const skillName = name ?? skillNameOf(entry);
	const description =
		entry.description.trim() ||
		`The skill "${entry.name}" of the shared graph.`;
	// The reader of pi reads a description of at most 1024 characters. A
	// longer one is cut, and the catalog keeps the whole text.
	const cut = description.slice(0, 1024).trim();
	return `---
name: ${yamlValue(skillName)}
description: ${yamlValue(cut)}
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
	name?: string,
): string {
	// The tree of the cache is the boundary of the write: a stub tree
	// that is a link cannot become the way out of the cache.
	const target = writeFileAtomic(
		cacheDir,
		`${STUB_DIR}/${safeSegment(entry.id)}/SKILL.md`,
		stubSkillMarkdown(entry, name),
	);
	return dirname(target);
}

/**
 * Write every stub of a catalog.
 *
 * The stubs that the catalog does not hold any more are removed, so a
 * skill that was withdrawn is not advertised any more.
 *
 * @param cacheDir The cache of the source.
 * @param entries The catalog.
 * @param advertised How many stubs are written at most. The catalog
 *   keeps every skill; only the discovery is bounded.
 */
export function writeStubs(
	cacheDir: string,
	entries: CachedCatalogEntry[],
	advertised?: number,
): string[] {
	const directory = stubRoot(cacheDir);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const written: string[] = [];
	const keep = new Set<string>();
	const limit =
		typeof advertised === "number" && advertised >= 0
			? advertised
			: entries.length;
	// The names are computed over the whole catalog, so a name does not
	// change when the advertised subset changes.
	const names = skillNamesOf(entries);
	for (const entry of entries.slice(0, limit)) {
		const segment = safeSegment(entry.id);
		keep.add(segment);
		written.push(writeStub(cacheDir, entry, names.get(entry.id)));
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
	const relative = `${SKILL_DIR}/${safeSegment(id)}/${safeSegment(revision)}/SKILL.md`;
	try {
		// The body is only read when no component of its path is a
		// link: a link inside the cache is a way out of it.
		assertNoLink(realRootOf(cacheDir), relative);
	} catch {
		return null;
	}
	const file = join(realRootOf(cacheDir), relative);
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
 * it already has. A publication without a hash is refused as well: a
 * body that cannot be checked may not be used.
 */
export function writeCachedSkill(
	cacheDir: string,
	entry: CachedCatalogEntry,
	instructions: string,
): string {
	if (!isPublicationHash(entry.sha256)) {
		throw new CachePathError(
			`the publication of the skill "${entry.id}" carries no usable hash, so the instructions cannot be checked`,
		);
	}
	const computed = sha256Of(instructions);
	if (computed !== entry.sha256.toLowerCase()) {
		throw new CachePathError(
			`the instructions of the skill "${entry.id}" do not match the hash of the publication`,
		);
	}
	const target = writeFileAtomic(
		cacheDir,
		`${SKILL_DIR}/${safeSegment(entry.id)}/${safeSegment(entry.revision)}/SKILL.md`,
		instructions,
	);
	return dirname(target);
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
	if (expectedSha256 && !isPublicationHash(expectedSha256)) {
		throw new CachePathError(
			`the publication of the file "${resourcePath}" carries no usable hash, so the file cannot be checked`,
		);
	}
	// The file is written inside the tree of the cache, and the path of
	// the file is joined to the tree of its skill: a link on the way is
	// refused, and the file may not leave the skill.
	const relative = containedRelative(
		`${SKILL_DIR}/${safeSegment(id)}/${safeSegment(revision)}`,
		resourcePath,
	);
	if (expectedSha256) {
		const computed = sha256Of(content);
		if (computed !== expectedSha256.toLowerCase()) {
			throw new CachePathError(
				`the resource "${resourcePath}" does not match the hash of the publication`,
			);
		}
	}
	const target = writeFileAtomic(cacheDir, relative, content);
	return target;
}

/**
 * Whether a value is the hash of a publication.
 *
 * A hash is 64 hexadecimal characters. Anything else is not a hash, and
 * a body that cannot be checked is not used.
 */
export function isPublicationHash(value: string | undefined): boolean {
	return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value.trim());
}

/**
 * The size of the cache, in bytes.
 *
 * The budget of the cache is a number of bytes, and this is the number
 * that counts. A link is not followed: the bytes of another tree are
 * not the bytes of this cache.
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
			let state: ReturnType<typeof statSync>;
			try {
				state = lstatSync(path);
			} catch {
				continue;
			}
			if (state.isSymbolicLink()) continue;
			if (state.isDirectory()) walk(path);
			else total += state.size;
		}
	};
	walk(cacheDir);
	return total;
}

/**
 * The versions of the hydrated skills, the oldest first.
 */
function cachedVersions(cacheDir: string): { path: string; modified: number }[] {
	const root = skillRoot(cacheDir);
	if (!existsSync(root)) return [];
	const versions: { path: string; modified: number }[] = [];
	for (const id of safeReadDir(root)) {
		const idPath = join(root, id);
		if (!safeIsDirectory(idPath)) continue;
		for (const revision of safeReadDir(idPath)) {
			const path = join(idPath, revision);
			if (!safeIsDirectory(path)) continue;
			let modified = 0;
			try {
				modified = statSync(path).mtimeMs;
			} catch {
				modified = 0;
			}
			versions.push({ path, modified });
		}
	}
	return versions.sort((a, b) => a.modified - b.modified);
}

/** The names of a directory, or nothing. */
function safeReadDir(directory: string): string[] {
	try {
		return readdirSync(directory);
	} catch {
		return [];
	}
}

/** Whether a path is a directory that is not a link. */
function safeIsDirectory(path: string): boolean {
	const state = lstatOrUndefined(path);
	return Boolean(state && state.isDirectory() && !state.isSymbolicLink());
}

/**
 * Make room for a write in the cache.
 *
 * The budget of the cache is a boundary, not a wish: a write that does
 * not fit is refused. Before the refusal, the oldest versions that are
 * not pinned are removed, so a machine that reads many revisions does
 * not fill its disk.
 *
 * @param cacheDir The cache of the source.
 * @param budget The budget of the cache, in bytes.
 * @param incoming The size of the write, in bytes.
 * @param pinned The path of the version that must not be removed.
 */
export function makeRoomInCache(
	cacheDir: string,
	budget: number,
	incoming: number,
	pinned?: string,
): void {
	if (!Number.isFinite(budget) || budget <= 0) return;
	let usage = cacheUsage(cacheDir);
	if (usage + incoming <= budget) return;
	for (const version of cachedVersions(cacheDir)) {
		if (usage + incoming <= budget) break;
		if (pinned && version.path === pinned) continue;
		rmSync(version.path, { recursive: true, force: true });
		usage = cacheUsage(cacheDir);
	}
	if (usage + incoming > budget) {
		throw new CachePathError(
			`the cache of the graph holds ${usage} bytes and its budget is ${budget} bytes: the write of ${incoming} bytes does not fit`,
		);
	}
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
