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
 * Internal projection entry with state
 */
interface ProjectionEntry<T> {
  name: string;
  state: T;
  initialState: T;
  reduce: ProjectionFn<T>;
}

/**
 * Projection Store
 */
export class ProjectionStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private projections = new Map<string, ProjectionEntry<any>>();

  /**
   * Register a projection
   */
  register<T>(projection: { name: string; initialState: T; reduce: ProjectionFn<T> }): void {
    this.projections.set(projection.name, {
      name: projection.name,
      state: projection.initialState,
      initialState: projection.initialState,
      reduce: projection.reduce,
    });
  }

  /**
   * Apply events to all projections
   */
  apply(events: StoredEvent[]): void {
    for (const event of events) {
      for (const [name, entry] of this.projections.entries()) {
        try {
          entry.state = entry.reduce(entry.state, event);
        } catch {
          // Silently ignore projection errors - don't crash the event loop
          // callers can check projection state after apply()
        }
      }
    }
  }

  /**
   * Get projection state
   */
  get<T>(name: string): T | null {
    const entry = this.projections.get(name);
    return entry ? entry.state : null;
  }

  /**
   * Reset projection to initial state
   */
  reset(name: string): void {
    const entry = this.projections.get(name);
    if (entry) {
      entry.state = entry.initialState;
    }
  }

  /**
   * List all projection names
   */
  list(): string[] {
    return Array.from(this.projections.keys());
  }
}
