/**
 * WebSocket Relay Server - Pushes callbacks to connected clients in real-time
 *
 * Architecture:
 *   Telegram/LINE → Webhook → This Server → WebSocket → Local Client
 *
 * No file queue needed - real-time streaming!
 */
import type { CallbackPayload } from "./types.js";
export type { CallbackPayload };
export interface RelayMessage {
    type: "callback" | "ping" | "pong" | "auth";
    payload: unknown;
}
/**
 * WebSocket Relay Server
 */
export declare class WsRelayServer {
    private server;
    private wss;
    private clients;
    private port;
    private running;
    constructor(port?: number);
    /**
     * Start the WebSocket server
     */
    start(): Promise<void>;
    private handleMessage;
    /**
     * Broadcast callback to all connected clients
     */
    broadcastCallback(callback: CallbackPayload): void;
    /**
     * Stop the server
     */
    stop(): Promise<void>;
    isRunning(): boolean;
    getClientCount(): number;
}
export declare function getRelayServer(): WsRelayServer;
