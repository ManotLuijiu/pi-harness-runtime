/**
 * Local Runtime Agent — RFC-0024
 *
 * Server-side coordinator for local browser agent (RFC-0023).
 * Runs on the server, communicates with browser agent on user's machine.
 *
 * Architecture:
 *   Server Runtime -> HTTP/RPC request -> Local Browser Agent on iMac
 *       -> Playwright persistent profile -> Human login if needed
 *       -> scrape usage/reset time -> return safe quota summary
 *
 * Security Rules:
 * - Never return raw cookies
 * - Never return localStorage
 * - Bind to localhost by default
 * - If remote access needed, require VPN/Tailscale and token
 * - Log only safe summaries
 */

import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";

export interface QuotaSummary {
	provider: string;
	authenticated: boolean;
	checkedAt: string;
	usageTextSample?: string;
	resetAt?: string;
	quotaUsedPct?: number;
	quotaResetIn?: string;
}

export interface AuthSession {
	provider: string;
	startedAt: string;
	lastCheckedAt: string;
	authenticated: boolean;
}

export interface LocalRuntimeAgentConfig {
	/** Port to listen on (default: 3847) */
	port?: number;
	/** Host to bind to (default: localhost) */
	host?: string;
	/** Secret token for authentication (optional) */
	authToken?: string;
	/** Local browser agent URL (default: http://localhost:3848) */
	browserAgentUrl?: string;
	/** Request timeout in ms (default: 30000) */
	requestTimeoutMs?: number;
}

export interface LocalRuntimeAgentEvents {
	onQuotaChecked: (summary: QuotaSummary) => void;
	onAuthStarted: (provider: string) => void;
	onAuthCompleted: (provider: string) => void;
	onError: (error: Error) => void;
}

const DEFAULT_CONFIG: Required<Omit<LocalRuntimeAgentConfig, "authToken">> = {
	port: 3847,
	host: "localhost",
	browserAgentUrl: "http://localhost:3848",
	requestTimeoutMs: 30000,
};

export class LocalRuntimeAgent extends EventEmitter {
	private readonly config: LocalRuntimeAgentConfig & Required<Omit<LocalRuntimeAgentConfig, "authToken">>;
	private server: Server | null = null;
	private authSessions: Map<string, AuthSession> = new Map();
	private isRunning = false;

	constructor(config: LocalRuntimeAgentConfig = {}) {
		super();
		this.config = {
			port: DEFAULT_CONFIG.port,
			host: DEFAULT_CONFIG.host,
			browserAgentUrl: DEFAULT_CONFIG.browserAgentUrl,
			requestTimeoutMs: DEFAULT_CONFIG.requestTimeoutMs,
			...config,
		};
	}

	/**
	 * Start the Local Runtime Agent server
	 */
	async start(): Promise<void> {
		if (this.isRunning) {
			throw new Error("Local Runtime Agent is already running");
		}

		return new Promise((resolve, reject) => {
			this.server = createServer(async (req, res) => {
				try {
					await this.handleRequest(req, res);
				} catch (error) {
					this.emitError(error);
					this.sendJson(res, 500, { error: "Internal server error" });
				}
			});

			this.server.on("error", (error) => {
				this.emitError(error);
				reject(error);
			});

			this.server.listen(this.config.port, this.config.host, () => {
				this.isRunning = true;
				console.log(
					`[LocalRuntimeAgent] Listening on ${this.config.host}:${this.config.port}`,
				);
				resolve();
			});
		});
	}

	/**
	 * Stop the Local Runtime Agent server
	 */
	async stop(): Promise<void> {
		return new Promise((resolve) => {
			if (!this.server) {
				resolve();
				return;
			}

			this.server.close(() => {
				this.isRunning = false;
				this.server = null;
				console.log("[LocalRuntimeAgent] Stopped");
				resolve();
			});
		});
	}

	/**
	 * Check if the agent is running
	 */
	isListening(): boolean {
		return this.isRunning;
	}

	/**
	 * Get quota summary for a provider via local browser agent
	 */
	async getQuota(provider: string): Promise<QuotaSummary> {
		const url = `${this.config.browserAgentUrl}/quota/${provider}`;
		const response = await this.fetchWithTimeout(url);

		if (!response.ok) {
			throw new Error(
				`Failed to get quota: ${response.status} ${response.statusText}`,
			);
		}

		const data = (await response.json()) as QuotaSummary;

		// Ensure safe response (redact any sensitive data)
		const safeData = this.redactQuotaResponse(data);

		// Track session
		this.trackQuotaCheck(provider, safeData);

		return safeData;
	}

