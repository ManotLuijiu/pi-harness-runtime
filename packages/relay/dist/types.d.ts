/**
 * Relay Types - Two-way Streaming Communication
 */
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
export type ConnectionState = {
    state: 'disconnected';
} | {
    state: 'connecting';
} | {
    state: 'authenticating';
} | {
    state: 'connected';
    sessionId: string;
} | {
    state: 'reconnecting';
    attempt: number;
} | {
    state: 'error';
    error: string;
};
export interface ConnectionStateChange {
    previous: ConnectionState;
    current: ConnectionState;
    timestamp: string;
}
/**
 * Protocol version for typed streaming
 */
export declare const PROTOCOL_VERSION = 1;
/**
 * Generate a unique message ID
 */
export declare function generateMessageId(): string;
/**
 * Create a timestamp
 */
export declare function createTimestamp(): string;
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
export interface SynchronizedMessage extends BaseMessage<'synchronized'> {
}
/**
 * Callback types from Telegram/LINE
 */
export interface CallbackPayload {
    id: string;
    type: 'telegram_callback' | 'line_callback';
    action: string;
    targetId: string;
    userId: number;
    username?: string;
    messageId?: number;
    timestamp: string;
    callbackQueryId?: string;
    chatId?: number;
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
export interface PingMessage extends BaseMessage<'ping'> {
}
export interface PongMessage extends BaseMessage<'pong'> {
}
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
export type ServerMessage = SnapshotMessage | SynchronizedMessage | CallbackMessage | StatusMessage | PongMessage | ConnectedMessage | AuthResponseMessage;
/**
 * Union type of all client -> server messages
 */
export type ClientMessage = AuthRequestMessage | PingMessage | SubscribeMessage;
export interface RelayMessage {
    type: 'connect' | 'disconnect' | 'data' | 'ping' | 'pong' | 'error';
    tunnelId?: string;
    payload?: unknown;
    timestamp: string;
}
