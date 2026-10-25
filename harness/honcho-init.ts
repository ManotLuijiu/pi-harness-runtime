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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * MCP Runtime Registration Request (per pi-mcp-adapter contract)
 */
interface McpRuntimeRegistrationRequest {
  version: 1;
  name: string;
  definition: {
    url: string;
    headers?: Record<string, string>;
  };
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
 * Did the adapter refuse the call?
 *
 * The check is a type guard and not a plain `!result.ok`: the root project
 * runs without strictNullChecks, and there the discriminant of a union is
 * not narrowed - the guard narrows in every setting.
 */
function isToolCallFailure(
  result: McpToolCallResult
): result is { ok: false; error?: Error } {
  return result.ok === false;
}

/**
 * Did the adapter refuse the registration?
 *
 * The same reason as isToolCallFailure: the guard narrows in every setting.
 */
function isRegistrationFailure(
  result: NonNullable<McpRuntimeRegistrationRequest["result"]>
): result is { ok: false; error: Error } {
  return result.ok === false;
}

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

/** Honcho config directory */
const HONCHO_CONFIG_DIR = join(homedir(), ".pi-harness-runtime", "honcho");

/** File to persist workspace ID */
const WORKSPACE_ID_FILE = join(HONCHO_CONFIG_DIR, "workspace-id.json");

// ---------------------------------------------------------------------------
// Workspace ID Persistence
// ---------------------------------------------------------------------------

interface PersistedWorkspace {
  workspaceId: string;
  workspaceName: string;
  createdAt: string;
}

function loadPersistedWorkspace(): PersistedWorkspace | null {
  try {
    if (existsSync(WORKSPACE_ID_FILE)) {
      const data = readFileSync(WORKSPACE_ID_FILE, "utf-8");
      return JSON.parse(data) as PersistedWorkspace;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

function savePersistedWorkspace(workspaceId: string, workspaceName: string): void {
  try {
    mkdirSync(HONCHO_CONFIG_DIR, { recursive: true });
    const data: PersistedWorkspace = {
      workspaceId,
      workspaceName,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(WORKSPACE_ID_FILE, JSON.stringify(data, null, 2));
    logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "workspace_persist", phase: "completed", workspaceId });
  } catch (err) {
    logServiceEvent({ ts: new Date().toISOString(), level: "warn", service: "honcho", operation: "workspace_persist", phase: "failed", reason: String(err) });
  }
}

/** Default assistant name */
const DEFAULT_ASSISTANT_NAME = "pi-agent";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Global Honcho memory instance */
let _honchoMemory: HonchoMemory | null = null;

/** Owned registration handle for disposal */
let _honchoRegistration: { dispose(): Promise<void> } | null = null;

/** Whether initHoncho has been called (attempted) */
let _initialized = false;

/** Whether initHoncho succeeded (can retry if false) */
let _initSucceeded = false;

/** Stored pi.events for use in tool calls */
let _piEvents: PiEvents | null = null;

/** Current Honcho identity (workspace, peers, session) */
let _identity: HonchoIdentity | null = null;

/** Disposed flag to prevent post-shutdown operations */
let _disposed = false;

// ---------------------------------------------------------------------------
// MCP Tool Calls
// ---------------------------------------------------------------------------

/**
 * The payload of a Honcho tool call.
 *
 * The MCP server answers with the MCP shape: the payload is the TEXT of the
 * first content block, and for the tools that answer with data that text is
 * JSON. The tools that only confirm something ("Peers added to session
 * successfully") answer with plain text.
 *
 * The harness therefore has to unwrap the content block before it can read a
 * peer id - reading `result.id` on the raw MCP result finds nothing, because
 * the id lives in the JSON text of the first block.
 */
export function honchoPayload(result: unknown): {
  data: Record<string, unknown> | null;
  parsed: unknown;
  text: string;
} {
  const content = (result as { content?: unknown })?.content;
  const first = Array.isArray(content) ? content[0] : undefined;
  const text = typeof (first as { text?: unknown })?.text === "string" ? (first as { text: string }).text : "";
  if (text === "") {
    return { data: null, parsed: null, text: "" };
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { data: parsed as Record<string, unknown>, parsed, text };
    }
    if (parsed !== null && typeof parsed === "object") {
      return { data: null, parsed, text };
    }
  } catch {
    // Not JSON: the tool confirmed with plain text.
  }
  return { data: null, parsed: null, text };
}

/**
 * The entries of a list tool ("peers", "sessions").
 *
 * The server answers with the list under its own key and the paging beside
 * it. A bare array is accepted as well.
 */
function listEntriesFrom(parsed: unknown, key: string): Record<string, unknown>[] {
  const list = (parsed as Record<string, unknown> | null)?.[key];
  if (Array.isArray(list)) {
    return list.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
  }
  if (Array.isArray(parsed)) {
    return parsed.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
  }
  return [];
}

/**
 * The peer id in the answer of a peer tool.
 *
 * The server answers with `peer_id`; the answers that carry a nested peer
 * use `id`. Both are accepted so a server change cannot silently empty the
 * identity.
 */
function peerIdFrom(data: Record<string, unknown> | null): string | null {
  if (!data) {
    return null;
  }
  const direct = data.peer_id ?? data.id;
  if (typeof direct === "string" && direct !== "") {
    return direct;
  }
  const nested = (data.peer as { id?: unknown } | undefined)?.id;
  return typeof nested === "string" && nested !== "" ? nested : null;
}

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

  // Use stored pi.events from initHoncho
  if (!_piEvents) {
    return { success: false, error: "pi.events not available" };
  }
  const piEvents = _piEvents;

  // Create tool call request
  const request: McpToolCallRequest = {
    version: 1,
    server: HONCHO_SERVER_NAME,
    tool: toolName,
    args,
  };

  logServiceEvent({ ts: new Date().toISOString(), level: "debug", service: "honcho", operation: "tool_call", phase: "start", tool: toolName, args: JSON.stringify(args).slice(0, 100) });

  // Emit tool call
  piEvents.emit(MCP_RUNTIME_TOOL_CALL_EVENT, request);

  // Read result immediately after emit. The value goes into a local: reading
  // the property again after the emit would lose the narrowing, because a
  // call may change the property.
  const pending = request.result;
  if (pending === undefined) {
    logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "tool_call", phase: "failed", tool: toolName, reason: "no response from adapter" });
    return { success: false, error: "No response from MCP adapter" };
  }

  // The adapter sets the promise during the emit - await it.
  const result = await pending;

  if (isToolCallFailure(result)) {
    // The adapter hands back an Error instance: JSON.stringify would show an
    // empty object, so the message goes into the log on its own. Without it
    // a failing call reads like "Unknown error" and names nothing.
    const message = result.error?.message ?? "Unknown error";
    logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "tool_call", phase: "failed", tool: toolName, error: message });
    return { success: false, error: message };
  }

  logServiceEvent({ ts: new Date().toISOString(), level: "debug", service: "honcho", operation: "tool_call", phase: "completed", tool: toolName, result: JSON.stringify(result.result).slice(0, 200) });

  return { success: true, result: result.result };
}

