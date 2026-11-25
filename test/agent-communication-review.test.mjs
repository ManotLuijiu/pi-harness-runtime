/**
 * The repairs of the review of the task diff.
 *
 * The review found real defects in the write lane, in the copy of a
 * workspace and in the runtime. Every test of this file proves one
 * repair, and every repair is a promise that the harness keeps:
 *
 * - A worker that writes a named file into a folder that does not exist
 *   yet has written the named file, and the lane applies it.
 * - The copy of a workspace keeps the files of a folder that holds a file
 *   that git ignores: the ignored file is out of the copy, the folder is
 *   not.
 * - Two lanes of one workspace do not overwrite each other: the second
 *   one refuses the file that the first one wrote.
 * - A write that fails leaves no folder of its own behind.
 * - A consult that fails before the worker starts leaves no copy of the
 *   project of the user in the temporary directory.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentCommunicationRuntime } from "../harness/agent-communication/runtime.ts";
import { JobStore } from "../harness/agent-communication/store.ts";
import { stageWorkspace } from "../harness/agent-communication/staging.ts";
import { writeThroughWorker } from "../harness/agent-communication/write-lane.ts";

/**
 * A temporary directory that goes away with the test.
 */
function temporary() {
	const dir = mkdtempSync(join(tmpdir(), "agent-communication-review-"));
	return {
		dir,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

/**
 * A stand-in of a vendored CLI.
 *
 * The program answers the probe of the sandbox, so the stand-in stands
 * for a machine whose sandbox starts.
 */
function standIn(dir, name, body) {
	const path = join(dir, name);
	writeFileSync(
		path,
		`#!/usr/bin/env node\nif (process.argv[2] === "sandbox") { process.exit(0); }\n${body}\n`,
		"utf8",
	);
	chmodSync(path, 0o755);
	return path;
}

/**
 * A stand-in of a vendored CLI whose sandbox cannot start.
 *
 * The probe of the sandbox fails, so the machine has no boundary for the
 * worker of the vendor.
 */
function standInWithoutSandbox(dir, name, body) {
	const path = join(dir, name);
	writeFileSync(
		path,
		`#!/usr/bin/env node\nif (process.argv[2] === "sandbox") { process.exit(1); }\n${body}\n`,
		"utf8",
	);
	chmodSync(path, 0o755);
	return path;
}

/**
 * A worker that writes the files it is given into the copy.
 */
function writingWorker(dir, files) {
	const writes = files
		.map((file) => {
			const folder = file.path.includes("/")
				? file.path.slice(0, file.path.lastIndexOf("/"))
				: "";
			const make = folder
				? `fs.mkdirSync(${JSON.stringify(folder)}, { recursive: true });`
				: "";
			return `${make}fs.writeFileSync(${JSON.stringify(file.path)}, ${JSON.stringify(file.content)});`;
		})
		.join("\n");
	return standIn(
		dir,
		"codex",
		`const fs = require("fs");
${writes}
process.stdout.write(JSON.stringify({ item: { type: "agent_message", text: "written" } }) + "\\n");`,
	);
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
	return { runtime, cleanup: home.cleanup };
}

/**
 * The environment with the stand-in on the PATH.
 */
function pathWith(dir) {
	return { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` };
}

test("the write lane applies a named file in a folder that does not exist yet", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(workspace, { recursive: true });
		// The folder of the named file is not there: the worker creates
		// it while it writes the file.
		writingWorker(dir.dir, [{ path: "docs/plan.md", content: "# the plan\n" }]);
		const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["docs/plan.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		// The worker wrote the named file and nothing else. The folder on
		// the way to it is not a write of its own.
		assert.equal(outcome.status, "written");
		assert.equal(outcome.applied.length, 1);
		assert.equal(outcome.applied[0].path, "docs/plan.md");
		assert.equal(
			readFileSync(join(workspace, "docs/plan.md"), "utf8"),
			"# the plan\n",
		);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the copy of a workspace keeps the files of a folder that holds an ignored file", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(join(workspace, "src"), { recursive: true });
		writeFileSync(join(workspace, ".gitignore"), "*.log\n", "utf8");
		writeFileSync(join(workspace, "src", "app.ts"), "export const app = 1;\n", "utf8");
		writeFileSync(join(workspace, "src", "app.log"), "noise\n", "utf8");
		execFileSync("git", ["init", "-q"], { cwd: workspace, stdio: "ignore" });
		const stagingRoot = join(dir.dir, "staging");
		mkdirSync(stagingRoot, { recursive: true });
		const staged = stageWorkspace(workspace, { stagingRoot, jobId: "job-1" });
		try {
			// The file that git ignores is out of the copy.
			assert.equal(existsSync(join(staged.path, "src", "app.log")), false);
			// The folder around it holds a file that belongs to the copy,
			// and the worker has to see it.
			assert.equal(
				existsSync(join(staged.path, "src", "app.ts")),
				true,
			);
		} finally {
			staged.dispose();
		}
	} finally {
		dir.cleanup();
	}
});

test("two lanes of one workspace do not overwrite each other", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(workspace, { recursive: true });
		// The worker writes the question into the named file, so the two
		// lanes write different content.
		standIn(
			dir.dir,
			"codex",
			`const fs = require("fs");
let data = "";
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
fs.mkdirSync("shared", { recursive: true });
fs.writeFileSync("shared/plan.md", data);
process.stdout.write(JSON.stringify({ item: { type: "agent_message", text: "written" } }) + "\\n");
});`,
		);
		const { runtime, cleanup } = makeRuntime({
			env: pathWith(dir.dir),
			maxPerTarget: 2,
			maxConcurrent: 2,
		});
		const lane = (prompt) =>
			writeThroughWorker(runtime, {
				workspace,
				target: "codex",
				paths: ["shared/plan.md"],
				prompt,
				sender: SENDER,
			});
		const outcomes = await Promise.all([lane("first"), lane("second")]);
		const written = outcomes.filter((outcome) => outcome.status === "written");
		const refused = outcomes.filter((outcome) => outcome.status === "refused");
		// One lane writes the file, the other one refuses it: the file
		// that the human edited is not overwritten.
		assert.equal(written.length, 1);
		assert.equal(refused.length, 1);
		const content = readFileSync(join(workspace, "shared/plan.md"), "utf8");
		// The file holds the answer of the lane that wrote it, and only
		// of that one: the other lane did not write over it.
		const hasFirst = content.includes("first");
		const hasSecond = content.includes("second");
		assert.notEqual(hasFirst, hasSecond);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("a write that fails leaves no folder of its own behind", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(workspace, { recursive: true });
		// A file where the folder of the second named file has to be: the
		// preparation of that file cannot make the folder.
		writeFileSync(join(workspace, "b"), "a file, not a folder\n", "utf8");
		standIn(
			dir.dir,
			"codex",
			`const fs = require("fs");
fs.rmSync("b", { force: true });
fs.mkdirSync("a", { recursive: true });
fs.writeFileSync("a/one.md", "# one\\n");
fs.mkdirSync("b", { recursive: true });
fs.writeFileSync("b/two.md", "# two\\n");
process.stdout.write(JSON.stringify({ item: { type: "agent_message", text: "written" } }) + "\\n");`,
		);
		const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["a/one.md", "b/two.md"],
			prompt: "write the files",
			sender: SENDER,
		});
		// The second file cannot be written: the whole write is refused.
		assert.equal(outcome.status, "refused");
		assert.equal(outcome.applied.length, 0);
		// The folder of the first file is not left behind: the tree of
		// the user is as it was.
		assert.equal(existsSync(join(workspace, "a")), false);
		// The file that was there is untouched.
		assert.equal(
			readFileSync(join(workspace, "b"), "utf8"),
			"a file, not a folder\n",
		);
		// No temporary of the harness is left behind.
		const leftovers = readdirSync(workspace).filter((name) =>
			name.includes(".pi-write-"),
		);
		assert.deepEqual(leftovers, []);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the write lane refuses a machine whose sandbox cannot start", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(workspace, { recursive: true });
		// The stand-in answers the probe of the sandbox with a failure:
		// the machine has no boundary for the worker, and the worker of a
		// write has write rights.
		standInWithoutSandbox(
			dir.dir,
			"codex",
			`const fs = require("fs");
fs.writeFileSync("plan.md", "# the plan\\n");
process.stdout.write(JSON.stringify({ item: { type: "agent_message", text: "written" } }) + "\\n");`,
		);
		const { runtime, cleanup } = makeRuntime({
			env: { ...pathWith(dir.dir), PI_AGENT_COMMUNICATION_UNSANDBOXED: "" },
		});
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["plan.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		// The worker of the write is not started: it would run with the
		// rights of the user, and the copy is no boundary for it.
		assert.equal(outcome.status, "refused");
		assert.match(outcome.diagnostic, /sandbox/);
		assert.equal(existsSync(join(workspace, "plan.md")), false);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("the write lane refuses a named path that is a link in the copy", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(workspace, { recursive: true });
		const secret = join(dir.dir, "secret.txt");
		writeFileSync(secret, "the secret of the user\n", "utf8");
		// The worker replaces the named file with a link to a file of the
		// user: a read that follows the link would copy the content of
		// that file into the workspace.
		standIn(
			dir.dir,
			"codex",
			`const fs = require("fs");
fs.symlinkSync(${JSON.stringify(secret)}, "plan.md");
process.stdout.write(JSON.stringify({ item: { type: "agent_message", text: "written" } }) + "\\n");`,
		);
		const { runtime, cleanup } = makeRuntime({ env: pathWith(dir.dir) });
		const outcome = await writeThroughWorker(runtime, {
			workspace,
			target: "codex",
			paths: ["plan.md"],
			prompt: "write the plan",
			sender: SENDER,
		});
		assert.equal(outcome.status, "refused");
		assert.match(outcome.diagnostic, /link/);
		// The content of the file of the user is not in the workspace.
		assert.equal(existsSync(join(workspace, "plan.md")), false);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});

test("a consult that fails before the worker starts leaves no copy behind", async () => {
	const dir = temporary();
	try {
		const workspace = join(dir.dir, "workspace");
		mkdirSync(workspace, { recursive: true });
		writeFileSync(join(workspace, "project.txt"), "the project\n", "utf8");
		standIn(dir.dir, "codex", `process.stdout.write("x");`);
		const stagingRoot = join(dir.dir, "staging");
		mkdirSync(stagingRoot, { recursive: true });
		const { runtime, cleanup } = makeRuntime({
			env: pathWith(dir.dir),
			stagingRoot,
			adapters: {
				codex: {
					target: "codex",
					binary: join(dir.dir, "codex"),
					// The arguments of the worker cannot be read: the
					// job fails before the worker starts.
					get argv() {
						throw new Error("the arguments are broken");
					},
				},
			},
		});
		const started = runtime.start({
			target: "codex",
			prompt: "what is this?",
			workspace,
			timeoutMs: 10_000,
			sender: SENDER,
		});
		const result = await runtime.wait(started.jobId, 15_000);
		assert.equal(result.status, "failed");
		// The copy of the project of the user is gone: a failed consult
		// does not leave a copy of the project in the temporary
		// directory.
		assert.deepEqual(readdirSync(stagingRoot), []);
		await runtime.stop();
		cleanup();
	} finally {
		dir.cleanup();
	}
});
