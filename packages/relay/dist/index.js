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
// Endpoint resolution (relay URL + auth token discovery)
export { resolveRelayEndpoint, deriveRelayWsUrl, isRelayWsUrl, describeRelayEndpoint, } from './relay-endpoint.js';
export { RELAY_URL_SOURCES, RELAY_TOKEN_SOURCES, } from './relay-endpoint.js';
// Types
export { PROTOCOL_VERSION, generateMessageId, createTimestamp, } from './types.js';
