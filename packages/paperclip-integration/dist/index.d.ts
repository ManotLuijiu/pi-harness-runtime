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
    identifier: string;
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
export declare class PaperclipClient {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly headers;
    constructor(config: PaperclipConfig);
    /**
     * Get current agent's identity and company context
     */
    getAgentMe(): Promise<PaperclipAgentMe>;
    /**
     * Get inbox issues assigned to this agent (mine-tab equivalent)
     */
    getInbox(companyId: string): Promise<PaperclipIssue[]>;
    /**
     * Get a single issue by ID or human-readable identifier
     */
    getIssue(issueIdOrIdentifier: string): Promise<PaperclipIssue>;
    /**
     * Update issue status
     */
    updateIssueStatus(issueIdOrIdentifier: string, status: string): Promise<PaperclipIssue>;
    /**
     * Add a comment to an issue
     */
    addComment(issueId: string, body: string): Promise<void>;
    private request;
}
export interface PaperclipWatcherOptions {
    /** pi-harness Telegram nc() helper */
    nc: (event: string, ctx: Record<string, unknown>) => Promise<void>;
    /** pi.dev sendUserMessage function */
    sendUserMessage: (content: string, opts?: {
        deliverAs?: string;
    }) => void;
    /** Optional: update Paperclip issue status after routing */
    onRouted?: (issue: PaperclipIssue) => Promise<void>;
    /** Poll interval in ms (default: 30s) */
    pollIntervalMs?: number;
}
export declare class PaperclipWatcher {
    private client;
    private options;
    private timer;
    private seenIds;
    private companyId;
    private agentName;
    constructor(config: PaperclipConfig, options: PaperclipWatcherOptions);
    /**
     * Start polling the Paperclip inbox
     */
    start(): Promise<void>;
    /**
     * Stop polling
     */
    stop(): void;
    /**
     * Manually trigger a poll (useful after Telegram command)
     */
    pollNow(): Promise<void>;
    private poll;
}
/**
 * Check if Paperclip is configured
 */
export declare function hasPaperclipConfig(): boolean;
/**
 * Get Paperclip config from environment / keys file
 */
export declare function getPaperclipConfig(): PaperclipConfig | null;
//# sourceMappingURL=index.d.ts.map