// ---------------------------------------------------------------------------
// Honcho API Operations
// ---------------------------------------------------------------------------

/**
 * Set workspace metadata using pi-harness-runtime info
 */
async function setWorkspaceMetadata(workspaceId: string, _workspaceName: string): Promise<void> {
  const metadata = {
    purpose: "pi-harness runtime memory",
    version: "1.0.0",
    created: new Date().toISOString(),
    source: "pi-harness-runtime",
  };

  const result = await callHonchoTool("set_metadata", {
    workspace_id: workspaceId,
    metadata,
  });

  if (result.success) {
    logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "workspace_metadata", phase: "completed", workspaceId });
  } else {
    logServiceEvent({ ts: new Date().toISOString(), level: "warn", service: "honcho", operation: "workspace_metadata", phase: "failed", reason: result.error });
  }
}

/**
 * Get or validate workspace ID.
 * 
 * Note: Honcho MCP does NOT have create_workspace/get_workspace tools.
 * Workspaces are created via CLI/API. MCP tools are for session management.
 * This function:
 * 1. Loads persisted workspace ID
 * 2. Validates it exists by calling inspect_workspace
 */
async function ensureWorkspace(workspaceName: string): Promise<string | null> {
  // First, check if we have a persisted workspace ID
  const persisted = loadPersistedWorkspace();
  if (persisted && persisted.workspaceName === workspaceName) {
    logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "workspace_reuse", phase: "completed", workspaceId: persisted.workspaceId });
    return persisted.workspaceId;
  }

  // Validate with inspect_workspace (MCP tool to check workspace exists)
  const inspectResult = await callHonchoTool("inspect_workspace", {
    workspace_id: workspaceName, // workspace_id can be name or ID
  });

  if (inspectResult.success && inspectResult.result) {
    // The server answers with the MCP envelope: the JSON sits in the text of
    // the first content block. Reading the envelope directly would find
    // nothing and silently fall back to the workspace name.
    const parsed = honchoPayload(inspectResult.result).parsed as {
      workspace?: { id?: string };
      id?: string;
      metadata?: Record<string, unknown>;
    } | null;
    const response: {
      workspace?: { id?: string };
      id?: string;
      metadata?: Record<string, unknown>;
    } = parsed ?? {};
    const workspaceId = response.workspace?.id ?? response.id ?? workspaceName;
    savePersistedWorkspace(workspaceId, workspaceName);
    
    // Set metadata if not already set
    if (!response.metadata || Object.keys(response.metadata).length === 0) {
      await setWorkspaceMetadata(workspaceId, workspaceName);
    }
    
    logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "workspace_validate", phase: "completed", workspaceId });
    return workspaceId;
  }

  logServiceEvent({
    ts: new Date().toISOString(),
    level: "error",
    service: "honcho",
    operation: "workspace_failed",
    phase: "failed",
    error: inspectResult.error ?? "Workspace not found",
    note: "Create workspace via CLI first: honcho workspace create <name>",
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
  // The server's peer API: create_peer is a get-or-create.
  const result = await callHonchoTool("create_peer", {
    workspace_id: workspaceId,
    peer_id: userName,
  });

  if (result.success) {
    const peerId = peerIdFrom(honchoPayload(result.result).data);
    if (peerId) {
      return peerId;
    }
  }

  // The peer may exist already: list the peers and look for it.
  const listResult = await callHonchoTool("list_peers", {
    workspace_id: workspaceId,
    size: 100,
  });
  if (listResult.success) {
    for (const peer of listEntriesFrom(honchoPayload(listResult.result).parsed, "peers")) {
      const peerId = peerIdFrom(peer);
      if (peerId === userName) {
        return peerId;
      }
    }
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
  const result = await callHonchoTool("create_peer", {
    workspace_id: workspaceId,
    peer_id: assistantName,
  });

  if (result.success) {
    const peerId = peerIdFrom(honchoPayload(result.result).data);
    if (peerId) {
      return peerId;
    }
  }

  const listResult = await callHonchoTool("list_peers", {
    workspace_id: workspaceId,
    size: 100,
  });
  if (listResult.success) {
    for (const peer of listEntriesFrom(honchoPayload(listResult.result).parsed, "peers")) {
      const peerId = peerIdFrom(peer);
      if (peerId === assistantName) {
        return peerId;
      }
    }
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
  // The server's session API: create_session is a get-or-create, and the
  // peers join the session with their own call.
  const result = await callHonchoTool("create_session", {
    workspace_id: workspaceId,
    session_id: sessionId,
  });

  let createdSessionId: string | null = null;
  if (result.success) {
    const data = honchoPayload(result.result).data;
    const id = data?.session_id ?? data?.id;
    createdSessionId = typeof id === "string" && id !== "" ? id : null;
  }

  if (!createdSessionId) {
    // The session may exist already: list the sessions and look for it.
    const listResult = await callHonchoTool("list_sessions", {
      workspace_id: workspaceId,
      size: 100,
    });
    if (listResult.success) {
      for (const session of listEntriesFrom(honchoPayload(listResult.result).parsed, "sessions")) {
        const id = session.session_id ?? session.id;
        if (typeof id === "string" && id === sessionId) {
          createdSessionId = id;
          break;
        }
      }
    }
  }

  if (!createdSessionId) {
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

  // The peers have to join the session explicitly.
  const peersResult = await callHonchoTool("add_peers_to_session", {
    workspace_id: workspaceId,
    session_id: createdSessionId,
    peers: [userPeerId, assistantPeerId],
  });
  if (!peersResult.success) {
    logServiceEvent({
      ts: new Date().toISOString(),
      level: "warn",
      service: "honcho",
      operation: "session_peers_failed",
      phase: "failed",
      error: peersResult.error ?? "Unknown error",
      sessionId: createdSessionId,
    });
  }

  return createdSessionId;
}

/**
 * Add a message to the session
 */
async function addMessage(
  workspaceId: string,
  sessionId: string,
  peerId: string,
  role: "user" | "assistant",
  content: string,
  messageId?: string
): Promise<boolean> {
  // The server takes the messages of a session in one call, and the author
  // of a message is the peer - the role lives in the metadata.
  const result = await callHonchoTool("add_messages_to_session", {
    workspace_id: workspaceId,
    session_id: sessionId,
    messages: [
      {
        peer_id: peerId,
        content,
        metadata: {
          role,
          ...(messageId ? { message_id: messageId } : {}),
        },
      },
    ],
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
  // The server has no query-scoped "get_context": the recall is the search,
  // and the messages it finds are the context.
  const result = await callHonchoTool("search", {
    workspace_id: workspaceId,
    session_id: sessionId,
    query,
    message_limit: Math.max(1, Math.min(100, limit)),
  });

  if (!result.success) {
    return null;
  }

  const messages = listEntriesFrom(honchoPayload(result.result).parsed, "messages");
  const texts = messages
    .map((message) => (typeof message.content === "string" ? message.content : ""))
    .filter((text) => text !== "");

  return texts.length > 0 ? texts.join("\n") : null;
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
/**
 * Pi events interface for lifecycle hooks
 */
interface PiEvents {
  on: (event: string, handler: (...args: unknown[]) => void | Promise<void>) => void;
  emit: (event: string, ...args: unknown[]) => void;
}

export async function initHoncho(options?: {
  workspaceName?: string;
  assistantName?: string;
  userName?: string;
  sessionId?: string;
  apiKey?: string;
  piEvents?: PiEvents;
}): Promise<HonchoMemory | null> {
  if (_disposed) {
    logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "dispose", phase: "failed", reason: "integration has been disposed, cannot reinitialize" });
    return null;
  }

  // Allow retry if previous init failed
  if (_initialized && _initSucceeded) {
    logServiceEvent({ ts: new Date().toISOString(), level: "debug", service: "honcho", operation: "init", phase: "completed", reason: "already initialized, returning existing instance" });
    return _honchoMemory;
  }

  // Reset state if retrying
  if (_initialized && !_initSucceeded) {
    logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "init", phase: "start", reason: "retrying initialization" });
  }
  _initialized = true;
  _initSucceeded = false;

  logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "init", phase: "start" });

  // Load API key
  const key = options?.apiKey ?? loadHonchoApiKey();
  if (!key) {
    logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "init", phase: "failed", reason: "No API key found", helpUrl: "https://app.honcho.dev" });
    honchoStatus.setConfigured(false);
    honchoStatus.recordFailure("init", "no_key", { error: "No API key" });
    return null;
  }

  honchoStatus.setConfigured(true);

  // Store pi.events for use in tool calls
  if (options?.piEvents) {
    _piEvents = options.piEvents;
  }

  // Ensure MCP config directory exists (non-destructive)
  ensureMcpConfigDirectory();

  // Write MCP config for the adapter to pick up
  try {
    writeHonchoMcpConfig(key);
    logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "mcp_config", phase: "completed" });
  } catch (err) {
    logServiceEvent({ ts: new Date().toISOString(), level: "warn", service: "honcho", operation: "mcp_config", phase: "failed", reason: err instanceof Error ? err.message : String(err) });
    // Continue anyway - adapter may use its own config
  }

  // Get pi.events from options (passed from startup) or fall back to global
  const piEvents = options?.piEvents ?? (globalThis as { pi?: { events?: PiEvents } }).pi?.events;

  if (!piEvents) {
    logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "init", phase: "failed", reason: "pi.events not available" });
    honchoStatus.recordFailure("init", "adapter_missing", { error: "pi.events not available" });
    return null;
  }

  // Create registration request with bearer token authentication
  const request: McpRuntimeRegistrationRequest = {
    version: 1,
    name: HONCHO_SERVER_NAME,
    definition: {
      url: "https://mcp.honcho.dev",
      headers: {
        Authorization: `Bearer ${key}`,
      },
    },
  };

  // Emit registration event - adapter writes request.result synchronously
  piEvents.emit(MCP_RUNTIME_REGISTER_EVENT, request);

  // Read result immediately after emit. The value goes into a local: reading
  // the property again after the emit would lose the narrowing, because a
  // call may change the property.
  const registration = request.result;
  if (registration === undefined) {
    logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "mcp_register", phase: "failed", reason: "MCP adapter not responding" });
    logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "mcp_register", phase: "failed", helpUrl: "pi install npm:pi-mcp-adapter" });
    honchoStatus.recordFailure("init", "no_listener", { error: "No adapter responded" });
    return null;
  }

  if (isRegistrationFailure(registration)) {
    const errorMsg = registration.error?.message ?? "Unknown registration error";
    
    // Check for duplicate name - an existing server may already be registered
    if (errorMsg.includes("already") || errorMsg.includes("duplicate")) {
      logServiceEvent({ ts: new Date().toISOString(), level: "warn", service: "honcho", operation: "mcp_register", phase: "completed", reason: "server already registered (duplicate name)" });
      // Continue with memory initialization - the existing server should work
    } else {
      logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "mcp_register", phase: "failed", reason: errorMsg });
      honchoStatus.recordFailure("init", "registration_rejected", { error: errorMsg });
      return null;
    }
  } else {
    // Registration accepted - store handle for disposal
    _honchoRegistration = registration.registration;
    logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "mcp_register", phase: "completed" });
  }

  // Create memory instance
  _honchoMemory = new HonchoMemory({
    apiKey: key,
  });

  // MCP registration done - identity setup deferred to session_start
  // (MCP tool calls require an active Pi session)
  logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "mcp_register", phase: "completed", reason: "identity_setup_deferred" });
  honchoStatus.recordSuccess("init", undefined, { note: "identity deferred to session_start" });

  return _honchoMemory;
}

