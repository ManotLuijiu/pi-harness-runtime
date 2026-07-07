/**
 * Runtime API — RFC-0027
 *
 * HTTP/RPC API for runtime control, job management, and status queries.
 *
 * Endpoints:
 * - GET  /health              - Health check
 * - GET  /jobs                - List jobs
 * - POST /jobs                - Create job
 * - GET  /jobs/:id            - Get job status
 * - POST /jobs/:id/start      - Start job
 * - POST /jobs/:id/pause      - Pause job
 * - POST /jobs/:id/resume     - Resume job
 * - POST /jobs/:id/cancel     - Cancel job
 * - GET  /jobs/:id/tasks       - List tasks
 * - GET  /jobs/:id/tasks/:tid - Get task status
 * - POST /jobs/:id/tasks/:tid - Update task
 * - GET  /quota               - Get quota status
 * - GET  /config              - Get runtime config
 * - PUT  /config              - Update runtime config
 * - WS   /ws                  - WebSocket for real-time events
 */

import { createServer, type Server, type IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { URL } from "node:url";
import { EventEmitter } from "node:events";
import type { JobStateMachine } from "../../harness/job-state-machine.js";
import type { TaskGraphManager } from "../../harness/task-graph.js";
import type { CheckpointManager } from "../../harness/job-state-machine.js";

export interface RuntimeApiConfig {
	/** Port to listen on (default: 3849) */
	port?: number;
	/** Host to bind to (default: localhost) */
	host?: string;
	/** API key for authentication (optional) */
	apiKey?: string;
	/** Enable CORS (default: false) */
	cors?: boolean;
	/** Allowed origins for CORS */
	corsOrigins?: string[];
	/** Enable WebSocket (default: true) */
	enableWebSocket?: boolean;
	/** Request timeout in ms (default: 30000) */
	requestTimeoutMs?: number;
}

export interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
	timestamp: string;
	requestId: string;
}

export interface JobSummary {
	jobId: string;
	requirement: string;
	status: string;
	createdAt: string;
	updatedAt: string;
	progress: {
		total: number;
		done: number;
		running: number;
		failed: number;
	};
}

export interface TaskSummary {
	taskId: string;
	title: string;
	status: string;
	assignedAgent?: string;
	dependencies: string[];
	createdAt: string;
	updatedAt: string;
}

export interface RuntimeStatus {
	running: boolean;
	version: string;
	uptime: number;
	jobs: {
		total: number;
		active: number;
		paused: number;
		completed: number;
	};
}

const DEFAULT_CONFIG: Required<
	Omit<RuntimeApiConfig, "apiKey" | "corsOrigins">
> = {
	port: 3849,
	host: "localhost",
	cors: false,
	enableWebSocket: true,
	requestTimeoutMs: 30000,
};

export class RuntimeApi extends EventEmitter {
	private readonly config: RuntimeApiConfig;
	private server: Server | null = null;
	private wsServer: WebSocketServer | null = null;
	private wsClients: Set<WebSocket> = new Set();
	private isRunning = false;
	private startTime: number = 0;
	private jobMachines: Map<string, JobStateMachine> = new Map();
	private taskGraphs: Map<string, TaskGraphManager> = new Map();
	private checkpoints: Map<string, CheckpointManager> = new Map();
	private requestCounter = 0;

	constructor(config: RuntimeApiConfig = {}) {
		super();
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.startTime = Date.now();
	}

	/**
	 * Start the Runtime API server
	 */
	async start(): Promise<void> {
		if (this.isRunning) {
			throw new Error("Runtime API is already running");
		}

		return new Promise((resolve, reject) => {
			this.server = createServer(async (req, res) => {
				const requestId = this.generateRequestId();

				try {
					// Set timeout
					req.setTimeout(this.config.requestTimeoutMs ?? 30000);

					// Handle CORS
					if (this.config.cors) {
						this.setCorsHeaders(req, res);
					}

					// Authenticate
					if (!this.authenticate(req, res)) {
						return;
					}

					// Handle request
					await this.handleRequest(req, res, requestId);
				} catch (error) {
					console.error(`[RuntimeApi] Request error: ${error}`);
					this.sendJson(
						res,
						500,
						{ error: "Internal server error" },
						requestId,
					);
				}
			});

			this.server.on("error", (error) => {
				reject(error);
			});

			this.server.listen(this.config.port, this.config.host, () => {
				this.isRunning = true;
				this.startTime = Date.now();
				console.log(
					`[RuntimeApi] HTTP server listening on ${this.config.host}:${this.config.port}`,
				);

				// Start WebSocket server
				if (this.config.enableWebSocket) {
					this.startWebSocket();
				}

				resolve();
			});
		});
	}

