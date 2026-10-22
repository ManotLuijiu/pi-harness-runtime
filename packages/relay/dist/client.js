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
    // Pending connect() settlement - resolve/reject handed to the caller
    pendingConnect = null;
    connectPromise = null;
    connectAttempt = 0; // Monotonic id of the current connect attempt
    connectPromiseAttempt = 0; // Attempt id the current connectPromise belongs to
    // Intentional shutdown - suppresses reconnect scheduling (deliberate stop, not network loss)
    shuttingDown = false;
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
     * Connect to relay server with automatic authentication.
     *
     * The returned Promise settles exactly once:
     * - resolves when the server confirms authentication (the readiness milestone)
     * - rejects on websocket error, authentication failure, close-before-ready,
     *   an explicit disconnect(), or the connect deadline
     */
    async connect() {
        if (this.isConnected())
            return;
        // Reuse only a LIVE connect attempt. Returning a settled promise would
        // make `disconnect(); connect();` resolve with the previous rejection and
        // open no socket at all.
        if (this.connectPromise && this.pendingConnect) {
            return this.connectPromise;
        }
        const promise = this.startConnect();
        this.connectPromise = promise;
        this.connectPromiseAttempt = this.connectAttempt;
        try {
            await promise;
        }
        finally {
            if (this.connectPromise === promise)
                this.connectPromise = null;
        }
    }
    /**
     * Open the socket and drive the connect/auth handshake.
     * The promise settles via settleConnect() from the handshake handlers.
     */
    startConnect() {
        // Close any stale socket without triggering reconnect handling
        this.cleanup();
        this.shuttingDown = false;
        this.setState({ state: 'connecting' });
        const url = this.config.serverUrl;
        const timeoutMs = this.config.connectTimeout ?? CONNECT_TIMEOUT_MS;
        console.log(`[RelayClient] Connecting to ${url}...`);
        return new Promise((resolve, reject) => {
            const attempt = ++this.connectAttempt;
            this.pendingConnect = { resolve, reject, attempt };
            // Deadline covers connection AND authentication (one timer for the whole handshake)
            this.connectTimeoutTimer = setTimeout(() => {
                if (!this.pendingConnect)
                    return;
                console.error(`[RelayClient] Connection timeout after ${timeoutMs}ms`);
                this.settleConnect(new Error(`Connection timeout after ${timeoutMs}ms`));
                this.closeSocket();
                this.setState({ state: 'disconnected' });
                this.scheduleReconnectAfterFailure();
            }, timeoutMs);
            let ws;
            try {
                ws = new WebSocket(url);
            }
            catch (err) {
                // An invalid URL throws synchronously. The attempt must not be left
                // pending: settle it, disarm the deadline and retry like any other
                // failed connect.
                const error = err instanceof Error ? err : new Error(String(err));
                console.error("[RelayClient] WebSocket construction failed:", error.message);
                this.settleConnect(error);
                this.setState({ state: 'disconnected' });
                this.scheduleReconnectAfterFailure();
                return;
            }
            this.ws = ws;
            ws.on("open", () => {
                if (this.ws !== ws)
                    return;
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
            ws.on("message", (data) => {
                if (this.ws !== ws)
                    return;
                this.handleMessage(data.toString());
            });
            ws.on("close", (code) => {
                // Ignore events from a socket that is no longer the active one: they
                // would otherwise corrupt the live connection (state, heartbeat) and
                // schedule a spurious reconnect.
                if (this.ws !== ws)
                    return;
                console.log("[RelayClient] WebSocket closed");
                this.ws = null;
                const wasPending = this.pendingConnect !== null;
                this.handleDisconnect();
                if (wasPending) {
                    this.settleConnect(new Error(`Connection closed before ready (code ${code})`));
                    this.scheduleReconnectAfterFailure();
                }
            });
            ws.on("error", (err) => {
                if (this.ws !== ws)
                    return;
                console.error("[RelayClient] WebSocket error:", err.message);
                this.callbacks.onError?.(err);
                const wasPending = this.pendingConnect !== null;
                this.ws = null;
                this.handleDisconnect();
                if (wasPending) {
                    this.settleConnect(err instanceof Error ? err : new Error(String(err)));
                    this.scheduleReconnectAfterFailure();
                }
            });
        });
    }
    /**
     * Settle the pending connect() promise exactly once.
     * Passing an error rejects; calling without an error resolves.
     */
    settleConnect(error) {
        const pending = this.pendingConnect;
        if (!pending)
            return;
        this.pendingConnect = null;
        if (this.connectTimeoutTimer) {
            clearTimeout(this.connectTimeoutTimer);
            this.connectTimeoutTimer = null;
        }
        // The attempt is over: a later connect() must start a NEW attempt instead
        // of handing out the settled promise. Only clear the promise when it
        // belongs to THIS attempt - a late settle must not clobber a newer one.
        if (this.connectPromiseAttempt === pending.attempt) {
            this.connectPromise = null;
            this.connectPromiseAttempt = 0;
        }
        if (error)
            pending.reject(error);
        else
            pending.resolve();
    }
    /**
     * Disconnect from relay server
     */
    disconnect() {
        console.log("[RelayClient] Disconnecting...");
        // Deliberate stop: do not schedule a reconnect afterwards
        this.shuttingDown = true;
        // Never leave a caller awaiting connect() hanging
        this.settleConnect(new Error('Disconnected before ready'));
        const wasConnected = this.state.state === 'connected';
        this.cleanup();
        this.sessionId = null;
        this.clientId = null;
        this.snapshotReceived = false;
        this.synchronizedReceived = false;
        this.setState({ state: 'disconnected' });
        // Only report a disconnect for a connection that was actually established.
        if (wasConnected)
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
            // Readiness milestone reached - settle the connect() promise
            this.settleConnect();
        }
        else {
            const message = msg.payload.error || 'Authentication failed';
            console.error(`[RelayClient] Auth failed: ${message}`);
            const error = new Error(message);
            this.callbacks.onError?.(error);
            // Reject the caller before tearing the socket down
            this.settleConnect(error);
            this.disconnect();
            // A rejected auth can be transient (a server restart with a rotated
            // token, a temporarily misconfigured server) - retry it like any other
            // failed connect.
            this.scheduleReconnectAfterFailure();
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
        // A deliberate stop must not trigger a reconnect
        if (this.shuttingDown) {
            console.log("[RelayClient] Disconnected (intentional stop, no reconnect)");
            return;
        }
        if (wasConnected) {
            this.callbacks.onDisconnected?.();
            this.scheduleReconnect();
        }
    }
    /**
     * Schedule a reconnect after a FAILED connect attempt.
     *
     * The backoff loop only survives the loss of an established connection, so a
     * refused server or a failed handshake would otherwise leave the client
     * permanently disconnected. Opt-in via `config.retryOnConnectFailure`:
     * an endless background retry loop is not always what the caller wants.
     */
    scheduleReconnectAfterFailure() {
        if (this.shuttingDown)
            return;
        if (!this.config.retryOnConnectFailure)
            return;
        this.scheduleReconnect();
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
        const interval = this.config.keepAlive ?? HEARTBEAT_INTERVAL_MS;
        this.heartbeatTimer = setInterval(() => {
            if (this.isConnected()) {
                this.send({
                    version: PROTOCOL_VERSION,
                    type: 'ping',
                    payload: {},
                    timestamp: createTimestamp(),
                });
            }
        }, interval);
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
        // Close WebSocket (handlers detached so our own cleanup does not trigger
        // disconnect/reconnect handling)
        this.closeSocket();
    }
    /**
     * Close the active socket without firing our own close/error handlers.
     */
    closeSocket() {
        const ws = this.ws;
        if (!ws)
            return;
        this.ws = null;
        // Detach only OUR handlers so the own cleanup never triggers the
        // disconnect/reconnect path.
        ws.removeAllListeners("open");
        ws.removeAllListeners("message");
        ws.removeAllListeners("close");
        ws.removeAllListeners("error");
        // An 'error' without a listener throws inside the ws implementation.
        ws.on("error", (err) => {
            console.warn("[RelayClient] Socket error while closing:", err.message);
        });
        ws.on("close", () => { });
        try {
            ws.close();
        }
        catch (err) {
            console.warn("[RelayClient] Error while closing socket:", String(err));
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
    /** True once the server has sent the callback snapshot for this session. */
    hasSnapshot() {
        return this.snapshotReceived;
    }
    getSessionId() {
        return this.sessionId;
    }
    getClientId() {
        return this.clientId;
    }
}
