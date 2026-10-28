/**
 * Honcho MCP Integration - Initialization and Registration
 *
 * Implements the full 6-step Honcho MCP integration on Pi's native MCP
 * support:
 * 1. Register the Honcho MCP server with Pi (pi.registerMcpServer)
 * 2. Connect with the native MCP client and list the tools
 * 3. Create/retrieve the workspace, the peers and the session
 * 4. Ingest messages on agent turn complete
 * 5. Retrieve context before agent execution
 * 6. Truthful status and proper shutdown
 *
 * The harness talks to the server twice, and both paths are native MCP:
 * the model reaches the tools through the registration of step 1, and the
 * automatic ingestion and recall of steps 4 and 5 use the MCP client of Pi's
 * own npm package against the same URL and the same credential.
 */

import { logServiceEvent, honchoStatus } from "./service-diagnostics.js";
import { HonchoMemory, loadHonchoApiKey } from "./honcho-memory.js";

/**
 * The credential loader of the integration.
 *
 * The startup uses it, so the environment variable wins over the key file
 * everywhere and not only inside the module.
 */
export { loadHonchoApiKey };
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The outcome of the initialization.
 *
 * The startup report names the actual cause, so the status is a closed set
 * instead of a boolean: "not ready" alone never says WHY.
 */
export type HonchoInitStatus =
  | "ready"
  | "missing_key"
  | "mcp_unavailable"
  | "registration_rejected";

export interface HonchoInitResult {
  /** What happened. */
  status: HonchoInitStatus;
  /** The memory instance, only when the status is "ready". */
  memory: HonchoMemory | null;
  /** Short, credential-free cause. */
  reason?: string;
  /** Actionable, credential-free hint. */
  hint?: string;
  /** The HTTP status of the answer, when the server answered with one. */
  httpStatus?: number;
  /** Whether the MCP server is registered with Pi. */
  mcpRegistered?: boolean;
  /**
   * Why the MCP server was not registered, credential-free.
   *
   * The status stays "ready": the memory works without the registration.
   * The reason names the cause, so the startup does not have to guess
   * ("check the Pi version") when the cause is something else.
   */
  mcpRegistrationReason?: string;
}

/**
 * The Honcho session identity
 */
interface HonchoIdentity {
  workspaceId: string;
  userPeerId: string;
  assistantPeerId: string;
  sessionId: string;
}

/**
 * The native MCP client library of Pi.
 *
 * The library is Pi's own npm package; the interface keeps the harness
 * independent of the concrete classes and lets the tests inject a fake.
 */
export interface HonchoMcpLibrary {
  McpClient: new (options: {
    name: string;
    version: string;
    requestTimeoutMs?: number;
  }) => HonchoMcpClient & {
    connect(transport: unknown): Promise<void>;
  };
  StreamableHttpTransport: new (options: {
    url: string;
    headers?: Record<string, string>;
  }) => unknown;
}

/**
 * Loads the native MCP client library.
 *
 * The production loader imports the library by name. The tests inject a
 * fake, because a dynamic import cannot be intercepted inside the sandbox
 * of the test suite.
 */
export type HonchoMcpLibraryLoader = () => Promise<HonchoMcpLibrary>;

/**
 * The part of the MCP client the harness uses.
 *
 * The client is Pi's own npm package; the interface keeps the harness
 * independent of the concrete class and lets the tests inject a fake.
 */