/**
 * Ensure Honcho workspace, peers, and session are created.
 * Call this on session_start when MCP tool calls are available.
 */
export async function ensureHonchoIdentity(): Promise<boolean> {
  if (!_honchoMemory || _initSucceeded) {
    return _initSucceeded;
  }

  const workspaceName = DEFAULT_WORKSPACE_NAME;
  const assistantName = DEFAULT_ASSISTANT_NAME;
  const userName = "pi-user";
  const sessionId = `pi-session-${Date.now()}`;

  logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "identity", phase: "start" });

  // Step 1: Create/get workspace
  const workspaceId = await ensureWorkspace(workspaceName);
  if (!workspaceId) {
    logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "create_workspace", phase: "failed" });
    honchoStatus.recordFailure("init", "workspace_failed", {});
    return false;
  }
  logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "create_workspace", phase: "completed", workspaceId });

  // Step 2: Create/get user peer
  const userPeerId = await ensureUserPeer(workspaceId, userName);
  if (!userPeerId) {
    logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "create_user_peer", phase: "failed" });
    honchoStatus.recordFailure("init", "user_peer_failed", {});
    return false;
  }
  logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "create_user_peer", phase: "completed", userPeerId });

  // Step 3: Create/get assistant peer
  const assistantPeerId = await ensureAssistantPeer(workspaceId, assistantName);
  if (!assistantPeerId) {
    logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "create_assistant_peer", phase: "failed" });
    honchoStatus.recordFailure("init", "assistant_peer_failed", {});
    return false;
  }
  logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "create_assistant_peer", phase: "completed", assistantPeerId });

  // Step 4: Create/get session
  const honchoSessionId = await ensureSession(workspaceId, userPeerId, assistantPeerId, sessionId);
  if (!honchoSessionId) {
    logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "create_session", phase: "failed" });
    honchoStatus.recordFailure("init", "session_failed", {});
    return false;
  }
  logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "create_session", phase: "completed", honchoSessionId });

  // Store identity
  _identity = {
    workspaceId,
    userPeerId,
    assistantPeerId,
    sessionId: honchoSessionId,
  };

  // Update memory state with all identities
  _honchoMemory.setConnected(true);
  _honchoMemory.setToolsDiscovered(true);
  _honchoMemory.setWorkspace(workspaceId);
  _honchoMemory.setSession(honchoSessionId);
  // The peers are the authors of the messages: without them the ingestion
  // cannot say who said what.
  _honchoMemory.setPeers(userPeerId, assistantPeerId);

  logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "memory_init", phase: "completed" });
  honchoStatus.recordSuccess("init", undefined, {
    workspaceId,
    userPeerId,
    assistantPeerId,
    sessionId: honchoSessionId,
  });

  // Mark initialization as successful
  _initSucceeded = true;

  return true;
}

