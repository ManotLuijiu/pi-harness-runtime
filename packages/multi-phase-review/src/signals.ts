/**
 * Review signals.
 *
 * A "review now" signal is any attempt to start a comprehensive review while
 * the implementation is still running. The workflow records the signal and
 * defers the review instead of letting it interrupt the implementation.
 */

import type { ReviewSignal } from "./types.js";

/**
 * Tool names that start a comprehensive review of the change.
 *
 * Task-level checks (a type error of the file that is edited right now, a
 * failing test of that file) are deliberately absent: they belong to the
 * implementation and stay actionable.
 */
export const DEFAULT_REVIEW_TOOL_PATTERNS: string[] = [
	"code-review",
	"code_review",
	"code-reviewer",
	"code_reviewer",
	"differential-review",
	"differential_review",
	"variant-analysis",
	"variant_analysis",
	"fp-check",
	"fp_check",
	"semgrep",
	"codeql",
	"durable-review",
	"durable_review",
	"spec-to-code-compliance",
	"spec_to_code_compliance",
	"security-threat-model",
	"security_threat_model",
	"supply-chain",
	"insecure-defaults",
	"sharp-edges",
	"agentic-actions",
	"audit",
];

/**
 * Command patterns that start a dedicated review runner from a shell.
 *
 * The list is narrow on purpose: a shell command is only a review signal when
 * it runs a review runner, never when it merely mentions one.
 */
export const DEFAULT_REVIEW_COMMAND_PATTERNS: string[] = [
	"code-review",
	"code-reviewer",
	"differential-review",
	"variant-analysis",
	"fp-check",
	"semgrep",
	"codeql",
	"durable-review",
	"security-review",
	"security-reviewer",
];

/** The programs that run another program. */
const LAUNCHERS = new Set([
	"npx",
	"bunx",
	"bun",
	"pnpm",
	"pnpx",
	"yarn",
	"dlx",
	"uvx",
	"pipx",
	"deno",
	"node",
	"python",
	"python3",
]);

/** The words a launcher uses to name the program it runs. */
const LAUNCHER_SUBCOMMANDS = new Set(["run", "x", "dlx", "exec"]);

/** Normalize a name: lower case, spaces and underscores become dashes. */
function normalizeName(name: string): string {
	return (name ?? "")
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/g, "-");
}

/**
 * The candidates of a tool name.
 *
 * A tool is identified by its full name and by the name behind its
 * namespace ("mcp__pi__code-review" is "code-review").
 */
function toolNameCandidates(name: string): string[] {
	const raw = (name ?? "").trim();
	if (!raw) return [];
	const candidates = new Set<string>();
	const add = (value: string): void => {
		const normalized = normalizeName(value);
		if (normalized) candidates.add(normalized);
	};
	add(raw);
	const segments = raw.split(/__|[:/]/).filter(Boolean);
	if (segments.length > 1) add(segments[segments.length - 1]);
	return [...candidates];
}

/**
 * The program a shell segment runs.
 *
 * Only the program matters: a command that mentions a review runner as an
 * argument ("echo code-review") does not run one.
 */
function commandExecutable(segment: string): string {
	const tokens = segment.trim().split(/\s+/).filter(Boolean);
	let index = 0;
	while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index += 1;
	while (
		index < tokens.length &&
		["sudo", "env", "command", "time", "nohup"].includes(tokens[index].toLowerCase())
	) {
		index += 1;
	}
	while (index < tokens.length && tokens[index].startsWith("-")) index += 1;
	let executable = tokens[index] ?? "";
	if (!executable) return "";
	if (LAUNCHERS.has(executable.toLowerCase())) {
		index += 1;
		while (index < tokens.length && tokens[index].startsWith("-")) index += 1;
		if (LAUNCHER_SUBCOMMANDS.has((tokens[index] ?? "").toLowerCase())) index += 1;
		executable = tokens[index] ?? "";
	}
	const name = executable.split("/").pop() ?? "";
	return normalizeName(name.replace(/\.(js|mjs|cjs|ts|sh)$/, ""));
}

/** Read the extra patterns a deployment configured. */
export function parseExtraPatterns(env: NodeJS.ProcessEnv = process.env): string[] {
	const raw = env.PI_TWO_PHASE_REVIEW_TOOLS;
	if (!raw) return [];
	return raw
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
}

/**
 * Does the tool name name a comprehensive review?
 *
 * The name is matched exactly: a tool that only contains the name of a
 * review ("read_audit_log") is ordinary work.
 */
export function isComprehensiveReviewTool(
	toolName: string,
	extraPatterns: string[] = [],
): boolean {
	const candidates = toolNameCandidates(toolName);
	if (candidates.length === 0) return false;
	const patterns = [...DEFAULT_REVIEW_TOOL_PATTERNS, ...extraPatterns].map(normalizeName);
	return candidates.some((candidate) => patterns.includes(candidate));
}

/** Does the shell command run a dedicated review runner? */
export function isReviewCommand(command: string): boolean {
	const text = (command ?? "").toLowerCase();
	if (!text) return false;
	const runners = new Set(DEFAULT_REVIEW_COMMAND_PATTERNS.map(normalizeName));
	const segments = text.split(/(?:\|\||&&|[;\n|])/);
	return segments.some((segment) => {
		const executable = commandExecutable(segment);
		return executable !== "" && runners.has(executable);
	});
}

