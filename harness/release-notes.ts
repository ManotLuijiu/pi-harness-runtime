/**
 * The release notes of the runtime, in the shape the native host reads them.
 *
 * The host of Pi 1.6.1 shows the notes of an installed package under its
 * native Extension Updates section. It reads the changelog of the package
 * itself: an entry starts at a line that begins with `## ` and the version of
 * the entry is read from that heading. A patch release of this repository was
 * written with `### ` by the conventionalcommits preset of standard-version,
 * so the host never saw a patch release at all.
 *
 * The rules of this module:
 *
 * - the version heading of an entry is always `## `, so the native parser
 *   reads every release of the runtime;
 * - the content of an entry and its comparison links are never rewritten;
 * - the notes are never shown twice: the host keeps the last version it saw
 *   in its own settings, this repository keeps no second version store and
 *   sends no second notification.
 */

/** The prefix of a heading that the native parser reads as a version entry. */
export const NATIVE_ENTRY_HEADING = "## ";

/** The heading of a version entry, as the native parser reads it. */
export interface ReleaseNoteEntry {
	/** The version of the entry, for example "1.1.532". */
	version: string;
	major: number;
	minor: number;
	patch: number;
	/** The heading line of the entry. */
	heading: string;
	/** The heading and the sections of the entry. */
	content: string;
}

/**
 * A line that names a version: the heading of a release.
 *
 * The native parser accepts `## [1.1.532]`, `## 1.1.532` and `### [1.1.532]`
 * for the version, but only a line that begins with `## ` starts an entry.
 */
const VERSION_HEADING = /^(\s*)(#{2,6})(\s.*)$/;

/** The version that a heading names. */
const HEADING_VERSION = /^\s*\[?v?(\d+)\.(\d+)\.(\d+)\]?/;

/** The version of a release, as the native parser reads it. */
const NATIVE_VERSION = /##\s+\[?(\d+)\.(\d+)\.(\d+)\]?/;

/**
 * The entries of a changelog, the way the native parser reads them.
 *
 * An entry starts at a line that begins with `## `; a heading without a
 * parsable version ends the current entry. The entries keep the order of the
 * file (the newest first).
 *
 * @param markdown The content of a changelog.
 */
export function parseReleaseNotes(markdown: string): ReleaseNoteEntry[] {
	const entries: ReleaseNoteEntry[] = [];
	const lines = markdown.split("\n");
	let current: { version: string; major: number; minor: number; patch: number; heading: string } | null = null;
	let content: string[] = [];

	const flush = (): void => {
		if (current && content.length > 0) {
			entries.push({ ...current, content: content.join("\n").trim() });
		}
	};

	for (const line of lines) {
		if (line.startsWith(NATIVE_ENTRY_HEADING)) {
			flush();
			const match = line.match(NATIVE_VERSION);
			if (!match) {
				current = null;
				content = [];
				continue;
			}
			current = {
				version: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
				major: Number(match[1]),
				minor: Number(match[2]),
				patch: Number(match[3]),
				heading: line,
			};
			content = [line];
			continue;
		}
		if (current) content.push(line);
	}
	flush();
	return entries;
}

/**
 * The result of a normalization of the headings.
 */
export interface NormalizedReleaseNotes {
	/** The changelog with every version heading at the level the host reads. */
	markdown: string;
	/** The number of the headings that changed. */
	changed: number;
}

/**
 * Give every version heading the level the native parser reads.
 *
 * Only the heading of a release changes: the level of the section headings
 * (`### Features`) stays, so the content of an entry and its comparison links
 * are preserved exactly. The function is idempotent.
 *
 * @param markdown The content of a changelog.
 */
export function normalizeReleaseNoteHeadings(markdown: string): NormalizedReleaseNotes {
	const lines = markdown.split("\n");
	let changed = 0;
	const normalized = lines.map((line) => {
		const match = line.match(VERSION_HEADING);
		if (!match) return line;
		const [, indent, hashes, rest] = match;
		if (hashes === "##") return line;
		if (!HEADING_VERSION.test(rest)) return line;
		changed += 1;
		// Only the level of the heading changes: the link of the version and
		// the date of the release stay exactly as they were written.
		return `${indent}##${rest}`;
	});
	return { markdown: normalized.join("\n"), changed };
}

/**
 * The entries that are newer than a version.
 *
 * The comparison is the one of the native parser: major, minor and patch are
 * compared as numbers, so 1.1.10 is newer than 1.1.9. A version that cannot be
 * read means that no entry is newer - the host then shows nothing and records
 * the current version.
 *
 * @param markdown The content of a changelog.
 * @param lastVersion The version the host has seen, if any.
 */
export function newerReleaseNotes(markdown: string, lastVersion?: string): ReleaseNoteEntry[] {
	const entries = parseReleaseNotes(markdown);
	if (!lastVersion) return [];
	const parts = lastVersion.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
	if (!parts) return [];
	const last = { major: Number(parts[1]), minor: Number(parts[2]), patch: Number(parts[3]) };
	return entries.filter((entry) => {
		if (entry.major !== last.major) return entry.major > last.major;
		if (entry.minor !== last.minor) return entry.minor > last.minor;
		return entry.patch > last.patch;
	});
}

/**
 * The notes of a release, the way the host renders them.
 *
 * The host puts the name of the package in front of the heading of the entry,
 * so the reader knows which package the notes belong to.
 *
 * @param markdown The content of a changelog.
 * @param packageName The name of the package, as the host reads it.
 * @param lastVersion The version the host has seen, if any.
 */
export function renderReleaseNotes(
	markdown: string,
	packageName: string,
	lastVersion?: string,
): string {
	return newerReleaseNotes(markdown, lastVersion)
		.map((entry) => entry.content.replace(/^##\s+/, `## ${packageName} `))
		.join("\n\n")
		.trim();
}
