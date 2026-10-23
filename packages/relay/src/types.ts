/**
 * Relay Types - Two-way Streaming Communication
 */

import { randomUUID } from "node:crypto";

// ============================================================================
// Connection Types
// ============================================================================

export interface RelayConfig {
  /** Relay server URL */
  serverUrl: string;
  /** Authentication token */
  token?: string;
  /** Environment ID */
  environmentId?: string;
  /** Keep alive interval in ms */
  keepAlive?: number;
  /** Connect timeout in ms */
  connectTimeout?: number;
  /**
   * Retry a FAILED connect attempt in the background (exponential backoff).
   *
   * Off by default: an endless background retry loop is not always what the
   * caller wants, and `connect()` already rejects with the real error.
   */
  retryOnConnectFailure?: boolean;
}

export interface RelayTunnel {
  /** Tunnel ID */
  id: string;
  /** Public URL for the tunnel */
  url: string;
  /** Local port being tunneled */
  localPort: number;
  /** Connection status */
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  /** Created timestamp */
  createdAt: string;
  /** Error message if any */
  error?: string;
}

// ============================================================================
// WebSocket Connection State Machine
// ============================================================================

export type ConnectionState =
  | { state: 'disconnected' }
  | { state: 'connecting' }
  | { state: 'authenticating' }
  | { state: 'connected'; sessionId: string }
  | { state: 'reconnecting'; attempt: number }
  | { state: 'error'; error: string };

export interface ConnectionStateChange {
  previous: ConnectionState;
  current: ConnectionState;
  timestamp: string;
}

// ============================================================================
// Typed Streaming Protocol
// ============================================================================

/**
 * Protocol version for typed streaming
 */
export const PROTOCOL_VERSION = 1;

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return randomUUID();
}

/**
 * Create a timestamp
 */
export function createTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Base message interface
 */
export interface BaseMessage<T extends string, P = unknown> {
  version: typeof PROTOCOL_VERSION;
  type: T;
  payload: P;
  timestamp: string;
  messageId?: string;
}

/**
 * Server -> Client: Initial state snapshot sent on connect
 */
export interface SnapshotMessage extends BaseMessage<'snapshot'> {
  payload: {
    sessionId: string;
    serverVersion: string;
    connectedClients: number;
    recentCallbacks: CallbackPayload[];
  };
}

/**
 * Server -> Client: Synchronization marker (indicates all initial state sent)
 */
export interface SynchronizedMessage extends BaseMessage<'synchronized'> {}

/**
 * Callback types from Telegram/LINE
 */
export interface CallbackPayload {
  id: string;
  type: 'telegram_callback' | 'line_callback' | 'telegram_message';
  action: string;
  targetId: string;
  userId: number;
  username?: string;
  messageId?: number;
  timestamp: string;
  // Preserve Telegram-specific fields for proper greeting verification
  callbackQueryId?: string;
  chatId?: number;
  // Text of a "telegram_message" payload (the user typed a message)
  text?: string;
  // True when the sender of a "telegram_message" payload is a bot. The
  // client refuses bot messages, so the flag has to survive the transport.
  isBot?: boolean;
}

/**
 * Server -> Client: Live callback event (after synchronized)
 */
export interface CallbackMessage extends BaseMessage<'callback'> {
  payload: CallbackPayload;
}

/**
 * Server -> Client: Status update
 */
export type StatusKind = 'info' | 'warning' | 'error';

export interface StatusMessage extends BaseMessage<'status'> {
  payload: {
    kind: StatusKind;
    code: string;
    message: string;
  };
}

/**
 * Heartbeat messages
 */
export interface PingMessage extends BaseMessage<'ping'> {}

export interface PongMessage extends BaseMessage<'pong'> {}

/**
 * Authentication messages
 */
export interface AuthRequestMessage extends BaseMessage<'auth'> {
  payload: {
    token: string;
  };
}

export interface AuthResponseMessage extends BaseMessage<'auth'> {
  payload: {
    success: boolean;
    sessionId?: string;
    error?: string;
  };
}

/**
 * Client -> Server: Subscribe to specific event types
 */
export interface SubscribeMessage extends BaseMessage<'subscribe'> {
  payload: {
    events: ('callback' | 'status' | 'sync')[];
  };
}

/**
 * Connection acknowledged by server
 */
export interface ConnectedMessage extends BaseMessage<'connected'> {
  payload: {
    clientId: string;
    serverTime: string;
  };
}

/**
 * Union type of all server -> client messages
 */
export type ServerMessage =
  | SnapshotMessage
  | SynchronizedMessage
  | CallbackMessage
  | StatusMessage
  | PongMessage
  | ConnectedMessage
  | AuthResponseMessage;

/**
 * Union type of all client -> server messages
 */
export type ClientMessage =
  | AuthRequestMessage
  | PingMessage
  | SubscribeMessage;

// Legacy compatibility
export interface RelayMessage {
  type: 'connect' | 'disconnect' | 'data' | 'ping' | 'pong' | 'error';
  tunnelId?: string;
  payload?: unknown;
  timestamp: string;
}
