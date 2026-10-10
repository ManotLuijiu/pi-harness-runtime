/**
 * Honcho MCP Integration - Initialization and Registration
 *
 * Implements the full 6-step Honcho MCP integration:
 * 1. Register MCP server through pi-mcp-adapter
 * 2. Discover tools and establish workspace/peer mapping
 * 3. Create/retrieve session for Pi session
 * 4. Ingest messages on agent turn complete
 * 5. Retrieve context before agent execution
 * 6. Truthful status and proper shutdown
 */

import { logServiceEvent, honchoStatus } from "./service-diagnostics.js";
import {
  HonchoMemory,
  loadHonchoApiKey,
  ensureMcpConfigDirectory,
  writeHonchoMcpConfig,
} from "./honcho-memory.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * MCP Runtime Registration Request (per pi-mcp-adapter contract)
 */
interface McpRuntimeRegistrationRequest {
  version: 1;
  name: string;
  definition: { url: string };
  result?:
    | { ok: true; registration: { dispose(): Promise<void> } }
    | { ok: false; error: Error };
}

/**
 * MCP Tool Call Request (per pi-mcp-adapter contract)
 */
interface McpToolCallRequest {
  version: 1;
  server: string;
  tool: string;
  args: Record<string, unknown>;
  result?: McpToolCallResult;
}

type McpToolCallResult =
  | { ok: true; result?: unknown }
  | { ok: false; error?: Error };

/**
 * Honcho session identity
 */
interface HonchoIdentity {
  workspaceId: string;
  userPeerId: string;
  assistantPeerId: string;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MCP_RUNTIME_REGISTER_EVENT = "pi-mcp-adapter:runtime-register:v1";
const MCP_RUNTIME_TOOL_CALL_EVENT = "pi-mcp-adapter:runtime-tool-call:v1";

/** Honcho MCP server name in the adapter */
const HONCHO_SERVER_NAME = "honcho";

/** Default workspace name for Pi harness */
const DEFAULT_WORKSPACE_NAME = "pi-harness";

/** Default assistant name */
const DEFAULT_ASSISTANT_NAME = "pi-agent";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Global Honcho memory instance */
let _honchoMemory: HonchoMemory | null = null;

/** Owned registration handle for disposal */
let _honchoRegistration: { dispose(): Promise<void> } | null = null;

/** Whether initHoncho has been called */
let _initialized = false;

/** Current Honcho identity (workspace, peers, session) */
let _identity: HonchoIdentity | null = null;

/** Disposed flag to prevent post-shutdown operations */
let _disposed = false;

// ---------------------------------------------------------------------------
// MCP Tool Calls
// ---------------------------------------------------------------------------

/**
 * Call a tool on the Honcho MCP server through the adapter.
 * Returns actual result from the MCP server.
 */
async function callHonchoTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  if (_disposed) {
    return { success: false, error: "Honcho integration disposed" };
  }

  // Get pi.events for cross-extension tool calls
  const piEvents = (globalThis as {
    pi?: {
      events?: {
        emit: (event: string, req: unknown) => void;
      };
    };
  }).pi?.events;

  if (!piEvents) {
    return { success: false, error: "pi.events not available" };
  }

  // Create tool call request
  const request: McpToolCallRequest = {
    version: 1,
    server: HONCHO_SERVER_NAME,
    tool: toolName,
    args,
  };

  // Emit tool call
  piEvents.emit(MCP_RUNTIME_TOOL_CALL_EVENT, request);

  // Wait for result (adapter resolves synchronously)
  // Check after a microtask to allow adapter to populate result
  await new Promise(resolve => setImmediate(resolve));

  if (request.result === undefined) {
    return { success: false, error: "No response from MCP adapter" };
  }

  if (!request.result.ok) {
    const resultError = (request.result as { error?: Error }).error;
  return { success: false, error: resultError?.message ?? "Unknown error" };
  }

  return { success: true, result: request.result.result };
}

// ---------------------------------------------------------------------------
// Honcho API Operations
// ---------------------------------------------------------------------------

/**
 * Create or get workspace for the harness
 */
