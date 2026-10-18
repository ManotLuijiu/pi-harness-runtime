/**
 * Relay Client - Connect to relay server for remote access
 */
/**
 * Generate a UUID v4
 */
function generateUUID() {
    // Use crypto.randomUUID if available (Node.js 14.17+)
    const crypto = globalThis;
    if (crypto.crypto?.randomUUID) {
        return crypto.crypto.randomUUID();
    }
    // Fallback: simple UUID generation
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
/**
 * Relay Client
 *
 * Connects to a relay server and establishes tunnels for remote access.
 */
export class RelayClient {
    config;
    options;
    connected = false;
    tunnel;
    constructor(config, options) {
        this.config = config;
        this.options = options;
    }
    /**
     * Connect to relay server
     */
    async connect() {
        if (this.connected)
            return;
        try {
            // In a real implementation, this would establish WebSocket connection
            // to the relay server and authenticate
            this.connected = true;
            this.options.onConnected?.();
        }
        catch (error) {
            this.options.onError?.(error);
            throw error;
        }
    }
    /**
     * Disconnect from relay server
     */
    async disconnect() {
        this.connected = false;
        this.tunnel = undefined;
        this.options.onDisconnected?.();
    }
    /**
     * Create a tunnel
     */
    async createTunnel(localPort) {
        const tunnel = {
            id: generateUUID(),
            url: `${this.config.serverUrl}/tunnel/${localPort}`,
            localPort,
            status: this.connected ? 'connected' : 'disconnected',
            createdAt: new Date().toISOString(),
        };
        this.tunnel = tunnel;
        this.options.onTunnel?.(tunnel);
        return tunnel;
    }
    /**
     * Send a message through the tunnel
     */
    async send(_message) {
        if (!this.connected) {
            throw new Error('Not connected to relay server');
        }
        // In a real implementation, this would send the message over WebSocket
    }
    /**
     * Check if connected
     */
    isConnected() {
        return this.connected;
    }
    /**
     * Get current tunnel
     */
    getTunnel() {
        return this.tunnel;
    }
}
