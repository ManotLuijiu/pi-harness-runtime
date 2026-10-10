/**
 * Honcho Memory Lifecycle
 *
 * Implements automatic memory ingestion and retrieval for Honcho MCP.
 *
 * Flow:
 * 1. Register MCP server (done in initHoncho)
 * 2. On tool discovery, establish workspace/peer mapping
 * 3. On agent turn complete, ingest sanitized message
 * 4. On agent execution start, retrieve relevant context
 * 5. Inject bounded context with provenance
 */

import { logServiceEvent, honchoStatus } from "./service-diagnostics.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Honcho MCP Configuration (non-destructive)
// ---------------------------------------------------------------------------

const MCP_CONFIG_DIR = join(homedir(), ".config", "mcp");
const MCP_CONFIG_FILE = join(MCP_CONFIG_DIR, "mcp.json");
const HONCHO_KEY_FILE = join(homedir(), ".pi-harness-runtime", "keys", "honcho-api-key.txt");

/**
 * Secrets to redact from messages before transmission.
 * These patterns are checked case-insensitively.
 */
const SECRET_PATTERNS: (string | RegExp)[] = [
	"api[_-]?key",
	"bearer",
	"token",
	"secret",
	"password",
	"credential",
	/honcho[_-]?api[_-]?key/i,
	/minimax[_-]?api[_-]?key/i,
	/openai[_-]?api[_-]?key/i,
];

/**
 * Redact secrets from text content.
 */
function redactSecrets(text: string): string {
	let result = text;
	for (const pattern of SECRET_PATTERNS) {
		if (typeof pattern === "string") {
			// Redact lines containing the pattern (case-insensitive)
			const regex = new RegExp(`^.*${pattern}.*$`, "gi");
			result = result.replace(regex, "[REDACTED]");
		} else {
			// Redact matches of regex pattern
			result = result.replace(pattern, "[REDACTED]");
		}
	}
	return result;
}

/**
 * Ensure MCP config directory exists (non-destructive).
 * Does NOT write config at import time.
 */
export function ensureMcpConfigDirectory(): void {
	if (!existsSync(MCP_CONFIG_DIR)) {
		mkdirSync(MCP_CONFIG_DIR, { recursive: true, mode: 0o755 });
	}
}

/**
 * Load Honcho API key from keys directory.
 * Does NOT write config files.
 */
