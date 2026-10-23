#!/usr/bin/env bun
/**
 * WebSocket Relay Server - Two-way streaming callbacks
 * 
 * Uses the relay package's typed streaming protocol:
 * - Snapshot + Live event pattern (t3code style)
 * - Typed message protocol
 * - Connection state machine
 * - Stream coalescing for high-frequency events
 * 
 * Architecture:
 *   Telegram/LINE → Webhook → This Server → WebSocket → Local Client
 */

import { createRelayServer, type RelayServerOptions } from "../packages/relay/src/server";

// Configuration from environment
const PORT = parseInt(process.env.WS_PORT || "8444", 10);
const HOST = process.env.WS_HOST || "0.0.0.0";
// No default token: a relay without a configured token accepts nobody.
// A public default secret would be worse than no relay at all.
const AUTH_TOKEN = process.env.RELAY_AUTH_TOKEN || "";
if (!AUTH_TOKEN) {
  console.error("[RelayServer] RELAY_AUTH_TOKEN is not set - refusing to start.");
  process.exit(1);
}
const SERVER_VERSION = process.env.SERVER_VERSION || "1.0.0";

// Create and start server
const options: RelayServerOptions = {
  port: PORT,
  host: HOST,
  authToken: AUTH_TOKEN,
  serverVersion: SERVER_VERSION,
  onTunnelConnect: (tunnel) => {
    console.log(`[Main] Tunnel connected: ${tunnel.id}`);
  },
  onTunnelDisconnect: (tunnelId) => {
    console.log(`[Main] Tunnel disconnected: ${tunnelId}`);
  },
  onStateChange: (change) => {
    console.log(`[Main] State change: ${change.previous.state} → ${change.current.state}`);
  },
};

const server = createRelayServer(options);

async function main() {
  console.log("===========================================");
  console.log("WebSocket Relay Server - Streaming v2");
  console.log("===========================================");
  console.log(`  Host: ${HOST}`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Auth: ${AUTH_TOKEN ? "enabled" : "disabled"}`);
  console.log(`  Version: ${SERVER_VERSION}`);
  console.log("===========================================");
  
  try {
    await server.start();
    console.log("Server started successfully!");
    
    // Log status periodically
    setInterval(() => {
      const clients = server.getClients();
      console.log(`[Status] Clients: ${clients.length}, Running: ${server.isRunning()}`);
    }, 30000);
    
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nShutting down...");
  await server.stop();
  process.exit(0);
});

main();
