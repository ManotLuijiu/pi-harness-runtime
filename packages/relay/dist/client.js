/**
 * Relay Client - Two-way streaming WebSocket client
 *
 * Implements t3code-style streaming with:
 * - Connection state machine
 * - Snapshot + live event handling
 * - Typed message protocol
 * - Automatic reconnection with backoff
 */
import WebSocket from "ws";
import { PROTOCOL_VERSION, createTimestamp, } from './types.js';
// ============================================================================
// Constants
// ============================================================================
const DEFAULT_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 30000;
const CONNECT_TIMEOUT_MS = 10000;
// ============================================================================
// Relay Client - Two-way Streaming Implementation
// ============================================================================
export class RelayClient {
    ws = null;
    config;
    callbacks;
    // State machine
    state = { state: 'disconnected' };
    sessionId = null;
    clientId = null;
    // Reconnection
    reconnectAttempt = 0;
    reconnectDelay = DEFAULT_RECONNECT_DELAY_MS;
    reconnectTimer = null;
    connectTimeoutTimer = null;
    // Heartbeat
    heartbeatTimer = null;
    // Snapshot tracking (t3code pattern)
    snapshotReceived = false;
    synchronizedReceived = false;
    constructor(config, callbacks = {}) {
        this.config = config;
        this.callbacks = callbacks;
    }
    // ========================================================================
    // Connection State Machine
    // ========================================================================
    setState(newState) {
        const previous = this.state;
        this.state = newState;
        this.callbacks.onStateChange?.({
            previous,
            current: newState,
            timestamp: createTimestamp(),
        });
    }
    isConnected() {
        return this.ws?.readyState === WebSocket.OPEN &&
            this.state.state === 'connected';
    }
    // ========================================================================
    // Lifecycle
    // ========================================================================
    /**
     * Connect to relay server with automatic authentication
     */
    async connect() {
        if (this.isConnected())
            return;
        // Clear any existing connection
        this.cleanup();
        this.setState({ state: 'connecting' });
        const url = this.config.serverUrl;
        console.log(`[RelayClient] Connecting to ${url}...`);
        return new Promise((resolve, reject) => {
            // Set connect timeout
            this.connectTimeoutTimer = setTimeout(() => {
                if (this.state.state === 'connecting') {
                    this.ws?.close();
                    reject(new Error('Connection timeout'));
                }
            }, CONNECT_TIMEOUT_MS);
            this.ws = new WebSocket(url);
            this.ws.on("open", () => {
                console.log("[RelayClient] WebSocket opened");
                this.setState({ state: 'authenticating' });
                // Send authentication
                this.send({
                    version: PROTOCOL_VERSION,
                    type: 'auth',
                    payload: { token: this.config.token || '' },
                    timestamp: createTimestamp(),
                });
            });
            this.ws.on("message", (data) => {
                this.handleMessage(data.toString());
            });
            this.ws.on("close", () => {
                console.log("[RelayClient] WebSocket closed");
                this.handleDisconnect();
            });
            this.ws.on("error", (err) => {
                console.error("[RelayClient] WebSocket error:", err.message);
                this.callbacks.onError?.(err);
                if (this.state.state === 'connecting' || this.state.state === 'authenticating') {
                    clearTimeout(this.connectTimeoutTimer);
                    reject(err);
                }
                this.handleDisconnect();
            });
        });
    }
    /**
     * Disconnect from relay server
     */
    disconnect() {
        console.log("[RelayClient] Disconnecting...");
        this.cleanup();
        this.setState({ state: 'disconnected' });
        this.callbacks.onDisconnected?.();
    }
    /**
     * Send a message through the WebSocket
     * Note: Messages can be sent even during authentication phase
     */
    send(message) {
        // Allow sending if WebSocket is open, regardless of authentication state
        // This is needed for auth message which is sent before state becomes 'connected'
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
        else {
            console.warn("[RelayClient] Cannot send: WebSocket not open");
        }
    }
    // ========================================================================
    // Message Handling
    // ========================================================================
    handleMessage(data) {
        try {
            const msg = JSON.parse(data);
            switch (msg.type) {
                case 'connected':
                    this.handleConnected(msg);
                    break;
                case 'auth':
                    this.handleAuth(msg);
                    break;
                case 'snapshot':
                    this.handleSnapshot(msg);
                    break;
                case 'synchronized':
                    this.handleSynchronized(msg);
                    break;
                case 'callback':
                    this.handleCallback(msg);
                    break;
                case 'status':
                    this.handleStatus(msg);
                    break;
                case 'pong':
                    // Heartbeat response - connection is alive
                    break;
                default: {
                    const unknownMsg = msg;
                    console.warn(`[RelayClient] Unknown message type: ${unknownMsg.type}`);
                }
            }
        }
        catch (err) {
            console.error("[RelayClient] Failed to parse message:", err);
            this.callbacks.onError?.(err);
        }
    }
    handleConnected(msg) {
        this.clientId = msg.payload.clientId;
        console.log(`[RelayClient] Connected, clientId: ${this.clientId}`);
    }
    handleAuth(msg) {
        if (msg.payload.success) {
            this.sessionId = msg.payload.sessionId || null;
            this.setState({ state: 'connected', sessionId: this.sessionId || '' });
            // Reset reconnection state
            this.reconnectAttempt = 0;
            this.reconnectDelay = DEFAULT_RECONNECT_DELAY_MS;
            // Start heartbeat
            this.startHeartbeat();
            // Notify callback
            this.callbacks.onConnected?.(this.sessionId || '');
            console.log(`[RelayClient] Authenticated, sessionId: ${this.sessionId}`);
        }
        else {
            console.error(`[RelayClient] Auth failed: ${msg.payload.error}`);
            this.callbacks.onError?.(new Error(msg.payload.error || 'Authentication failed'));
            this.disconnect();
        }
    }
    handleSnapshot(msg) {
        console.log(`[RelayClient] Snapshot received: ${msg.payload.recentCallbacks.length} recent callbacks`);
        this.snapshotReceived = true;
        // Notify callback
        this.callbacks.onSnapshot?.(msg.payload);
    }
    handleSynchronized(_msg) {
        console.log("[RelayClient] Synchronized - live events starting");
        this.synchronizedReceived = true;
        // Notify callback
        this.callbacks.onSynchronized?.();
    }
    handleCallback(msg) {
        // Only process callbacks after synchronized
        if (!this.synchronizedReceived) {
            console.warn("[RelayClient] Ignoring callback before synchronized");
            return;
        }
        this.callbacks.onCallback?.(msg.payload);
    }
    handleStatus(msg) {
        console.log(`[RelayClient] Status [${msg.payload.kind}]: ${msg.payload.code} - ${msg.payload.message}`);
        this.callbacks.onStatus?.(msg.payload);
    }
    // ========================================================================
    // Disconnect & Reconnect
    // ========================================================================
    handleDisconnect() {
        this.stopHeartbeat();
        const wasConnected = this.state.state === 'connected';
        this.setState({ state: 'disconnected' });
        if (wasConnected) {
            this.callbacks.onDisconnected?.();
            this.scheduleReconnect();
        }
    }
    scheduleReconnect() {
        if (this.reconnectTimer)
            return;
        this.reconnectAttempt++;
        this.setState({ state: 'reconnecting', attempt: this.reconnectAttempt });
        console.log(`[RelayClient] Scheduling reconnect attempt ${this.reconnectAttempt} in ${this.reconnectDelay}ms`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect().catch((err) => {
                console.error(`[RelayClient] Reconnect failed: ${err.message}`);
            });
        }, this.reconnectDelay);
        // Exponential backoff
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    }
    // ========================================================================
    // Heartbeat
    // ========================================================================
    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (this.isConnected()) {
                this.send({
                    version: PROTOCOL_VERSION,
                    type: 'ping',
                    payload: {},
                    timestamp: createTimestamp(),
                });
            }
        }, HEARTBEAT_INTERVAL_MS);
    }
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    // ========================================================================
    // Cleanup
    // ========================================================================
    cleanup() {
        // Clear timers
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.connectTimeoutTimer) {
            clearTimeout(this.connectTimeoutTimer);
            this.connectTimeoutTimer = null;
        }
        this.stopHeartbeat();
        // Reset snapshot state
        this.snapshotReceived = false;
        this.synchronizedReceived = false;
        // Close WebSocket
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
    // ========================================================================
    // Public API
    // ========================================================================
    getState() {
        return this.state;
    }
    isReady() {
        return this.isConnected() && this.synchronizedReceived;
    }
    getSessionId() {
        return this.sessionId;
    }
    getClientId() {
        return this.clientId;
    }
}
