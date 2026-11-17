/**
 * The observation of the read and search tools.
 *
 * The guard watches the tools the agent uses while it investigates. It
 * observes what the tool reported, not what the agent said it read: a tool
 * that failed read nothing, and a tool that was not recognised says nothing
 * about the coverage of any file.
 *
 * The shell is treated with care. A command that is clearly a read is
 * tracked; a command that is not recognised is unknown. The text of a
 * command is never executed to find out what it does.
 */

import type {
	InspectedRange,
	ObservationKind,
	ObservationSource,
} from "./types.js";

/**
 * What the guard learned from one tool call.
 */
export interface Observation {
	/** The kind of the observation. */
	kind: ObservationKind;
	/** How well the source of the observation is known. */
	source: ObservationSource;
	/** The tool that produced it. */
	toolName: string;
	/** The path of the file, when the tool named one. */
	path?: string;
	/** The range that was inspected, when the tool named one. */
	range?: InspectedRange;
	/** The query of a search. */
	query?: string;
	/** The scope of a search. */
	scope?: string;
	/** The size of the returned content, in bytes, when it was observed. */
	observedBytes?: number;
	/** True when the tool failed. */
	failed: boolean;
	/** True when the result was cut short. */
	truncated: boolean;
	/**
	 * True when the observation counts as a read of a file.
	 *
	 * A search is not a read, and a tool the guard does not know says
	 * nothing about the reading of a file.
	 */
	countsAsRead: boolean;
	/** How long the tool took, in milliseconds. */
	durationMs?: number;
}

/**
 * The input of a tool call, as far as the guard reads it.
 */
export interface ToolCallInput {
	toolName: string;
	input?: unknown;
}

/**
 * The end of a tool call, as far as the guard reads it.
 */
export interface ToolCallEnd {
	toolName: string;
	isError?: boolean;
	result?: unknown;
	durationMs?: number;
}

/**
 * The result of a tool, as far as the guard reads it.
 */
interface ResultShape {
	content?: unknown;
	truncated?: boolean;
	outputBytes?: number;
	totalBytes?: number;
	outputLines?: number;
	totalLines?: number;
	details?: {
		truncation?: {
			truncated?: boolean;
			outputBytes?: number;
			outputLines?: number;
			totalLines?: number;
		};
	};
}

/**
 * The text of a result.
 *
 * Pi returns the content of a tool as a plain text or as an array of
 * blocks. A block that carries text contributes its text, and a block that
 * carries something else contributes nothing: the size of a block that is
 * not text is not the size of the reading.
 */
function resultText(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return undefined;
	const parts: string[] = [];
	for (const block of value) {
		if (typeof block === "string") {
			parts.push(block);
			continue;
		}
		if (!block || typeof block !== "object") continue;
		const candidate = block as {
			text?: unknown;
			content?: unknown;
		};
		if (typeof candidate.text === "string") {
			parts.push(candidate.text);
			continue;
		}
		if (typeof candidate.content === "string") {
			parts.push(candidate.content);
		}
	}
	return parts.length > 0 ? parts.join("\n") : undefined;
}

/**
 * The number of characters of a result, when it carries text.
 */
function contentLength(value: unknown): number | undefined {
	const text = resultText(value);
	return text === undefined ? undefined : Buffer.byteLength(text, "utf8");
}

/**
 * What the result says about the size and the truncation.
 *
 * The size of a result is what the agent paid for, so it is the number that
 * the cost estimate is based on.
 */
function readResultShape(result: unknown): {
	observedBytes?: number;
	truncated: boolean;
} {
	if (!result || typeof result !== "object") {
		const length = contentLength(result);
		return { observedBytes: length, truncated: false };
	}
	const shape = result as ResultShape;
	const truncation = shape.details?.truncation;
	const truncated = shape.truncated === true || truncation?.truncated === true;
	// The size of the result is what the agent paid for, so the size that
	// came back is measured and not the size of the whole file.
	const observedBytes =
		shape.outputBytes ??
		truncation?.outputBytes ??
		contentLength(shape.content) ??
		shape.totalBytes;
	return {
		observedBytes,
		truncated,
	};
}

/**
 * The lines of a result.
 */
interface LineCounts {
	/** The lines that came back. */
	observed?: number;
	/** The lines of the whole file, when the source reported them. */
	total?: number;
}

