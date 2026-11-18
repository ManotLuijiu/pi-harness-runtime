/**
 * The consultation of a worker of another vendor.
 *
 * The harness asks Codex or Claude Code a question and gets its answer.
 * The rules that must hold, whatever the worker does:
 *
 * - The question goes to stdin, it is never an argument of the process.
 * - The worker is started without a shell, so a prompt is never a command.
 * - A worker that runs out of time is a timeout, not a failure.
 * - A stopped worker is really stopped, and the job that owned it ends as
 *   cancelled: a stopped worker never answers.
 * - A worker that is not signed in is not a quota problem, and a failure
 *   that nobody understands stays a failure.
 * - One worker per target, two workers in total, and no worker may
 *   consult another worker.
 * - The answer of a worker is data: it never approves anything.
 *
 * The workers of these tests are stand-ins: small programs that behave
 * like the vendored CLIs without a network and without a key.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import { runCli, filteredEnv } from "../harness/agent-communication/cli-runner.ts";
import { CODEX_ARGV, readCodexAnswer } from "../harness/agent-communication/codex.ts";
import { CLAUDE_ARGV } from "../harness/agent-communication/claude.ts";
import { readClaudeAnswer } from "../harness/agent-communication/claude.ts";
import { classifyWorkerFailure } from "../harness/agent-communication/diagnose.ts";
import { AgentCommunicationRuntime } from "../harness/agent-communication/runtime.ts";
import { JobStore } from "../harness/agent-communication/store.ts";
import {
	agentConsultTool,
	agentJobCancelTool,
	agentJobStatusTool,
} from "../harness/agent-communication/tools.ts";
import {
	detectWorker,
	presenceLine,
	resolveBinary,
} from "../harness/agent-communication/detect.ts";
import {
	changesSince,
	snapshotWorkspace,
} from "../harness/agent-communication/workspace-guard.ts";
import { canonicalWorkspace, registerAgentCommunication } from "../harness/agent-communication/registration.ts";
import { writeThroughWorker } from "../harness/agent-communication/write-lane.ts";
import { registerAgentCommunicationTools } from "../harness/agent-communication/tools.ts";

/**
 * A temporary directory that goes away with the test.
 */
