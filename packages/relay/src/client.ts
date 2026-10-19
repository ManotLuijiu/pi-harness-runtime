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
  
  // State machine
  private state: ConnectionState = { state: 'disconnected' };
  private sessionId: string | null = null;
  private clientId: string | null = null;
  
  // Reconnection
  private reconnectAttempt = 0;
  private reconnectDelay = DEFAULT_RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  
  // Heartbeat
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  
  // Snapshot tracking (t3code pattern)
  private snapshotReceived = false;
  private synchronizedReceived = false;

  constructor(config: RelayConfig, callbacks: RelayClientCallbacks = {}) {
    this.config = config;
    this.callbacks = callbacks;
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
   * Connect to relay server with automatic authentication
   */
  async connect(): Promise<void> {
    if (this.isConnected()) return;
    
    // Clear any existing connection
    this.cleanup();
    
    this.setState({ state: 'connecting' });
    
    const url = this.config.serverUrl;
    console.log(`[RelayClient] Connecting to ${url}...`);
    
    return new Promise((resolve, reject) => {
      // Set connect timeout
      this.connectTimeoutTimer = setTimeout(() => {
        if (this.state.state === 'connecting') {
          this.ws?.close();
          reject(new Error('Connection timeout'));
        }
      }, CONNECT_TIMEOUT_MS);
      
      this.ws = new WebSocket(url);
      
      this.ws.on("open", () => {
        console.log("[RelayClient] WebSocket opened");
        this.setState({ state: 'authenticating' });
        
        // Send authentication
        this.send({
          version: PROTOCOL_VERSION,
          type: 'auth',
          payload: { token: this.config.token || '' },
          timestamp: createTimestamp(),
        });
      });
      
      this.ws.on("message", (data) => {
        this.handleMessage(data.toString());
      });
      
      this.ws.on("close", () => {
        console.log("[RelayClient] WebSocket closed");
        this.handleDisconnect();
      });
      
      this.ws.on("error", (err) => {
        console.error("[RelayClient] WebSocket error:", err.message);
        this.callbacks.onError?.(err);
        
        if (this.state.state === 'connecting' || this.state.state === 'authenticating') {
          clearTimeout(this.connectTimeoutTimer!);
          reject(err);
        }
        
        this.handleDisconnect();
      });
    });
  }

  /**
   * Disconnect from relay server
   */
  disconnect(): void {
    console.log("[RelayClient] Disconnecting...");
    this.cleanup();
    this.setState({ state: 'disconnected' });
    this.callbacks.onDisconnected?.();
  }

  /**
   * Send a message through the WebSocket
   */
  send(message: ClientMessage): void {
    if (this.isConnected()) {
      this.ws!.send(JSON.stringify(message));
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
          console.warn(`[RelayClient] Unknown message type: ${unknownMsg.type}`);
        }
      }
    } catch (err) {
      console.error("[RelayClient] Failed to parse message:", err);
      this.callbacks.onError?.(err as Error);
    }
  }

  private handleConnected(msg: ConnectedMessage): void {
    this.clientId = msg.payload.clientId;
    console.log(`[RelayClient] Connected, clientId: ${this.clientId}`);
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
      console.log(`[RelayClient] Authenticated, sessionId: ${this.sessionId}`);
    } else {
      console.error(`[RelayClient] Auth failed: ${msg.payload.error}`);
      this.callbacks.onError?.(new Error(msg.payload.error || 'Authentication failed'));
      this.disconnect();
    }
  }

  private handleSnapshot(msg: SnapshotMessage): void {
    console.log(`[RelayClient] Snapshot received: ${msg.payload.recentCallbacks.length} recent callbacks`);
    this.snapshotReceived = true;
    
    // Notify callback
    this.callbacks.onSnapshot?.(msg.payload);
  }

  private handleSynchronized(_msg: SynchronizedMessage): void {
    console.log("[RelayClient] Synchronized - live events starting");
    this.synchronizedReceived = true;
    
    // Notify callback
    this.callbacks.onSynchronized?.();
  }

  private handleCallback(msg: CallbackMessage): void {
    // Only process callbacks after synchronized
    if (!this.synchronizedReceived) {
      console.warn("[RelayClient] Ignoring callback before synchronized");
      return;
    }
    
    this.callbacks.onCallback?.(msg.payload);
  }

  private handleStatus(msg: StatusMessage): void {
    console.log(`[RelayClient] Status [${msg.payload.kind}]: ${msg.payload.code} - ${msg.payload.message}`);
    this.callbacks.onStatus?.(msg.payload);
  }

  // ========================================================================
  // Disconnect & Reconnect
  // ========================================================================

  private handleDisconnect(): void {
    this.stopHeartbeat();
    
    const wasConnected = this.state.state === 'connected';
    this.setState({ state: 'disconnected' });
    
    if (wasConnected) {
      this.callbacks.onDisconnected?.();
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    
    this.reconnectAttempt++;
    this.setState({ state: 'reconnecting', attempt: this.reconnectAttempt });
    
    console.log(`[RelayClient] Scheduling reconnect attempt ${this.reconnectAttempt} in ${this.reconnectDelay}ms`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        console.error(`[RelayClient] Reconnect failed: ${err.message}`);
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
    
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        this.send({
          version: PROTOCOL_VERSION,
          type: 'ping',
          payload: {},
          timestamp: createTimestamp(),
        });
      }
    }, HEARTBEAT_INTERVAL_MS);
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
    
    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
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

  getSessionId(): string | null {
    return this.sessionId;
  }

  getClientId(): string | null {
    return this.clientId;
  }
}