export interface HonchoMcpClient {
  /** The tools of the server. */
  listTools(): Promise<unknown[]>;
  /** Call a tool of the server. */
  callTool(
    tool: string,
    args?: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<unknown>;
  /** Close the connection. */
  close(): Promise<void>;
  /** The connection state of the client, when it exposes one. */
  readonly connectionState?: string;
}

/**
 * Creates a connected MCP client.
 *
 * The default implementation uses Pi's native MCP client; the tests inject
 * a fake with the same shape.
 */
export type HonchoMcpClientFactory = (
  apiKey: string
) => Promise<HonchoMcpClient>;

/**
 * The part of Pi's extension API the harness uses for the MCP server.
 */
export interface HonchoMcpRegistrar {
  registerMcpServer?: (name: string, config: unknown) => void;
  unregisterMcpServer?: (name: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The Honcho MCP server (streamable HTTP). */
const HONCHO_MCP_URL = "https://mcp.honcho.dev";

/** The name of the Honcho MCP server in Pi. */
const HONCHO_SERVER_NAME = "honcho";

/**
 * Pi's native MCP client library.
 *
 * The library is imported dynamically: a runtime without it has to report
 * "mcp_unavailable" instead of breaking the whole harness.
 */
const MCP_CLIENT_MODULE = "@earendil-works/pi-mcp";

/** The request timeout of the MCP client. */
const MCP_REQUEST_TIMEOUT_MS = 30_000;

/**
 * The timeout of the credential probe.
 *
 * The probe is a courtesy, not a gate: it must never hold the startup for
 * long, so a server that does not answer counts as unreachable.
 */
const CREDENTIAL_PROBE_TIMEOUT_MS = 5_000;

/** Default workspace name for Pi harness */
const DEFAULT_WORKSPACE_NAME = "pi-harness";

/** Honcho config directory */
const HONCHO_CONFIG_DIR = join(homedir(), ".pi-harness-runtime", "honcho");

/** File to persist workspace ID */
const WORKSPACE_ID_FILE = join(HONCHO_CONFIG_DIR, "workspace-id.json");

/**
 * The answer of the server that says the credential was refused.
 *
 * The server does not check the credential during the handshake: it answers
 * the first tool call with the verdict. The texts that carry the verdict
 * name the key, the authorization or the status of the refusal.
 */
const CREDENTIAL_REJECTION_PATTERN =
  /api[\s_-]*key|unauthoriz|unauthentic|forbidden|invalid[\s_-]*token|credential|\b401\b|\b403\b/i;

/** The error of a missing MCP client library. */
const MODULE_MISSING_PATTERN =
  /cannot find (module|package)|err_module_not_found|err_unknown_file_extension|failed to resolve|cannot resolve/i;

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

/** Whether initHoncho has been called (attempted) */
let _initialized = false;

/** Whether the MCP connection is up and the tools are listed */
let _initReady = false;

/** Whether initHoncho succeeded (can retry if false) */
let _initSucceeded = false;

/** The native MCP client of the session */
let _mcpClient: HonchoMcpClient | null = null;

/** The factory that creates the client (the seam of the tests) */
let _clientFactory: HonchoMcpClientFactory | null = null;

/** The credential of the session. It never reaches a log or a message. */
let _apiKey: string | null = null;
/** Whether the MCP server is registered with Pi. */
let _mcpRegistered = false;

/**
 * Why the MCP server is not registered with Pi.
 *
 * The reason is credential-free and it names the cause, so the startup does
 * not have to guess ("check the Pi version") when the cause is another one.
 */
let _mcpRegistrationReason: string | undefined;
/** Loads the native MCP client library. The tests inject a fake. */
let _libraryLoader: HonchoMcpLibraryLoader | null = null;
/**
 * The extension API of Pi, used to unregister the MCP server again.
 *
 * It is set only when this extension registered the server: a name that
 * another extension owns has to stay with its owner, so a refused
 * registration must never be undone by the shutdown.
 */
let _registrar: HonchoMcpRegistrar | null = null;

/** Current Honcho identity (workspace, peers, session) */
let _identity: HonchoIdentity | null = null;

/** Disposed flag to prevent post-shutdown operations */
let _disposed = false;

/** The result of the last initialization attempt */
let _initResult: HonchoInitResult | null = null;

// ---------------------------------------------------------------------------
// MCP client
// ---------------------------------------------------------------------------

/**
 * Create a connected client with Pi's native MCP client library.
 *
 * The connection is streamable HTTP against the Honcho server, and the
 * credential travels in the Authorization header.
 */
async function createNativeMcpClient(
  apiKey: string,
  load: HonchoMcpLibraryLoader
): Promise<HonchoMcpClient> {
  const mod = await load();
  const client = new mod.McpClient({
    name: "pi-harness-runtime",
    version: "1.0.0",
    requestTimeoutMs: MCP_REQUEST_TIMEOUT_MS,
  });
  const transport = new mod.StreamableHttpTransport({
    url: HONCHO_MCP_URL,
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  await client.connect(transport);
  return client;
}

/**
 * Loads the native MCP client library of Pi.
 *
 * The library is a dependency of the harness, so the import belongs to the
 * module and not to the caller. The failure of the import is reported by
 * the caller, which knows what it means for the startup.
 */
async function defaultLibraryLoader(): Promise<HonchoMcpLibrary> {
  const mod = await import(MCP_CLIENT_MODULE);
  // SAFETY: the package exports the two classes with these names; the
  // interface above describes exactly how the harness uses them.
  return mod as unknown as HonchoMcpLibrary;
}

/**
 * The factory of the client of the session.
 *
 * The injected factory wins (the tests use it), the native client of Pi is
 * the default.
 */
function clientFactory(): HonchoMcpClientFactory {
  return (
    _clientFactory ??
    ((apiKey: string) =>
      createNativeMcpClient(apiKey, _libraryLoader ?? defaultLibraryLoader))
  );
}

/**
 * The client of the session, connected.
 *
 * The client stays alive for the whole session; a dropped connection is
 * re-established lazily, so a long session survives a server restart.
 */
async function ensureMcpClient(): Promise<HonchoMcpClient | null> {
  if (_disposed) {
    return null;
  }

  if (_mcpClient) {
    const state = _mcpClient.connectionState;
    // A client without a state (a fake, or an older library) counts as
    // connected: the calls report their own failures. A client that is
    // still connecting is not usable: a call would run before the
    // handshake is finished.
    if (!state || state === "connected") {
      return _mcpClient;
    }
    try {
      await _mcpClient.close();
    } catch {
      // A client that cannot be closed is dropped anyway.
    }
    _mcpClient = null;
  }

  if (!_apiKey) {
    return null;
  }

  const factory = clientFactory();
  try {
    _mcpClient = await factory(_apiKey);
    return _mcpClient;
  } catch (err) {
    logServiceEvent({
      ts: new Date().toISOString(),
      level: "error",
      service: "honcho",
      operation: "mcp_connect",
      phase: "failed",
      reason: redact(err instanceof Error ? err.message : String(err)),
    });
    return null;
  }
}

/**
 * Did the server answer the call with an error?
 *
 * The MCP shape carries the verdict of a failed tool call in the result
 * (`isError`), not in an exception: the server refuses an unknown
 * credential with a result that carries the text of the refusal.
 */
function isErrorResult(result: unknown): boolean {
  return (result as { isError?: unknown })?.isError === true;
}

/**
 * The text of an answer.
 *
 * The text of the content blocks is the answer of the server; a result that
 * carries an error object instead answers with the message of the error.
 */
function resultText(result: unknown): string {
  const content = (result as { content?: unknown })?.content;
  if (Array.isArray(content)) {
    const text = content
      .filter((block) => (block as { type?: unknown })?.type === "text")
      .map((block) => String((block as { text?: unknown }).text ?? ""))
      .filter((entry) => entry !== "")
      .join("\n");
    if (text !== "") {
      return text;
    }
  }
  const error = (result as { error?: { message?: unknown } })?.error;
  if (error && typeof error.message === "string") {
    return error.message;
  }
  return "";
}

/**
 * The HTTP status of an error, when it carries one.
 */
function errorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown })?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Remove the credential from a text.
 *
 * The server can echo the credential in its answer (an error message that
 * quotes the key). Every text that the module keeps, reports or logs passes
 * through here, so the key never reaches a log file, a reason or a hint.
 *
 * This complements `redactSecrets` of honcho-memory, it does not replace it:
 * the pattern redactor only masks a value that follows a secret-looking key
 * name, while the server can quote the credential on its own. The exact mask
 * covers that case.
 *
 * @param text The text to mask
 * @param apiKey The credential to remove
 * @returns The text without the credential
 */
export function redactHonchoKey(text: string, apiKey: string): string {
	if (!apiKey || !text) return text;
	return text.split(apiKey).join("<redacted>");
}

/**
 * Remove the credential of this session from a text.
 *
 * The text of the server is the one place where the key can come back: the
 * answer of a refused call may quote it.
 */
function redact(text: string): string {
	return redactHonchoKey(text, _apiKey ?? "");
}

/**
 * Did the server refuse the credential?
 *
 * The refusal arrives either as an HTTP status (401, 403) or as the text of
 * the answer, and both are named without the credential itself.
 */
function isCredentialRejection(text: string, status?: number): boolean {
  if (status === 401 || status === 403) {
    return true;
  }
  return text !== "" && CREDENTIAL_REJECTION_PATTERN.test(text);
}

/**
 * The result of a refusal of the server, when the answer is one.
 *
 * The server that answers with a status refused the request: a refused
 * credential (401, 403) and a refused endpoint (404) are both a rejection
 * of the registration and not an unreachable server.
 */
function refusalResult(
  message: string,
  status?: number
): HonchoInitResult | null {
  if (status === 401 || status === 403) {
    return {
      status: "registration_rejected",
      memory: null,
      reason: `the server refused the stored credential (HTTP ${status})`,
      hint: "the stored Honcho credential was rejected by the server",
      httpStatus: status,
    };
  }
  if (status === 404) {
    return {
      status: "registration_rejected",
      memory: null,
      reason: "the server refused the MCP endpoint (HTTP 404)",
      hint: "the Honcho MCP endpoint answered 404",
      httpStatus: status,
    };
  }
  if (isCredentialRejection(message)) {
    return {
      status: "registration_rejected",
      memory: null,
      reason: `the server rejected the stored credential: ${redact(message)}`,
      hint: "the stored Honcho credential was rejected by the server",
    };
  }
  return null;
}

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
  const nested = (data as { peer?: { id?: unknown } }).peer?.id;
  return typeof nested === "string" && nested !== "" ? nested : null;
}

/**
 * Describe the arguments of a call for the log, without their values.
 *
 * The values are what the user wrote (a message, a peer name) and a server
 * can be asked to echo the credential. Only the names of the arguments and
 * their size are logged.
 */
function describeArgs(args: Record<string, unknown>): string {
  const names = Object.keys(args ?? {});
  return `${names.join(",") || "none"} (${describeShape(args)})`;
}

/**
 * Describe the size of a value for the log, without its content.
 *
 * @param value The value to describe
 * @returns The size of the value as text
 */
function describeShape(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return `${typeof text === "string" ? text.length : 0} chars`;
  } catch {
    return "unknown size";
  }
}

/**
 * Call a tool on the Honcho MCP server through the native MCP client.
 * Returns actual result from the MCP server.
 */
async function callHonchoTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  if (_disposed) {
    return { success: false, error: "Honcho integration disposed" };
  }

