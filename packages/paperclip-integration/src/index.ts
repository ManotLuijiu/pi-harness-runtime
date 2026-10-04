/**
 * Paperclip Integration — RFC-00XX
 *
 * Connects pi-harness-runtime to Paperclip's control plane.
 *
 * Architecture:
 *   Paperclip (control plane) → REST API → pi-harness inbox watcher
 *   → Telegram alerts → pi.dev agent executes → Paperclip task updates
 *
 * Key flows:
 *   1. Poll Paperclip inbox (assigned tasks) → route to pi.dev via sendUserMessage
 *   2. Emit Telegram alerts for all task state changes
 *   3. Update Paperclip issue status on task completion/failure
 *
 * Paperclip API base: https://api.paperclip.inc/api
 * Auth: Bearer token (agent API key)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaperclipConfig {
	/** Paperclip API base URL */
	baseUrl: string;
	/** Agent API key (bearer token) */
	apiKey: string;
	/** Company ID for company-scoped endpoints */
	companyId?: string;
	/** Poll interval in ms (default: 30000 = 30s) */
	pollIntervalMs?: number;
	/** Called with a Telegram-friendly summary when a task is detected */
	onTaskDetected?: (task: PaperclipIssue) => void;
	/** Called when task status changes */
	onTaskStatusChange?: (task: PaperclipIssue, oldStatus: string) => void;
}

export interface PaperclipIssue {
	id: string;
	identifier: string; // e.g. "PAP-39"
	title: string;
	status: string;
	priority?: string;
	assigneeId?: string;
	assigneeName?: string;
	description?: string;
	createdAt: string;
	updatedAt: string;
}

export interface PaperclipAgentMe {
	id: string;
	name: string;
	email: string;
	companyId: string;
	companyName: string;
	role: string;
}

// ---------------------------------------------------------------------------
// Paperclip Client
// ---------------------------------------------------------------------------

export class PaperclipClient {
	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly headers: Record<string, string>;

	constructor(config: PaperclipConfig) {
		this.baseUrl = config.baseUrl.replace(/\/$/, "");
		this.apiKey = config.apiKey;
		this.headers = {
			Authorization: `Bearer ${this.apiKey}`,
			"Content-Type": "application/json",
		};
	}

	/**
	 * Get current agent's identity and company context
	 */
	async getAgentMe(): Promise<PaperclipAgentMe> {
		const res = await this.request<PaperclipAgentMe>("GET", "/api/agents/me");
		return res;
	}

	/**
	 * Get inbox issues assigned to this agent (mine-tab equivalent)
	 */
	async getInbox(companyId: string): Promise<PaperclipIssue[]> {
		const params = new URLSearchParams({
			status: "todo,in_progress,needs_review",
			assigneeId: "me",
		});
		const res = await this.request<{ issues: PaperclipIssue[] }>(
			"GET",
			`/api/companies/${companyId}/issues?${params}`,
		);
		return res.issues ?? [];
	}

	/**
	 * Get a single issue by ID or human-readable identifier
	 */
	async getIssue(issueIdOrIdentifier: string): Promise<PaperclipIssue> {
		// Try as identifier first (PAP-39), then as UUID
		try {
			return await this.request<PaperclipIssue>("GET", `/api/issues/${issueIdOrIdentifier}`);
		} catch {
			return await this.request<PaperclipIssue>(
				"GET",
				`/api/issues/by-identifier/${issueIdOrIdentifier}`,
			);
		}
	}

	/**
	 * Update issue status
	 */
	async updateIssueStatus(
		issueIdOrIdentifier: string,
		status: string,
	): Promise<PaperclipIssue> {
		return this.request<PaperclipIssue>("PATCH", `/api/issues/${issueIdOrIdentifier}`, { body: JSON.stringify({ status }) });
	}

	/**
	 * Add a comment to an issue
	 */
	async addComment(issueId: string, body: string): Promise<void> {
		await this.request("POST", `/api/issues/${issueId}/comments`, { body: JSON.stringify({ body }) });
	}

	private async request<T>(
		method: string,
		path: string,
		options: { body?: string } = {},
	): Promise<T> {
		const url = path.startsWith("http")
			? path
			: `${this.baseUrl}${path}`;

		const res = await fetch(url, {
			method,
			headers: this.headers,
			body: options.body,
		});

		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(
				`Paperclip API ${method} ${path} failed (${res.status}): ${text}`,
			);
		}

		return res.json() as Promise<T>;
	}
}

// ---------------------------------------------------------------------------
// Paperclip Watcher — polls inbox, routes tasks to pi.dev
// ---------------------------------------------------------------------------

export interface PaperclipWatcherOptions {
	/** pi-harness Telegram nc() helper */
	nc: (event: string, ctx: Record<string, unknown>) => Promise<void>;
	/** pi.dev sendUserMessage function */
	sendUserMessage: (content: string, opts?: { deliverAs?: string }) => void;
	/** Optional: update Paperclip issue status after routing */
	onRouted?: (issue: PaperclipIssue) => Promise<void>;
	/** Poll interval in ms (default: 30s) */
	pollIntervalMs?: number;
}