function temporary() {
	const dir = mkdtempSync(join(tmpdir(), "agent-communication-"));
	return {
		dir,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

/**
 * A stand-in of a vendored CLI.
 *
 * The program is what the worker would do: it writes to stdout, to
 * stderr, or it waits for ever.
 */
function standIn(dir, name, body) {
	const path = join(dir, name);
	writeFileSync(path, `#!/usr/bin/env node\n${body}\n`, "utf8");
	chmodSync(path, 0o755);
	return path;
}

/**
 * The environment with the stand-ins first.
 */
function pathWith(dir) {
	return { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` };
}

/**
 * The sender of a request.
 */
const SENDER = {
	agentId: "agent-under-test",
	sessionId: "session-under-test",
	generation: 1,
};

/**
 * A runtime with a store in a temporary directory.
 */
function makeRuntime(options = {}) {
	const home = temporary();
	const runtime = new AgentCommunicationRuntime({
		store: new JobStore(home.dir),
		...options,
	});
	return { runtime, home, cleanup: home.cleanup };
}

test("the runner gives the prompt to the worker on stdin", async () => {
	const dir = temporary();
	try {
		const script = standIn(
			dir.dir,
			"echo-stdin",
			`let data = "";
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => { process.stdout.write("GOT:" + data); });`,
		);
		const run = await runCli({
			binary: process.execPath,
			argv: [script],
			cwd: dir.dir,
			stdin: "the question",
			timeoutMs: 10_000,
			env: filteredEnv(process.env),
		});
		assert.equal(run.exitCode, 0);
		assert.equal(run.stdout, "GOT:the question");
	} finally {
		dir.cleanup();
	}
});

test("the runner starts the worker without a shell", async () => {
	const dir = temporary();
	try {
		// The argument looks like a shell command. Without a shell it is
		// only an argument, so nothing runs and no file appears.
		const marker = join(dir.dir, "pwned");
		const script = standIn(
			dir.dir,
			"echo-argv",
			`process.stdout.write(process.argv.slice(2).join("|"));`,
		);
		const run = await runCli({
			binary: process.execPath,
			argv: [script, `; touch ${marker}`],
			cwd: dir.dir,
			timeoutMs: 10_000,
			env: filteredEnv(process.env),
		});
		assert.equal(run.exitCode, 0);
		// The argument reached the worker as a plain argument.
		assert.equal(run.stdout, `; touch ${marker}`);
		assert.equal(existsSync(marker), false);
	} finally {
		dir.cleanup();
	}
});

test("the runner reports a worker that runs out of time as a timeout", async () => {
	const dir = temporary();
	try {
		const script = standIn(
			dir.dir,
			"sleeper",
			`setInterval(() => {}, 1000);`,
		);
		const run = await runCli({
			binary: process.execPath,
			argv: [script],
			cwd: dir.dir,
			timeoutMs: 300,
			killGraceMs: 200,
			env: filteredEnv(process.env),
		});
		assert.equal(run.timedOut, true);
		assert.equal(run.cancelled, false);
	} finally {
		dir.cleanup();
	}
});

test("the runner stops a worker that ignores the first signal", async () => {
	const dir = temporary();
	try {
		const script = standIn(
			dir.dir,
			"stubborn",
			`process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);`,
		);
		const run = await runCli({
			binary: process.execPath,
			argv: [script],
			cwd: dir.dir,
			timeoutMs: 30_000,
			killGraceMs: 200,
			env: filteredEnv(process.env),
			signal: AbortSignal.timeout(300),
		});
		assert.equal(run.cancelled, true);
		// The worker is really gone: the promise settled after the process
		// ended, not before.
		assert.equal(run.signal === "SIGKILL" || run.signal === "SIGTERM", true);
	} finally {
		dir.cleanup();
	}
});

test("the runner cuts the output of a worker that writes for ever", async () => {
	const dir = temporary();
	try {
		const script = standIn(
			dir.dir,
			"talker",
			`const chunk = "x".repeat(4096);
let sent = 0;
const timer = setInterval(() => {
	process.stdout.write(chunk);
	sent += chunk.length;
	if (sent > 200000) { clearInterval(timer); process.exit(0); }
}, 1);`,
		);
		const run = await runCli({
			binary: process.execPath,
			argv: [script],
			cwd: dir.dir,
			timeoutMs: 20_000,
			maxOutputBytes: 8192,
			env: filteredEnv(process.env),
		});
		assert.equal(run.truncated, true);
		assert.ok(run.stdout.length <= 8192);
	} finally {
		dir.cleanup();
	}
});

test("the environment of a worker holds no credential of the harness", () => {
	const env = filteredEnv({
		PATH: "/usr/bin",
		HOME: "/home/frappe",
		PI_LOG_WEBHOOK_TOKEN: "secret",
		ANTHROPIC_API_KEY: "key",
		PI_LOG_R2_SECRET_ACCESS_KEY: "secret",
	});
	assert.equal(env.PATH, "/usr/bin");
	assert.equal(env.HOME, "/home/frappe");
	assert.equal(env.PI_LOG_WEBHOOK_TOKEN, undefined);
	assert.equal(env.PI_LOG_R2_SECRET_ACCESS_KEY, undefined);
});

test("the answer of Codex is read from its events", () => {
	const answer = readCodexAnswer({
		stdout: [
			JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "the answer" } }),
			"",
		].join("\n"),
		stderr: "",
		exitCode: 0,
		timedOut: false,
		cancelled: false,
		truncated: false,
		durationMs: 10,
	});
	assert.equal(answer.status, "completed");
	assert.equal(answer.answer, "the answer");
});

test("the answer of Codex is read from the events of the older format", () => {
	const answer = readCodexAnswer({
		stdout: JSON.stringify({ id: "0", msg: { type: "agent_message", message: "the old answer" } }),
		stderr: "",
		exitCode: 0,
		timedOut: false,
		cancelled: false,
		truncated: false,
		durationMs: 10,
	});
	assert.equal(answer.status, "completed");
	assert.equal(answer.answer, "the old answer");
});

test("the answer of Claude Code is read from its result", () => {
	const answer = readClaudeAnswer({
		stdout: JSON.stringify({ type: "result", subtype: "success", result: "the answer" }),
		stderr: "",
		exitCode: 0,
		timedOut: false,
		cancelled: false,
		truncated: false,
		durationMs: 10,
	});
	assert.equal(answer.status, "completed");
	assert.equal(answer.answer, "the answer");
});

test("a worker that is not signed in is not a quota problem", () => {
	const failure = classifyWorkerFailure("Error: not logged in, run `codex login`");
	assert.equal(failure.status, "blocked-auth-or-quota");
});

test("a worker that asks for a permission is blocked, not failed", () => {
	const failure = classifyWorkerFailure("the command requires approval from the user");
	assert.equal(failure.status, "blocked-approval");
});

test("a failure that nobody understands stays a failure", () => {
	const failure = classifyWorkerFailure("segmentation fault");
	assert.equal(failure.status, "failed");
});

test("a worker that is not signed in is never called completed", () => {
	const answer = readCodexAnswer({
		stdout: "",
		stderr: "Error: You are not logged in.",
		exitCode: 1,
		timedOut: false,
		cancelled: false,
		truncated: false,
		durationMs: 10,
	});
	assert.equal(answer.status, "blocked-auth-or-quota");
	assert.equal(answer.answer, "");
});

test("the reason of a worker that is not signed in is named, not the exit code", () => {
	// The live pilot of Claude Code showed this: the worker writes the
	// reason in its result and exits with 1. The reason is the sign-in,
	// and the exit code hides it.
	const answer = readClaudeAnswer({
		stdout: JSON.stringify({
			type: "result",
			subtype: "success",
			is_error: true,
			result: "Not logged in · Please run /login",
		}),
		stderr: "",
		exitCode: 1,
		timedOut: false,
		cancelled: false,
		truncated: false,
		durationMs: 10,
	});
	assert.equal(answer.status, "blocked-auth-or-quota");
	assert.match(answer.diagnostic ?? "", /Not logged in/);
	assert.equal(answer.answer, "");
});

test("the runtime refuses a target that is not a worker of the vocabulary", async () => {
	const { runtime, cleanup } = makeRuntime();
	try {
		const result = runtime.start({
			target: "rm -rf /",
			prompt: "the question",
			workspace: "/tmp",
			sender: SENDER,
		});
		assert.equal(result.status, "failed");
		assert.match(result.diagnostic ?? "", /unknown target/);
	} finally {
		await runtime.stop();
		cleanup();
	}
});

test("the runtime refuses an empty question and a relative workspace", async () => {
	const { runtime, cleanup } = makeRuntime();
	try {
		const empty = runtime.start({
			target: "codex",
			prompt: "   ",
			workspace: "/tmp",
			sender: SENDER,
		});
		assert.equal(empty.status, "failed");
		assert.match(empty.diagnostic ?? "", /empty/);

		const relative = runtime.start({
			target: "codex",
			prompt: "the question",
			workspace: "relative/path",
			sender: SENDER,
		});
		assert.equal(relative.status, "failed");
		assert.match(relative.diagnostic ?? "", /absolute/);
	} finally {
		await runtime.stop();
		cleanup();
	}
});

test("a worker may not consult another worker", async () => {
	const { runtime, cleanup } = makeRuntime();
	try {
		const result = runtime.start({
			target: "codex",
			prompt: "the question",
			workspace: "/tmp",
			sender: SENDER,
			hop: 1,
		});
		assert.equal(result.status, "failed");
		assert.match(result.diagnostic ?? "", /may not consult another worker/);
	} finally {
		await runtime.stop();
		cleanup();
	}
});

test("one worker per target and two workers in total", async () => {
	const dir = temporary();
	const { runtime, cleanup } = makeRuntime({
		env: pathWith(dir.dir),
	});
	try {
		// The stand-ins wait, so the jobs are running when the third one
		// asks for a slot.
		standIn(dir.dir, "codex", `setInterval(() => {}, 1000);`);
		standIn(dir.dir, "claude", `setInterval(() => {}, 1000);`);
		const first = runtime.start({
			target: "codex",
			prompt: "one",
			workspace: dir.dir,
			sender: SENDER,
		});
		assert.equal(first.status, "running");
		const second = runtime.start({
			target: "codex",
			prompt: "two",
			workspace: dir.dir,
			sender: SENDER,
		});
		assert.equal(second.status, "failed");
		assert.match(second.diagnostic ?? "", /already running/);

		const third = runtime.start({
			target: "claude",
			prompt: "three",
			workspace: dir.dir,
			sender: SENDER,
		});
		assert.equal(third.status, "running");
		const fourth = runtime.start({
			target: "claude",
			prompt: "four",
			workspace: dir.dir,
			sender: SENDER,
		});
		assert.equal(fourth.status, "failed");
		assert.match(fourth.diagnostic ?? "", /worker slot|already running/);
	} finally {
		await runtime.stop();
		cleanup();
		dir.cleanup();
	}
});

test("the state of a job is durable and holds no credential", async () => {
	const dir = temporary();
	const { runtime, home, cleanup } = makeRuntime({
		env: pathWith(dir.dir),
	});
	try {
		standIn(
			dir.dir,
			"codex",
			`let data = "";
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
	process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "the answer" } }));
});`,
		);
		const started = runtime.start({
			target: "codex",
			prompt: "the question",
			workspace: dir.dir,
			sender: SENDER,
		});
		const result = await runtime.wait(started.jobId, 20_000);
		assert.ok(result);
		assert.equal(result.status, "completed");
		assert.equal(result.answer, "the answer");

		const record = new JobStore(home.dir).read(started.jobId);
		assert.ok(record);
		assert.equal(record.status, "completed");
		assert.equal(record.answer, "the answer");
		// The question of the user is not written to disk.
		assert.equal(JSON.stringify(record).includes("the question"), false);
	} finally {
		await runtime.stop();
		cleanup();
		dir.cleanup();
	}
});

test("a cancelled job ends as cancelled and the worker is gone", async () => {
	const dir = temporary();
	const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
	try {
		standIn(dir.dir, "codex", `setInterval(() => {}, 1000);`);
		const started = runtime.start({
			target: "codex",
			prompt: "the question",
			workspace: dir.dir,
			sender: SENDER,
		});
		assert.equal(started.status, "running");
		const stopped = await runtime.cancel(started.jobId);
		assert.equal(stopped, true);
		const result = runtime.status(started.jobId);
		assert.ok(result);
		assert.equal(result.status, "cancelled");
		assert.equal(result.answer, "");
		// The job is over: the worker slot is free again.
		const next = runtime.start({
			target: "codex",
			prompt: "another question",
			workspace: dir.dir,
			sender: SENDER,
		});
		assert.equal(next.status, "running");
	} finally {
		await runtime.stop();
		cleanup();
		dir.cleanup();
	}
});

test("the tool of the consultation gives the answer of the worker", async () => {
	const dir = temporary();
	const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
	try {
		standIn(
			dir.dir,
			"codex",
			`let data = "";
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
	process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "the answer" } }));
});`,
		);
		const tool = agentConsultTool({
			runtime,
			sender: () => SENDER,
			workspace: () => dir.dir,
			waitMs: 20_000,
		});
		const outcome = await tool.execute("call-1", {
			target: "codex",
			prompt: "the question",
		});
		const text = outcome.content.map((entry) => entry.text).join("\n");
		assert.match(text, /the answer/);
		assert.equal(outcome.details.status, "completed");
	} finally {
		await runtime.stop();
		cleanup();
		dir.cleanup();
	}
});

test("the tool of the status names the state of the job", async () => {
	const dir = temporary();
	const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
	try {
		standIn(dir.dir, "codex", `setInterval(() => {}, 1000);`);
		const started = runtime.start({
			target: "codex",
			prompt: "the question",
			workspace: dir.dir,
			sender: SENDER,
		});
		const tool = agentJobStatusTool({
			runtime,
			sender: () => SENDER,
			workspace: () => dir.dir,
		});
		const outcome = await tool.execute("call-2", { jobId: started.jobId });
		const text = outcome.content.map((entry) => entry.text).join("\n");
		assert.match(text, /running/);
		const missing = await tool.execute("call-3", { jobId: "no-such-job" });
		assert.match(
			missing.content.map((entry) => entry.text).join("\n"),
			/no job/,
		);
	} finally {
		await runtime.stop();
		cleanup();
		dir.cleanup();
	}
});

test("the tool of the cancel stops the job", async () => {
	const dir = temporary();
	const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
	try {
		standIn(dir.dir, "codex", `setInterval(() => {}, 1000);`);
		const started = runtime.start({
			target: "codex",
			prompt: "the question",
			workspace: dir.dir,
			sender: SENDER,
		});
		const tool = agentJobCancelTool({
			runtime,
			sender: () => SENDER,
			workspace: () => dir.dir,
		});
		const outcome = await tool.execute("call-4", { jobId: started.jobId });
		assert.equal(outcome.details.status, "cancelled");
	} finally {
		await runtime.stop();
		cleanup();
		dir.cleanup();
	}
});

test("the workspace of a session is the canonical path", () => {
	const dir = temporary();
	try {
		assert.equal(canonicalWorkspace(dir.dir), dir.dir);
		assert.equal(canonicalWorkspace("  "), process.cwd());
	} finally {
		dir.cleanup();
	}
});

test("the consultation is off by default and the switch turns it on", async () => {
	const dir = temporary();
	const previous = process.env.PI_AGENT_COMMUNICATION;
	try {
		delete process.env.PI_AGENT_COMMUNICATION;
		const off = registerAgentCommunication({
			workspace: () => dir.dir,
			sessionId: () => "session-under-test",
			root: dir.dir,
		});
		assert.equal(off, undefined);

		process.env.PI_AGENT_COMMUNICATION = "1";
		const on = registerAgentCommunication({
			workspace: () => dir.dir,
			sessionId: () => "session-under-test",
			root: dir.dir,
		});
		assert.ok(on);

		const registered = [];
		registerAgentCommunicationTools(
			{ registerTool: (tool) => registered.push(tool.name) },
			on.tools,
		);
		assert.deepEqual(registered.sort(), [
			"agent_consult",
			"agent_job_cancel",
			"agent_job_status",
		]);
		await on.stop();
	} finally {
		if (previous === undefined) delete process.env.PI_AGENT_COMMUNICATION;
		else process.env.PI_AGENT_COMMUNICATION = previous;
		dir.cleanup();
	}
});

/**
 * The presence of a worker.
 *
 * The harness has to know whether Codex and Claude Code are on the
 * machine before a question is asked: a missing binary and a worker that
 * is not signed in are two different problems for the human.
 */
test("the binary of a worker is looked up on the PATH", () => {
	const dir = temporary();
	try {
		const binary = standIn(dir.dir, "codex", "process.stdout.write('ok');");
		assert.equal(resolveBinary("codex", { PATH: dir.dir }), binary);
	} finally {
		dir.cleanup();
	}
});

test("the environment decides which binary of a worker is used", () => {
	const chosen = temporary();
	const other = temporary();
	try {
		const binary = standIn(chosen.dir, "codex-stand-in", "process.stdout.write('ok');");
		standIn(other.dir, "codex", "process.stdout.write('other');");
		assert.equal(
			resolveBinary("codex", { PATH: other.dir, CODEX_BIN: binary }),
			binary,
		);
	} finally {
		chosen.cleanup();
		other.cleanup();
	}
});

test("an override that does not point at a runnable file switches the worker off", () => {
	const dir = temporary();
	try {
		const path = join(dir.dir, "codex");
		writeFileSync(path, "not runnable", "utf8");
		assert.equal(
			resolveBinary("codex", { PATH: dir.dir, CODEX_BIN: path }),
			undefined,
		);
	} finally {
		dir.cleanup();
	}
});

test("a worker that is not on the machine is named as missing", async () => {
	const dir = temporary();
	try {
		const presence = await detectWorker("codex", { PATH: dir.dir });
		assert.equal(presence.present, false);
		assert.match(presence.reason ?? "", /not installed/);
		assert.match(presenceLine(presence), /missing/);
	} finally {
		dir.cleanup();
	}
});

test("a worker that is on the machine is asked for its version and its sign-in", async () => {
	const dir = temporary();
	try {
		standIn(
			dir.dir,
			"codex",
			`const args = process.argv.slice(2);
