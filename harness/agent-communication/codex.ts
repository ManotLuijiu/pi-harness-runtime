/**
 * The adapter of Codex.
 *
 * Codex is asked one question and answers it. The consultation is
 * read-only: the sandbox of the worker is `read-only`, so it may look at
 * the workspace and it may not change it.
 *
 * The flags are the ones of the installed version of Codex (0.167.0). They
 * are read from `codex exec --help` and not from an article about it:
 * a flag that a version does not know is an error, and an error is a
 * failure of the consultation.
 *
 * The MCP servers of the worker are switched off (`mcp_servers={}`): a
 * worker that may call the harness again would consult itself, and the
 * harness owns the hop limit of that recursion.
 */

import { classifyWorkerFailure, firstLine } from "./diagnose.ts";
import type {
	ConsultAdapter,
	ConsultStatus,
	WorkerRun,
} from "./types.ts";

/**
 * The name of the worker.
 */
export const CODEX_TARGET = "codex" as const;

/**
 * The binary of the worker.
 *
 * The name is a constant: the caller names the target, never a binary.
 */
export const CODEX_BINARY = "codex";

/**
 * The arguments of one consultation.
 *
 * The prompt is read from stdin (`-`), so it is never in the process list
 * of the machine.
 */
export const CODEX_ARGV = [
	"exec",
	"--sandbox",
	"read-only",
	"--skip-git-repo-check",
	// The worker may not ask for anything. A measured leak showed that
	// the write of the worker was approved by the automatic reviewer of
	// the user, whatever the sandbox said: the sandbox governs the shell
	// of the worker, and the patch tool of the worker is not the shell.
	// With the approval policy "never" the write is refused by the
	// read-only sandbox, and the reviewer "user" means that nobody
	// answers for the worker in a run without a human.
	"-c",
	'approval_policy="never"',
	"-c",
	'approvals_reviewer="user"',
	// The hooks of the user do not run for the worker.
	"-c",
	"features.hooks=false",
	// The MCP servers of the worker are off: the worker may not call the
	// harness again. The configuration of the user is not ignored: it
	// carries the model, the provider and the trust of the project, and
	// without it the worker cannot read anything in this machine.
	"-c",
	"mcp_servers={}",
	"--json",
	"-",
] as const;

/**
 * The arguments of the consult of Codex when the machine has no sandbox.
 *
 * The tools of the worker need the sandbox of the operating system, and
 * a container does not always give the rights that the sandbox needs. On
 * such a machine the strict arguments make the worker blind: it cannot
 * read anything. The contained arguments let the worker work, and the
 * copy of the workspace is then the boundary. The harness measures the
 * tree itself, so a change is named and not hidden.
 */
export const CODEX_ARGV_CONTAINED = [
	"exec",
	"--sandbox",
	"read-only",
	"--skip-git-repo-check",
	// The hooks of the user do not run for the worker.
	"-c",
	"features.hooks=false",
	// The MCP servers of the worker are off: the worker may not call the
	// harness again.
	"-c",
	"mcp_servers={}",
	"--json",
	"-",
] as const;

/**
 * The events of Codex that carry the answer.
 *
 * The format of the events changed over the versions of Codex, and both
 * shapes are read: an item of type `agent_message` and a message of type
 * `agent_message`. An event that carries neither is not the answer.
 */
function answerFromEvents(stdout: string): string {
	const parts: string[] = [];
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		let event: Record<string, unknown>;
		try {
			event = JSON.parse(trimmed) as Record<string, unknown>;
		} catch {
			continue;
		}
		const item = event.item as Record<string, unknown> | undefined;
		if (item && item.type === "agent_message" && typeof item.text === "string") {
			parts.push(item.text);
			continue;
		}
		const msg = event.msg as Record<string, unknown> | undefined;
		if (msg && msg.type === "agent_message" && typeof msg.message === "string") {
			parts.push(msg.message);
		}
	}
	return parts.join("\n").trim();
}

/**
 * Read the answer of Codex.
 */
export function readCodexAnswer(run: WorkerRun): {
	status: ConsultStatus;
	answer: string;
	diagnostic?: string;
} {
	if (run.spawnError) {
		return {
			status: "failed",
			answer: "",
			diagnostic: `codex could not be started: ${run.spawnError}`,
		};
	}
	if (run.timedOut) {
		return {
			status: "timed-out",
			answer: "",
			diagnostic: "codex did not answer in time",
		};
	}
	if (run.cancelled) {
		return {
			status: "cancelled",
			answer: "",
			diagnostic: "codex was stopped on purpose",
		};
	}
	const answer = answerFromEvents(run.stdout);
	if (run.exitCode === 0 && answer.length > 0) {
		return { status: "completed", answer };
	}
	// The worker wrote something that is not an answer: the reason is in
	// what it wrote. A reason that is understood is named: a worker that
	// is not signed in says so, and the exit code alone hides it.
	const failure = classifyWorkerFailure(`${run.stderr}\n${run.stdout}`);
	if (failure.status !== "failed") {
		return { status: failure.status, answer: "", diagnostic: failure.diagnostic };
	}
	return {
		status: "failed",
		answer: "",
		diagnostic: firstLine(run.stderr, `codex exited with ${run.exitCode ?? "no code"}`),
	};
}

/**
 * The adapter of Codex.
 */
export function codexAdapter(env: Record<string, string>): ConsultAdapter {
	return {
		target: CODEX_TARGET,
		binary: CODEX_BINARY,
		argv: CODEX_ARGV,
		fallbackArgv: CODEX_ARGV_CONTAINED,
		env,
		read: readCodexAnswer,
	};
}
