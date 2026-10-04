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
export declare class LocalRuntimeAgent extends EventEmitter {
    private readonly config;
    private server;
    private authSessions;
    private isRunning;
    constructor(config?: LocalRuntimeAgentConfig);
    /**
     * Start the Local Runtime Agent server
     */
    start(): Promise<void>;
    /**
     * Stop the Local Runtime Agent server
     */
    stop(): Promise<void>;
    /**
     * Check if the agent is running
     */
    isListening(): boolean;
    /**
     * Get quota summary for a provider via local browser agent
     */
    getQuota(provider: string): Promise<QuotaSummary>;
    /**
     * Start authentication flow for a provider
     */
    startAuth(provider: string): Promise<{
        started: boolean;
        message: string;
    }>;
    /**
     * Check authentication status for a provider
     */
    checkAuth(provider: string): Promise<{
        authenticated: boolean;
        since?: string;
    }>;
    /**
     * Get all active auth sessions
     */
    getAuthSessions(): AuthSession[];
    private handleRequest;
    private authenticateRequest;
    private handleHealth;
    private handleQuota;
    private handleAuthStart;
    private handleAuthReset;
    private handleSessions;
    private fetchWithTimeout;
    private redactQuotaResponse;
    private redactText;
    private trackQuotaCheck;
    private emitError;
    private sendJson;
}
/**
 * Create a LocalRuntimeAgent with default config for harness runtime
 */
export declare function createHarnessRuntimeAgent(): LocalRuntimeAgent;
//# sourceMappingURL=local-runtime-agent.d.ts.map