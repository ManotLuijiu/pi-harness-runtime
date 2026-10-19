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
export { RelayServer, createRelayServer } from './server.js';
export type { RelayServerOptions } from './server.js';
export { RelayClient } from './client.js';
export type { RelayClientCallbacks } from './client.js';
export { PROTOCOL_VERSION, generateMessageId, createTimestamp, } from './types.js';
export type { RelayConfig, RelayTunnel, ConnectionState, ConnectionStateChange, BaseMessage, SnapshotMessage, SynchronizedMessage, CallbackPayload, CallbackMessage, StatusKind, StatusMessage, PingMessage, PongMessage, AuthRequestMessage, AuthResponseMessage, SubscribeMessage, ConnectedMessage, ServerMessage, ClientMessage, RelayMessage, } from './types.js';
