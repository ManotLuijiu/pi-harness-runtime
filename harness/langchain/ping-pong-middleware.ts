import { randomUUID, createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHerdrWorkspace } from "../../packages/event-bus/src/herdr-bus.js";
import {
	PingPongDecisionEngine,
	scanCodebaseComplexity,
	type PingPongDecisionOptions,
	type PingPongDecisionResult,
} from "../../packages/intent-analyzer/src/index.js";

export interface PingPongMiddlewareOptions extends PingPongDecisionOptions {
	/** Shared directory watched by LoopDaemon. Defaults to /tmp/herdr-workspace. */
	workspace?: string;
	/** Repository root and blackboard owner. Defaults to process.cwd(). */
	projectRoot?: string;
	/** Agent or terminal identifier for audit records. */
	actorId?: string;
	/** Also enqueue suggest_ping_pong decisions. Default: false. */
	enqueueSuggestions?: boolean;
	/** Test hook for stable timestamps. */
	now?: () => Date;
}

export interface PingPongMiddlewareResult {
	decision: PingPongDecisionResult;
	enqueued: boolean;
	taskId?: string;
	taskFile?: string;
	auditFile: string;
	blackboardFile: string;
}

interface AuditRecord {
	id: string;
	createdAt: string;
	actorId: string;
	projectRoot: string;
	request: string;
	decision: PingPongDecisionResult["decision"];
	score: number;
	thresholds: PingPongDecisionResult["thresholds"];
	reasons: string[];
	enqueued: boolean;
	taskId?: string;
	taskFile?: string;
}

export class PingPongMiddleware {
	private readonly engine: PingPongDecisionEngine;

	constructor(engine = new PingPongDecisionEngine()) {
		this.engine = engine;
	}

	submit(
		request: string,
		options: PingPongMiddlewareOptions = {},
	): PingPongMiddlewareResult {
		const workspace = options.workspace ?? getHerdrWorkspace();
		const projectRoot = options.projectRoot ?? process.cwd();
		const createdAt = (options.now?.() ?? new Date()).toISOString();
		const actorId =
			options.actorId ?? process.env.PI_AGENT_ID ?? process.env.USER ?? "unknown";
		ensureWorkspace(workspace);

		const codebase = options.codebase ?? scanCodebaseComplexity(projectRoot);
		const decision = this.engine.analyze(request, { ...options, codebase });
		const shouldEnqueue =
			decision.decision === "run_ping_pong" ||
			(options.enqueueSuggestions === true &&
				decision.decision === "suggest_ping_pong");

		let taskId: string | undefined;
		let taskFile: string | undefined;
		if (shouldEnqueue) {
			const task = writeInboxTask(
				workspace,
				request,
				decision,
				createdAt,
				actorId,
				projectRoot,
			);
			taskId = task.taskId;
			taskFile = task.taskFile;
		}

		const blackboardFile = writeBlackboardSnapshot(
			projectRoot,
			request,
			decision,
			createdAt,
			taskId,
		);

		const auditFile = join(workspace, "ping-pong-decisions.jsonl");
		const audit: AuditRecord = {
			id: randomUUID(),
			createdAt,
			actorId,
			projectRoot,
			request,
			decision: decision.decision,
			score: decision.score,
			thresholds: decision.thresholds,
			reasons: decision.reasons,
			enqueued: shouldEnqueue,
			taskId,
			taskFile,
		};
		appendFileSync(auditFile, JSON.stringify(audit) + "\n", "utf8");

		return {
			decision,
			enqueued: shouldEnqueue,
			taskId,
			taskFile,
			auditFile,
			blackboardFile,
		};
	}
}

export function submitPingPongIntent(
	request: string,
	options: PingPongMiddlewareOptions = {},
): PingPongMiddlewareResult {
	return new PingPongMiddleware().submit(request, options);
}

function writeBlackboardSnapshot(
	projectRoot: string,
	request: string,
	decision: PingPongDecisionResult,
	createdAt: string,
	taskId?: string,
): string {
	const dir = join(projectRoot, ".write-review");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const statusFile = join(dir, "status.json");
	const now = new Date().toISOString();
	const phase = decision.decision === "run_ping_pong" ? "writing" : "idle";
	const status = {
		projectPath: projectRoot,
		phase,
		writerDone: false,
		writerMessage: request,
		iteration: 0,
		mode: "ping_pong",
		pingPong: {
			decision: decision.decision,
			score: decision.score,
			runThreshold: decision.thresholds.run,
			suggestThreshold: decision.thresholds.suggest,
			reasons: decision.reasons,
			request,
			taskId,
			createdAt,
		},
		createdAt,
		updatedAt: now,
	};
	writeFileSync(statusFile, JSON.stringify(status, null, 2), "utf8");
	return statusFile;
}
function ensureWorkspace(workspace: string): void {
	if (!existsSync(workspace)) mkdirSync(workspace, { recursive: true });
	const dirs = ["payloads", "subscriptions", "leases", "reviews", "code"];
	for (const dir of dirs) {
		const path = join(workspace, dir);
		if (!existsSync(path)) mkdirSync(path, { recursive: true });
	}
}

function writeInboxTask(
	workspace: string,
	request: string,
	decision: PingPongDecisionResult,
	createdAt: string,
	actorId: string,
	projectRoot: string,
): { taskId: string; taskFile: string } {
	const hash = createHash("sha256").update(request).digest("hex").slice(0, 10);
	const nonce = randomUUID().slice(0, 8);
	const taskId = "ping-pong-" + Date.now() + "-" + hash + "-" + nonce;
	const taskFile = join(workspace, taskId + ".md");
	const body = [
		"---",
		"kind: ping-pong",
		"createdAt: " + createdAt,
		"actorId: " + actorId,
		"projectRoot: " + projectRoot,
		"decision: " + decision.decision,
		"score: " + decision.score,
		"runThreshold: " + decision.thresholds.run,
		"---",
		"",
		request.trim(),
		"",
	].join("\n");
	writeFileSync(taskFile, body, "utf8");
	return { taskId: taskId + ".md", taskFile };
}