export function loadHonchoApiKey(): string | undefined {
	if (existsSync(HONCHO_KEY_FILE)) {
		try {
			return readFileSync(HONCHO_KEY_FILE, "utf8").trim() || undefined;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/**
 * Read existing MCP config (non-destructive).
 * Returns null if config doesn't exist or is invalid.
 */
export function readMcpConfig(): Record<string, unknown> | null {
	if (!existsSync(MCP_CONFIG_FILE)) {
		return null;
	}
	try {
		const content = readFileSync(MCP_CONFIG_FILE, "utf8");
		return JSON.parse(content);
	} catch {
		return null;
	}
}

/**
 * Write MCP config atomically (non-destructive).
 * Only updates the Honcho server entry, preserves other entries.
 */
export function writeHonchoMcpConfig(apiKey: string): void {
	ensureMcpConfigDirectory();

	// Read existing config or create new one
	let config: Record<string, unknown> = readMcpConfig() || { mcpServers: {} };
	if (!config.mcpServers || typeof config.mcpServers !== "object") {
		config = { mcpServers: {} };
	}

	// Update Honcho entry
	const mcpServers = config.mcpServers as Record<string, unknown>;
	mcpServers.honcho = {
		url: "https://mcp.honcho.dev",
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	};

	// Atomic write with temp file
	const tempFile = `${MCP_CONFIG_FILE}.tmp`;
	writeFileSync(tempFile, JSON.stringify(config, null, 2), { mode: 0o644 });
	try {
		// Verify the temp file is valid JSON before renaming
		JSON.parse(readFileSync(tempFile, "utf8"));
		renameSync(tempFile, MCP_CONFIG_FILE);
	} catch {
		// Clean up invalid temp file
		try { unlinkSync(tempFile); } catch { /* ignore */ }
		throw new Error("Failed to write valid MCP config");
	}
}

// ---------------------------------------------------------------------------
// Honcho Health Check - Detect suspended accounts
// ---------------------------------------------------------------------------

interface HonchoHealthResponse {
  status: string;
  suspended?: boolean;
  message?: string;
}

let _honchoHealthInterval: ReturnType<typeof setInterval> | null = null;
const HONCHO_HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
const HONCHO_HEALTH_ENDPOINT = "https://api.honcho.dev/v1/health";

async function checkHonchoHealth(): Promise<void> {
  const apiKey = loadHonchoApiKey();

  if (!apiKey) {
    return; // No key, skip health check
  }

  try {
    const response = await fetch(HONCHO_HEALTH_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (response.status === 401 || response.status === 403) {
      console.warn("[honcho] WARNING: API key may be invalid or account suspended");
      console.warn("[honcho] Please reactivate at: https://app.honcho.dev");
      return;
    }

    const data = await response.json().catch(() => ({})) as HonchoHealthResponse;

    if (data.suspended || data.status === "suspended") {
      console.warn("[honcho] WARNING: Honcho account is suspended due to inactivity");
      console.warn("[honcho] Reactivate at: https://app.honcho.dev");
      console.warn("[honcho] Memory features will be unavailable until reactivated");
    }
  } catch (err) {
    // Network errors are not critical, just log
    console.debug("[honcho] Health check failed:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Start periodic Honcho health checks
 */
export function startHonchoHealthCheck(): void {
  if (_honchoHealthInterval) {
    return; // Already running
  }

  // Initial check
  void checkHonchoHealth();

  // Periodic check
  _honchoHealthInterval = setInterval(() => {
    void checkHonchoHealth();
  }, HONCHO_HEALTH_CHECK_INTERVAL);

  console.log("[honcho] Health check started (every 5 minutes)");
}

/**
 * Stop periodic Honcho health checks
 */
export function stopHonchoHealthCheck(): void {
  if (_honchoHealthInterval) {
    clearInterval(_honchoHealthInterval);
    _honchoHealthInterval = null;
    console.log("[honcho] Health check stopped");
  }
}

// ---------------------------------------------------------------------------
// Honcho Memory Implementation
// ---------------------------------------------------------------------------

/**
 * Honcho memory configuration
 */
export interface HonchoMemoryConfig {
  /** Honcho API key */
  apiKey: string;
  /** Workspace ID for memory storage */
  workspaceId?: string;
  /** User peer ID */
  userPeerId?: string;
  /** Assistant peer ID */
  assistantPeerId?: string;
  /** Max context size to inject (chars) */
  maxContextChars?: number;
  /** Enable auto-ingestion */
  autoIngest?: boolean;
}

/**
 * Ingested message record for deduplication
 */
interface IngestedMessage {
  id: string;
  ingestedAt: Date;
}

/**
 * Honcho memory state
 */
export class HonchoMemory {
  private config: HonchoMemoryConfig;
  private ingestedMessages = new Map<string, IngestedMessage>();
  private isConnected = false;
  private toolsDiscovered = false;
  private workspaceId: string | null = null;
  private _disposed = false;

  constructor(config: HonchoMemoryConfig) {
    this.config = {
      maxContextChars: 4000,
      autoIngest: true,
      ...config,
    };
  }

  /**
   * Set connected state
   */
  setConnected(connected: boolean): void {
    this.isConnected = connected;
    honchoStatus.setConnected(connected);
    if (connected) {
      logServiceEvent({
        ts: new Date().toISOString(),
        level: "info",
        service: "honcho",
        operation: "connected",
        phase: "completed",
      });
    }
  }

  /**
   * Set tools discovered state
   */
  setToolsDiscovered(discovered: boolean): void {
    this.toolsDiscovered = discovered;
    if (discovered) {
      logServiceEvent({
        ts: new Date().toISOString(),
        level: "info",
        service: "honcho",
        operation: "tools_discovered",
        phase: "completed",
      });
    }
  }

  /**
   * Set workspace ID after session creation
   */
  setWorkspace(workspaceId: string): void {
    this.workspaceId = workspaceId;
    logServiceEvent({
      ts: new Date().toISOString(),
      level: "info",
      service: "honcho",
      operation: "workspace_created",
      phase: "completed",
      workspaceId,
    });
  }

  /**
   * Check if memory is ready
   */
  isReady(): boolean {
    return this.isConnected && this.toolsDiscovered && !!this.workspaceId;
  }

  /**
   * Generate stable deduplication ID for a message.
   * Uses content hash + event identity (not current time) for retry stability.
   */
  generateMessageId(
    eventId: string,
    role: string,
    content: string,
    timestamp: Date
  ): string {
    // Stable hash: eventId ensures retry stability
    // timestamp is from the original event, not Date.now()
    const data = `${eventId}:${role}:${content}:${timestamp.toISOString()}`;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Sanitize message content for storage.
   * Redacts secrets and enforces total payload bound.
   */
  sanitizeContent(
    content: string | Array<{ type?: string; text?: string }>
  ): { text: string; originalLength: number } {
    let text: string;

    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((block) => block.type === "text")
        .map((block) => (block as { text?: string }).text ?? "")
        .join("\n");
    } else {
      text = String(content);
    }

    const originalLength = text.length;

    // Step 1: Redact secrets before truncation
    text = redactSecrets(text);

    // Step 2: Truncate to per-block limit
    const BLOCK_LIMIT = 2000;
    if (text.length > BLOCK_LIMIT) {
      text = text.slice(0, BLOCK_LIMIT) + "...[truncated]";
    }

    // Step 3: Enforce total payload bound (separate limit for ingestion vs retrieval)
    const TOTAL_LIMIT = 10000;
    if (text.length > TOTAL_LIMIT) {
      text = text.slice(0, TOTAL_LIMIT) + "...[payload truncated]";
    }

    return { text, originalLength };
  }

  /**
   * Call a Honcho MCP tool through the adapter.
   * Returns actual result, never fabricates content.
   */
  private async callHonchoTool(
    _toolName: string,
    _args: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    // This will be implemented when the MCP adapter integration is complete
    // The adapter provides runtime-tool-call:v1 event for this
    // For now, return failure to prevent fake success
    return {
      success: false,
      error: "MCP adapter integration not yet implemented",
    };
  }

  /**
   * Ingest a completed turn message through Honcho MCP.
   * Persists only after verified successful response.
   */
  async ingestMessage(
    role: "user" | "assistant",
    content: string | Array<{ type?: string; text?: string }>,
    timestamp: Date = new Date(),
    eventId: string = `msg-${timestamp.getTime()}`
  ): Promise<{ success: boolean; deduped: boolean; error?: string }> {
    if (this._disposed) {
      return { success: false, deduped: false, error: "memory disposed" };
    }

    if (!this.isReady()) {
      return { success: false, deduped: false, error: "memory not ready" };
    }

    if (!this.config.autoIngest) {
      return { success: false, deduped: false, error: "auto-ingest disabled" };
    }

    const { text: sanitized, originalLength } = this.sanitizeContent(content);
    const messageId = this.generateMessageId(eventId, role, sanitized, timestamp);

    // Check deduplication BEFORE any remote call
    if (this.ingestedMessages.has(messageId)) {
      logServiceEvent({
        ts: new Date().toISOString(),
        level: "debug",
        service: "honcho",
        operation: "ingest_skipped",
        phase: "completed",
        reason: "deduplicated",
        messageId,
      });
      return { success: true, deduped: true };
    }

    logServiceEvent({
      ts: new Date().toISOString(),
      level: "info",
      service: "honcho",
      operation: "ingest_started",
      phase: "start",
      role,
      messageLength: sanitized.length,
      originalLength,
    });

    try {
      // Call Honcho MCP tool through the adapter
      const result = await this.callHonchoTool("add_messages_to_session", {
        session_id: this.workspaceId,
        role,
        content: sanitized,
        message_id: messageId,
        timestamp: timestamp.toISOString(),
      });

      if (!result.success) {
        throw new Error(result.error || "Tool call failed");
      }

      // Record success ONLY after verified response
      this.ingestedMessages.set(messageId, {
        id: messageId,
        ingestedAt: timestamp,
      });

      // Clean up old messages (keep last 100)
      if (this.ingestedMessages.size > 100) {
        const oldest = Array.from(this.ingestedMessages.entries())
          .sort((a, b) => a[1].ingestedAt.getTime() - b[1].ingestedAt.getTime())
          .slice(0, 10);
        for (const [id] of oldest) {
          this.ingestedMessages.delete(id);
        }
      }

      logServiceEvent({
        ts: new Date().toISOString(),
        level: "info",
        service: "honcho",
        operation: "ingest_succeeded",
        phase: "completed",
        messageLength: sanitized.length,
      });

      honchoStatus.recordSuccess("ingest", undefined, { messageLength: sanitized.length });

      return { success: true, deduped: false };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logServiceEvent({
        ts: new Date().toISOString(),
        level: "error",
        service: "honcho",
        operation: "ingest_failed",
        phase: "failed",
        error,
      });

      honchoStatus.recordFailure("ingest", "unknown", { error });

      return { success: false, deduped: false, error };
    }
  }

  /**
   * Retrieve relevant context from Honcho MCP.
   * Returns real retrieved content, never fabricates.
   */
  async retrieveContext(query: string): Promise<{
    success: boolean;
    context: string;
    empty: boolean;
    error?: string;
  }> {
    if (this._disposed) {
      return { success: false, context: "", empty: true, error: "memory disposed" };
    }

    if (!this.isReady()) {
      return { success: false, context: "", empty: true, error: "memory not ready" };
    }

    logServiceEvent({
      ts: new Date().toISOString(),
      level: "info",
      service: "honcho",
      operation: "retrieve_started",
      phase: "start",
      queryLength: query.length,
    });

    try {
      // Call Honcho get_session_context tool through the adapter
      const result = await this.callHonchoTool("get_session_context", {
        session_id: this.workspaceId,
        query,
        limit: 10,
      });

      if (!result.success) {
        throw new Error(result.error || "Tool call failed");
      }

      // Parse actual response content
      let context = "";
      if (result.result && typeof result.result === "object") {
        const response = result.result as Record<string, unknown>;
        // Extract context from response based on actual Honcho API shape
        context = (response.content as string) ||
                  (response.messages as string[])?.join("\n") ||
                  JSON.stringify(response);
      }

      // Apply max context chars limit
      const maxChars = this.config.maxContextChars ?? 4000;
      if (context.length > maxChars) {
        context = context.slice(0, maxChars) + "...[context truncated]";
      }

      // Empty retrieval is a valid result, not a fabricated context
      const isEmpty = context.trim().length === 0;

      logServiceEvent({
        ts: new Date().toISOString(),
        level: "info",
        service: "honcho",
        operation: "retrieve_succeeded",
        phase: "completed",
        contextLength: context.length,
        empty: isEmpty,
      });

      honchoStatus.recordSuccess("retrieve", undefined, { contextLength: context.length });

      return {
        success: true,
        context,
        empty: isEmpty,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logServiceEvent({
        ts: new Date().toISOString(),
        level: "error",
        service: "honcho",
        operation: "retrieve_failed",
        phase: "failed",
        error,
      });

      honchoStatus.recordFailure("retrieve", "unknown", { error });

      // On failure, return empty context (don't fabricate)
      return { success: false, context: "", empty: true, error };
    }
  }

  /**
   * Get memory status for diagnostics
   */
  getStatus(): {
    ready: boolean;
    connected: boolean;
    toolsDiscovered: boolean;
    workspaceId: string | null;
    ingestedCount: number;
  } {
    return {
      ready: this.isReady(),
      connected: this.isConnected,
      toolsDiscovered: this.toolsDiscovered,
      workspaceId: this.workspaceId,
      ingestedCount: this.ingestedMessages.size,
    };
  }

  /**
   * Dispose of the memory instance.
   * Stops timers, clears state, prevents further operations.
   */
  dispose(): void {
    this._disposed = true;
    this.ingestedMessages.clear();
    honchoStatus.setConnected(false);
    logServiceEvent({
      ts: new Date().toISOString(),
      level: "info",
      service: "honcho",
      operation: "disposed",
      phase: "completed",
    });
  }
}

// Export redactSecrets for testing
export { redactSecrets };