/**
 * The lines of a result, when it is a text.
 *
 * The number of lines says whether the result covered the range that was
 * asked for. Pi reports the lines that came back under the truncation of
 * the result, and the lines of the whole file beside them.
 */
function countLines(result: unknown): LineCounts {
	if (typeof result === "string") {
		const lines = result.split("\n").length;
		return { observed: lines, total: lines };
	}
	if (!result || typeof result !== "object") return {};
	const shape = result as ResultShape;
	const truncation = shape.details?.truncation;
	const observed = shape.outputLines ?? truncation?.outputLines;
	const total = shape.totalLines ?? truncation?.totalLines;
	if (observed !== undefined) return { observed, total: total ?? observed };
	const text = resultText(shape.content);
	if (text !== undefined) {
		const lines = text.split("\n").length;
		return { observed: lines, total: total ?? lines };
	}
	return { total };
}

/**
 * The input of a tool call, parsed into the fields the guard reads.
 *
 * The input arrives as an unknown value, so it is decoded here once and the
 * rest of the module works with the named fields.
 */
interface ParsedToolInput {
	path?: string;
	pattern?: string;
	command?: string;
	offset?: number;
	limit?: number;
}

/**
 * Decode the input of a tool call.
 *
 * A field that is not of the expected shape is absent: a malformed input
 * describes no file, so the guard must not guess one.
 */
function parseToolInput(input: unknown): ParsedToolInput {
	if (!input || typeof input !== "object") return {};
	const raw = input as Record<string, unknown>;
	const parsed: ParsedToolInput = {};

	const path = raw.path;
	if (typeof path === "string" && path.trim().length > 0) {
		parsed.path = path.trim();
	}
	const pattern = raw.pattern;
	if (typeof pattern === "string") parsed.pattern = pattern;
	const command = raw.command;
	if (typeof command === "string") parsed.command = command;

	const offset = raw.offset;
	if (typeof offset === "number" && Number.isFinite(offset)) {
		parsed.offset = offset;
	}
	const limit = raw.limit;
	if (typeof limit === "number" && Number.isFinite(limit)) {
		parsed.limit = limit;
	}
	return parsed;
}

/**
 * The range a read covered.
 *
 * A read without an offset starts at the first line. A read with a limit
 * covers the lines it returned, and a read that was truncated covers only
 * the part that came back: the rest of the file is not known.
 */
function readRange(
	input: ParsedToolInput,
	lines: LineCounts,
	truncated: boolean,
): InspectedRange | undefined {
	const start = input.offset !== undefined && input.offset > 0 ? input.offset : 1;
	const requested =
		input.limit !== undefined && input.limit > 0 ? input.limit : undefined;

	if (truncated) {
		// Only the lines that came back were seen: the rest of the range
		// was asked for and never delivered.
		if (lines.observed !== undefined && lines.observed > 0) {
			const seen =
				requested !== undefined
					? Math.min(requested, lines.observed)
					: lines.observed;
			return { start, end: start + seen - 1, truncated };
		}
		// The number of lines is unknown, so the coverage of the rest is
		// unknown too.
		return { start, end: start, truncated };
	}

	if (requested !== undefined) {
		return { start, end: start + requested - 1, truncated };
	}
	const whole = lines.observed ?? lines.total;
	if (whole !== undefined && whole > 0) {
		return { start, end: start + whole - 1, truncated };
	}
	return { start, end: start, truncated };
}

/**
 * The commands that are clearly a read of a file.
 *
 * The list is short on purpose. A command that is not in the list is
 * unknown, and an unknown command says nothing about the coverage of a
 * file.
 */
const SHELL_READ_PATTERNS: RegExp[] = [
	/^cat\s+(?:-[A-Za-z]+\s+)*(?<path>[^\s|;&]+)/,
	/^head\s+(?:-[A-Za-z]+\s+)*(?<path>[^\s|;&]+)/,
	/^tail\s+(?:-[A-Za-z]+\s+)*(?<path>[^\s|;&]+)/,
	/^less\s+(?:-[A-Za-z]+\s+)*(?<path>[^\s|;&]+)/,
	/^wc\s+(?:-[A-Za-z]+\s+)*(?<path>[^\s|;&]+)/,
];

/**
 * The commands that are clearly a search.
 */