if (args[0] === "--version") process.stdout.write("codex-cli 9.9.9\\n");
else if (args[0] === "login") process.stdout.write("Logged in using ChatGPT\\n");
else process.stdout.write("");`,
		);
		const presence = await detectWorker("codex", { PATH: dir.dir });
		assert.equal(presence.present, true);
		assert.equal(presence.version, "codex-cli 9.9.9");
		assert.equal(presence.signedIn, true);
		assert.match(presenceLine(presence), /signed in/);
	} finally {
		dir.cleanup();
	}
});

test("the sign-in of Claude Code is read from the answer of the worker", async () => {
	const dir = temporary();
	try {
		standIn(
			dir.dir,
			"claude",
			`const args = process.argv.slice(2);
if (args[0] === "--version") process.stdout.write("2.1.319 (Claude Code)\\n");
else if (args[0] === "auth") process.stdout.write(JSON.stringify({ loggedIn: false }) + "\\n");
else process.stdout.write("");`,
		);
		const presence = await detectWorker("claude", { PATH: dir.dir });
		assert.equal(presence.present, true);
		assert.equal(presence.signedIn, false);
		assert.match(presence.reason ?? "", /not signed in/);
		assert.match(presenceLine(presence), /not signed in/);
	} finally {
		dir.cleanup();
	}
});

test("the runtime refuses a job when the worker is not installed", async () => {
	const { runtime, cleanup } = makeRuntime({ env: { PATH: "/nonexistent-bin-dir" } });
	try {
		const job = await runtime.start({
			target: "codex",
			prompt: "the question",
			workspace: process.cwd(),
			sender: SENDER,
		});
		assert.equal(job.status, "failed");
		assert.match(job.diagnostic ?? "", /not installed/);
	} finally {
		await runtime.stop();
		cleanup();
	}
});

/**
 * The workspace of a consultation.
 *
 * The promise of a consultation is that the worker may look and may not
 * change. The harness does not believe the promise: it watches the tree
 * and names every file that the worker changed.
 */
test("the worker works in a copy: the workspace of the user is not changed", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(workspace, { recursive: true });
		writeFileSync(join(workspace, "answer.txt"), "the answer\n", "utf8");
		standIn(
			dir.dir,
			"codex",
			`const fs = require("node:fs");