  const client = await ensureMcpClient();
  if (!client) {
    return { success: false, error: "The Honcho MCP client is not connected" };
  }

  logServiceEvent({ ts: new Date().toISOString(), level: "debug", service: "honcho", operation: "tool_call", phase: "start", tool: toolName, args: describeArgs(args) });

  let raw: unknown;
  try {
    raw = await client.callTool(toolName, args);
  } catch (err) {
    // The message of the error is the real reason and has to survive: a
    // failing call that reads like "Unknown error" names nothing.
    const message = err instanceof Error ? err.message : String(err);
    logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "tool_call", phase: "failed", tool: toolName, error: redact(message) });
    return { success: false, error: redact(message) };
  }

  if (isErrorResult(raw)) {
    // The server refuses a call with a result that carries the reason in
    // its content, not with an exception.
    const message = redact(resultText(raw) || "The Honcho server refused the call");
    logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "tool_call", phase: "failed", tool: toolName, error: message });
    return { success: false, error: message };
  }

  // The content of a result is not logged: it carries what the user wrote
  // (and a server can quote the credential in it). Only the shape is.
  logServiceEvent({ ts: new Date().toISOString(), level: "debug", service: "honcho", operation: "tool_call", phase: "completed", tool: toolName, result: describeShape(raw) });

  return { success: true, result: raw };
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
 * Note: the harness does not create the workspace. The server knows the
 * tool `create_workspace`, but the workspace of the harness is a
 * deployment decision and stays a CLI/API task.
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
      workspace_id?: string;
      id?: string;
      metadata?: Record<string, unknown>;
    } | null;
    const response: {
      workspace?: { id?: string };
      workspace_id?: string;
      id?: string;
      metadata?: Record<string, unknown>;
    } = parsed ?? {};
    // The server answers with `workspace_id`; `workspace.id` and `id` are
    // the shapes of the older answers and stay accepted.
    const workspaceId =
      response.workspace_id ??
      response.workspace?.id ??
      response.id ??
      workspaceName;
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
// Registration with Pi
// ---------------------------------------------------------------------------