async function ensureWorkspace(workspaceName: string): Promise<string | null> {
  const result = await callHonchoTool("create_workspace", {
    name: workspaceName,
  });

  if (result.success && result.result) {
    const response = result.result as { id?: string; workspace?: { id?: string } };
    return response.id ?? response.workspace?.id ?? null;
  }

  // Try get_workspace as fallback
  const getResult = await callHonchoTool("get_workspace", {
    name: workspaceName,
  });

  if (getResult.success && getResult.result) {
    const response = getResult.result as { id?: string };
    return response.id ?? null;
  }

  logServiceEvent({
    ts: new Date().toISOString(),
    level: "error",
    service: "honcho",
    operation: "workspace_failed",
    phase: "failed",
    error: result.error ?? "Unknown error",
  });

  return null;
}

/**
 * Create or get user peer
 */
async function ensureUserPeer(
  workspaceId: string,
  userName: string
): Promise<string | null> {
  const result = await callHonchoTool("create_user", {
    workspace_id: workspaceId,
    name: userName,
  });

  if (result.success && result.result) {
    const response = result.result as { id?: string; user?: { id?: string } };
    return response.id ?? response.user?.id ?? null;
  }

  // Try get_or_create_user as fallback
  const getResult = await callHonchoTool("get_or_create_user", {
    workspace_id: workspaceId,
    name: userName,
  });

  if (getResult.success && getResult.result) {
    const response = getResult.result as { id?: string };
    return response.id ?? null;
  }

  logServiceEvent({
    ts: new Date().toISOString(),
    level: "error",
    service: "honcho",
    operation: "user_peer_failed",
    phase: "failed",
    error: result.error ?? "Unknown error",
  });

  return null;
}

/**
 * Create or get assistant peer
 */
async function ensureAssistantPeer(
  workspaceId: string,
  assistantName: string
): Promise<string | null> {
  const result = await callHonchoTool("create_assistant", {
    workspace_id: workspaceId,
    name: assistantName,
  });

  if (result.success && result.result) {
    const response = result.result as { id?: string; assistant?: { id?: string } };
    return response.id ?? response.assistant?.id ?? null;
  }

  logServiceEvent({
    ts: new Date().toISOString(),
    level: "error",
    service: "honcho",
    operation: "assistant_peer_failed",
    phase: "failed",
    error: result.error ?? "Unknown error",
  });

  return null;
}

/**
 * Create or get session for the current Pi session
 */
async function ensureSession(
  workspaceId: string,
  userPeerId: string,
  assistantPeerId: string,
  sessionId: string
): Promise<string | null> {
  const result = await callHonchoTool("create_session", {
    workspace_id: workspaceId,
    user_id: userPeerId,
    assistant_id: assistantPeerId,
    id: sessionId,
  });

  if (result.success && result.result) {
    const response = result.result as { id?: string; session?: { id?: string } };
    return response.id ?? response.session?.id ?? null;
  }

  // Try get_or_create_session as fallback
  const getResult = await callHonchoTool("get_or_create_session", {
    workspace_id: workspaceId,
    user_id: userPeerId,
    assistant_id: assistantPeerId,
    id: sessionId,
  });

  if (getResult.success && getResult.result) {
    const response = getResult.result as { id?: string };
    return response.id ?? null;
  }

  logServiceEvent({
    ts: new Date().toISOString(),
    level: "error",
    service: "honcho",
    operation: "session_failed",
    phase: "failed",
    error: result.error ?? "Unknown error",
  });

  return null;
}

/**
 * Add a message to the session
 */
async function addMessage(
  sessionId: string,
  peerId: string,
  role: "user" | "assistant",
  content: string,
  messageId?: string
): Promise<boolean> {
  const result = await callHonchoTool("add_message", {
    session_id: sessionId,
    sender_id: peerId,
    role,
    content,
    message_id: messageId,
  });

  return result.success;
}

/**
 * Get context for a query
 */