const SHELL_SEARCH_PATTERNS: RegExp[] = [
	/^grep\s+(?:-[A-Za-z]+\s+)*(?<pattern>[^\s|;&]+)/,
	/^rg\s+(?:-[A-Za-z]+\s+)*(?<pattern>[^\s|;&]+)/,
	/^ag\s+(?:-[A-Za-z]+\s+)*(?<pattern>[^\s|;&]+)/,
];

/**
 * A command that only reads the tree.
 */
const SHELL_LIST_PATTERN = /^ls\s+(?:-[A-Za-z]+\s+)*(?<path>[^\s|;&]+)?$/;

/**
 * What the shell command is understood to be.
 *
 * The text of the command is only read, never run. A command that the
 * patterns do not recognise is unknown.
 */
export interface ShellCommandReading {
	kind: ObservationKind | "unknown";
	path?: string;
	query?: string;
}

/**
 * Recognise a shell command that reads.
 *
 * A command with a chain, a redirection or a substitution is unknown: the
 * parts after the first command are not inspected, so the reading of the
 * first command would be wrong.
 */
export function classifyShellCommand(command: string): ShellCommandReading {
	const trimmed = command.trim();
	if (!trimmed) return { kind: "unknown" };
	// A command that pipes, chains or redirects is more than one command,
	// and only the first part is understood here.
	if (/[|;&><]|\$\(|`/.test(trimmed)) return { kind: "unknown" };

	for (const pattern of SHELL_READ_PATTERNS) {
		const match = pattern.exec(trimmed);
		const path = match?.groups?.path;
		if (path) return { kind: "shell-read", path };
	}
	for (const pattern of SHELL_SEARCH_PATTERNS) {
		const match = pattern.exec(trimmed);
		const query = match?.groups?.pattern;
		if (query) return { kind: "search", query };
	}
	const list = SHELL_LIST_PATTERN.exec(trimmed);
	if (list) {
		const path = list.groups?.path;
		return path ? { kind: "shell-read", path } : { kind: "unknown" };
	}
	return { kind: "unknown" };
}

/**
 * The observation of one tool call and its result.
 *
 * A failed call observes nothing: the file was not read.
 */
export function observeToolCall(
	call: ToolCallInput,
	end?: ToolCallEnd,
): Observation | undefined {
	const toolName = call.toolName;
	const input = parseToolInput(call.input);
	if (toolName === "read") {
		const shape = end ? readResultShape(end.result) : { truncated: false };
		const failed = end?.isError === true;
		const lines = end ? countLines(end.result) : {};
		return {
			kind: "read",
			source: "known",
			toolName,
			path: input.path,
			range: failed
				? undefined
				: readRange(input, lines, shape.truncated),
			observedBytes: shape.observedBytes,
			failed,
			truncated: shape.truncated,
			countsAsRead: true,
			durationMs: end?.durationMs,
		};
	}
	if (toolName === "grep" || toolName === "find") {
		const shape = end ? readResultShape(end.result) : { truncated: false };
		const failed = end?.isError === true;
		return {
			kind: "search",
			source: "known",
			toolName,
			query: input.pattern,
			scope: input.path,
			observedBytes: shape.observedBytes,
			failed,
			truncated: shape.truncated,
			// A search is not a read of a file.
			countsAsRead: false,
			durationMs: end?.durationMs,
		};
	}
	if (toolName === "bash") {
		const reading = classifyShellCommand(input.command ?? "");
		const shape = end ? readResultShape(end.result) : { truncated: false };
		return {
			kind: reading.kind === "unknown" ? "shell-read" : reading.kind,
			source: reading.kind === "unknown" ? "unknown" : "known",
			toolName,
			path: reading.path,
			query: reading.query,
			scope: reading.path,
			observedBytes: shape.observedBytes,
			failed: end?.isError === true,
			truncated: shape.truncated,
			// A command that was not recognised reads no known file.
			countsAsRead: reading.kind === "shell-read",
			durationMs: end?.durationMs,
		};
	}
	// A tool the guard does not know: the coverage of nothing is known.
	return {
		kind: "shell-read",
		source: "unknown",
		toolName,
		failed: end?.isError === true,
		truncated: false,
		// An edit, a write and every other tool the guard does not know
		// read no file.
		countsAsRead: false,
		durationMs: end?.durationMs,
	};
}