/**
 * The configuration of the Honcho MCP server for Pi.
 *
 * The credential travels in the Authorization header of the server
 * configuration, exactly like it travels in the header of the client.
 */
export function honchoMcpServerConfig(apiKey: string): {
  url: string;
  headers: Record<string, string>;
  exposure: string;
  description: string;
} {
  return {
    url: HONCHO_MCP_URL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    exposure: "codemode",
    description:
      "Honcho memory: workspaces, peers, sessions, messages and recall",
  };
}

/**
 * Register the Honcho MCP server with Pi.
 *
 * The registration is what the model and `/mcp` see. A registration that Pi
 * refuses (for example a name that another extension owns) is reported and
 * never throws into the startup.
 *
 * @param pi The extension API of Pi
 * @param apiKey The Honcho credential
 * @returns Whether the server is registered, and why it is not
 */
export function registerHonchoMcpServer(
  pi: HonchoMcpRegistrar | undefined | null,
  apiKey: string
): { registered: boolean; reason?: string } {
  if (!pi || typeof pi.registerMcpServer !== "function") {
    return {
      registered: false,
      reason: "the extension API of this runtime has no registerMcpServer",
    };
  }

  try {
    pi.registerMcpServer(HONCHO_SERVER_NAME, honchoMcpServerConfig(apiKey));
    return { registered: true };
  } catch (err) {
    // The message of Pi can echo the configuration, and the configuration
    // carries the credential: the key never reaches the reason.
    let reason = err instanceof Error ? err.message : String(err);
    if (apiKey !== "") {
      reason = reason.split(apiKey).join("[REDACTED]");
    }
    logServiceEvent({
      ts: new Date().toISOString(),
      level: "warn",
      service: "honcho",
      operation: "mcp_register",
      phase: "failed",
      reason,
    });
    return { registered: false, reason };
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Run a promise with a timeout.
 *
 * A promise that never settles must not hold the startup, so the timeout
 * wins and the pending promise is left to its own fate.
 */
async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number
): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  try {
    const settled = await Promise.race([
      work.then((value) => ({ timedOut: false as const, value })),
      timeout,
    ]);
    return settled;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Close a client that the initialization could not use.
 *
 * An initialization that fails must not leave a connection open: the
 * session would end with a client that nobody closes.
 *
 * @param client The client to close
 */
async function closeUnusedClient(client: HonchoMcpClient | null): Promise<void> {
  if (!client) {
    return;
  }
  if (_mcpClient === client) {
    _mcpClient = null;
  }
  try {
    await client.close();
    logServiceEvent({ ts: new Date().toISOString(), level: "debug", service: "honcho", operation: "mcp_close", phase: "completed", reason: "the initialization failed" });
  } catch (err) {
    logServiceEvent({ ts: new Date().toISOString(), level: "warn", service: "honcho", operation: "mcp_close", phase: "failed", reason: redact(err instanceof Error ? err.message : String(err)) });
  }
}

/**
 * Did the timeout win?
 *
 * The check is a type guard and not a plain `outcome.timedOut`: the root
 * project runs without strictNullChecks, and there the discriminant of a
 * union is not narrowed - the guard narrows in every setting.
 */
function isTimeoutOutcome(
  outcome: { timedOut: true } | { timedOut: false; value: unknown }
): outcome is { timedOut: true } {
  return outcome.timedOut === true;
}

/**
 * The verdict of the server about the credential.
 *
 * The server does not check the credential during the handshake: the
 * verdict arrives with the first tool call. The probe therefore calls a
 * tool that a normal (non-admin) credential may pass, and reads the answer.
 */
type CredentialVerdict =
  | { verdict: "accepted" }
  | { verdict: "rejected"; reason: string; httpStatus?: number }
  | { verdict: "unavailable"; reason: string };

async function probeCredential(
  client: HonchoMcpClient,
  timeoutMs: number = CREDENTIAL_PROBE_TIMEOUT_MS
): Promise<CredentialVerdict> {
  const persisted = loadPersistedWorkspace();
  const workspaceId = persisted?.workspaceId ?? DEFAULT_WORKSPACE_NAME;

  // The probe must not outlive its timeout: the request is aborted, so no
  // call stays pending on a connection that the initialization closes.
  const controller = new AbortController();

  let outcome: { timedOut: true } | { timedOut: false; value: unknown };
  try {
    outcome = await withTimeout(
      client.callTool(
        "inspect_workspace",
        { workspace_id: workspaceId },
        { signal: controller.signal }
      ),
      timeoutMs
    );
  } catch (err) {
    controller.abort();
    const status = errorStatus(err);
    const message = err instanceof Error ? err.message : String(err);
    if (isCredentialRejection(message, status)) {
      return {
        verdict: "rejected",
        reason: message,
        ...(status ? { httpStatus: status } : {}),
      };
    }
    // The probe did not get an answer. A workspace that does not exist is
    // answered with a result (the server creates it), so an exception here
    // is a transport failure - never a proof that the credential is good.
    logServiceEvent({
      ts: new Date().toISOString(),
      level: "warn",
      service: "honcho",
      operation: "credential_probe",
      phase: "failed",
      reason: redact(message),
    });
    return { verdict: "unavailable", reason: redact(message) };
  }

  if (isTimeoutOutcome(outcome)) {
    controller.abort();
    return {
      verdict: "unavailable",
      reason: `the server did not answer the credential probe within ${timeoutMs}ms`,
    };
  }

  const raw = outcome.value;
  if (!isErrorResult(raw)) {
    return { verdict: "accepted" };
  }

  const text = resultText(raw);
  if (isCredentialRejection(text)) {
    return { verdict: "rejected", reason: redact(text) };
  }

  // The credential was accepted: the tool failed for another reason (a
  // workspace that does not exist, for example). The identity step reports
  // the workspace problem.
  logServiceEvent({
    ts: new Date().toISOString(),
    level: "warn",
    service: "honcho",
    operation: "credential_probe",
    phase: "completed",
    reason: "the probe failed for another reason than the credential",
  });
  return { verdict: "accepted" };
}

/**
 * Initialize the Honcho MCP integration.
 *
 * Must be called during session_start or later.
 *
 * @param options Initialization options
 * @returns The outcome of the initialization with its actual cause
 */
export async function initHoncho(options?: {
  workspaceName?: string;
  assistantName?: string;
  userName?: string;
  sessionId?: string;
  apiKey?: string;
  /** The extension API of Pi, used to register the MCP server. */
  pi?: HonchoMcpRegistrar;
  /** Creates the MCP client. The tests inject a fake client here. */
  createClient?: HonchoMcpClientFactory;
  /** Loads the native MCP client library. The tests inject a fake here. */
  loadMcpLibrary?: HonchoMcpLibraryLoader;
  /** The timeout of the credential probe. The tests shorten it. */
  probeTimeoutMs?: number;
}): Promise<HonchoInitResult> {
  const result = await runInit(options);
  // The diagnostics commands report the outcome of the last attempt, so
  // the cause survives until somebody asks for it.
  _initResult = result;
  return result;
}

/**
 * The result of the last initialization, for the diagnostics commands.
 */
export function getHonchoInitResult(): HonchoInitResult | null {
  return _initResult;
}

async function runInit(options?: {
  workspaceName?: string;
  assistantName?: string;
  userName?: string;
  sessionId?: string;
  apiKey?: string;
  pi?: HonchoMcpRegistrar;
  createClient?: HonchoMcpClientFactory;
  loadMcpLibrary?: HonchoMcpLibraryLoader;
  probeTimeoutMs?: number;
}): Promise<HonchoInitResult> {
  if (_disposed) {
    logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "dispose", phase: "failed", reason: "integration has been disposed, cannot reinitialize" });
    return {
      status: "mcp_unavailable",
      memory: null,
      reason: "the Honcho integration has been disposed",
    };
  }

  // Allow retry if previous init failed
  if (_initialized && _initReady) {
    logServiceEvent({ ts: new Date().toISOString(), level: "debug", service: "honcho", operation: "init", phase: "completed", reason: "already initialized, returning existing instance" });
    const existing: HonchoInitResult = {
      status: "ready",
      memory: _honchoMemory,
      mcpRegistered: _mcpRegistered,
    };
    if (_mcpRegistrationReason) {
      existing.mcpRegistrationReason = _mcpRegistrationReason;
    }
    return existing;
  }

  if (_initialized) {
    logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "init", phase: "start", reason: "retrying initialization" });
  }
  _initialized = true;
  _initReady = false;

  logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "init", phase: "start" });

  // Load API key
  const key = options?.apiKey ?? loadHonchoApiKey();
  if (!key) {
    logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "init", phase: "failed", reason: "No API key found", helpUrl: "https://app.honcho.dev" });
    honchoStatus.setConfigured(false);
    honchoStatus.recordFailure("init", "no_key", { error: "No API key" });
    return {
      status: "missing_key",
      memory: null,
      reason: "no Honcho API key was found",
      hint: "Set HONCHO_API_KEY or store the key in ~/.pi-harness-runtime/keys/honcho-api-key.txt",
    };
  }

  honchoStatus.setConfigured(true);
  _apiKey = key;
  _clientFactory = options?.createClient ?? null;
  _libraryLoader = options?.loadMcpLibrary ?? null;

  // Connect with the native MCP client.
  const factory = clientFactory();
  let client: HonchoMcpClient;
  try {
    client = await factory(key);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = errorStatus(err);
    logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "mcp_connect", phase: "failed", reason: redact(message) });
    honchoStatus.recordFailure("init", "connect_failed", { error: redact(message) });

    const refusal = refusalResult(message, status);
    if (refusal) {
      honchoStatus.setConnected(false);
      honchoStatus.recordFailure("init", "registration_rejected", { error: redact(message) });
      return refusal;
    }

    if (MODULE_MISSING_PATTERN.test(message)) {
      return {
        status: "mcp_unavailable",
        memory: null,
        reason: "the native MCP client library is not installed",
        hint: "@earendil-works/pi-mcp 1.4.0 or newer is required for the native MCP client",
      };
    }

    return {
      status: "mcp_unavailable",
      memory: null,
      reason: `the Honcho MCP server could not be reached: ${redact(message)}`,
      hint: `check the network and the endpoint ${HONCHO_MCP_URL}`,
    };
  }

  _mcpClient = client;

  // The tools of the server have to be listed: a server that answers the
  // handshake but not the tools is not usable.
  try {
    await client.listTools();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = errorStatus(err);
    logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "mcp_tools", phase: "failed", reason: redact(message) });
    honchoStatus.recordFailure("init", "list_tools_failed", { error: redact(message) });

    const refusal = refusalResult(message, status);
    if (refusal) {
      honchoStatus.setConnected(false);
      honchoStatus.recordFailure("init", "registration_rejected", { error: redact(message) });
      await closeUnusedClient(client);
      return refusal;
    }

    await closeUnusedClient(client);
    return {
      status: "mcp_unavailable",
      memory: null,
      reason: `the Honcho MCP server did not list its tools: ${redact(message)}`,
      hint: `the endpoint ${HONCHO_MCP_URL} answered the handshake but no tools`,
    };
  }

  // The handshake does not check the credential: the verdict arrives with
  // the first tool call. The probe asks for it, with a short timeout.
  const probe = await probeCredential(client, options?.probeTimeoutMs ?? CREDENTIAL_PROBE_TIMEOUT_MS);
  if (probe.verdict === "rejected") {
    logServiceEvent({ ts: new Date().toISOString(), level: "error", service: "honcho", operation: "credential_probe", phase: "failed", reason: redact(probe.reason) });
    honchoStatus.setConnected(false);
    honchoStatus.recordFailure("init", "credential_rejected", { error: redact(probe.reason) });
    await closeUnusedClient(client);
    return {
      status: "registration_rejected",
      memory: null,
      reason: `the server rejected the stored credential: ${redact(probe.reason)}`,
      hint: "the stored Honcho credential was rejected by the server",
      ...(probe.httpStatus ? { httpStatus: probe.httpStatus } : {}),
    };
  }
  if (probe.verdict === "unavailable") {
    logServiceEvent({ ts: new Date().toISOString(), level: "warn", service: "honcho", operation: "credential_probe", phase: "failed", reason: redact(probe.reason) });
    honchoStatus.recordFailure("init", "probe_failed", { error: redact(probe.reason) });
    await closeUnusedClient(client);
    return {
      status: "mcp_unavailable",
      memory: null,
      reason: `the Honcho MCP server did not answer the credential probe: ${probe.reason}`,
      hint: `the endpoint ${HONCHO_MCP_URL} accepted the handshake but did not answer a call`,
    };
  }

  // Register the server with Pi, so the model and `/mcp` see it. The
  // registration needs the extension API of the running Pi: without it the
  // module does not attempt a registration, and it never reports a failure
  // for a registration that the caller performs itself.
  const pi = options?.pi;
  if (pi) {
    const registration = registerHonchoMcpServer(pi, key);
    _mcpRegistered = registration.registered;
    if (registration.registered) {
      // The extension API is kept for the shutdown: the server has to be
      // unregistered again, or a reload keeps the old registration alive.
      // Only a registration that this extension made is ever unregistered:
      // a name that another extension owns has to stay with its owner.
      _registrar = pi;
      _mcpRegistrationReason = undefined;
      logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "mcp_register", phase: "completed" });
    } else {
      _mcpRegistrationReason = redact(registration.reason ?? "the server was not registered");
      logServiceEvent({ ts: new Date().toISOString(), level: "warn", service: "honcho", operation: "mcp_register", phase: "failed", reason: _mcpRegistrationReason });
      honchoStatus.recordFailure("init", "registration_failed", { error: _mcpRegistrationReason });
    }
  }

  // Create memory instance
  _honchoMemory = new HonchoMemory({
    apiKey: key,
  });
  honchoStatus.setConnected(true);

  // The identity setup is deferred to session_start (the workspace, the
  // peers and the session belong to a running session).
  logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "init", phase: "completed", reason: "identity_setup_deferred" });
  honchoStatus.recordSuccess("init", undefined, { note: "identity deferred to session_start" });

  _initReady = true;

  const ready: HonchoInitResult = {
    status: "ready",
    memory: _honchoMemory,
    mcpRegistered: _mcpRegistered,
  };
  if (_mcpRegistrationReason) {
    ready.mcpRegistrationReason = _mcpRegistrationReason;
  }
  return ready;
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
 * Closes the MCP client, stops timers, clears state.
 */