fs.writeFileSync(process.cwd() + "/written-by-the-worker.md", "written\\n");
process.stdout.write(JSON.stringify({ item: { type: "agent_message", text: "the answer of " + process.cwd() } }) + "\\n");`,
		);
		const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
		const job = await runtime.start({
			target: "codex",
			prompt: `the question about ${workspace}`,
			workspace,
			sender: SENDER,
		});
		const result = await runtime.wait(job.jobId, 10_000);
		assert.equal(result.status, "completed");
		// The write of the worker landed in the copy, and the copy is gone.
		assert.equal(existsSync(join(workspace, "written-by-the-worker.md")), false);
		// The workspace of the user is untouched.
		assert.deepEqual(result.changedFiles, []);
		assert.equal(existsSync(join(workspace, "answer.txt")), true);
		// The answer names the workspace of the user, not the copy.
		assert.ok(!(result.answer ?? "").includes("/pi-agent-consult/"));
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("a worker that changes nothing leaves the workspace alone", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(workspace, { recursive: true });
		standIn(
			dir.dir,
			"codex",
			`process.stdout.write(JSON.stringify({ item: { type: "agent_message", text: "the answer" } }) + "\\n");`,
		);
		const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
		const job = await runtime.start({
			target: "codex",
			prompt: "the question",
			workspace,
			sender: SENDER,
		});
		const result = await runtime.wait(job.jobId, 10_000);
		assert.equal(result.status, "completed");
		assert.deepEqual(result.changedFiles, []);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

/**
 * The arguments of the consult of Codex.
 *
 * A measured leak showed that the write of the worker was approved by
 * the automatic reviewer of the user, whatever the sandbox said. The
 * arguments of the consult are the contract of the read-only promise, so
 * they are locked here.
 */
test("the consult of Codex asks for nothing and reaches no server", () => {
	const argv = CODEX_ARGV.join(" ");
	assert.match(argv, /--sandbox read-only/);
	assert.match(argv, /approval_policy="never"/);
	assert.match(argv, /approvals_reviewer="user"/);
	assert.match(argv, /features\.hooks=false/);
	assert.match(argv, /mcp_servers=\{\}/);
	assert.ok(!argv.includes("workspace-write"));
	assert.ok(!argv.includes("--ignore-user-config"));
	assert.ok(!argv.includes("dangerously"));
});

test("the consult of Claude offers the read tools and nothing else", () => {
	const argv = CLAUDE_ARGV.join(" ");
	assert.match(argv, /--tools Read,Glob,Grep/);
	assert.match(argv, /--permission-mode dontAsk/);
	assert.match(argv, /--permission-prompts none/);
	assert.match(argv, /--strict-mcp-config/);
	assert.ok(!argv.includes("acceptEdits"));
});

test("the guard of the workspace names what changed in the tree", () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(join(workspace, "sub"), { recursive: true });
		writeFileSync(join(workspace, "kept.txt"), "kept\n", "utf8");
		const before = snapshotWorkspace(workspace);
		writeFileSync(join(workspace, "added.txt"), "added\n", "utf8");
		writeFileSync(join(workspace, "sub", "changed.txt"), "one\n", "utf8");
		writeFileSync(join(workspace, "kept.txt"), "kept and more\n", "utf8");
		const changed = changesSince(workspace, before);
		assert.deepEqual(changed, ["added.txt", "kept.txt", "sub/changed.txt"]);
	} finally {
		dir.cleanup();
	}
});

test("a workspace that cannot be copied is named in the record", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(workspace, { recursive: true });
		standIn(
			dir.dir,
			"codex",
			`process.stdout.write(JSON.stringify({ item: { type: "agent_message", text: "the answer" } }) + "\\n");`,
		);
		const { runtime, cleanup } = makeRuntime({
			env: pathWith(dir.dir),
			stage: (root) => ({
				path: root,
				root,
				copied: false,
				mapPrompt: (prompt) => prompt,
				mapAnswer: (answer) => answer,
				dispose: () => {},
			}),
		});
		const job = await runtime.start({
			target: "codex",
			prompt: "the question",
			workspace,
			sender: SENDER,
		});
		const result = await runtime.wait(job.jobId, 10_000);
		// The worker is not started: a worker that works in the workspace
		// of the user may change it.
		assert.equal(result.status, "failed");
		assert.match(result.diagnostic ?? "", /could not be copied/);
		assert.equal(result.answer, "");
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the override of a worker is resolved to a full path", () => {
	const dir = temporary();
	try {
		const binary = standIn(dir.dir, "codex", "process.stdout.write('ok');");
		// A relative override would be looked for in the copy of the
		// workspace, where the worker of a consult works.
		const rel = relative(process.cwd(), binary);
		const found = resolveBinary("codex", { PATH: dir.dir, CODEX_BIN: rel });
		assert.ok(found && isAbsolute(found));
		assert.equal(found, resolve(binary));
	} finally {
		dir.cleanup();
	}
});

/**
 * A stand-in of a worker that writes files into the directory it works in.
 */
function writingWorker(dir, files) {
	const writes = files
		.map((file) => {
			const dir = file.path.includes("/")
				? file.path.slice(0, file.path.lastIndexOf("/"))
				: "";
			const make = dir
				? `fs.mkdirSync(${JSON.stringify(dir)}, { recursive: true });`
				: "";
			return `${make}fs.writeFileSync(${JSON.stringify(file.path)}, ${JSON.stringify(file.content)});`;
		})
		.join("\n");
	return standIn(
		dir,
		"codex",
		`const fs = require("fs");