	/**
	 * Stop the Runtime API server
	 */
	async stop(): Promise<void> {
		return new Promise((resolve) => {
			// Close WebSocket server
			if (this.wsServer) {
				this.wsServer.close();
				this.wsServer = null;
			}

			// Close all WebSocket clients
			for (const client of Array.from(this.wsClients)) {
				client.close();
			}
			this.wsClients.clear();

			// Close HTTP server
			if (this.server) {
				this.server.close(() => {
					this.isRunning = false;
					this.server = null;
					console.log("[RuntimeApi] Stopped");
					resolve();
				});
			} else {
				resolve();
			}
		});
	}

	/**
	 * Register a job machine
	 */
	registerJob(jobId: string, machine: JobStateMachine): void {
		this.jobMachines.set(jobId, machine);
	}

	/**
	 * Register a task graph
	 */
	registerTaskGraph(jobId: string, graph: TaskGraphManager): void {
		this.taskGraphs.set(jobId, graph);
	}

	/**
	 * Register a checkpoint manager
	 */
	registerCheckpointManager(jobId: string, manager: CheckpointManager): void {
		this.checkpoints.set(jobId, manager);
	}

	/**
	 * Emit an event to all WebSocket clients
	 */
	broadcast(event: string, data: unknown): void {
		const message = JSON.stringify({
			event,
			data,
			timestamp: new Date().toISOString(),
		});

		for (const client of Array.from(this.wsClients)) {
			if (client.readyState === WebSocket.OPEN) {
				client.send(message);
			}
		}
	}

	// ─── Private Methods ────────────────────────────────────────────────

