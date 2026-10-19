/**
 * Cloud Relay - Two-way Streaming Communication
 *
 * Enables real-time two-way communication with pi-harness without router/port forwarding.
 * Based on T3Code's streaming architecture:
 * - Snapshot + Live event pattern
 * - Typed message protocol
 * - Connection state machine
 * - Stream coalescing
 */
// Server
export { RelayServer, createRelayServer } from './server.js';
// Client
export { RelayClient } from './client.js';
// Types
export { PROTOCOL_VERSION, generateMessageId, createTimestamp, } from './types.js';
