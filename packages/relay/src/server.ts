/**
 * Relay Server - Two-way streaming WebSocket relay
 * 
 * Implements t3code-style streaming with:
 * - Snapshot + Live event pattern
 * - Typed message protocol
 * - Connection state machine
 * - Stream coalescing
 */

import { createServer, IncomingMessage, ServerResponse, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
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
  type SubscribeMessage,
  PROTOCOL_VERSION,
  generateMessageId,
  createTimestamp,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PORT = 8444;
const DEFAULT_HOST = "0.0.0.0";
const MAX_RECENT_CALLBACKS = 100;
const STREAM_BATCH_SIZE = 50;  // Batch events for coalescing
const STREAM_BATCH_TIMEOUT_MS = 100;  // Flush batch after this delay

// ============================================================================
// Server Options
// ============================================================================

export interface RelayServerOptions {
  /** Port to listen on */
  port?: number;
  /** Host to bind */
  host?: string;
  /** Authentication token */
  authToken?: string;
  /** Server version string */
  serverVersion?: string;
  /** Called when a tunnel connects */
  onTunnelConnect?: (tunnel: RelayTunnel) => void;
  /** Called when a tunnel disconnects */
  onTunnelDisconnect?: (tunnelId: string) => void;
  /** Called when a message is received */
  onMessage?: (tunnelId: string, message: RelayMessage) => void;
  /** Called on state change */
  onStateChange?: (change: ConnectionStateChange) => void;
}

// ============================================================================
// Client Session
// ============================================================================

interface ClientSession {
  id: string;
  ws: WebSocket;
  state: ConnectionState;
  subscriptions: Set<'callback' | 'status' | 'sync'>;
  connectedAt: string;
  lastPing: string;
  pendingSnapshot: boolean;  // True if snapshot not yet sent
}

// ============================================================================
// Stream Event Buffer (for coalescing)
// ============================================================================

interface EventBuffer {
  callbacks: CallbackPayload[];
  timer: ReturnType<typeof setTimeout> | null;
}

function createEventBuffer(): EventBuffer {
  return {
    callbacks: [],
    timer: null,
  };
}

// ============================================================================
// Relay Server - Two-way Streaming Implementation
// ============================================================================

export class RelayServer {
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, ClientSession>();
  private tunnels = new Map<string, RelayTunnel>();
  private options: Required<RelayServerOptions>;
  private running = false;
  private serverSessionId: string;
  
  // Event stream buffering for coalescing
  private eventBuffer: EventBuffer = createEventBuffer();
  
  // Recent callbacks for snapshot
  private recentCallbacks: CallbackPayload[] = [];

  constructor(options: RelayServerOptions = {}) {
    this.serverSessionId = randomUUID();
    this.options = {
      port: options.port ?? DEFAULT_PORT,
      host: options.host ?? DEFAULT_HOST,
      authToken: options.authToken ?? "change-me-in-production",
      serverVersion: options.serverVersion ?? "1.0.0",
      onTunnelConnect: options.onTunnelConnect ?? (() => {}),
      onTunnelDisconnect: options.onTunnelDisconnect ?? (() => {}),
      onMessage: options.onMessage ?? (() => {}),
      onStateChange: options.onStateChange ?? (() => {}),
    };
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

  /**
   * Start the WebSocket server
   */
  async start(): Promise<void> {
    if (this.running) return;

    this.server = createServer();
    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const clientId = randomUUID();
      const clientIp = req.socket.remoteAddress;
      
      console.log(`[RelayServer] Client connecting: ${clientId} from ${clientIp}`);
      
      // Create client session
      const session: ClientSession = {
        id: clientId,
        ws,
        state: { state: 'connecting' },
        subscriptions: new Set(['callback', 'status', 'sync']),
        connectedAt: createTimestamp(),
        lastPing: createTimestamp(),
        pendingSnapshot: true,
      };
      
      this.clients.set(clientId, session);
      this.updateState(session, { state: 'connecting' });

      // Handle incoming messages
      ws.on("message", (data: Buffer) => {
        this.handleMessage(clientId, data);
      });

      ws.on("close", () => {
        this.clients.delete(clientId);
        console.log(`[RelayServer] Client disconnected: ${clientId}`);
      });

      ws.on("error", (err) => {
        console.error(`[RelayServer] Client error: ${clientId}`, err.message);
        this.clients.delete(clientId);
      });

      // Send initial connected message
      this.sendMessage(session, {
        version: PROTOCOL_VERSION,
        type: 'connected',
        payload: {
          clientId,
          serverTime: createTimestamp(),
        },
        timestamp: createTimestamp(),
      } as ConnectedMessage);

      // Client will send auth message - wait for it
      // Auth is validated in handleMessage -> handleAuth
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.options.port, this.options.host, () => {
        this.running = true;
        console.log(`[RelayServer] Server started on ${this.options.host}:${this.options.port}`);
        resolve();
      });
      
      this.server!.on("error", (err) => {
        console.error("[RelayServer] Server error:", err);
        reject(err);
      });
    });
  }

  /**
   * Stop the relay server
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    // Close all client connections
    for (const session of this.clients.values()) {
      session.ws.close();
    }
    this.clients.clear();

    // Close event buffer timer
    if (this.eventBuffer.timer) {
      clearTimeout(this.eventBuffer.timer);
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.running = false;
        console.log("[RelayServer] Server stopped");
        resolve();
      });
    });
  }

  // ========================================================================
  // State Management
  // ========================================================================

  private updateState(session: ClientSession, newState: ConnectionState): void {
    const previous = session.state;
    session.state = newState;
    
    this.options.onStateChange({
      previous,
      current: newState,
      timestamp: createTimestamp(),
    });
  }

  // ========================================================================
  // Message Handling
  // ========================================================================

  private handleMessage(clientId: string, data: Buffer): void {
    const session = this.clients.get(clientId);
    if (!session) return;

    try {
      const msg = JSON.parse(data.toString()) as ClientMessage & { type: string };
      
      switch (msg.type) {
        case 'auth':
          this.handleAuth(clientId, (msg as { payload: { token: string } }).payload.token);
          break;

        case 'ping':
          this.handlePing(session);
          break;

        case 'subscribe':
          this.handleSubscribe(session, msg as SubscribeMessage);
          break;

        default:
          const _msg = msg as { type: string };
          console.warn(`[RelayServer] Unknown message type: ${_msg?.type}`);
      }
    } catch (err) {
      console.error("[RelayServer] Invalid message:", err);
      this.sendStatus(session, 'error', 'INVALID_MESSAGE', 'Failed to parse message');
    }
  }

  private handleAuth(clientId: string, token: string): void {
    const session = this.clients.get(clientId);
    if (!session) return;

    const success = token === this.options.authToken;
    const response: AuthResponseMessage = {
      version: PROTOCOL_VERSION,
      type: 'auth',
      payload: {
        success,
        sessionId: success ? this.serverSessionId : undefined,
        error: success ? undefined : 'Invalid token',
      },
      timestamp: createTimestamp(),
      messageId: generateMessageId(),
    };

    this.sendMessage(session, response);

    if (success) {
      this.updateState(session, { state: 'connected', sessionId: this.serverSessionId });
      console.log(`[RelayServer] Client authenticated: ${clientId}`);
      
      // Send snapshot + synchronized (t3code pattern)
      this.sendSnapshot(session);
    } else {
      this.updateState(session, { state: 'error', error: 'Authentication failed' });
      session.ws.close();
    }
  }

  private handlePing(session: ClientSession): void {
    session.lastPing = createTimestamp();
    this.sendMessage(session, {
      version: PROTOCOL_VERSION,
      type: 'pong',
      payload: {},
      timestamp: createTimestamp(),
    });
  }

  private handleSubscribe(session: ClientSession, msg: SubscribeMessage): void {
    session.subscriptions = new Set(msg.payload.events);
    console.log(`[RelayServer] Client ${session.id} subscribed to: ${Array.from(session.subscriptions).join(', ')}`);
  }

  // ========================================================================
  // Snapshot + Live Streaming (t3code pattern)
  // ========================================================================

  /**
   * Send initial snapshot followed by synchronized marker
   * This is the t3code pattern: snapshot -> synchronized -> live events
   */
  private async sendSnapshot(session: ClientSession): Promise<void> {
    // Build snapshot message
    const snapshot: SnapshotMessage = {
      version: PROTOCOL_VERSION,
      type: 'snapshot',
      payload: {
        sessionId: this.serverSessionId,
        serverVersion: this.options.serverVersion,
        connectedClients: this.clients.size,
        recentCallbacks: this.recentCallbacks.slice(-20),  // Last 20 callbacks
      },
      timestamp: createTimestamp(),
      messageId: generateMessageId(),
    };

    // Send snapshot
    this.sendMessage(session, snapshot);

    // Send synchronized marker (t3code pattern: indicates snapshot complete)
    const synchronized: SynchronizedMessage = {
      version: PROTOCOL_VERSION,
      type: 'synchronized',
      payload: {},
      timestamp: createTimestamp(),
      messageId: generateMessageId(),
    };

    this.sendMessage(session, synchronized);
    session.pendingSnapshot = false;
    
    console.log(`[RelayServer] Snapshot sent to ${session.id}`);
  }

  /**
   * Flush event buffer and send batched callbacks
   */
  private flushEventBuffer(): void {
    if (this.eventBuffer.callbacks.length === 0) return;

    const callbacks = this.eventBuffer.callbacks;
    this.eventBuffer.callbacks = [];
    this.eventBuffer.timer = null;

    // Send each callback as a separate live event
    for (const callback of callbacks) {
      this.broadcastCallback(callback, false);  // false = don't add to recent
    }
  }

  // ========================================================================
  // Broadcasting
  // ========================================================================

  /**
   * Broadcast callback to all connected clients
   * Uses stream batching for high-frequency events
   */
  broadcastCallback(callback: CallbackPayload, batch = true): number {
    // Add to recent callbacks (circular buffer)
    this.recentCallbacks.push(callback);
    if (this.recentCallbacks.length > MAX_RECENT_CALLBACKS) {
      this.recentCallbacks.shift();
    }

    const message: CallbackMessage = {
      version: PROTOCOL_VERSION,
      type: 'callback',
      payload: callback,
      timestamp: createTimestamp(),
      messageId: generateMessageId(),
    };

    if (batch) {
      // Add to buffer for coalescing
      this.eventBuffer.callbacks.push(callback);

      if (!this.eventBuffer.timer) {
        this.eventBuffer.timer = setTimeout(() => {
          this.flushEventBuffer();
        }, STREAM_BATCH_TIMEOUT_MS);
      }
    } else {
      // Send immediately
      this.broadcast(message);
    }

    // Number of connected clients that will receive this callback.
    // Callers use 0 to detect "no relay client attached" and fall back to disk.
    return this.getClientCount();
  }

  /**
   * Send status to all clients
   */
  broadcastStatus(kind: 'info' | 'warning' | 'error', code: string, message: string): void {
    const msg: StatusMessage = {
      version: PROTOCOL_VERSION,
      type: 'status',
      payload: { kind, code, message },
      timestamp: createTimestamp(),
      messageId: generateMessageId(),
    };

    this.broadcast(msg);
  }

  /**
   * Broadcast to all subscribed clients
   */
  private broadcast(message: ServerMessage): number {
    let count = 0;

    for (const session of this.clients.values()) {
      if (this.isConnected(session)) {
        this.sendMessage(session, message);
        count++;
      }
    }

    console.log(`[RelayServer] Broadcast ${message.type} to ${count} client(s)`);

    return count;
  }

  /**
   * Check if client is connected and authenticated
   */
  private isConnected(session: ClientSession): boolean {
    return session.ws.readyState === WebSocket.OPEN && 
           session.state.state === 'connected';
  }

  /**
   * Send a typed message to a client
   */
  private sendMessage(session: ClientSession, message: ServerMessage): void {
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send status to specific client
   */
  private sendStatus(session: ClientSession, kind: 'info' | 'warning' | 'error', code: string, message: string): void {
    const msg: StatusMessage = {
      version: PROTOCOL_VERSION,
      type: 'status',
      payload: { kind, code, message },
      timestamp: createTimestamp(),
      messageId: generateMessageId(),
    };
    this.sendMessage(session, msg);
  }

  // ========================================================================
  // Public API
  // ========================================================================

  isRunning(): boolean {
    return this.running;
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getClients(): Array<{ id: string; state: ConnectionState; connectedAt: string }> {
    return Array.from(this.clients.values()).map(s => ({
      id: s.id,
      state: s.state,
      connectedAt: s.connectedAt,
    }));
  }

  getRecentCallbacks(limit = 20): CallbackPayload[] {
    return this.recentCallbacks.slice(-limit);
  }
}

// ============================================================================
// Export for use in webhook server
// ============================================================================

export function createRelayServer(options?: RelayServerOptions): RelayServer {
  return new RelayServer(options);
}