	/**
	 * Start authentication flow for a provider
	 */
	async startAuth(
		provider: string,
	): Promise<{ started: boolean; message: string }> {
		const session: AuthSession = {
			provider,
			startedAt: new Date().toISOString(),
			lastCheckedAt: new Date().toISOString(),
			authenticated: false,
		};

		this.authSessions.set(provider, session);
		this.emit("authStarted", provider);

		const url = `${this.config.browserAgentUrl}/auth/${provider}/start`;
		const response = await this.fetchWithTimeout(url);

		if (!response.ok) {
			return {
				started: false,
				message: `Failed to start auth: ${response.statusText}`,
			};
		}

		return {
			started: true,
			message: `Auth flow started for ${provider}. Please complete login on your local browser.`,
		};
	}

	/**
	 * Check authentication status for a provider
	 */
	async checkAuth(
		provider: string,
	): Promise<{ authenticated: boolean; since?: string }> {
		const session = this.authSessions.get(provider);
		const url = `${this.config.browserAgentUrl}/auth/${provider}/status`;

		try {
			const response = await this.fetchWithTimeout(url);
			if (response.ok) {
				const data = (await response.json()) as { authenticated: boolean };
				return {
					authenticated: data.authenticated,
					since: session?.startedAt,
				};
			}
		} catch {
			// Browser agent not reachable
		}

		return {
			authenticated: session?.authenticated ?? false,
			since: session?.startedAt,
		};
	}

	/**
	 * Get all active auth sessions
	 */
	getAuthSessions(): AuthSession[] {
		return Array.from(this.authSessions.values());
	}

	// ─── Private Methods ────────────────────────────────────────────────

	private async handleRequest(
		req: import("node:http").IncomingMessage,
		res: import("node:http").ServerResponse,
	): Promise<void> {
		const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
		const path = url.pathname;
		const method = req.method ?? "GET";

		// Authenticate request
		if (!this.authenticateRequest(req, res)) {
			return;
		}

		// Route requests
		switch (path) {
			case "/health":
				this.handleHealth(res);
				break;

			case `/quota/${url.pathname.split("/")[2]}`:
				if (method === "GET") {
					await this.handleQuota(res, url.pathname.split("/")[2]);
				} else {
					this.sendJson(res, 405, { error: "Method not allowed" });
				}
				break;

			case `/auth/${url.pathname.split("/")[2]}/start`:
				if (method === "POST") {
					await this.handleAuthStart(res, url.pathname.split("/")[2]);
				} else {
					this.sendJson(res, 405, { error: "Method not allowed" });
				}
				break;

			case `/auth/${url.pathname.split("/")[2]}/reset`:
				if (method === "POST") {
					await this.handleAuthReset(res, url.pathname.split("/")[2]);
				} else {
					this.sendJson(res, 405, { error: "Method not allowed" });
				}
				break;

			case "/sessions":
				this.handleSessions(res);
				break;

			default:
				this.sendJson(res, 404, { error: "Not found" });
		}
	}

	private authenticateRequest(
		req: import("node:http").IncomingMessage,
		res: import("node:http").ServerResponse,
	): boolean {
		// No auth token configured - allow all
		if (!this.config.authToken) {
			return true;
		}

		const authHeader = req.headers.authorization;
		if (!authHeader) {
			this.sendJson(res, 401, { error: "Authorization required" });
			return false;
		}

		const token = authHeader.replace(/^Bearer\s+/i, "");
		if (token !== this.config.authToken) {
			this.sendJson(res, 403, { error: "Invalid token" });
			return false;
		}

		return true;
	}

	private async handleHealth(
		res: import("node:http").ServerResponse,
	): Promise<void> {
		const healthy = this.isRunning;

		// Check if browser agent is reachable
		let browserAgentHealthy = false;
		try {
			const response = await this.fetchWithTimeout(
				`${this.config.browserAgentUrl}/health`,
			);
			browserAgentHealthy = response.ok;
		} catch {
			// Browser agent not reachable
		}

		this.sendJson(res, healthy ? 200 : 503, {
			status: healthy ? "healthy" : "unhealthy",
			localRuntimeAgent: healthy,
			browserAgent: browserAgentHealthy ? "reachable" : "unreachable",
			timestamp: new Date().toISOString(),
		});
	}

