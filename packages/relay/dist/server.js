/**
 * Relay Server - Two-way streaming WebSocket relay
 *
 * Implements t3code-style streaming with:
 * - Snapshot + Live event pattern
 * - Typed message protocol
 * - Connection state machine
 * - Stream coalescing
 */
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { PROTOCOL_VERSION, generateMessageId, createTimestamp, } from './types.js';
// ============================================================================
// Constants
// ============================================================================
const DEFAULT_PORT = 8444;
const DEFAULT_HOST = "0.0.0.0";
const MAX_RECENT_CALLBACKS = 100;
const STREAM_BATCH_SIZE = 50; // Batch events for coalescing
const STREAM_BATCH_TIMEOUT_MS = 100; // Flush batch after this delay
function createEventBuffer() {
    return {
        callbacks: [],
        timer: null,
    };
}
// ============================================================================
// Relay Server - Two-way Streaming Implementation
// ============================================================================
export class RelayServer {
    server = null;
    wss = null;
    clients = new Map();
    tunnels = new Map();
    options;
    running = false;
    serverSessionId;
    // Event stream buffering for coalescing
    eventBuffer = createEventBuffer();
    // Recent callbacks for snapshot
    recentCallbacks = [];
    constructor(options = {}) {
        this.serverSessionId = randomUUID();
        this.options = {
            port: options.port ?? DEFAULT_PORT,
            host: options.host ?? DEFAULT_HOST,
            // No default token: a relay without a configured token accepts nobody
            // (the live path resolves a real token from the key files and fails
            // closed when there is none).
            authToken: options.authToken ?? process.env.RELAY_AUTH_TOKEN ?? "",
            serverVersion: options.serverVersion ?? "1.0.0",
            onTunnelConnect: options.onTunnelConnect ?? (() => { }),
            onTunnelDisconnect: options.onTunnelDisconnect ?? (() => { }),
            onMessage: options.onMessage ?? (() => { }),
            onStateChange: options.onStateChange ?? (() => { }),
        };
    }
    // ========================================================================
    // Lifecycle
    // ========================================================================
    /**
     * Start the WebSocket server
     */
    async start() {
        if (this.running)
            return;
        this.server = createServer();
        this.wss = new WebSocketServer({ server: this.server });
        this.wss.on("connection", (ws, req) => {
            const clientId = randomUUID();
            const clientIp = req.socket.remoteAddress;
            console.log(`[RelayServer] Client connecting: ${clientId} from ${clientIp}`);
            // Create client session
            const session = {
                id: clientId,
                ws,
                state: { state: 'connecting' },
                subscriptions: new Set(['callback', 'status', 'sync']),
                connectedAt: createTimestamp(),
                lastPing: createTimestamp(),
                pendingSnapshot: true,
            };
            this.clients.set(clientId, session);
            this.updateState(session, { state: 'connecting' });
            // Handle incoming messages
            ws.on("message", (data) => {
                this.handleMessage(clientId, data);
            });
            ws.on("close", () => {
                this.clients.delete(clientId);
                console.log(`[RelayServer] Client disconnected: ${clientId}`);
            });
            ws.on("error", (err) => {
                console.error(`[RelayServer] Client error: ${clientId}`, err.message);
                this.clients.delete(clientId);
            });
            // Send initial connected message
            this.sendMessage(session, {
                version: PROTOCOL_VERSION,
                type: 'connected',
                payload: {
                    clientId,
                    serverTime: createTimestamp(),
                },
                timestamp: createTimestamp(),
            });
            // Client will send auth message - wait for it
            // Auth is validated in handleMessage -> handleAuth
        });
        return new Promise((resolve, reject) => {
            this.server.listen(this.options.port, this.options.host, () => {
                this.running = true;
                console.log(`[RelayServer] Server started on ${this.options.host}:${this.options.port}`);
                resolve();
            });
            this.server.on("error", (err) => {
                console.error("[RelayServer] Server error:", err);
                reject(err);
            });
        });
    }
    /**
     * Stop the relay server
     */
    async stop() {
        // Close all client connections. Use terminate() so the underlying TCP
        // socket is dropped immediately - a graceful close() can leave the socket
        // half-open and make the server shutdown below hang forever.
        for (const session of this.clients.values()) {
            try {
                session.ws.terminate();
            }
            catch {
                // ignore: socket may already be gone
            }
        }
        this.clients.clear();
        // Close event buffer timer
        if (this.eventBuffer.timer) {
            clearTimeout(this.eventBuffer.timer);
            this.eventBuffer.timer = null;
        }
        await new Promise((resolve) => {
            let settled = false;
            let fallbackTimer = null;
            const finish = () => {
                if (settled)
                    return;
                settled = true;
                // Never leave the fallback timer behind: it would keep the process
                // alive for a second after every shutdown.
                if (fallbackTimer) {
                    clearTimeout(fallbackTimer);
                    fallbackTimer = null;
                }
                this.running = false;
                console.log("[RelayServer] Server stopped");
                resolve();
            };
            if (!this.server) {
                this.closeWebSocketServer();
                finish();
                return;
            }
            try {
                this.server.close(() => finish());
                // Drop keep-alive / upgraded sockets so close() can complete
                this.server.closeAllConnections?.();
            }
            catch {
                // Server was not listening - nothing to close
                this.closeWebSocketServer();
                finish();
                return;
            }
            // Never let a stuck socket hang the shutdown
            fallbackTimer = setTimeout(() => {
                // The server is still listening: force the handle down so the port is
                // released and the process can exit.
                try {
                    this.server?.closeAllConnections?.();
                    this.server?.unref?.();
                }
                catch {
                    // ignore
                }
                this.closeWebSocketServer();
                finish();
            }, 1000);
        });
        this.closeWebSocketServer();
    }
    /**
     * Close the WebSocket server (if any) so it never keeps the process alive.
     */
    closeWebSocketServer() {
        const wss = this.wss;
        if (!wss)
            return;
        this.wss = null;
        try {
            wss.close();
        }
        catch {
            // ignore: already closed
        }
    }
    // ========================================================================
    // State Management
    // ========================================================================
    updateState(session, newState) {
        const previous = session.state;
        session.state = newState;
        this.options.onStateChange({
            previous,
            current: newState,
            timestamp: createTimestamp(),
        });
    }
    // ========================================================================
    // Message Handling
    // ========================================================================
    handleMessage(clientId, data) {
        const session = this.clients.get(clientId);
        if (!session)
            return;
        try {
            const msg = JSON.parse(data.toString());
            switch (msg.type) {
                case 'auth':
                    this.handleAuth(clientId, msg.payload.token);
                    break;
                case 'ping':
                    this.handlePing(session);
                    break;
                case 'subscribe':
                    this.handleSubscribe(session, msg);
                    break;
                default:
                    const _msg = msg;
                    console.warn(`[RelayServer] Unknown message type: ${_msg?.type}`);
            }
        }
        catch (err) {
            console.error("[RelayServer] Invalid message:", err);
            this.sendStatus(session, 'error', 'INVALID_MESSAGE', 'Failed to parse message');
        }
    }
    handleAuth(clientId, token) {
        const session = this.clients.get(clientId);
        if (!session)
            return;
        // Without a configured token nobody may connect - a public default
        // secret would be worse than no relay at all.
        const success = this.options.authToken.length > 0 && token === this.options.authToken;
        const response = {
            version: PROTOCOL_VERSION,
            type: 'auth',
            payload: {
                success,
                sessionId: success ? this.serverSessionId : undefined,
                error: success ? undefined : 'Invalid token',
            },
            timestamp: createTimestamp(),
            messageId: generateMessageId(),
        };
        this.sendMessage(session, response);
        if (success) {
            this.updateState(session, { state: 'connected', sessionId: this.serverSessionId });
            console.log(`[RelayServer] Client authenticated: ${clientId}`);
            // Send snapshot + synchronized (t3code pattern)
            this.sendSnapshot(session);
        }
        else {
            this.updateState(session, { state: 'error', error: 'Authentication failed' });
            session.ws.close();
        }
    }
    handlePing(session) {
        session.lastPing = createTimestamp();
        this.sendMessage(session, {
            version: PROTOCOL_VERSION,
            type: 'pong',
            payload: {},
            timestamp: createTimestamp(),
        });
    }
    handleSubscribe(session, msg) {
        session.subscriptions = new Set(msg.payload.events);
        console.log(`[RelayServer] Client ${session.id} subscribed to: ${Array.from(session.subscriptions).join(', ')}`);
    }
    // ========================================================================
    // Snapshot + Live Streaming (t3code pattern)
    // ========================================================================
    /**
     * Send initial snapshot followed by synchronized marker
     * This is the t3code pattern: snapshot -> synchronized -> live events
     */
    async sendSnapshot(session) {
        // Build snapshot message
        const snapshot = {
            version: PROTOCOL_VERSION,
            type: 'snapshot',
            payload: {
                sessionId: this.serverSessionId,
                serverVersion: this.options.serverVersion,
                connectedClients: this.clients.size,
                recentCallbacks: this.recentCallbacks.slice(-20), // Last 20 callbacks
            },
            timestamp: createTimestamp(),
            messageId: generateMessageId(),
        };
        // Send snapshot
        this.sendMessage(session, snapshot);
        // Send synchronized marker (t3code pattern: indicates snapshot complete)
        const synchronized = {
            version: PROTOCOL_VERSION,
            type: 'synchronized',
            payload: {},
            timestamp: createTimestamp(),
            messageId: generateMessageId(),
        };
        this.sendMessage(session, synchronized);
        session.pendingSnapshot = false;
        console.log(`[RelayServer] Snapshot sent to ${session.id}`);
    }
    /**
     * Flush event buffer and send batched callbacks
     */
    flushEventBuffer() {
        if (this.eventBuffer.callbacks.length === 0)
            return;
        const callbacks = this.eventBuffer.callbacks;
        this.eventBuffer.callbacks = [];
        this.eventBuffer.timer = null;
        // Send each callback as a separate live event
        for (const callback of callbacks) {
            this.broadcastCallback(callback, false); // false = don't add to recent
        }
    }
    // ========================================================================
    // Broadcasting
    // ========================================================================
    /**
     * Broadcast callback to all connected clients
     * Uses stream batching for high-frequency events
     */
    broadcastCallback(callback, batch = true) {
        // Add to recent callbacks (circular buffer)
        this.recentCallbacks.push(callback);
        if (this.recentCallbacks.length > MAX_RECENT_CALLBACKS) {
            this.recentCallbacks.shift();
        }
        const message = {
            version: PROTOCOL_VERSION,
            type: 'callback',
            payload: callback,
            timestamp: createTimestamp(),
            messageId: generateMessageId(),
        };
        if (batch) {
            // Add to buffer for coalescing
            this.eventBuffer.callbacks.push(callback);
            if (!this.eventBuffer.timer) {
                this.eventBuffer.timer = setTimeout(() => {
                    this.flushEventBuffer();
                }, STREAM_BATCH_TIMEOUT_MS);
            }
        }
        else {
            // Send immediately
            this.broadcast(message);
        }
        // Number of connected clients that will receive this callback.
        // Callers use 0 to detect "no relay client attached" and fall back to disk.
        return this.getClientCount();
    }
    /**
     * Send status to all clients
     */
    broadcastStatus(kind, code, message) {
        const msg = {
            version: PROTOCOL_VERSION,
            type: 'status',
            payload: { kind, code, message },
            timestamp: createTimestamp(),
            messageId: generateMessageId(),
        };
        this.broadcast(msg);
    }
    /**
     * Broadcast to all subscribed clients
     */
    broadcast(message) {
        let count = 0;
        for (const session of this.clients.values()) {
            if (this.isConnected(session)) {
                this.sendMessage(session, message);
                count++;
            }
        }
        console.log(`[RelayServer] Broadcast ${message.type} to ${count} client(s)`);
        return count;
    }
    /**
     * Check if client is connected and authenticated
     */
    isConnected(session) {
        return session.ws.readyState === WebSocket.OPEN &&
            session.state.state === 'connected';
    }
    /**
     * Send a typed message to a client
     */
    sendMessage(session, message) {
        if (session.ws.readyState === WebSocket.OPEN) {
            session.ws.send(JSON.stringify(message));
        }
    }
    /**
     * Send status to specific client
     */
    sendStatus(session, kind, code, message) {
        const msg = {
            version: PROTOCOL_VERSION,
            type: 'status',
            payload: { kind, code, message },
            timestamp: createTimestamp(),
            messageId: generateMessageId(),
        };
        this.sendMessage(session, msg);
    }
    // ========================================================================
    // Public API
    // ========================================================================
    isRunning() {
        return this.running;
    }
    getClientCount() {
        return this.clients.size;
    }
    getClients() {
        return Array.from(this.clients.values()).map(s => ({
            id: s.id,
            state: s.state,
            connectedAt: s.connectedAt,
        }));
    }
    getRecentCallbacks(limit = 20) {
        return this.recentCallbacks.slice(-limit);
    }
}
// ============================================================================
// Export for use in webhook server
// ============================================================================
export function createRelayServer(options) {
    return new RelayServer(options);
}
