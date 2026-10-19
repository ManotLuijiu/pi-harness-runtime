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
    private heartbeatTimer;
    private snapshotReceived;
    private synchronizedReceived;
    constructor(config: RelayConfig, callbacks?: RelayClientCallbacks);
    private setState;
    private isConnected;
    /**
     * Connect to relay server with automatic authentication
     */
    connect(): Promise<void>;
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
    private scheduleReconnect;
    private startHeartbeat;
    private stopHeartbeat;
    private cleanup;
    getState(): ConnectionState;
    isReady(): boolean;
    getSessionId(): string | null;
    getClientId(): string | null;
}