/** The agent name of a generic dispatch tool, when it has one. */
export function dispatchAgentName(toolName: string, input: unknown): string {
	if (!["subagent", "task", "dispatch_agent"].includes(toolName)) return "";
	const args = (input ?? {}) as Record<string, unknown>;
	const candidates = [args.agent, args.subagent_type, args.agentName, args.role];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
	}
	return "";
}

/** A review request that the harness recognized. */
export interface ReviewInvocation {
	/** The source of the request (tool name, agent name or command). */
	source: string;
	/** The files the request points at (best effort). */
	files: string[];
	/** One short line describing the request. */
	reason: string;
}

const SOURCE_FILE_PATTERN =
	/(?:^|[\s"'`(=])((?:\.{0,2}\/)?(?:[\w.@+-]+\/)*[\w.@+-]+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs))/g;

/** Pull file names out of a tool input (best effort). */
export function extractFiles(toolName: string, input: unknown): string[] {
	const args = (input ?? {}) as Record<string, unknown>;
	const files = new Set<string>();

	const add = (value: unknown): void => {
		if (typeof value === "string" && value.trim()) files.add(value.trim());
	};
	const addList = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const entry of value) add(entry);
			return;
		}
		add(value);
	};

	for (const key of ["files", "paths", "path", "file", "target", "targets", "scope"]) {
		addList(args[key]);
	}

	if (toolName === "bash" && typeof args.command === "string") {
		const matches = args.command.matchAll(SOURCE_FILE_PATTERN);
		for (const match of matches) {
			if (match[1]) files.add(match[1]);
		}
	}

	return [...files].slice(0, 200);
}

/**
 * Recognize a request to start a comprehensive review.
 *
 * Returns `null` when the call is an ordinary task-level check.
 */
export function detectReviewInvocation(
	toolName: string,
	input: unknown,
	extraPatterns: string[] = [],
): ReviewInvocation | null {
	if (isComprehensiveReviewTool(toolName, extraPatterns)) {
		return {
			source: toolName,
			files: extractFiles(toolName, input),
			reason: `a comprehensive review was requested with ${toolName}`,
		};
	}

	const agent = dispatchAgentName(toolName, input);
	if (agent && isComprehensiveReviewTool(agent, extraPatterns)) {
		return {
			source: agent,
			files: extractFiles(toolName, input),
			reason: `a comprehensive review was requested with the ${agent} reviewer`,
		};
	}

	if (toolName === "bash") {
		const command = (input as Record<string, unknown> | null)?.command;
		if (typeof command === "string" && isReviewCommand(command)) {
			return {
				source: "bash",
				files: extractFiles(toolName, input),
				reason: `a review runner was started: ${command.trim().slice(0, 160)}`,
			};
		}
	}

	return null;
}

/**
 * A negation of a review request.
 *
 * The negation is read per sentence, so "do not review yet" does not silence
 * a later "please review the diff".
 */
const NEGATED_REVIEW =
	/\b(?:do not|don'?t|does not|doesn'?t|no|without|skip|avoid|postpone|defer|later|not yet|never)\b[^.!?\n]{0,40}\b(?:review|audit)\b/i;

/** The ways a human asks for a review. */
const AFFIRMATIVE_REVIEW: RegExp[] = [
	/\b(?:please\s+)?(?:run|do|perform|start|begin|execute|launch|carry out|give)\s+(?:a\s+|an\s+|the\s+)?(?:comprehensive\s+|full\s+|complete\s+|code\s+|security\s+)?(?:review|audit)\b/i,
	/\b(?:can|could|would|will|shall)\s+you\s+(?:please\s+)?(?:review|audit)\b/i,
	/\b(?:review|audit)\s+(?:the|this|that|my|our|it|everything|all|each)\b/i,
	/^\s*(?:please\s+)?(?:review|audit)\b/i,
	/\b(?:review|audit)\s+(?:now|again)\b/i,
];

/**
 * Did the human ask for a review explicitly?
 *
 * The phase order never overrides the intent of the user: an explicit request
 * runs the review now. A sentence that talks about a review without asking
 * for one is not a request.
 */
export function explicitReviewRequest(message: string): boolean {
	if (!message) return false;
	const sentences = message.split(/(?<=[.!?])\s+/);
	return sentences.some((sentence) => {
		if (NEGATED_REVIEW.test(sentence)) return false;
		return AFFIRMATIVE_REVIEW.some((pattern) => pattern.test(sentence));
	});
}

/** The identity of a signal: the same signal is never recorded twice. */
export function signalKey(signal: ReviewSignal): string {
	const files = [...signal.files].sort().join(",");
	return `${signal.source}::${files}::${signal.reason.trim().toLowerCase()}`;
}

/** Add a signal, ignoring an identical one. */
export function mergeSignals(
	signals: ReviewSignal[],
	signal: ReviewSignal,
	limit = 50,
): ReviewSignal[] {
	const key = signalKey(signal);
	if (signals.some((entry) => signalKey(entry) === key)) return signals;
	const next = [...signals, signal];
	return next.length > limit ? next.slice(next.length - limit) : next;
}

/** The merged view of every recorded signal. */
export interface SignalSummary {
	sources: string[];
	files: string[];
	reason: string;
}

/** Merge the recorded signals into one scope. */
export function summarizeSignals(signals: ReviewSignal[]): SignalSummary {
	const sources = [...new Set(signals.map((signal) => signal.source))];
	const files = [...new Set(signals.flatMap((signal) => signal.files))];
	const reason = [...new Set(signals.map((signal) => signal.reason.trim()).filter(Boolean))].join(
		"; ",
	);
	return { sources, files, reason };
}
