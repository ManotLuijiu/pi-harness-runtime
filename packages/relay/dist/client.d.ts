/**
 * Relay Client - Two-way streaming WebSocket client
 *
 * Implements t3code-style streaming with:
 * - Connection state machine
 * - Snapshot + live event handling
 * - Typed message protocol
 * - Automatic reconnection with backoff
 */
import { type RelayConfig, type ConnectionState, type ConnectionStateChange, type CallbackPayload, type ClientMessage, type SnapshotMessage, type StatusMessage } from './types.js';
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
export declare class RelayClient {
    private ws;
    private config;
    private callbacks;
    private state;
    private sessionId;
    private clientId;
    private reconnectAttempt;
    private reconnectDelay;
    private reconnectTimer;
    private connectTimeoutTimer;
    private pendingConnect;
    private connectPromise;
    private connectAttempt;
    private connectPromiseAttempt;
    private shuttingDown;
    private heartbeatTimer;
    private snapshotReceived;
    private synchronizedReceived;
    constructor(config: RelayConfig, callbacks?: RelayClientCallbacks);
    private setState;
    private isConnected;
    /**
     * Connect to relay server with automatic authentication.
     *
     * The returned Promise settles exactly once:
     * - resolves when the server confirms authentication (the readiness milestone)
     * - rejects on websocket error, authentication failure, close-before-ready,
     *   an explicit disconnect(), or the connect deadline
     */
    connect(): Promise<void>;
    /**
     * Open the socket and drive the connect/auth handshake.
     * The promise settles via settleConnect() from the handshake handlers.
     */
    private startConnect;
    /**
     * Settle the pending connect() promise exactly once.
     * Passing an error rejects; calling without an error resolves.
     */
    private settleConnect;
    /**
     * Disconnect from relay server
     */
    disconnect(): void;
    /**
     * Send a message through the WebSocket
     * Note: Messages can be sent even during authentication phase
     */
    send(message: ClientMessage): void;
    private handleMessage;
    private handleConnected;
    private handleAuth;
    private handleSnapshot;
    private handleSynchronized;
    private handleCallback;
    private handleStatus;
    private handleDisconnect;
    /**
     * Schedule a reconnect after a FAILED connect attempt.
     *
     * The backoff loop only survives the loss of an established connection, so a
     * refused server or a failed handshake would otherwise leave the client
     * permanently disconnected. Opt-in via `config.retryOnConnectFailure`:
     * an endless background retry loop is not always what the caller wants.
     */
    private scheduleReconnectAfterFailure;
    private scheduleReconnect;
    private startHeartbeat;
    private stopHeartbeat;
    private cleanup;
    /**
     * Close the active socket without firing our own close/error handlers.
     */
    private closeSocket;
    getState(): ConnectionState;
    isReady(): boolean;
    /** True once the server has sent the callback snapshot for this session. */
    hasSnapshot(): boolean;
    getSessionId(): string | null;
    getClientId(): string | null;
}
