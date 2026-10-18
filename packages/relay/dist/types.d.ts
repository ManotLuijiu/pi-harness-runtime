/**
 * Relay Types
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
export interface RelayMessage {
    type: 'connect' | 'disconnect' | 'data' | 'ping' | 'pong' | 'error';
    tunnelId?: string;
    payload?: unknown;
    timestamp: string;
}
