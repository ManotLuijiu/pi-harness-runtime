/**
 * Connection Registry
 * 
 * Scopes connections by environment/context.
 * Tracks active connections and their state.
 */

import type { EventEmitter } from './types.js';
import { ConnectionSupervisor } from './supervisor.js';

export interface RegistryEntry {
  id: string;
  supervisor: ConnectionSupervisor;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  lastConnectedAt?: Date;
}

/**
 * Connection Registry
 * 
 * Manages multiple connections by ID.
 * Connections persist even after disconnect (for reconnection).
 */
export class ConnectionRegistry {
  private connections = new Map<string, RegistryEntry>();
  private onChange?: (entries: RegistryEntry[]) => void;

  constructor(onChange?: (entries: RegistryEntry[]) => void) {
    this.onChange = onChange;
  }

  /**
   * Register a new connection
   */
  register(id: string, supervisor: ConnectionSupervisor, metadata?: Record<string, unknown>): RegistryEntry {
    const entry: RegistryEntry = {
      id,
      supervisor,
      metadata,
      createdAt: new Date(),
    };

    this.connections.set(id, entry);
    this.notifyChange();
    return entry;
  }

  /**
   * Unregister a connection
   */
  unregister(id: string): boolean {
    const entry = this.connections.get(id);
    if (entry) {
      entry.supervisor.disconnect().catch(() => {});
      this.connections.delete(id);
      this.notifyChange();
      return true;
    }
    return false;
  }

  /**
   * Get a connection by ID
   */
  get(id: string): RegistryEntry | undefined {
    return this.connections.get(id);
  }

  /**
   * Get all connections
   */
  list(): RegistryEntry[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get connections by state
   */
  listByState(state: string): RegistryEntry[] {
    return this.list().filter(e => e.supervisor.getState() === state);
  }

  /**
   * Update connection metadata
   */
  updateMetadata(id: string, metadata: Record<string, unknown>): boolean {
    const entry = this.connections.get(id);
    if (entry) {
      entry.metadata = { ...entry.metadata, ...metadata };
      this.notifyChange();
      return true;
    }
    return false;
  }

  /**
   * Update last connected timestamp
   */
  touch(id: string): boolean {
    const entry = this.connections.get(id);
    if (entry) {
      entry.lastConnectedAt = new Date();
      this.notifyChange();
      return true;
    }
    return false;
  }

  /**
   * Clear all connections
   */
  async clear(): Promise<void> {
    const promises = this.list().map(e => e.supervisor.disconnect());
    await Promise.allSettled(promises);
    this.connections.clear();
    this.notifyChange();
  }

  /**
   * Get count of connections
   */
  size(): number {
    return this.connections.size;
  }

  /**
   * Check if connection exists
   */
  has(id: string): boolean {
    return this.connections.has(id);
  }

  /**
   * Notify change listeners
   */
  private notifyChange(): void {
    if (this.onChange) {
      this.onChange(this.list());
    }
  }
}