${writes}
process.stdout.write(JSON.stringify({ item: { type: "agent_message", text: "the plan is written" } }) + "\\n");`,
	);
}

test("the write lane applies the file that the human named", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(join(workspace, "wiki"), { recursive: true });
		writingWorker(dir.dir, [
			{ path: "wiki/plan.md", content: "# the plan\n\nthe plan of the worker\n" },
		]);
		const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["wiki/plan.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		assert.equal(outcome.status, "written");
		assert.equal(outcome.applied.length, 1);
		assert.equal(outcome.applied[0].path, "wiki/plan.md");
		assert.equal(
			readFileSync(join(workspace, "wiki/plan.md"), "utf8"),
			"# the plan\n\nthe plan of the worker\n",
		);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the write lane refuses a worker that wrote another file", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(join(workspace, "wiki"), { recursive: true });
		writingWorker(dir.dir, [
			{ path: "wiki/plan.md", content: "# the plan\n" },
			{ path: "harness/notebook.ts", content: "the worker went elsewhere\n" },
		]);
		const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["wiki/plan.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		assert.equal(outcome.status, "refused");
		assert.equal(outcome.applied.length, 0);
		assert.match(outcome.diagnostic ?? "", /outside the named files/);
		// Nothing was applied: not the named file, not the other one.
		assert.equal(existsSync(join(workspace, "wiki/plan.md")), false);
		assert.equal(existsSync(join(workspace, "harness/notebook.ts")), false);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the write lane refuses a path outside of the workspace", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(workspace, { recursive: true });
		writingWorker(dir.dir, [
			{ path: "marker.txt", content: "the worker ran\n" },
		]);
		const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["../escaped.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		assert.equal(outcome.status, "refused");
		assert.match(outcome.diagnostic ?? "", /not a file of the workspace/);
		// The worker was never asked: the request was refused before it.
		assert.equal(existsSync(join(workspace, "marker.txt")), false);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the write lane refuses the files of the machinery", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(workspace, { recursive: true });
		const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["package.json"],
			prompt: "write the plan",
			sender: SENDER,
		});
		assert.equal(outcome.status, "refused");
		assert.match(outcome.diagnostic ?? "", /not a file a worker may write/);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the write lane reports that the worker wrote nothing", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(workspace, { recursive: true });
		writingWorker(dir.dir, []);
		const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["wiki/plan.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		assert.equal(outcome.status, "nothing");
		assert.equal(outcome.applied.length, 0);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the write lane refuses a path that leaves the workspace through a symlink", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		const outside = join(dir.dir, "outside");
		mkdirSync(workspace, { recursive: true });
		mkdirSync(outside, { recursive: true });
		// The link points out of the workspace: the file behind it may
		// not be written by the harness.
		symlinkSync(outside, join(workspace, "link"), "dir");
		writingWorker(dir.dir, [
			{ path: "link/plan.md", content: "# the plan\n" },
		]);
		const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["link/plan.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		assert.equal(outcome.status, "refused");
		assert.equal(outcome.applied.length, 0);
		// Nothing was written behind the link.
		assert.equal(existsSync(join(outside, "plan.md")), false);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the copy of the workspace has no symlink", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		const outside = join(dir.dir, "outside");
		mkdirSync(workspace, { recursive: true });
		mkdirSync(outside, { recursive: true });
		writeFileSync(join(outside, "secret.txt"), "the secret\n");
		symlinkSync(join(outside, "secret.txt"), join(workspace, "link.txt"));
		// The worker writes through every link of the directory it works in.
		writingWorker(dir.dir, [
			{ path: "link.txt", content: "the worker wrote through the link\n" },
		]);
		const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["wiki/plan.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		// The file behind the link was not touched: the copy has no link.
		assert.equal(
			readFileSync(join(outside, "secret.txt"), "utf8"),
			"the secret\n",
		);
		// The worker wrote a file of its own in the copy: the lane refuses
		// a worker that writes outside the named files.
		assert.equal(outcome.status, "refused");
		assert.equal(outcome.applied.length, 0);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the guard sees a file that was rewritten with the same size", () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(workspace, { recursive: true });
		writeFileSync(join(workspace, "note.md"), "the first version\n");
		const before = snapshotWorkspace(workspace);
		// The same number of bytes: only the time of the write tells the
		// two versions apart.
		writeFileSync(join(workspace, "note.md"), "the other version\n");
		const changed = changesSince(workspace, before);
		assert.deepEqual(changed, ["note.md"]);
	} finally {
		dir.cleanup();
	}
});

test("the slot of a cancelled job is held until the worker is really gone", async () => {
	const dir = temporary();
	const { runtime, cleanup } = makeRuntime({
		env: pathWith(dir.dir),
		killGraceMs: 300,
	});
	try {
		// A worker that ignores the signal: it is killed after the grace,
		// and the slot belongs to it until then.
		standIn(
			dir.dir,
			"codex",
			`process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);`,
		);
		const started = runtime.start({
			target: "codex",
			prompt: "the question",
			workspace: dir.dir,
			sender: SENDER,
		});
		assert.equal(started.status, "running");
		const cancelling = runtime.cancel(started.jobId);
		// The worker is still stopping: the slot is still taken.
		const second = runtime.start({
			target: "codex",
			prompt: "another question",
			workspace: dir.dir,
			sender: SENDER,
		});
		assert.equal(second.status, "failed");
		assert.match(second.diagnostic ?? "", /already running/);
		await cancelling;
		// The worker is gone: the slot is free again.
		const third = runtime.start({
			target: "codex",
			prompt: "another question",
			workspace: dir.dir,
			sender: SENDER,
		});
		assert.equal(third.status, "running");
		await runtime.cancel(third.jobId);
	} finally {
		await runtime.stop();
		cleanup();
		dir.cleanup();
	}
});

test("the copy of the workspace is gone when the consult is over", async () => {
	const dir = temporary();
	try {
		const stagingRoot = join(dir.dir, "staging");
		const home = temporary();
		const runtime = new AgentCommunicationRuntime({
			store: new JobStore(home.dir),
			stagingRoot,
			env: pathWith(dir.dir),
		});
		standIn(
			dir.dir,
			"codex",
			`process.stdout.write(JSON.stringify({ item: { type: "agent_message", text: "the answer" } }) + "\\n");`,
		);
		const workspace = join(dir.dir, "workspace");
		mkdirSync(workspace, { recursive: true });
		const started = runtime.start({
			target: "codex",
			prompt: "the question",
			workspace,
			sender: SENDER,
		});
		const result = await runtime.wait(started.jobId, 10_000);
		assert.equal(result.status, "completed");
		// The copy is thrown away: nothing of the workspace is left in the
		// temporary directory.
		assert.deepEqual(
			existsSync(stagingRoot) ? readdirSync(stagingRoot) : [],
			[],
		);
		await runtime.stop();
		home.cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the write lane leaves the tree of the user as it was, apart from the applied file", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(join(workspace, "wiki"), { recursive: true });
		writeFileSync(join(workspace, "wiki/notes.md"), "the notes\n");
		// The worker writes a file of its own and the named file.
		writingWorker(dir.dir, [
			{ path: "wiki/plan.md", content: "# the plan\n" },
			{ path: "wiki/scratch.md", content: "the scratch of the worker\n" },
		]);
		const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
		const before = snapshotWorkspace(workspace);
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["wiki/plan.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		assert.equal(outcome.status, "refused");
		// The worker wrote a file that was not named: nothing was applied
		// and the tree of the user is untouched.
		const changed = changesSince(workspace, before);
		assert.deepEqual(changed, []);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the state of a job holds no credential of the harness", async () => {
	const dir = temporary();
	const home = temporary();
	try {
		const secret = "the-secret-of-the-harness";
		const runtime = new AgentCommunicationRuntime({
			store: new JobStore(home.dir),
			env: {
				...pathWith(dir.dir),
				PI_LOG_WEBHOOK_TOKEN: secret,
			},
		});
		standIn(
			dir.dir,
			"codex",
			`process.stdout.write(JSON.stringify({ item: { type: "agent_message", text: "the answer" } }) + "\\n");`,
		);
		const workspace = join(dir.dir, "workspace");
		mkdirSync(workspace, { recursive: true });
		const started = runtime.start({
			target: "codex",
			prompt: "the question of the user",
			workspace,
			sender: SENDER,
		});
		await runtime.wait(started.jobId, 10_000);
		const jobsDir = join(home.dir, "agent-jobs");
		const files = existsSync(jobsDir) ? readdirSync(jobsDir) : [];
		assert.ok(files.length > 0);
		for (const name of files) {
			const content = readFileSync(join(jobsDir, name), "utf8");
			assert.equal(content.includes(secret), false);
		}
		await runtime.stop();
	} finally {
		dir.cleanup();
		home.cleanup();
	}
});

test("the copy of a write that failed is gone", async () => {
	const dir = temporary();
	try {
		const stagingRoot = join(dir.dir, "staging");
		const home = temporary();
		const runtime = new AgentCommunicationRuntime({
			store: new JobStore(home.dir),
			stagingRoot,
			env: pathWith(dir.dir),
		});
		// The worker fails: it writes nothing and leaves with an error.
		standIn(dir.dir, "codex", `process.stderr.write("the worker failed"); process.exit(3);`);
		const workspace = join(dir.dir, "workspace");
		mkdirSync(workspace, { recursive: true });
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["wiki/plan.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		assert.equal(outcome.status, "failed");
		// The copy of the workspace is gone: a failed write does not leave
		// a copy of the project of the user behind.
		assert.deepEqual(
			existsSync(stagingRoot) ? readdirSync(stagingRoot) : [],
			[],
		);
		await runtime.stop();
		home.cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the state of a job that is too old goes away", () => {
	const dir = temporary();
	try {
		const store = new JobStore(dir.dir);
		store.write({
			jobId: "old-job",
			correlationId: "old-correlation",
			target: "codex",
			workspace: dir.dir,
			status: "completed",
			answer: "the answer",
			startedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
			finishedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
			sender: SENDER,
		});
		// The file of the state is a week old.
		const path = join(dir.dir, "agent-jobs", "old-job.json");
		const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
		utimesSync(path, old, old);
		assert.equal(store.read("old-job") !== undefined, true);
		// The state of a job that is too old is of no use to a session.
		const expired = store.expire();
		assert.equal(expired, 1);
		assert.equal(store.read("old-job"), undefined);
	} finally {
		dir.cleanup();
	}
});

test("the runner settles when the binary of the worker does not exist", async () => {
	const dir = temporary();
	try {
		const controller = new AbortController();
		const run = await runCli({
			binary: join(dir.dir, "there-is-no-such-worker"),
			argv: [],
			cwd: dir.dir,
			stdin: "the question",
			timeoutMs: 5_000,
			signal: controller.signal,
			env: filteredEnv(process.env),
		});
		// The run does not hang, and the reason is named.
		assert.equal(run.exitCode, undefined);
		assert.match(run.spawnError ?? "", /ENOENT|not found|no such file/i);
		// The abort of the job is still possible: the listener of the
		// failed spawn is gone.
		controller.abort();
	} finally {
		dir.cleanup();
	}
});

test("the write lane refuses a worker that is not installed", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(join(workspace, "wiki"), { recursive: true });
		// No stand-in: the PATH holds no worker at all.
		const { runtime, cleanup } = makeRuntime({ env: { PATH: dir.dir } });
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["wiki/plan.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		// The request was refused before the worker started.
		assert.equal(outcome.status, "refused");
		assert.equal(outcome.applied.length, 0);
		assert.match(outcome.diagnostic ?? "", /not installed|not started/);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the tool of the consultation names the tools of a job that still runs", async () => {
	const dir = temporary();
	try {
		// A worker that waits for ever.
		standIn(dir.dir, "codex", `setInterval(() => {}, 1000);`);
		const { runtime, cleanup } = makeRuntime({
			env: pathWith(dir.dir),
			defaultWaitMs: 150,
		});
		const tool = agentConsultTool({
			runtime,
			sender: () => SENDER,
			workspace: () => dir.dir,
			waitMs: 150,
		});
		const workspace = join(dir.dir, "workspace");
		mkdirSync(workspace, { recursive: true });
		const outcome = await tool.execute("call-1", {
			target: "codex",
			prompt: "the question",
		});
		const text = outcome.content.map((entry) => entry.text).join("\n");
		// The agent is told how to read the job and how to stop it.
		assert.match(text, /agent_job_status/);
		assert.match(text, /agent_job_cancel/);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the copy of a write whose wait expires is gone", async () => {
	const dir = temporary();
	try {
		const stagingRoot = join(dir.dir, "staging");
		const workspace = join(dir.dir, "workspace");
		mkdirSync(join(workspace, "wiki"), { recursive: true });
		// A worker that waits for ever: the wait of the lane expires.
		standIn(dir.dir, "codex", `setInterval(() => {}, 1000);`);
		const { runtime, cleanup } = makeRuntime({
			env: pathWith(dir.dir),
			stagingRoot,
			defaultWaitMs: 200,
		});
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["wiki/plan.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		assert.equal(outcome.status, "failed");
		// The copy of the workspace of the user does not stay in the
		// temporary directory when the lane gives up.
		assert.deepEqual(
			existsSync(stagingRoot) ? readdirSync(stagingRoot) : [],
			[],
		);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the write lane does not overwrite a file that the human edited meanwhile", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(join(workspace, "wiki"), { recursive: true });
		writeFileSync(join(workspace, "wiki/plan.md"), "the plan of the user\n");
		// The worker writes its version into the copy and changes the file
		// of the user while it runs.
		standIn(
			dir.dir,
			"codex",
			`const fs = require("fs");
