/**
 * Connection Registry
 *
 * Scopes connections by environment/context.
 * Tracks active connections and their state.
 */
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
export declare class ConnectionRegistry {
    private connections;
    private onChange?;
    constructor(onChange?: (entries: RegistryEntry[]) => void);
    /**
     * Register a new connection
     */
    register(id: string, supervisor: ConnectionSupervisor, metadata?: Record<string, unknown>): RegistryEntry;
    /**
     * Unregister a connection
     */
    unregister(id: string): boolean;
    /**
     * Get a connection by ID
     */
    get(id: string): RegistryEntry | undefined;
    /**
     * Get all connections
     */
    list(): RegistryEntry[];
    /**
     * Get connections by state
     */
    listByState(state: string): RegistryEntry[];
    /**
     * Update connection metadata
     */
    updateMetadata(id: string, metadata: Record<string, unknown>): boolean;
    /**
     * Update last connected timestamp
     */
    touch(id: string): boolean;
    /**
     * Clear all connections
     */
    clear(): Promise<void>;
    /**
     * Get count of connections
     */
    size(): number;
    /**
     * Check if connection exists
     */
    has(id: string): boolean;
    /**
     * Notify change listeners
     */
    private notifyChange;
}
