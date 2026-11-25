/**
 * The adapter of Claude Code.
 *
 * Claude Code is asked one question and answers it. The consultation is
 * read-only: the worker only gets the tools that read (`Read`, `Glob`,
 * `Grep`), it may not prompt anybody (`--permission-prompts none`), and it
 * may not call the MCP servers of the machine (`--strict-mcp-config`), so
 * it cannot consult the harness again.
 *
 * The flags are the ones of the installed version of Claude Code
 * (2.1.319). They are read from `claude --help` and not from an article
 * about it: a flag that a version does not know is an error, and an error
 * is a failure of the consultation.
 */

import { classifyWorkerFailure, firstLine } from "./diagnose.ts";
import { claudeBridgeArgs, type BridgeConfig } from "./bridge-config.ts";
import type {
	ConsultAdapter,
	ConsultStatus,
	WorkerRun,
} from "./types.ts";

/**
 * The name of the worker.
 */
export const CLAUDE_TARGET = "claude" as const;

/**
 * The binary of the worker.
 *
 * The name is a constant: the caller names the target, never a binary.
 */
export const CLAUDE_BINARY = "claude";

/**
 * The arguments of one consultation.
 *
 * The prompt is read from stdin, so it is never in the process list of the
 * machine.
 */
export const CLAUDE_ARGV = [
	"-p",
	"--output-format",
	"json",
	// Nobody answers a prompt of the worker: a permission that is not
	// given is a permission that is refused.
	"--permission-mode",
	"dontAsk",
	"--permission-prompts",
	"none",
	// The tools of the worker are the ones that read. It may look, and it
	// may not change.
	"--tools",
	"Read,Glob,Grep",
	// The MCP servers of the machine are off: the worker may not call the
	// harness again.
	"--strict-mcp-config",
] as const;

/**
 * The answer of Claude Code.
 *
 * The result of the worker is one JSON object. The answer is its `result`
 * field. A result that reports an error is a failure, and the reason is
 * read from what the worker wrote.
 */
function answerFromResult(stdout: string): {
	answer: string;
	failed: boolean;
	text: string;
} {
	const trimmed = stdout.trim();
	if (trimmed.length === 0) {
		return { answer: "", failed: true, text: "" };
	}
	try {
		const parsed = JSON.parse(trimmed) as Record<string, unknown>;
		const answer =
			typeof parsed.result === "string" ? parsed.result.trim() : "";
		const failed =
			parsed.is_error === true ||
			(typeof parsed.subtype === "string" && parsed.subtype !== "success");
		const errorText = errorTextOf(parsed, failed);
		return { answer, failed, text: errorText };
	} catch {
		return { answer: "", failed: true, text: trimmed };
	}
}

/**
 * The text of the failure of a result.
 *
 * The worker writes its reason in the result: the sign-in of a CLI that
 * is not signed in is the field `result`, and the field `error` of the
 * newer results.
 */
function errorTextOf(
	parsed: Record<string, unknown>,
	failed: boolean,
): string {
	if (typeof parsed.error === "string") return parsed.error;
	if (failed && typeof parsed.result === "string") return parsed.result;
	return "";
}

/**
 * Read the answer of Claude Code.
 */
export function readClaudeAnswer(run: WorkerRun): {
	status: ConsultStatus;
	answer: string;
	diagnostic?: string;
} {
	if (run.spawnError) {
		return {
			status: "failed",
			answer: "",
			diagnostic: `claude could not be started: ${run.spawnError}`,
		};
	}
	if (run.timedOut) {
		return {
			status: "timed-out",
			answer: "",
			diagnostic: "claude did not answer in time",
		};
	}
	if (run.cancelled) {
		return {
			status: "cancelled",
			answer: "",
			diagnostic: "claude was stopped on purpose",
		};
	}
	const result = answerFromResult(run.stdout);
	if (!result.failed && result.answer.length > 0) {
		return { status: "completed", answer: result.answer };
	}
	// The worker wrote something that is not an answer: the reason is in
	// what it wrote. A reason that is understood is named: a worker that
	// is not signed in says so, and the exit code alone hides it.
	const failure = classifyWorkerFailure(`${result.text}\n${run.stderr}`);
	if (failure.status !== "failed") {
		return { status: failure.status, answer: "", diagnostic: failure.diagnostic };
	}
	return {
		status: "failed",
		answer: "",
		diagnostic: firstLine(run.stderr, `claude exited with ${run.exitCode ?? "no code"}`),
	};
}

/**
 * The arguments of a consultation with the reverse bridge.
 *
 * The MCP servers of the machine are off by the other arguments
 * (`--strict-mcp-config`), and the bridge is the one server that is
 * there. The human asks for the bridge by name, with
 * `PI_AGENT_COMMUNICATION_BRIDGE=1`.
 */
export function claudeBridgeArgv(config: BridgeConfig): string[] {
	return [
		"-p",
		"--output-format",
		"json",
		"--permission-mode",
		"dontAsk",
		"--permission-prommts",
		"none",
		"--tools",
		"Read,Glob,Grep",
		...claudeBridgeArgs(config),
		"--strict-mcp-config",
	];
}

/**
 * The adapter of Claude Code.
 */
export function claudeAdapter(
	env: Record<string, string>,
	bridge?: BridgeConfig,
): ConsultAdapter {
	return {
		target: CLAUDE_TARGET,
		binary: CLAUDE_BINARY,
		argv: bridge ? claudeBridgeArgv(bridge) : CLAUDE_ARGV,
		bridgeArgv: claudeBridgeArgv,
		env,
		read: readClaudeAnswer,
	};
}
