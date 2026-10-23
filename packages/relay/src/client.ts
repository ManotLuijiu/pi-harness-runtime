/**
 * Relay Client - Two-way streaming WebSocket client
 * 
 * Implements t3code-style streaming with:
 * - Connection state machine
 * - Snapshot + live event handling
 * - Typed message protocol
 * - Automatic reconnection with backoff
 */

import WebSocket from "ws";
import {
  type RelayConfig,
  type RelayTunnel,
  type RelayMessage,
  type ConnectionState,
  type ConnectionStateChange,
  type CallbackPayload,
  type ServerMessage,
  type ClientMessage,
  type SnapshotMessage,
  type SynchronizedMessage,
  type CallbackMessage,
  type StatusMessage,
  type AuthResponseMessage,
  type ConnectedMessage,
  PROTOCOL_VERSION,
  generateMessageId,
  createTimestamp,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 30000;
const CONNECT_TIMEOUT_MS = 10000;

// ============================================================================
// Client Callbacks
// ============================================================================

/**
 * Where the client writes its diagnostics.
 *
 * A TUI owns the terminal: a stray console write lands in the prompt input
 * field. The harness therefore injects a logger that writes to the log file
 * (the console stays the default for CLI scripts).
 */
export interface RelayLogger {
  log?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

export interface RelayClientCallbacks {
  /** Called when connected and authenticated */
  onConnected?: (sessionId: string) => void;
  /** Called when disconnected */
  onDisconnected?: () => void;
  /** Called when snapshot is received (initial state) */
  onSnapshot?: (snapshot: SnapshotMessage['payload']) => void;
  /** Called when synchronized marker received (live events start) */
  onSynchronized?: () => void;
  /** Called when a callback event is received */
  onCallback?: (callback: CallbackPayload) => void;
  /** Called when a status message is received */
  onStatus?: (status: StatusMessage['payload']) => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** Called when connection state changes */
  onStateChange?: (change: ConnectionStateChange) => void;
}

// ============================================================================
// Relay Client - Two-way Streaming Implementation
// ============================================================================

export class RelayClient {
  private ws: WebSocket | null = null;
  private config: RelayConfig;
  private callbacks: RelayClientCallbacks;
  private logger: RelayLogger;
  
  // State machine
  private state: ConnectionState = { state: 'disconnected' };
  private sessionId: string | null = null;
  private clientId: string | null = null;
  
  // Reconnection
  private reconnectAttempt = 0;
  private reconnectDelay = DEFAULT_RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  // Pending connect() settlement - resolve/reject handed to the caller
  private pendingConnect: { resolve: () => void; reject: (error: Error) => void; attempt: number } | null = null;
  private connectPromise: Promise<void> | null = null;
  private connectAttempt = 0;  // Monotonic id of the current connect attempt
  private connectPromiseAttempt = 0;  // Attempt id the current connectPromise belongs to

  // Intentional shutdown - suppresses reconnect scheduling (deliberate stop, not network loss)
  private shuttingDown = false;
  
  // Heartbeat
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  
  // Snapshot tracking (t3code pattern)
  private snapshotReceived = false;
  private synchronizedReceived = false;

  constructor(config: RelayConfig, callbacks: RelayClientCallbacks = {}, logger: RelayLogger = {}) {
    this.config = config;
    this.callbacks = callbacks;
    this.logger = logger;
  }

  // ========================================================================
  // Diagnostics
  // ========================================================================

  /**
   * Write a diagnostic.
   *
   * A TUI owns the terminal: the harness injects a logger so that nothing
   * reaches the console. A partial logger must not reopen that hole - a
   * missing level falls back to a level the logger does provide.
   */
  private log(message: string): void {
    this.emit("log", message);
  }

  private logWarn(message: string): void {
    this.emit("warn", message);
  }

  private logError(message: string): void {
    this.emit("error", message);
  }

  private emit(level: "log" | "warn" | "error", message: string): void {
    const logger = this.logger;
    // A logger was injected: route the level to one the logger provides,
    // never back to the console. The order keeps the severity as close as
    // possible (error -> warn -> log).
    const candidates: Array<"log" | "warn" | "error"> =
      level === "error" ? ["error", "warn", "log"] : level === "warn" ? ["warn", "error", "log"] : ["log", "warn", "error"];

    for (const candidate of candidates) {
      const sink = candidate === "log" ? logger.log : candidate === "warn" ? logger.warn : logger.error;
      if (!sink) continue;
      try {
        sink(message);
      } catch {
        // A broken logger must never break the relay client.
      }
      return;
    }

    if (level === "log") console.log(message);
    else if (level === "warn") console.warn(message);
    else console.error(message);
  }

  // ========================================================================
  // Connection State Machine
  // ========================================================================

  private setState(newState: ConnectionState): void {
    const previous = this.state;
    this.state = newState;
    
    this.callbacks.onStateChange?.({
      previous,
      current: newState,
      timestamp: createTimestamp(),
    });
  }

  private isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && 
           this.state.state === 'connected';
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

  /**
   * Connect to relay server with automatic authentication.
   *
   * The returned Promise settles exactly once:
   * - resolves when the server confirms authentication (the readiness milestone)
   * - rejects on websocket error, authentication failure, close-before-ready,
   *   an explicit disconnect(), or the connect deadline
   */
  async connect(): Promise<void> {
    if (this.isConnected()) return;

    // Reuse only a LIVE connect attempt. Returning a settled promise would
    // make `disconnect(); connect();` resolve with the previous rejection and
    // open no socket at all.
    if (this.connectPromise && this.pendingConnect) {
      return this.connectPromise;
    }

    const promise = this.startConnect();
    this.connectPromise = promise;
    this.connectPromiseAttempt = this.connectAttempt;
    try {
      await promise;
    } finally {
      if (this.connectPromise === promise) this.connectPromise = null;
    }
  }

  /**
   * Open the socket and drive the connect/auth handshake.
   * The promise settles via settleConnect() from the handshake handlers.
   */
  private startConnect(): Promise<void> {
    // Close any stale socket without triggering reconnect handling
    this.cleanup();
    this.shuttingDown = false;

    this.setState({ state: 'connecting' });

    const url = this.config.serverUrl;
    const timeoutMs = this.config.connectTimeout ?? CONNECT_TIMEOUT_MS;
    this.log(`[RelayClient] Connecting to ${url}...`);

    return new Promise<void>((resolve, reject) => {
      const attempt = ++this.connectAttempt;
      this.pendingConnect = { resolve, reject, attempt };

      // Deadline covers connection AND authentication (one timer for the whole handshake)
      this.connectTimeoutTimer = setTimeout(() => {
        if (!this.pendingConnect) return;
        this.logError(`[RelayClient] Connection timeout after ${timeoutMs}ms`);
        this.settleConnect(new Error(`Connection timeout after ${timeoutMs}ms`));
        this.closeSocket();
        this.setState({ state: 'disconnected' });
        this.scheduleReconnectAfterFailure();
      }, timeoutMs);

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        // An invalid URL throws synchronously. The attempt must not be left
        // pending: settle it, disarm the deadline and retry like any other
        // failed connect.
        const error = err instanceof Error ? err : new Error(String(err));
        this.logError(`[RelayClient] WebSocket construction failed: ${error.message}`);
        this.settleConnect(error);
        this.setState({ state: 'disconnected' });
        this.scheduleReconnectAfterFailure();
        return;
      }
      this.ws = ws;

      ws.on("open", () => {
        if (this.ws !== ws) return;
        this.log("[RelayClient] WebSocket opened");
        this.setState({ state: 'authenticating' });

        // Send authentication
        this.send({
          version: PROTOCOL_VERSION,
          type: 'auth',
          payload: { token: this.config.token || '' },
          timestamp: createTimestamp(),
        });
      });

      ws.on("message", (data) => {
        if (this.ws !== ws) return;
        this.handleMessage(data.toString());
      });

      ws.on("close", (code) => {
        // Ignore events from a socket that is no longer the active one: they
        // would otherwise corrupt the live connection (state, heartbeat) and
        // schedule a spurious reconnect.
        if (this.ws !== ws) return;
        this.log("[RelayClient] WebSocket closed");
        this.ws = null;
        const wasPending = this.pendingConnect !== null;
        this.handleDisconnect();
        if (wasPending) {
          this.settleConnect(new Error(`Connection closed before ready (code ${code})`));
          this.scheduleReconnectAfterFailure();
        }
      });

      ws.on("error", (err) => {
        if (this.ws !== ws) return;
        this.logError(`[RelayClient] WebSocket error: ${err.message}`);
        this.callbacks.onError?.(err);
        const wasPending = this.pendingConnect !== null;
        this.ws = null;
        this.handleDisconnect();
        if (wasPending) {
          this.settleConnect(err instanceof Error ? err : new Error(String(err)));
          this.scheduleReconnectAfterFailure();
        }
      });
    });
  }

  /**
   * Settle the pending connect() promise exactly once.
   * Passing an error rejects; calling without an error resolves.
   */
  private settleConnect(error?: Error): void {
    const pending = this.pendingConnect;
    if (!pending) return;
    this.pendingConnect = null;
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
    // The attempt is over: a later connect() must start a NEW attempt instead
    // of handing out the settled promise. Only clear the promise when it
    // belongs to THIS attempt - a late settle must not clobber a newer one.
    if (this.connectPromiseAttempt === pending.attempt) {
      this.connectPromise = null;
      this.connectPromiseAttempt = 0;
    }
    if (error) pending.reject(error);
    else pending.resolve();
  }

  /**
   * Disconnect from relay server
   */
  disconnect(): void {
    this.log("[RelayClient] Disconnecting...");
    // Deliberate stop: do not schedule a reconnect afterwards
    this.shuttingDown = true;
    // Never leave a caller awaiting connect() hanging
    this.settleConnect(new Error('Disconnected before ready'));
    const wasConnected = this.state.state === 'connected';
    this.cleanup();
    this.sessionId = null;
    this.clientId = null;
    this.snapshotReceived = false;
    this.synchronizedReceived = false;
    this.setState({ state: 'disconnected' });
    // Only report a disconnect for a connection that was actually established.
    if (wasConnected) this.callbacks.onDisconnected?.();
  }

  /**
   * Send a message through the WebSocket
   * Note: Messages can be sent even during authentication phase
   */
  send(message: ClientMessage): void {
    // Allow sending if WebSocket is open, regardless of authentication state
    // This is needed for auth message which is sent before state becomes 'connected'
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.logWarn("[RelayClient] Cannot send: WebSocket not open");
    }
  }

  // ========================================================================
  // Message Handling
  // ========================================================================

  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data) as ServerMessage & { type: string };
      
      switch (msg.type) {
        case 'connected':
          this.handleConnected(msg as ConnectedMessage);
          break;

        case 'auth':
          this.handleAuth(msg as AuthResponseMessage);
          break;

        case 'snapshot':
          this.handleSnapshot(msg as SnapshotMessage);
          break;

        case 'synchronized':
          this.handleSynchronized(msg as SynchronizedMessage);
          break;

        case 'callback':
          this.handleCallback(msg as CallbackMessage);
          break;

        case 'status':
          this.handleStatus(msg as StatusMessage);
          break;

        case 'pong':
          // Heartbeat response - connection is alive
          break;

        default: {
          const unknownMsg = msg as { type: string };
          this.logWarn(`[RelayClient] Unknown message type: ${unknownMsg.type}`);
        }
      }
    } catch (err) {
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    // One line per log record: the stack must not break the format.
    this.logError(`[RelayClient] Failed to parse message: ${detail.replace(/\s*\n\s*/g, " | ")}`);
      this.callbacks.onError?.(err as Error);
    }
  }

  private handleConnected(msg: ConnectedMessage): void {
    this.clientId = msg.payload.clientId;
    this.log(`[RelayClient] Connected, clientId: ${this.clientId}`);
  }

  private handleAuth(msg: AuthResponseMessage): void {
    if (msg.payload.success) {
      this.sessionId = msg.payload.sessionId || null;
      this.setState({ state: 'connected', sessionId: this.sessionId || '' });
      
      // Reset reconnection state
      this.reconnectAttempt = 0;
      this.reconnectDelay = DEFAULT_RECONNECT_DELAY_MS;
      
      // Start heartbeat
      this.startHeartbeat();
      
      // Notify callback
      this.callbacks.onConnected?.(this.sessionId || '');
      this.log(`[RelayClient] Authenticated, sessionId: ${this.sessionId}`);

      // Readiness milestone reached - settle the connect() promise
      this.settleConnect();
    } else {
      const message = msg.payload.error || 'Authentication failed';
      this.logError(`[RelayClient] Auth failed: ${message}`);
      const error = new Error(message);
      this.callbacks.onError?.(error);
      // Reject the caller before tearing the socket down
      this.settleConnect(error);
      this.disconnect();
      // A rejected auth can be transient (a server restart with a rotated
      // token, a temporarily misconfigured server) - retry it like any other
      // failed connect.
      this.scheduleReconnectAfterFailure();
    }
  }

  private handleSnapshot(msg: SnapshotMessage): void {
    this.log(`[RelayClient] Snapshot received: ${msg.payload.recentCallbacks.length} recent callbacks`);
    this.snapshotReceived = true;
    
    // Notify callback
    this.callbacks.onSnapshot?.(msg.payload);
  }

  private handleSynchronized(_msg: SynchronizedMessage): void {
    this.log("[RelayClient] Synchronized - live events starting");
    this.synchronizedReceived = true;
    
    // Notify callback
    this.callbacks.onSynchronized?.();
  }

  private handleCallback(msg: CallbackMessage): void {
    // Only process callbacks after synchronized
    if (!this.synchronizedReceived) {
      this.logWarn("[RelayClient] Ignoring callback before synchronized");
      return;
    }
    
    this.callbacks.onCallback?.(msg.payload);
  }

  private handleStatus(msg: StatusMessage): void {
    this.log(`[RelayClient] Status [${msg.payload.kind}]: ${msg.payload.code} - ${msg.payload.message}`);
    this.callbacks.onStatus?.(msg.payload);
  }

  // ========================================================================
  // Disconnect & Reconnect
  // ========================================================================

  private handleDisconnect(): void {
    this.stopHeartbeat();

    const wasConnected = this.state.state === 'connected';
    this.setState({ state: 'disconnected' });

    // A deliberate stop must not trigger a reconnect
    if (this.shuttingDown) {
      this.log("[RelayClient] Disconnected (intentional stop, no reconnect)");
      return;
    }

    if (wasConnected) {
      this.callbacks.onDisconnected?.();
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule a reconnect after a FAILED connect attempt.
   *
   * The backoff loop only survives the loss of an established connection, so a
   * refused server or a failed handshake would otherwise leave the client
   * permanently disconnected. Opt-in via `config.retryOnConnectFailure`:
   * an endless background retry loop is not always what the caller wants.
   */
  private scheduleReconnectAfterFailure(): void {
    if (this.shuttingDown) return;
    if (!this.config.retryOnConnectFailure) return;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    
    this.reconnectAttempt++;
    this.setState({ state: 'reconnecting', attempt: this.reconnectAttempt });
    
    this.log(`[RelayClient] Scheduling reconnect attempt ${this.reconnectAttempt} in ${this.reconnectDelay}ms`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        this.logError(`[RelayClient] Reconnect failed: ${err.message}`);
      });
    }, this.reconnectDelay);
    
    // Exponential backoff
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  }

  // ========================================================================
  // Heartbeat
  // ========================================================================

  private startHeartbeat(): void {
    this.stopHeartbeat();

    const interval = this.config.keepAlive ?? HEARTBEAT_INTERVAL_MS;

    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        this.send({
          version: PROTOCOL_VERSION,
          type: 'ping',
          payload: {},
          timestamp: createTimestamp(),
        });
      }
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  private cleanup(): void {
    // Clear timers
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
    this.stopHeartbeat();
    
    // Reset snapshot state
    this.snapshotReceived = false;
    this.synchronizedReceived = false;

    // Close WebSocket (handlers detached so our own cleanup does not trigger
    // disconnect/reconnect handling)
    this.closeSocket();
  }

  /**
   * Close the active socket without firing our own close/error handlers.
   */
  private closeSocket(): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    // Detach only OUR handlers so the own cleanup never triggers the
    // disconnect/reconnect path.
    ws.removeAllListeners("open");
    ws.removeAllListeners("message");
    ws.removeAllListeners("close");
    ws.removeAllListeners("error");
    // An 'error' without a listener throws inside the ws implementation.
    ws.on("error", (err: Error) => {
      this.logWarn(`[RelayClient] Socket error while closing: ${err.message}`);
    });
    ws.on("close", () => {});
    try {
      ws.close();
    } catch (err) {
      this.logWarn(`[RelayClient] Error while closing socket: ${String(err)}`);
    }
  }

  // ========================================================================
  // Public API
  // ========================================================================

  getState(): ConnectionState {
    return this.state;
  }

  isReady(): boolean {
    return this.isConnected() && this.synchronizedReceived;
  }

  /** True once the server has sent the callback snapshot for this session. */
  hasSnapshot(): boolean {
    return this.snapshotReceived;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getClientId(): string | null {
    return this.clientId;
  }
}