export async function shutdownHoncho(): Promise<void> {
  if (_disposed) {
    return;
  }

  _disposed = true;
  logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "shutdown", phase: "start" });

  // The MCP server must not stay registered with Pi. A reload registers it
  // again, and the old registration would keep the old credential alive.
  if (_registrar && typeof _registrar.unregisterMcpServer === "function") {
    try {
      _registrar.unregisterMcpServer(HONCHO_SERVER_NAME);
      logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "mcp_unregister", phase: "completed" });
    } catch (err) {
      logServiceEvent({ ts: new Date().toISOString(), level: "warn", service: "honcho", operation: "mcp_unregister", phase: "failed", reason: redact(err instanceof Error ? err.message : String(err)) });
    }
  }
  _registrar = null;

  // Dispose memory instance
  if (_honchoMemory) {
    _honchoMemory.dispose();
    _honchoMemory = null;
  }

  // Clear identity
  _identity = null;

  // Close the native MCP client
  if (_mcpClient) {
    try {
      await _mcpClient.close();
      logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "mcp_close", phase: "completed" });
    } catch (err) {
      logServiceEvent({ ts: new Date().toISOString(), level: "warn", service: "honcho", operation: "mcp_close", phase: "failed", reason: redact(err instanceof Error ? err.message : String(err)) });
    }
    _mcpClient = null;
  }

  _apiKey = null;
  _mcpRegistered = false;
  _mcpRegistrationReason = undefined;
  _initialized = false;
  _initReady = false;
  logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "shutdown", phase: "completed" });
}

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
    registerMcpServer?: (name: string, config: unknown) => void;
    unregisterMcpServer?: (name: string) => void;
  }
): void {
  // Note: initHoncho() is called at startup in index.ts
  // ensureHonchoIdentity() is called via session_start handler in index.ts
  // This function only handles message ingestion and shutdown

  logServiceEvent({ ts: new Date().toISOString(), level: "info", service: "honcho", operation: "lifecycle_hooks", phase: "start" });

  // The extension API is not remembered here: this function registers
  // nothing. Only the registration of the initialization may be undone by
  // the shutdown, and the shutdown may only undo what this extension made.

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