	private startWebSocket(): void {
		this.wsServer = new WebSocketServer({
			noServer: true,
		});

		this.server?.on("upgrade", (request, socket, head) => {
			const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
			if (url.pathname === "/ws") {
				this.wsServer?.handleUpgrade(request, socket, head, (ws) => {
					this.wsServer?.emit("connection", ws, request);
				});
			}
		});

		this.wsServer.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
			this.wsClients.add(ws);
			console.log("[RuntimeApi] WebSocket client connected");

			ws.on("close", () => {
				this.wsClients.delete(ws);
				console.log("[RuntimeApi] WebSocket client disconnected");
			});

			ws.on("error", (error: Error) => {
				console.error("[RuntimeApi] WebSocket error:", error);
				this.wsClients.delete(ws);
			});

			// Send welcome message
			ws.send(
				JSON.stringify({
					event: "connected",
					data: { message: "Connected to Runtime API" },
					timestamp: new Date().toISOString(),
				}),
			);
		});
	}

	private authenticate(
		req: IncomingMessage,
		res: import("node:http").ServerResponse,
	): boolean {
		if (!this.config.apiKey) {
			return true;
		}

		const apiKey = req.headers["x-api-key"];
		if (apiKey !== this.config.apiKey) {
			this.sendJson(
				res,
				401,
				{ error: "Unauthorized" },
				this.generateRequestId(),
			);
			return false;
		}

		return true;
	}

	private setCorsHeaders(
		req: IncomingMessage,
		res: import("node:http").ServerResponse,
	): void {
		const origin = req.headers.origin;
		const allowedOrigins = this.config.corsOrigins ?? ["*"];

		if (
			allowedOrigins.includes("*") ||
			(origin && allowedOrigins.includes(origin))
		) {
			res.setHeader("Access-Control-Allow-Origin", origin ?? "*");
			res.setHeader(
				"Access-Control-Allow-Methods",
				"GET, POST, PUT, DELETE, OPTIONS",
			);
			res.setHeader(
				"Access-Control-Allow-Headers",
				"Content-Type, Authorization, X-Api-Key",
			);
		}
	}

	private async handleRequest(
		req: IncomingMessage,
		res: import("node:http").ServerResponse,
		requestId: string,
	): Promise<void> {
		const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
		const path = url.pathname;
		const method = req.method ?? "GET";

		// Handle OPTIONS for CORS
		if (method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		// Route requests
		if (path === "/health" && method === "GET") {
			this.handleHealth(res, requestId);
		} else if (path === "/status" && method === "GET") {
			this.handleStatus(res, requestId);
		} else if (path === "/jobs" && method === "GET") {
			await this.handleListJobs(res, requestId);
		} else if (path === "/jobs" && method === "POST") {
			await this.handleCreateJob(req, res, requestId);
		} else if (path === "/quota" && method === "GET") {
			await this.handleGetQuota(res, requestId);
		} else if (path === "/config" && method === "GET") {
			this.handleGetConfig(res, requestId);
		} else if (path.match(/^\/jobs\/([^/]+)\/?$/)) {
			const jobId = path.match(/^\/jobs\/([^/]+)\/?$/)?.[1];
			if (jobId) {
				await this.handleJob(jobId, method, url, req, res, requestId);
			}
		} else {
			this.sendJson(res, 404, { error: "Not found" }, requestId);
		}
	}

	private handleHealth(
		res: import("node:http").ServerResponse,
		requestId: string,
	): void {
		this.sendJson(res, 200, { status: "healthy" }, requestId);
	}

	private handleStatus(
		res: import("node:http").ServerResponse,
		requestId: string,
	): void {
		const status: RuntimeStatus = {
			running: this.isRunning,
			version: "1.0.0",
			uptime: Date.now() - this.startTime,
			jobs: {
				total: this.jobMachines.size,
				active: 0,
				paused: 0,
				completed: 0,
			},
		};

		// Count job statuses
		for (const machine of Array.from(this.jobMachines.values())) {
			const summary = machine.getStatusSummary();
			if (summary) {
				if (summary.status === "running") status.jobs.active++;
				else if (
					summary.status === "paused" ||
					summary.status === "paused_quota"
				)
					status.jobs.paused++;
				else if (summary.isTerminal) status.jobs.completed++;
			}
		}

		this.sendJson(res, 200, status, requestId);
	}

	private async handleListJobs(
		res: import("node:http").ServerResponse,
		requestId: string,
	): Promise<void> {
		const jobs: JobSummary[] = [];

		for (const entry of Array.from(this.jobMachines.entries())) {
			const [jobId, machine] = entry;
			const checkpoint = await machine.getCheckpoint();
			const graph = this.taskGraphs.get(jobId);

			// Get progress from task graph
			let progress = { total: 0, done: 0, running: 0, failed: 0 };
			if (graph) {
				try {
					const tasks = graph.getAllTasks();
					progress = {
						total: tasks.length,
						done: tasks.filter((t) => t.status === "done").length,
						running: tasks.filter((t) => t.status === "running").length,
						failed: tasks.filter((t) => t.status === "failed").length,
					};
				} catch {
					// Fallback to default
				}
			}

			jobs.push({
				jobId,
				requirement: checkpoint?.requirement ?? "Unknown",
				status: machine.getStatusSummary()?.status ?? "unknown",
				createdAt: checkpoint?.createdAt ?? new Date().toISOString(),
				updatedAt: checkpoint?.updatedAt ?? new Date().toISOString(),
				progress,
			});
		}

		this.sendJson(res, 200, { jobs }, requestId);
	}

	private async handleCreateJob(
		_req: IncomingMessage,
		res: import("node:http").ServerResponse,
		requestId: string,
	): Promise<void> {
		let body = "";

		for await (const chunk of _req) {
			body += chunk;
		}

		let data: { requirement?: string };
		try {
			data = JSON.parse(body);
		} catch {
			this.sendJson(res, 400, { error: "Invalid JSON" }, requestId);
			return;
		}

		if (!data.requirement) {
			this.sendJson(
				res,
				400,
				{ error: "Missing 'requirement' field" },
				requestId,
			);
			return;
		}

		// In a real implementation, this would create a new job
		// For now, just acknowledge the request
		this.sendJson(
			res,
			201,
			{
				message: "Job creation not implemented - use harness CLI",
				requirement: data.requirement,
			},
			requestId,
		);
	}

	private async handleJob(
		jobId: string,
		method: string,
		url: URL,
		req: IncomingMessage,
		res: import("node:http").ServerResponse,
		requestId: string,
	): Promise<void> {
		const machine = this.jobMachines.get(jobId);

		if (!machine) {
			this.sendJson(res, 404, { error: "Job not found" }, requestId);
			return;
		}

		// Get job details
		if (method === "GET") {
			const checkpoint = await machine.getCheckpoint();
				const graph = this.taskGraphs.get(jobId);
				// Get progress from task graph
				let progress = { total: 0, done: 0, running: 0, failed: 0 };
				if (graph) {
					try {
						const tasks = graph.getAllTasks();
						progress = {
							total: tasks.length,
							done: tasks.filter((t) => t.status === "done").length,
							running: tasks.filter((t) => t.status === "running").length,
							failed: tasks.filter((t) => t.status === "failed").length,
						};
					} catch {
						// Fallback to default
					}
				}

			this.sendJson(
				res,
				200,
				{
					jobId,
					requirement: checkpoint?.requirement ?? "Unknown",
					status: machine.getStatusSummary()?.status ?? "unknown",
					canResume: machine.getStatusSummary()?.canResume ?? false,
					isTerminal: machine.getStatusSummary()?.isTerminal ?? false,
					progress,
					checkpoint,
				},
				requestId,
			);
			return;
		}

		// Job actions
		const action = url.searchParams.get("action");

		switch (method) {
			case "POST":
				if (action === "start") {
					await machine.resumeJob(jobId);
					this.broadcast("job.started", { jobId });
					this.sendJson(res, 200, { message: "Job started", jobId }, requestId);
				} else if (action === "pause") {
					const result = await machine.transition("paused");
					this.broadcast("job.paused", { jobId });
					this.sendJson(
						res,
						200,
						{ message: "Job paused", jobId, result },
						requestId,
					);
				} else if (action === "resume") {
					await machine.resumeJob(jobId);
					this.broadcast("job.resumed", { jobId });
					this.sendJson(res, 200, { message: "Job resumed", jobId }, requestId);
				} else if (action === "cancel") {
					const result = await machine.transition("cancelled");
					this.broadcast("job.cancelled", { jobId });
					this.sendJson(
						res,
						200,
						{ message: "Job cancelled", jobId, result },
						requestId,
					);
				} else {
					this.sendJson(res, 400, { error: "Unknown action" }, requestId);
				}
				break;

			default:
				this.sendJson(res, 405, { error: "Method not allowed" }, requestId);
		}
	}

	private async handleGetQuota(
		res: import("node:http").ServerResponse,
		requestId: string,
	): Promise<void> {
		// In a real implementation, this would query the quota manager
		this.sendJson(
			res,
			200,
			{
				message: "Quota endpoint - integrate with packages/quota-manager",
				usage: {
					h5_used_pct: 0,
					weekly_used_pct: 0,
				},
			},
			requestId,
		);
	}

	private handleGetConfig(
		res: import("node:http").ServerResponse,
		requestId: string,
	): void {
		// Don't expose sensitive config
		this.sendJson(
			res,
			200,
			{
				port: this.config.port,
				host: this.config.host,
				cors: this.config.cors,
				enableWebSocket: this.config.enableWebSocket,
				requestTimeoutMs: this.config.requestTimeoutMs,
				// Expose version without exposing apiKey
				version: "1.0.0",
			},
			requestId,
		);
	}

	private sendJson(
		res: import("node:http").ServerResponse,
		status: number,
		data: unknown,
		requestId: string,
	): void {
		const response: ApiResponse = {
			success: status >= 200 && status < 300,
			...(status >= 200 && status < 300
				? { data }
				: { error: (data as { error?: string }).error }),
			timestamp: new Date().toISOString(),
			requestId,
		};

		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(response));
	}

	private generateRequestId(): string {
		this.requestCounter++;
		return `req_${Date.now().toString(36)}_${this.requestCounter.toString(36)}`;
	}
}

/**
 * Create RuntimeApi with default config for harness runtime
 */
export function createHarnessRuntimeApi(): RuntimeApi {
	return new RuntimeApi({
		port: 3849,
		host: "localhost",
		enableWebSocket: true,
		requestTimeoutMs: 30000,
	});
}
