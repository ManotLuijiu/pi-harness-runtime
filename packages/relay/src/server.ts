/**
 * Relay Server - Cloud relay server for tunnels
 */

import type { RelayConfig, RelayTunnel, RelayMessage } from './types.js';

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  // Use crypto.randomUUID if available
  const crypto = globalThis as { crypto?: { randomUUID?: () => string } };
  if (crypto.crypto?.randomUUID) {
    return crypto.crypto.randomUUID();
  }
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c: string) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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
export class RelayServer {
  private tunnels = new Map<string, RelayTunnel>();
  private options: Required<RelayServerOptions>;
  private running = false;

  constructor(options: RelayServerOptions = {}) {
    this.options = {
      port: options.port ?? 3001,
      host: options.host ?? '0.0.0.0',
      onTunnelConnect: options.onTunnelConnect ?? (() => {}),
      onTunnelDisconnect: options.onTunnelDisconnect ?? (() => {}),
      onMessage: options.onMessage ?? (() => {}),
    };
  }

  /**
   * Start the relay server
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // Note: Actual HTTP/WebSocket server would be implemented here
    // For now, this is a stub that can be expanded with actual server code
  }

  /**
   * Stop the relay server
   */
  async stop(): Promise<void> {
    this.running = false;
    this.tunnels.clear();
  }

  /**
   * Get all active tunnels
   */
  getTunnels(): RelayTunnel[] {
    return Array.from(this.tunnels.values());
  }

  /**
   * Get tunnel by ID
   */
  getTunnel(id: string): RelayTunnel | undefined {
    return this.tunnels.get(id);
  }

  /**
   * Create a tunnel
   */
  createTunnel(localPort: number): RelayTunnel {
    const tunnel: RelayTunnel = {
      id: generateUUID(),
      url: `https://tunnel-${Date.now()}.relay.example.com`,
      localPort,
      status: 'connecting',
      createdAt: new Date().toISOString(),
    };
    this.tunnels.set(tunnel.id, tunnel);
    return tunnel;
  }

  /**
   * Remove a tunnel
   */
  removeTunnel(id: string): boolean {
    return this.tunnels.delete(id);
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.running;
  }
}
