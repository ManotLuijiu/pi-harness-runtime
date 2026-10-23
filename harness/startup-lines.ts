/**
 * Rendering of the startup summary lines.
 *
 * The startup widget renders one line per service and the fix instructions
 * below it. A fix instruction is usually a shell command that creates a key
 * file - and such a command is longer than a narrow terminal can show.
 *
 * A truncated command is worse than no command: the user copies a broken
 * path. A command that does not fit is therefore split into several lines -
 * the directory to change to, the command itself and, when even that does
 * not fit, the redirect on a line of its own (with a backslash continuation,
 * so the shell still runs it as one command).
 *
 * A command is NEVER cut off. Prose (a hint, "Then reload Pi.") may be
 * truncated - unless it carries a path or an instruction: a path is put on a
 * line of its own and never cut, and a sentence that does not fit is split
 * at its separator (" - ", ", ") so that the actionable part survives.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/**
 * Render the detail lines of one startup message.
 *
 * @param detail The detail text - a shell command or a prose line.
 * @param indent The tree indent the detail belongs under (e.g. "│  ").
 * @param width The available terminal width.
 */
export function renderDetailLines(detail: string, indent: string, width: number): string[] {
	// Only the shell commands are prefixed with "Fix:" - a prose detail
	// ("Then reload Pi.") must not read like a command.
	const isCommand = detail.startsWith("echo ");
	const prefix = isCommand ? "Fix: " : "";
	const line = `${indent} ${prefix}${detail}`;
	if (visibleWidth(line) <= width) {
		return [truncateToWidth(line, width)];
	}
	if (!isCommand) {
		return renderProse(detail, indent, width);
	}

	// The note ("# the file exists but is empty") is not part of the command.
	const noteIndex = detail.indexOf("   # ");
	const note = noteIndex >= 0 ? detail.slice(noteIndex).trim() : "";
	const command = noteIndex >= 0 ? detail.slice(0, noteIndex).trimEnd() : detail;
	const match = /^echo "(.*)" > (\S+)$/.exec(command);
	if (!match) {
		// Not a command we can split - show it truncated.
		return [truncateToWidth(line, width)];
	}

	const placeholder = match[1];
	const path = match[2];
	const slash = path.lastIndexOf("/");
	const dir = slash >= 0 ? path.slice(0, slash) : ".";

	// The variants, from the shortest to the longest. The first one that
	// fits into the terminal wins; the last one is printed untruncated when
	// even that does not fit - a command must never be cut in the middle.
	// `mkdir -p` makes the split safe: without it a missing directory would
	// let the redirect create the file in the current working directory.
	// The redirect keeps the full path - no `cd` - so pasting the command
	// does not change the working directory of the user's shell.
	const variants: string[][] = [
		[
			`${indent} Fix: mkdir -p ${dir}`,
			`${indent}      echo "${placeholder}" > ${path}`,
		],
		[
			`${indent} Fix: mkdir -p ${dir}`,
			`${indent}      echo "${placeholder}" \\`,
			`${indent}        > ${path}`,
		],
	];
	const fits = (lines: string[]) => lines.every((entry) => visibleWidth(entry) <= width);
	const chosen = variants.find(fits) ?? variants[variants.length - 1];
	const lines = [...chosen];
	// The note goes on its own line - appended to the command it would be
	// cut off in a narrow terminal.
	if (note) {
		lines.push(...renderNote(note, indent, width));
	}
	return lines;
}

/**
 * Render a prose detail.
 *
 * The actionable part of a prose line must survive a narrow terminal: a path
 * (e.g. "Configure LINE in ~/.pi-harness-runtime/keys/, then reload Pi.")
 * goes onto a line of its own and is never cut, and a sentence that does not
 * fit is split at a separator so that the instruction ("then reload Pi.")
 * is not lost.
 */
function renderProse(detail: string, indent: string, width: number): string[] {
	// A path anywhere in the prose goes onto a line of its own - never cut.
	const pathMatch = /(\S*\/\S*)/.exec(detail);
	if (pathMatch && pathMatch.index > 0) {
		const raw = pathMatch[1];
		// The path must be copyable - trailing punctuation belongs to the
		// sentence, not to the path.
		const path = raw.replace(/[,.;:)]+$/, "");
		const head = detail.slice(0, pathMatch.index).trim();
		const tail = detail.slice(pathMatch.index + raw.length).trim();
		const lines: string[] = [];
		if (head) lines.push(...splitProse(head, indent, width));
		lines.push(`${indent}      ${path}`);
		if (tail) lines.push(...splitProse(tail, indent, width));
		return lines;
	}
	return splitProse(detail, indent, width);
}

/**
 * Split a prose text that does not fit into the terminal.
 *
 * The split happens at a separator (" - ", " or ", " (", ", ") so that both
 * halves keep their meaning - the actionable half (a file name, an
 * environment variable, "then reload Pi.") is never lost. A part that still
 * does not fit is split again.
 */
function splitProse(text: string, indent: string, width: number): string[] {
	const line = `${indent} ${text}`;
	if (visibleWidth(line) <= width) return [truncateToWidth(line, width)];
	for (const separator of [" - ", " or ", " (", ", "]) {
		const index = text.lastIndexOf(separator);
		if (index <= 0) continue;
		const head = text.slice(0, index).trim().replace(/[(\s]+$/, "");
		const tail = text.slice(index + separator.length).trim().replace(/^[),;:\s]+/, "");
		if (!head || !tail) continue;
		return [...splitProse(head, indent, width), ...splitProse(tail, indent, width)];
	}
	// Last resort: wrap at a word boundary so that no word is cut in half.
	const words = text.split(/\s+/).filter(Boolean);
	let wrapped = "";
	let offset = 0;
	for (const word of words) {
		const candidate = wrapped ? `${wrapped} ${word}` : word;
		if (wrapped && visibleWidth(`${indent} ${candidate}`) > width) break;
		const start = text.indexOf(word, offset);
		if (start < 0) break;
		wrapped = candidate;
		offset = start + word.length;
	}
	if (wrapped && wrapped !== text) {
		const rest = text.slice(offset).trim();
		return [...splitProse(wrapped, indent, width), ...splitProse(rest, indent, width)];
	}
	return [truncateToWidth(line, width)];
}

/**
 * Render the note of a command ("# the file exists but is empty - the command
 * replaces it"). The note warns that a working credential is overwritten -
 * that warning must survive a narrow terminal.
 */
function renderNote(note: string, indent: string, width: number): string[] {
	const line = `${indent}      ${note}`;
	if (visibleWidth(line) <= width) return [line];
	const index = note.indexOf(" - ");
	if (index > 0) {
		return [
			truncateToWidth(`${indent}      ${note.slice(0, index)}`, width),
			truncateToWidth(`${indent}      ${note.slice(index + 3)}`, width),
		];
	}
	return [truncateToWidth(line, width)];
}