fs.writeFileSync("wiki/plan.md", "the plan of the worker\\n");
fs.writeFileSync(${JSON.stringify(join(workspace, "wiki/plan.md"))}, "the plan of the user, edited\\n");
process.stdout.write(JSON.stringify({ item: { type: "agent_message", text: "the plan is written" } }) + "\\n");`,
		);
		const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["wiki/plan.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		// The file of the human is not overwritten.
		assert.equal(outcome.status, "refused");
		assert.equal(outcome.applied.length, 0);
		assert.equal(
			readFileSync(join(workspace, "wiki/plan.md"), "utf8"),
			"the plan of the user, edited\n",
		);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("a workspace that is a link is staged without a link", async () => {
	const dir = temporary();
	try {
		const real = join(dir.dir, "real-workspace");
		mkdirSync(join(real, "wiki"), { recursive: true });
		writeFileSync(join(real, "wiki/notes.md"), "the notes\n");
		const link = join(dir.dir, "linked-workspace");
		symlinkSync(real, link, "dir");
		const stagingRoot = join(dir.dir, "staging");
		standIn(
			dir.dir,
			"codex",
			`process.stdout.write(JSON.stringify({ item: { type: "agent_message", text: "the answer" } }) + "\\n");`,
		);
		const { runtime, cleanup } = makeRuntime({
			env: pathWith(dir.dir),
			stagingRoot,
		});
		const started = runtime.start({
			target: "codex",
			prompt: "the question",
			workspace: link,
			sender: SENDER,
			keepStaging: true,
		});
		const result = await runtime.wait(started.jobId, 10_000);
		assert.equal(result.status, "completed");
		// The copy holds the workspace of the user, and no link to it.
		assert.equal(
			existsSync(join(stagingRoot, started.jobId, "wiki/notes.md")),
			true,
		);
		// The copy is a directory, not a link to the workspace of the user:
		// existsSync follows a link, lstatSync does not.
		assert.equal(
			lstatSync(join(stagingRoot, started.jobId)).isSymbolicLink(),
			false,
		);
		// And no file of the copy is a link either.
		assert.equal(
			lstatSync(join(stagingRoot, started.jobId, "wiki/notes.md"))
				.isSymbolicLink(),
			false,
		);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the tool of the consultation says that the worker was not started", async () => {
	const dir = temporary();
	const { runtime, cleanup } = makeRuntime({ env: { PATH: dir.dir } });
	try {
		const tool = agentConsultTool({
			runtime,
			sender: () => SENDER,
			workspace: () => dir.dir,
			waitMs: 5_000,
		});
		const outcome = await tool.execute("call-1", {
			target: "codex",
			prompt: "the question",
		});
		const text = outcome.content.map((entry) => entry.text).join("\n");
		// The worker never ran: the tool does not blame the worker.
		assert.match(text, /was not started/);
		assert.equal(/did not answer/.test(text), false);
	} finally {
		await runtime.stop();
		cleanup();
		dir.cleanup();
	}
});

test("the tool of the consultation says that the worker was not started when the copy failed", async () => {
	const dir = temporary();
	const { runtime, cleanup } = makeRuntime({
		env: pathWith(dir.dir),
		// The copy of the workspace cannot be made.
		stage: (root) => ({
			path: root,
			root,
			copied: false,
			mapPrompt: (prompt) => prompt,
			mapAnswer: (answer) => answer,
			dispose: () => {},
		}),
	});
	try {
		standIn(
			dir.dir,
			"codex",
			`process.stdout.write(JSON.stringify({ item: { type: "agent_message", text: "the answer" } }) + "\\n");`,
		);
		const tool = agentConsultTool({
			runtime,
			sender: () => SENDER,
			workspace: () => dir.dir,
			waitMs: 10_000,
		});
		const outcome = await tool.execute("call-1", {
			target: "codex",
			prompt: "the question",
		});
		const text = outcome.content.map((entry) => entry.text).join("\\n");
		// The worker never ran: the tool does not blame the worker.
		assert.match(text, /The worker was not started/);
		assert.equal(/did not answer/.test(text), false);
	} finally {
		await runtime.stop();
		cleanup();
		dir.cleanup();
	}
});

test("the state of a refused job carries the refusal", async () => {
	const dir = temporary();
	try {
		const home = temporary();
		const { runtime, cleanup } = makeRuntime({
			store: new JobStore(home.dir),
			env: pathWith(dir.dir),
			// The copy of the workspace cannot be made.
			stage: (root) => ({
				path: root,
				root,
				copied: false,
				mapPrompt: (prompt) => prompt,
				mapAnswer: (answer) => answer,
				dispose: () => {},
			}),
		});
		standIn(
			dir.dir,
			"codex",
			`process.stdout.write(JSON.stringify({ item: { type: "agent_message", text: "the answer" } }) + "\\n");`,
		);
		const started = runtime.start({
			target: "codex",
			prompt: "the question",
			workspace: dir.dir,
			sender: SENDER,
		});
		await runtime.wait(started.jobId, 10_000);
		// The refusal survives the durable state: a job that reads the
		// state later still knows that the worker never ran.
		const record = new JobStore(home.dir).read(started.jobId);
		assert.equal(record?.refused, true);
		assert.equal(runtime.status(started.jobId)?.refused, true);
		await runtime.stop();
		cleanup();
		home.cleanup();
	} finally {
		dir.cleanup();
	}
});

test("a job that fails after the copy keeps the path of the copy", async () => {
	const dir = temporary();
	try {
		const stagedPath = join(dir.dir, "the-copy");
		mkdirSync(stagedPath, { recursive: true });
		const { runtime, cleanup } = makeRuntime({
			env: pathWith(dir.dir),
			// The copy is made, and then the job fails.
			stage: (root) => ({
				path: stagedPath,
				root,
				copied: true,
				mapPrompt: () => {
					throw new Error("the question cannot be sent");
				},
				mapAnswer: (answer) => answer,
				dispose: () => {},
			}),
		});
		const started = runtime.start({
			target: "codex",
			prompt: "the question",
			workspace: dir.dir,
			sender: SENDER,
			keepStaging: true,
		});
		const result = await runtime.wait(started.jobId, 10_000);
		assert.equal(result.status, "failed");
		// The path of the copy is known: the caller may take it away.
		assert.equal(result.stagedPath, stagedPath);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the write lane refuses the whole write when one file conflicts", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(join(workspace, "wiki"), { recursive: true });
		writeFileSync(join(workspace, "wiki/first.md"), "the first file\n");
		writeFileSync(join(workspace, "wiki/second.md"), "the second file\n");
		// The time of the files is set with the precision of a
		// millisecond, so the edit of the worker can be hidden from the
		// guard of the tree: the lane has to see it in the check of the
		// conflict.
		const stamp = new Date(1700000000000);
		for (const name of ["wiki/first.md", "wiki/second.md"]) {
			utimesSync(join(workspace, name), stamp, stamp);
		}
		// The worker writes both files and edits the second one in the
		// workspace of the user while it runs. The edit keeps the size and
		// the time of the file, so the guard of the tree does not see it:
		// the lane has to see it in the check of the conflict.
		standIn(
			dir.dir,
			"codex",
			`const fs = require("fs");
