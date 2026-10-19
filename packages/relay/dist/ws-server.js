/**
 * WebSocket Relay Server - Pushes callbacks to connected clients in real-time
 *
 * Architecture:
 *   Telegram/LINE → Webhook → This Server → WebSocket → Local Client
 *
 * No file queue needed - real-time streaming!
 */
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
const AUTH_TOKEN = process.env.RELAY_AUTH_TOKEN || "change-me-in-production";
/**
 * WebSocket Relay Server
 */
export class WsRelayServer {
    server = null;
    wss = null;
    clients = new Map();
    port;
    running = false;
    constructor(port = 8444) {
        this.port = port;
    }
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
            console.log(`[WsRelay] Client connected: ${clientId} from ${req.socket.remoteAddress}`);
            // Don't auth yet - just accept connection
            // Client will send auth message
            ws.on("message", (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    this.handleMessage(ws, clientId, msg);
                }
                catch (err) {
                    console.error("[WsRelay] Invalid message:", err);
                }
            });
            ws.on("close", () => {
                this.clients.delete(clientId);
                console.log(`[WsRelay] Client disconnected: ${clientId}`);
            });
            ws.on("error", (err) => {
                console.error(`[WsRelay] Client error: ${clientId}`, err);
                this.clients.delete(clientId);
            });
            // Send welcome
            ws.send(JSON.stringify({ type: "connected", payload: { clientId } }));
        });
        return new Promise((resolve) => {
            this.server.listen(this.port, () => {
                this.running = true;
                console.log(`[WsRelay] Server started on port ${this.port}`);
                resolve();
            });
        });
    }
    handleMessage(ws, clientId, msg) {
        switch (msg.type) {
            case "auth":
                if (msg.payload === AUTH_TOKEN) {
                    this.clients.set(clientId, ws);
                    ws.send(JSON.stringify({ type: "auth", payload: { success: true } }));
                    console.log(`[WsRelay] Client authenticated: ${clientId}`);
                }
                else {
                    ws.send(JSON.stringify({ type: "auth", payload: { success: false, error: "Invalid token" } }));
                    ws.close();
                }
                break;
            case "ping":
                ws.send(JSON.stringify({ type: "pong", payload: {} }));
                break;
        }
    }
    /**
     * Broadcast callback to all connected clients
     */
    broadcastCallback(callback) {
        const msg = JSON.stringify({ type: "callback", payload: callback });
        let count = 0;
        for (const [clientId, ws] of this.clients) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(msg);
                count++;
            }
        }
        console.log(`[WsRelay] Broadcast callback to ${count} client(s): ${callback.action} ${callback.targetId}`);
    }
    /**
     * Stop the server
     */
    async stop() {
        if (!this.running)
            return;
        for (const ws of this.clients.values()) {
            ws.close();
        }
        this.clients.clear();
        return new Promise((resolve) => {
            this.server.close(() => {
                this.running = false;
                console.log("[WsRelay] Server stopped");
                resolve();
            });
        });
    }
    isRunning() {
        return this.running;
    }
    getClientCount() {
        return this.clients.size;
    }
}
// Export singleton for use in unified webhook server
let singleton = null;
export function getRelayServer() {
    if (!singleton) {
        singleton = new WsRelayServer();
    }
    return singleton;
}