/**
 * Get the current Honcho memory instance
 */
export function getHonchoMemory(): HonchoMemory | null {
  return _honchoMemory;
}

/**
 * Get the current Honcho identity
 */
export function getHonchoIdentity(): HonchoIdentity | null {
  return _identity;
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
    _identity.workspaceId,
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
    _identity.workspaceId,
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
  logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "shutdown", phase: "start" });

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
      logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "dispose_registration", phase: "completed" });
    } catch (err) {
      logServiceEvent({ ts: new Date().toISOString(), level: "warn", service: "honcho", operation: "dispose_registration", phase: "failed", reason: err instanceof Error ? err.message : String(err) });
    }
    _honchoRegistration = null;
  }

  _initialized = false;
  logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "shutdown", phase: "completed" });
}

/**
 * Register Honcho with session lifecycle hooks.
 * Call this during harness startup to wire Honcho into Pi events.
 *
 * @param getPiEvents Function that returns pi.events when available
 */
/**
 * Call a Honcho MCP tool (exported for honcho-memory.ts)
 */
export async function honchoToolCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  return await callHonchoTool(toolName, args);
}

/**
 * Register Honcho lifecycle hooks using pi.on.
 * Must be called before Pi emits session_start.
 * @param pi ExtensionAPI instance from startup
 */
export function registerHonchoLifecycle(
  pi: {
    on: (event: string, handler: (...args: unknown[]) => void | Promise<void>) => void;
  }
): void {
  // Note: initHoncho() is called at startup in index.ts
  // ensureHonchoIdentity() is called via session_start handler in index.ts
  // This function only handles message ingestion and shutdown

  logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "lifecycle_hooks", phase: "start" });

  // Shutdown at session shutdown
  pi.on("session_shutdown", async () => {
    await shutdownHoncho();
  });

  // Ingest assistant messages at message_end
  pi.on("message_end", async (event: unknown) => {
    const msgEvent = event as { message?: { role?: string; content?: string | Array<{ type?: string; text?: string }> } } | undefined;
    if (!msgEvent?.message || msgEvent.message.role !== "assistant") return;

    const memory = getHonchoMemory();
    if (!memory?.isReady()) return;

    const msg = msgEvent.message;

    // Extract text content
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter((block): block is { type: "text"; text: string } =>
          block.type === "text" && typeof block.text === "string"
        )
        .map(block => block.text)
        .join("\n");
    }

    if (content) {
      await memory.ingestMessage("assistant", content);
    }
  });

  logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "lifecycle_hooks", phase: "completed" });
}