fs.writeFileSync("wiki/first.md", "the first file of the worker\\n");
fs.writeFileSync("wiki/second.md", "the second file of the worker\\n");
const target = ${JSON.stringify(join(workspace, "wiki/second.md"))};
const before = fs.statSync(target);
fs.writeFileSync(target, "the SECOND file\\n");
fs.utimesSync(target, before.atime, before.mtime);
process.stdout.write(JSON.stringify({ item: { type: "agent_message", text: "the plan is written" } }) + "\\n");`,
		);
		const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["wiki/first.md", "wiki/second.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		// The lane is a transaction: the conflict refuses the whole write,
		// so the first file is not written either.
		assert.equal(outcome.status, "refused");
		assert.equal(outcome.applied.length, 0);
		assert.equal(
			readFileSync(join(workspace, "wiki/first.md"), "utf8"),
			"the first file\n",
		);
		assert.equal(
			readFileSync(join(workspace, "wiki/second.md"), "utf8"),
			"the SECOND file\n",
		);
		// The lane refused the file that changed while the worker ran.
		assert.match(
			outcome.diagnostic ?? "",
			/changed in the workspace while the worker was running/,
		);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the write lane refuses a worker that changed the workspace of the user", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(join(workspace, "wiki"), { recursive: true });
		// The worker writes into the copy and into the workspace of the
		// user.
		standIn(
			dir.dir,
			"codex",
			`const fs = require("fs");
