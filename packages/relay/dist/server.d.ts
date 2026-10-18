/**
 * Relay Server - Cloud relay server for tunnels
 */
import type { RelayTunnel, RelayMessage } from './types.js';
/**
 * Relay Server options
 */
export interface RelayServerOptions {
    /** Port to listen on */
    port?: number;
    /** Host to bind */
    host?: string;
    /** Called when a tunnel connects */
    onTunnelConnect?: (tunnel: RelayTunnel) => void;
    /** Called when a tunnel disconnects */
    onTunnelDisconnect?: (tunnelId: string) => void;
    /** Called when a message is received */
    onMessage?: (tunnelId: string, message: RelayMessage) => void;
}
/**
 * Relay Server
 *
 * Manages tunnels and relays messages between clients.
 */
export declare class RelayServer {
    private tunnels;
    private options;
    private running;
    constructor(options?: RelayServerOptions);
    /**
     * Start the relay server
     */
    start(): Promise<void>;
    /**
     * Stop the relay server
     */
    stop(): Promise<void>;
    /**
     * Get all active tunnels
     */
    getTunnels(): RelayTunnel[];
    /**
     * Get tunnel by ID
     */
    getTunnel(id: string): RelayTunnel | undefined;
    /**
     * Create a tunnel
     */
    createTunnel(localPort: number): RelayTunnel;
    /**
     * Remove a tunnel
     */
    removeTunnel(id: string): boolean;
    /**
     * Check if server is running
     */
    isRunning(): boolean;
}
