/**
 * Connection types
 *
 * Note: Uses minimal EventEmitter-like interface to avoid Node.js dependency.
 * Implementations can swap in Node's EventEmitter or use any compatible event system.
 */
/**
 * Default connection options
 */
export const DEFAULT_CONNECTION_OPTIONS = {
    initialDelay: 1000,
    maxDelay: 5 * 60 * 1000, // 5 minutes
    maxRetries: 0, // Infinite
    jitter: true,
    verbose: false,
};
