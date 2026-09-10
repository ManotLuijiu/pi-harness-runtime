import { describe, it } from "node:test";
import { equal, ok } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PingPongMiddleware } from "./ping-pong-middleware.js";

describe("PingPongMiddleware", () => {
	it("records explicit PING-PONG decisions in blackboard and inbox", () => {
		const projectRoot = mkdtempSync(join(tmpdir(), "ping-pong-project-"));
		const workspace = mkdtempSync(join(tmpdir(), "ping-pong-workspace-"));
		try {
			const result = new PingPongMiddleware().submit(
				"Good plan, then write down plan to wiki/ then I will ask Minimax to write code then you review",
				{
					projectRoot,
					workspace,
					actorId: "test-agent",
					now: () => new Date("2026-09-10T00:00:00.000Z"),
				},
			);

			equal(result.enqueued, true);
			ok(result.taskFile);
			ok(result.taskId?.endsWith(".md"));
			const taskBody = readFileSync(result.taskFile!, "utf8");
			ok(taskBody.includes("kind: ping-pong"));
			ok(taskBody.includes("ask Minimax to write code"));

			const blackboard = JSON.parse(
				readFileSync(join(projectRoot, ".write-review", "status.json"), "utf8"),
			);
			equal(blackboard.mode, "ping_pong");
			equal(blackboard.phase, "writing");
			equal(blackboard.pingPong.decision, "run_ping_pong");
			equal(blackboard.pingPong.taskId, result.taskId);

			const audit = readFileSync(result.auditFile, "utf8");
			ok(audit.includes("run_ping_pong"));
			ok(audit.includes("test-agent"));
		} finally {
			rmSync(projectRoot, { recursive: true, force: true });
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("records inline decisions without enqueueing", () => {
		const projectRoot = mkdtempSync(join(tmpdir(), "ping-pong-project-"));
		const workspace = mkdtempSync(join(tmpdir(), "ping-pong-workspace-"));
		try {
			const result = new PingPongMiddleware().submit(
				"analyze why the loop is quiet, do not edit code",
				{ projectRoot, workspace, actorId: "test-agent" },
			);

			equal(result.enqueued, false);
			equal(result.taskFile, undefined);
			const blackboard = JSON.parse(
				readFileSync(join(projectRoot, ".write-review", "status.json"), "utf8"),
			);
			equal(blackboard.mode, "ping_pong");
			equal(blackboard.phase, "idle");
			equal(blackboard.pingPong.decision, "handle_inline");
		} finally {
			rmSync(projectRoot, { recursive: true, force: true });
			rmSync(workspace, { recursive: true, force: true });
		}
	});
});
