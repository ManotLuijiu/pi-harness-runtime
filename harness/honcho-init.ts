/**
 * Honcho MCP Integration - Initialization and Registration
 *
 * Handles MCP server registration through the pi-mcp-adapter with proper:
 * - Synchronous result reading after emit
 * - Non-destructive configuration
 * - Lifecycle management
 */

import { HonchoMemory, loadHonchoApiKey } from "./honcho-memory.js";
import { honchoStatus } from "./service-diagnostics.js";

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

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Global Honcho memory instance */
let _honchoMemory: HonchoMemory | null = null;

/** Owned registration handle for disposal */
let _honchoRegistration: { dispose(): Promise<void> } | null = null;

/** Whether initHoncho has been called */
let _initialized = false;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

const MCP_RUNTIME_REGISTER_EVENT = "pi-mcp-adapter:runtime-register:v1";

/**
 * Initialize Honcho MCP integration.
 *
 * Must be called during session_start or later when the adapter listener is installed.
 * Reads request.result synchronously after emit per the adapter contract.
 *
 * @param apiKey Optional API key override (defaults to key file)
 * @returns Promise resolving to the memory instance (or null if registration failed)
 */
export async function initHoncho(apiKey?: string): Promise<HonchoMemory | null> {
  if (_initialized) {
    console.debug("[honcho] Already initialized, skipping duplicate init");
    return _honchoMemory;
  }
  _initialized = true;

  // Load API key
  const key = apiKey ?? loadHonchoApiKey();
  if (!key) {
    console.error("[honcho] No API key found. Run: echo \"YOUR_KEY\" > ~/.pi-harness-runtime/keys/honcho-api-key.txt");
    honchoStatus.setConfigured(false);
    honchoStatus.recordFailure("init", "no_key", { error: "No API key" });
    return null;
  }

  honchoStatus.setConfigured(true);
  console.info("[honcho] Registered; initiating MCP connection...");

  try {
    // Get pi.events for cross-extension registration
    const piEvents = (globalThis as { pi?: { events?: { emit: (event: string, req: unknown) => void } } }).pi?.events;

    if (!piEvents) {
      console.error("[honcho] MCP adapter not available (pi.events not found)");
      honchoStatus.recordFailure("init", "adapter_missing", { error: "pi.events not available" });
      return null;
    }

    // Create registration request
    const request: McpRuntimeRegistrationRequest = {
      version: 1,
      name: "honcho",
      definition: {
        url: "https://mcp.honcho.dev",
      },
    };

    // Emit registration event - adapter writes request.result synchronously
    piEvents.emit(MCP_RUNTIME_REGISTER_EVENT, request);

    // Read result immediately after emit
    if (request.result === undefined) {
      // No listener responded - adapter not installed
      console.error("[honcho] MCP adapter not responding to registration");
      console.error("[honcho] Install: pi install npm:pi-mcp-adapter");
      honchoStatus.recordFailure("init", "no_listener", { error: "No adapter responded to registration" });
      return null;
    }

    if (!request.result.ok) {
      // Registration rejected
      const errorMsg = request.result.error?.message ?? "Unknown registration error";
      console.error(`[honcho] Registration failed: ${errorMsg}`);
      honchoStatus.recordFailure("init", "registration_rejected", { error: errorMsg });
      return null;
    }

    // Registration accepted - store handle for disposal
    _honchoRegistration = request.result.registration;
    console.debug("[honcho] Registered; connection pending verification...");

    // Create memory instance
    _honchoMemory = new HonchoMemory({
      apiKey: key,
    });

    console.debug("[honcho] Memory instance created; awaiting connection verification");
    return _honchoMemory;

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[honcho] Initialization error: ${error}`);
    honchoStatus.recordFailure("init", "error", { error });
    return null;
  }
}

/**
 * Get the Honcho memory instance (if initialized)
 */
export function getHonchoMemory(): HonchoMemory | null {
  return _honchoMemory;
}

/**
 * Check if Honcho is initialized
 */
export function isHonchoInitialized(): boolean {
  return _initialized;
}

/**
 * Shutdown Honcho integration.
 * Disposes owned registration, stops timers, clears state.
 */
export async function shutdownHoncho(): Promise<void> {
  console.info("[honcho] Shutting down...");

  // Dispose memory instance
  if (_honchoMemory) {
    _honchoMemory.dispose();
    _honchoMemory = null;
  }

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
  getPiEvents: () => { on: (event: string, handler: () => void | Promise<void>) => void } | undefined
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
