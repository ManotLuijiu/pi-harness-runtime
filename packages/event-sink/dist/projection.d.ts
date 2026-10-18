/**
 * Projection Store
 *
 * Maintains materialized views of events for efficient queries.
 * Projections are updated atomically with events.
 */
import type { StoredEvent } from './sink.js';
/**
 * Projection function type
 */
export type ProjectionFn<T> = (state: T | null, event: StoredEvent) => T;
/**
 * Projection Store
 */
export declare class ProjectionStore {
    private projections;
    /**
     * Register a projection
     */
    register<T>(projection: {
        name: string;
        initialState: T;
        reduce: ProjectionFn<T>;
    }): void;
    /**
     * Apply events to all projections
     */
    apply(events: StoredEvent[]): void;
    /**
     * Get projection state
     */
    get<T>(name: string): T | null;
    /**
     * Reset projection to initial state
     */
    reset(name: string): void;
    /**
     * List all projection names
     */
    list(): string[];
}
