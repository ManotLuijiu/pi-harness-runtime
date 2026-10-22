/**
 * Relay Server - Two-way streaming WebSocket relay
 *
 * Implements t3code-style streaming with:
 * - Snapshot + Live event pattern
 * - Typed message protocol
 * - Connection state machine
 * - Stream coalescing
 */
import { type RelayTunnel, type RelayMessage, type ConnectionState, type ConnectionStateChange, type CallbackPayload } from './types.js';
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
export declare class RelayServer {
    private server;
    private wss;
    private clients;
    private tunnels;
    private options;
    private running;
    private serverSessionId;
    private eventBuffer;
    private recentCallbacks;
    constructor(options?: RelayServerOptions);
    /**
     * Start the WebSocket server
     */
    start(): Promise<void>;
    /**
     * Stop the relay server
     */
    stop(): Promise<void>;
    /**
     * Close the WebSocket server (if any) so it never keeps the process alive.
     */
    private closeWebSocketServer;
    private updateState;
    private handleMessage;
    private handleAuth;
    private handlePing;
    private handleSubscribe;
    /**
     * Send initial snapshot followed by synchronized marker
     * This is the t3code pattern: snapshot -> synchronized -> live events
     */
    private sendSnapshot;
    /**
     * Flush event buffer and send batched callbacks
     */
    private flushEventBuffer;
    /**
     * Broadcast callback to all connected clients
     * Uses stream batching for high-frequency events
     */
    broadcastCallback(callback: CallbackPayload, batch?: boolean): number;
    /**
     * Send status to all clients
     */
    broadcastStatus(kind: 'info' | 'warning' | 'error', code: string, message: string): void;
    /**
     * Broadcast to all subscribed clients
     */
    private broadcast;
    /**
     * Check if client is connected and authenticated
     */
    private isConnected;
    /**
     * Send a typed message to a client
     */
    private sendMessage;
    /**
     * Send status to specific client
     */
    private sendStatus;
    isRunning(): boolean;
    getClientCount(): number;
    getClients(): Array<{
        id: string;
        state: ConnectionState;
        connectedAt: string;
    }>;
    getRecentCallbacks(limit?: number): CallbackPayload[];
}
export declare function createRelayServer(options?: RelayServerOptions): RelayServer;
