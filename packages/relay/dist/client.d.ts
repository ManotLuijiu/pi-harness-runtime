/**
 * Relay Client - Connect to relay server for remote access
 */
import type { RelayConfig, RelayTunnel, RelayMessage } from './types.js';
/**
 * Relay Client options
 */
export interface RelayClientOptions {
    /** Called when connected */
    onConnected?: () => void;
    /** Called when disconnected */
    onDisconnected?: () => void;
    /** Called when tunnel is established */
    onTunnel?: (tunnel: RelayTunnel) => void;
    /** Called on error */
    onError?: (error: Error) => void;
}
/**
 * Relay Client
 *
 * Connects to a relay server and establishes tunnels for remote access.
 */
export declare class RelayClient {
    private config;
    private options;
    private connected;
    private tunnel?;
    constructor(config: RelayConfig, options: RelayClientOptions);
    /**
     * Connect to relay server
     */
    connect(): Promise<void>;
    /**
     * Disconnect from relay server
     */
    disconnect(): Promise<void>;
    /**
     * Create a tunnel
     */
    createTunnel(localPort: number): Promise<RelayTunnel>;
    /**
     * Send a message through the tunnel
     */
    send(_message: RelayMessage): Promise<void>;
    /**
     * Check if connected
     */
    isConnected(): boolean;
    /**
     * Get current tunnel
     */
    getTunnel(): RelayTunnel | undefined;
}