async function getContext(
  workspaceId: string,
  sessionId: string,
  query: string,
  limit: number = 5
): Promise<string | null> {
  const result = await callHonchoTool("get_context", {
    workspace_id: workspaceId,
    session_id: sessionId,
    query,
    limit,
  });

  if (result.success && result.result) {
    const response = result.result as { content?: string; context?: string; text?: string };
    return response.content ?? response.context ?? response.text ?? null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize Honcho MCP integration.
 *
 * Must be called during session_start or later when the adapter listener is installed.
 * Reads request.result synchronously after emit per the adapter contract.
 *
 * @param options Initialization options
 * @returns Promise resolving to the memory instance (or null if registration failed)
 */
export async function initHoncho(options?: {
  workspaceName?: string;
  assistantName?: string;
  userName?: string;
  sessionId?: string;
  apiKey?: string;
}): Promise<HonchoMemory | null> {
  if (_disposed) {
    console.error("[honcho] Integration has been disposed, cannot reinitialize");
    return null;
  }

  if (_initialized) {
    console.debug("[honcho] Already initialized, returning existing instance");
    return _honchoMemory;
  }
  _initialized = true;

  console.info("[honcho] Initializing Honcho MCP integration...");

  // Load API key
  const key = options?.apiKey ?? loadHonchoApiKey();
  if (!key) {
    console.error("[honcho] No API key found. Run: echo \"YOUR_KEY\" > ~/.pi-harness-runtime/keys/honcho-api-key.txt");
    honchoStatus.setConfigured(false);
    honchoStatus.recordFailure("init", "no_key", { error: "No API key" });
    return null;
  }

  honchoStatus.setConfigured(true);

  // Ensure MCP config directory exists (non-destructive)
  ensureMcpConfigDirectory();

  // Write MCP config for the adapter to pick up
  try {
    writeHonchoMcpConfig(key);
    console.info("[honcho] MCP config written");
  } catch (err) {
    console.warn("[honcho] Failed to write MCP config:", err);
    // Continue anyway - adapter may use its own config
  }

  // Get pi.events for cross-extension registration
  const piEvents = (globalThis as {
    pi?: {
      events?: {
        emit: (event: string, req: unknown) => void;
      };
    };
  }).pi?.events;

  if (!piEvents) {
    console.error("[honcho] pi.events not available - MCP adapter may not be installed");
    honchoStatus.recordFailure("init", "adapter_missing", { error: "pi.events not available" });
    return null;
  }

  // Create registration request
  const request: McpRuntimeRegistrationRequest = {
    version: 1,
    name: HONCHO_SERVER_NAME,
    definition: {
      url: "https://mcp.honcho.dev",
    },
  };

  // Emit registration event - adapter writes request.result synchronously
  piEvents.emit(MCP_RUNTIME_REGISTER_EVENT, request);

  // Read result immediately after emit
  if (request.result === undefined) {
    console.error("[honcho] MCP adapter not responding to registration");
    console.error("[honcho] Install: pi install npm:pi-mcp-adapter");
    honchoStatus.recordFailure("init", "no_listener", { error: "No adapter responded" });
    return null;
  }

  if (!request.result.ok) {
    const errorMsg = request.result.error?.message ?? "Unknown registration error";
    console.error(`[honcho] Registration failed: ${errorMsg}`);
    honchoStatus.recordFailure("init", "registration_rejected", { error: errorMsg });
    return null;
  }

  // Registration accepted - store handle for disposal
  _honchoRegistration = request.result.registration;
  console.info("[honcho] MCP server registered");

  // Create memory instance
  _honchoMemory = new HonchoMemory({
    apiKey: key,
  });

  // Discover tools and establish identity
  const workspaceName = options?.workspaceName ?? DEFAULT_WORKSPACE_NAME;
  const assistantName = options?.assistantName ?? DEFAULT_ASSISTANT_NAME;
  const userName = options?.userName ?? "pi-user";
  const sessionId = options?.sessionId ?? `pi-session-${Date.now()}`;

  console.info("[honcho] Establishing workspace/peer identity...");

  // Step 1: Create/get workspace
  const workspaceId = await ensureWorkspace(workspaceName);
  if (!workspaceId) {
    console.error("[honcho] Failed to create workspace");
    honchoStatus.recordFailure("init", "workspace_failed", {});
    return _honchoMemory; // Return instance but mark as not ready
  }
  console.info(`[honcho] Workspace: ${workspaceId}`);

  // Step 2: Create/get user peer
  const userPeerId = await ensureUserPeer(workspaceId, userName);
  if (!userPeerId) {
    console.error("[honcho] Failed to create user peer");
    honchoStatus.recordFailure("init", "user_peer_failed", {});
    return _honchoMemory;
  }
  console.info(`[honcho] User peer: ${userPeerId}`);

  // Step 3: Create/get assistant peer
  const assistantPeerId = await ensureAssistantPeer(workspaceId, assistantName);
  if (!assistantPeerId) {
    console.error("[honcho] Failed to create assistant peer");
    honchoStatus.recordFailure("init", "assistant_peer_failed", {});
    return _honchoMemory;
  }
  console.info(`[honcho] Assistant peer: ${assistantPeerId}`);

  // Step 4: Create/get session
  const honchoSessionId = await ensureSession(workspaceId, userPeerId, assistantPeerId, sessionId);
  if (!honchoSessionId) {
    console.error("[honcho] Failed to create session");
    honchoStatus.recordFailure("init", "session_failed", {});
    return _honchoMemory;
  }
  console.info(`[honcho] Session: ${honchoSessionId}`);

  // Store identity
  _identity = {
    workspaceId,
    userPeerId,
    assistantPeerId,
    sessionId: honchoSessionId,
  };

  // Update memory state
  _honchoMemory.setConnected(true);
  _honchoMemory.setToolsDiscovered(true);
  _honchoMemory.setWorkspace(workspaceId);

  console.info("[honcho] Memory ready");
  honchoStatus.recordSuccess("init", undefined, {
    workspaceId,
    userPeerId,
    assistantPeerId,
    sessionId: honchoSessionId,
  });

  return _honchoMemory;
}

/**
 * Get the current Honcho identity
 */
export function getHonchoIdentity(): HonchoIdentity | null {
  return _identity;
}

/**
 * Get the Honcho memory instance (if initialized)
 */
export function getHonchoMemory(): HonchoMemory | null {
  return _honchoMemory;
}

/**
 * Check if Honcho is initialized and ready
 */
export function isHonchoInitialized(): boolean {
  return _initialized && _honchoMemory?.isReady() === true;
}

/**
 * Ingest a user message
 */
export async function ingestUserMessage(
  content: string,
  messageId?: string
): Promise<{ success: boolean; deduped: boolean; error?: string }> {
  if (!_identity || !_honchoMemory) {
    return { success: false, deduped: false, error: "Honcho not initialized" };
  }

  return await addMessage(
    _identity.sessionId,
    _identity.userPeerId,
    "user",
    content,
    messageId
  ) ? { success: true, deduped: false } : { success: false, deduped: false, error: "Failed to add message" };
}

/**
 * Ingest an assistant message
 */
export async function ingestAssistantMessage(
  content: string,
  messageId?: string
): Promise<{ success: boolean; deduped: boolean; error?: string }> {
  if (!_identity || !_honchoMemory) {
    return { success: false, deduped: false, error: "Honcho not initialized" };
  }

  return await addMessage(
    _identity.sessionId,
    _identity.assistantPeerId,
    "assistant",
    content,
    messageId
  ) ? { success: true, deduped: false } : { success: false, deduped: false, error: "Failed to add message" };
}

/**
 * Retrieve context for a query
 */
export async function retrieveHonchoContext(
  query: string,
  limit: number = 5
): Promise<{ success: boolean; context: string; error?: string }> {
  if (!_identity) {
    return { success: false, context: "", error: "Honcho not initialized" };
  }

  const context = await getContext(
    _identity.workspaceId,
    _identity.sessionId,
    query,
    limit
  );

  if (context !== null) {
    return { success: true, context };
  }

  return { success: false, context: "", error: "Failed to retrieve context" };
}

/**
 * Shutdown Honcho integration.
 * Disposes owned registration, stops timers, clears state.
 */
export async function shutdownHoncho(): Promise<void> {
  if (_disposed) {
    return;
  }

  _disposed = true;
  console.info("[honcho] Shutting down...");

  // Dispose memory instance
  if (_honchoMemory) {
    _honchoMemory.dispose();
    _honchoMemory = null;
  }

  // Clear identity
  _identity = null;

  // Dispose owned registration
  if (_honchoRegistration) {
    try {
      await _honchoRegistration.dispose();
      console.info("[honcho] Registration disposed");
    } catch (err) {
      console.warn("[honcho] Failed to dispose registration:", err);
    }
    _honchoRegistration = null;
  }

  _initialized = false;
  console.info("[honcho] Shutdown complete");
}

/**
 * Register Honcho with session lifecycle hooks.
 * Call this during harness startup to wire Honcho into Pi events.
 *
 * @param getPiEvents Function that returns pi.events when available
 */
export function registerHonchoLifecycle(
  getPiEvents: () => {
    on: (event: string, handler: () => void | Promise<void>) => void;
  } | undefined
): void {
  const events = getPiEvents();
  if (!events) {
    console.warn("[honcho] Cannot register lifecycle: pi.events not available");
    return;
  }

  // Initialize at session start
  events.on("session_start", async () => {
    console.info("[honcho] Session started, initializing...");
    await initHoncho();
  });

  // Shutdown at session end
  events.on("session_end", async () => {
    await shutdownHoncho();
  });

  console.info("[honcho] Lifecycle hooks registered");
}
