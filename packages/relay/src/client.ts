/**
 * Relay Client - Connect to relay server for remote access
 */

import type { RelayConfig, RelayTunnel, RelayMessage } from './types.js';

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  // Use crypto.randomUUID if available (Node.js 14.17+)
  const crypto = globalThis as { crypto?: { randomUUID?: () => string } };
  if (crypto.crypto?.randomUUID) {
    return crypto.crypto.randomUUID();
  }
  // Fallback: simple UUID generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c: string) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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
export class RelayClient {
  private config: RelayConfig;
  private options: RelayClientOptions;
  private connected = false;
  private tunnel?: RelayTunnel;

  constructor(config: RelayConfig, options: RelayClientOptions) {
    this.config = config;
    this.options = options;
  }

  /**
   * Connect to relay server
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      // In a real implementation, this would establish WebSocket connection
      // to the relay server and authenticate
      this.connected = true;
      this.options.onConnected?.();
    } catch (error) {
      this.options.onError?.(error as Error);
      throw error;
    }
  }

  /**
   * Disconnect from relay server
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.tunnel = undefined;
    this.options.onDisconnected?.();
  }

  /**
   * Create a tunnel
   */
  async createTunnel(localPort: number): Promise<RelayTunnel> {
    const tunnel: RelayTunnel = {
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
  async send(_message: RelayMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected to relay server');
    }
    // In a real implementation, this would send the message over WebSocket
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get current tunnel
   */
  getTunnel(): RelayTunnel | undefined {
    return this.tunnel;
  }
}