	private async handleQuota(
		res: import("node:http").ServerResponse,
		provider: string,
	): Promise<void> {
		try {
			const summary = await this.getQuota(provider);
			this.sendJson(res, 200, summary);
		} catch (error) {
			this.sendJson(res, 500, {
				error: error instanceof Error ? error.message : "Failed to get quota",
			});
		}
	}

	private async handleAuthStart(
		res: import("node:http").ServerResponse,
		provider: string,
	): Promise<void> {
		const result = await this.startAuth(provider);
		this.sendJson(res, result.started ? 200 : 500, result);
	}

	private async handleAuthReset(
		res: import("node:http").ServerResponse,
		provider: string,
	): Promise<void> {
		try {
			const url = `${this.config.browserAgentUrl}/auth/${provider}/reset`;
			const response = await this.fetchWithTimeout(url, { method: "POST" });

			if (response.ok) {
				this.authSessions.delete(provider);
				this.sendJson(res, 200, { message: "Auth session reset" });
			} else {
				this.sendJson(res, response.status, { error: "Failed to reset auth" });
			}
		} catch (error) {
			this.sendJson(res, 500, {
				error: error instanceof Error ? error.message : "Failed to reset auth",
			});
		}
	}

	private handleSessions(res: import("node:http").ServerResponse): void {
		this.sendJson(res, 200, {
			sessions: this.getAuthSessions(),
		});
	}

	private async fetchWithTimeout(
		url: string,
		options: RequestInit = {},
	): Promise<Response> {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(),
			this.config.requestTimeoutMs,
		);

		try {
			const response = await fetch(url, {
				...options,
				signal: controller.signal,
			});
			return response;
		} finally {
			clearTimeout(timeout);
		}
	}

	private redactQuotaResponse(data: QuotaSummary): QuotaSummary {
		// Ensure no raw cookies, tokens, or sensitive data are included
		const safe: QuotaSummary = {
			provider: data.provider,
			authenticated: data.authenticated,
			checkedAt: data.checkedAt,
		};

		// Only include safe fields
		if (data.usageTextSample) {
			// Truncate and redact any potential sensitive patterns
			safe.usageTextSample = this.redactText(data.usageTextSample);
		}

		if (data.resetAt) {
			safe.resetAt = data.resetAt;
		}

		if (data.quotaUsedPct !== undefined) {
			safe.quotaUsedPct = data.quotaUsedPct;
		}

		if (data.quotaResetIn) {
			safe.quotaResetIn = data.quotaResetIn;
		}

		return safe;
	}

	private redactText(text: string): string {
		// Redact potential tokens, cookies, session IDs
		return text
			.replace(/[A-Za-z0-9+/]{32,}={0,2}/g, "[REDACTED]") // Long base64 strings
			.replace(/session[_-]?id["\s:=]+[^\s&"]+/gi, "session_id=[REDACTED]")
			.replace(/token["\s:=]+[^\s&"]+/gi, "token=[REDACTED]")
			.replace(/cookie["\s:=]+[^\s&"]+/gi, "cookie=[REDACTED]");
	}

	private trackQuotaCheck(provider: string, summary: QuotaSummary): void {
		const existing = this.authSessions.get(provider);
		if (existing) {
			existing.lastCheckedAt = new Date().toISOString();
			existing.authenticated = summary.authenticated;
		}

		this.emit("quotaChecked", summary);
	}

	private emitError(error: unknown): void {
		const err = error instanceof Error ? error : new Error(String(error));
		this.emit("error", err);
		console.error("[LocalRuntimeAgent] Error:", err.message);
	}

	private sendJson(
		res: import("node:http").ServerResponse,
		status: number,
		data: unknown,
	): void {
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(data));
	}
}

/**
 * Create a LocalRuntimeAgent with default config for harness runtime
 */
export function createHarnessRuntimeAgent(): LocalRuntimeAgent {
	return new LocalRuntimeAgent({
		port: 3847,
		host: "localhost",
		browserAgentUrl: "http://localhost:3848",
		requestTimeoutMs: 30000,
	});
}