export class PaperclipWatcher {
	private client: PaperclipClient;
	private options: PaperclipWatcherOptions;
	private timer: ReturnType<typeof setInterval> | null = null;
	private seenIds = new Set<string>();
	private companyId: string | null = null;
	private agentName: string = "agent";

	constructor(config: PaperclipConfig, options: PaperclipWatcherOptions) {
		this.client = new PaperclipClient(config);
		this.options = options;
	}

	/**
	 * Start polling the Paperclip inbox
	 */
	async start(): Promise<void> {
		// Fetch agent identity
		try {
			const me = await this.client.getAgentMe();
			this.companyId = me.companyId;
			this.agentName = me.name;
			console.error(`[paperclip] Agent: ${me.name} @ ${me.companyName}`);
		} catch (err) {
			console.error(
				`[paperclip] Failed to get agent identity: ${err instanceof Error ? err.message : String(err)}`,
			);
			return;
		}

		// Initial poll
		await this.poll();

		// Schedule polling
		const interval = this.options.pollIntervalMs ?? 30_000;
		this.timer = setInterval(() => {
			void this.poll();
		}, interval);
	}

	/**
	 * Stop polling
	 */
	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/**
	 * Manually trigger a poll (useful after Telegram command)
	 */
	async pollNow(): Promise<void> {
		await this.poll();
	}

	private async poll(): Promise<void> {
		if (!this.companyId) return;

		try {
			const issues = await this.client.getInbox(this.companyId);

			for (const issue of issues) {
				// Skip already-seen issues
				if (this.seenIds.has(issue.id)) continue;
				this.seenIds.add(issue.id);

				// Route to Telegram
				this.options.nc("TaskCompleted", {
					requirement: `[Paperclip] ${issue.identifier}: ${issue.title}`,
					taskTitle: issue.title,
					taskId: issue.id,
					error: `New task assigned: ${issue.priority ? `P${issue.priority}` : ""}`,
				});

				// Route to pi.dev
				const body = `[Paperclip task assigned to ${this.agentName}]\n\n` +
					`**${issue.identifier}**: ${issue.title}\n` +
					`Status: ${issue.status}${issue.priority ? `\nPriority: ${issue.priority}` : ""}\n` +
					`\n${issue.description ?? ""}`;

				try {
					this.options.sendUserMessage(body, { deliverAs: "steer" });
				} catch {
					// pi.dev may not be ready
				}

				// Mark as in_progress in Paperclip
				this.options.onRouted?.(issue);
			}
		} catch (err) {
			console.error(
				`[paperclip] Poll failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Auto-init from env / keys file
// ---------------------------------------------------------------------------

/**
 * Check if Paperclip is configured
 */
export function hasPaperclipConfig(): boolean {
	const apiKey =
		process.env.PAPERCLIP_API_KEY ||
		process.env.PAPERCLIP_API_KEY;
	if (!apiKey) {
		const homedir = process.env.HOME || process.env.USERPROFILE || "/home/frappe";
		try {
			const { readFileSync, existsSync } = require("fs");
			const path = `${homedir}/.pi-harness-runtime/keys/paperclip-api-key.txt`;
			if (existsSync(path)) {
				const key = readFileSync(path, "utf8").trim();
				return key.length > 10;
			}
		} catch {
			// ignore
		}
	}
	return !!apiKey;
}

/**
 * Get Paperclip config from environment / keys file
 */
export function getPaperclipConfig(): PaperclipConfig | null {
	const homedir = process.env.HOME || process.env.USERPROFILE || "/home/frappe";
	const keysDir = `${homedir}/.pi-harness-runtime/keys`;

	try {
		const { readFileSync, existsSync } = require("fs");

		// Check for config file first (JSON with multiple settings)
		const configPath = `${keysDir}/paperclip-config.json`;
		if (existsSync(configPath)) {
			const config = JSON.parse(readFileSync(configPath, "utf8"));
			if (config.apiKey && config.baseUrl) {
				return {
					apiKey: config.apiKey,
					baseUrl: config.baseUrl,
					companyId: config.companyId,
				};
			}
		}

		// Fallback to individual files
		const apiKeyPath = `${keysDir}/paperclip-api-key.txt`;
		const baseUrlPath = `${keysDir}/paperclip-base-url.txt`;

		if (!existsSync(apiKeyPath)) return null;

		const apiKey = readFileSync(apiKeyPath, "utf8").trim();
		if (!apiKey || apiKey.length < 10) return null;

		// Default to self-hosted server URL
		const baseUrl = existsSync(baseUrlPath)
			? readFileSync(baseUrlPath, "utf8").trim()
			: "https://paperclip.moo-vpn.online/api";

		return { apiKey, baseUrl };
	} catch {
		return null;
	}
}