fs.writeFileSync("wiki/plan.md", "the plan of the worker\\n");
fs.writeFileSync(${JSON.stringify(join(workspace, "wiki/sneaky.md"))}, "the sneaky file\\n");
process.stdout.write(JSON.stringify({ item: { type: "agent_message", text: "the plan is written" } }) + "\\n");`,
		);
		const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["wiki/plan.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		// The change in the workspace of the user is named, and nothing is
		// applied.
		assert.equal(outcome.status, "refused");
		assert.equal(outcome.applied.length, 0);
		assert.match(outcome.diagnostic ?? "", /changed .* workspace/);
		assert.equal(existsSync(join(workspace, "wiki/plan.md")), false);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the copy of a write whose wait gives up at once is gone", async () => {
	const dir = temporary();
	try {
		const stagingRoot = join(dir.dir, "staging");
		const workspace = join(dir.dir, "workspace");
		mkdirSync(join(workspace, "wiki"), { recursive: true });
		standIn(dir.dir, "codex", `setInterval(() => {}, 1000);`);
		const { runtime, cleanup } = makeRuntime({
			env: pathWith(dir.dir),
			stagingRoot,
			// The wait of the lane gives up at once: the job is still
			// running, and it ends in the moment the lane looks for it.
			defaultWaitMs: 1,
		});
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["wiki/plan.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		assert.equal(outcome.status, "failed");
		// The copy of the workspace of the user does not stay behind.
		assert.deepEqual(
			existsSync(stagingRoot) ? readdirSync(stagingRoot) : [],
			[],
		);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the copy of a write whose job ends while the lane waits is gone", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(join(workspace, "wiki"), { recursive: true });
		const stagedPath = join(dir.dir, "the-copy");
		mkdirSync(stagedPath, { recursive: true });
		let calls = 0;
		// A runtime whose job ends in the moment the lane waits: the path
		// of the copy is only known before the wait.
		const runtime = {
			start: () => ({
				jobId: "job-1",
				status: "running",
				target: "codex",
				answer: "",
				durationMs: 0,
			}),
			wait: async () => ({
				jobId: "job-1",
				status: "failed",
				answer: "",
				diagnostic: "the worker did not answer",
				durationMs: 10,
			}),
			stagedPath: () => {
				calls += 1;
				return calls === 1 ? stagedPath : undefined;
			},
			cancel: async () => true,
		};
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["wiki/plan.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		assert.equal(outcome.status, "failed");
		// The copy of the workspace of the user does not stay behind: the
		// lane knew the path before it waited.
		assert.equal(existsSync(stagedPath), false);
	} finally {
		dir.cleanup();
	}
});
