/**
 * E2E Test Suite: Honcho MCP
 * 
 * Tests the Honcho MCP server tools used by pi-harness-runtime.
 * MCP endpoint: https://mcp.honcho.dev
 * 
 * Note: MCP uses SSE streaming. This test uses fetch with text/event-stream.
 * 
 * Usage:
 *   bun test e2e/honcho/mcp.test.ts
 */

import { describe, it, beforeAll, afterAll, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// MCP Configuration
const HONCHO_MCP_URL = "https://mcp.honcho.dev";
const HONCHO_API_URL = "https://app.honcho.dev/api";
const API_KEY_FILE = join(homedir(), ".pi-harness-runtime", "keys", "honcho-api-key.txt");
const TEST_WORKSPACE = `pi-harness-test-${Date.now()}`;
const TEST_SESSION = `test-session-${Date.now()}`;
const TEST_USER_PEER = `test-user-${Date.now()}`;
const TEST_ASSISTANT_PEER = `test-assistant-${Date.now()}`;

interface McpResponse {
  jsonrpc: string;
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

function getApiKey(): string {
  const envKey = process.env.HONCHO_API_KEY;
  if (envKey) return envKey;
  
  if (existsSync(API_KEY_FILE)) {
    return readFileSync(API_KEY_FILE, "utf-8").trim();
  }
  
  throw new Error("No Honcho API key found");
}

/**
 * Send MCP request via SSE streaming
 */
async function sendMcpRequest(body: object): Promise<unknown> {
  const apiKey = getApiKey();
  
  const response = await fetch(HONCHO_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`MCP request failed: ${response.status}`);
  }

  if (!response.body) {
    throw new Error("No response body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    
    // Parse SSE lines
    const lines = buffer.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data.startsWith("{")) {
          try {
            const parsed = JSON.parse(data) as McpResponse;
            if (parsed.result !== undefined) {
              return parsed.result;
            }
          } catch {
            // Continue parsing
          }
        }
      }
    }
  }
  
  throw new Error("No result in MCP response");
}

describe("Honcho MCP E2E Tests", () => {
  let sessionId = "";
  
  beforeAll(async () => {
    console.log("\n[Test Setup] Connecting to MCP...");
    
    // Initialize connection
    await sendMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "pi-harness-test", version: "1.0.0" },
      },
    });
    console.log("  MCP initialized");
  });
  
  afterAll(() => {
    console.log("\n[Test Teardown] Test session:", sessionId);
    console.log("  (Manual cleanup needed for persistent data)");
  });
  
  describe("connection and discovery", () => {
    it("should list available tools", async () => {
      const result = await sendMcpRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }) as { tools?: Array<{ name: string; description?: string }> };
      
      expect(result).toBeDefined();
      if (result && typeof result === "object" && "tools" in result) {
        const tools = (result as { tools: Array<{ name: string }> }).tools;
        const toolNames = tools.map((t) => t.name);
        console.log("  Available tools:", toolNames);
        
        // Core tools we expect
        expect(toolNames).toContain("create_session");
        expect(toolNames).toContain("create_peer");
        expect(toolNames).toContain("add_peers_to_session");
        expect(toolNames).toContain("add_messages_to_session");
      }
    });
  });
  
  describe("session management", () => {
    it("should create a session", async () => {
      const result = await sendMcpRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "create_session",
          arguments: {
            workspace_id: "pi-harness",
            session_id: TEST_SESSION,
          },
        },
      }) as { content?: Array<{ type: string; text: string }>; isError?: boolean };
      
      console.log("  Create session result:", JSON.stringify(result).slice(0, 200));
      
      // Should succeed or return existing
      expect(result).toBeDefined();
    });
    
    it("should create user peer", async () => {
      const result = await sendMcpRequest({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "create_peer",
          arguments: {
            workspace_id: "pi-harness",
            peer_id: TEST_USER_PEER,
          },
        },
      }) as { content?: Array<{ type: string; text: string }> };
      
      console.log("  Create peer result:", JSON.stringify(result).slice(0, 200));
      expect(result).toBeDefined();
    });
    
    it("should create assistant peer", async () => {
      const result = await sendMcpRequest({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "create_peer",
          arguments: {
            workspace_id: "pi-harness",
            peer_id: TEST_ASSISTANT_PEER,
          },
        },
      }) as { content?: Array<{ type: string; text: string }> };
      
      expect(result).toBeDefined();
    });
    
    it("should add peers to session", async () => {
      const result = await sendMcpRequest({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "add_peers_to_session",
          arguments: {
            workspace_id: "pi-harness",
            session_id: TEST_SESSION,
            peers: [
              { peer_id: TEST_USER_PEER, observe_me: true, observe_others: true },
              { peer_id: TEST_ASSISTANT_PEER, observe_me: false, observe_others: true },
            ],
          },
        },
      }) as { content?: Array<{ type: string; text: string }> };
      
      console.log("  Add peers result:", JSON.stringify(result).slice(0, 200));
      expect(result).toBeDefined();
    });
  });
  
  describe("message management", () => {
    it("should add messages to session", async () => {
      const result = await sendMcpRequest({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "add_messages_to_session",
          arguments: {
            workspace_id: "pi-harness",
            session_id: TEST_SESSION,
            messages: [
              {
                peer_id: TEST_USER_PEER,
                content: "Hello from E2E test!",
              },
              {
                peer_id: TEST_ASSISTANT_PEER,
                content: "Hello! This is a test response.",
              },
            ],
          },
        },
      }) as { content?: Array<{ type: string; text: string }> };
      
      console.log("  Add messages result:", JSON.stringify(result).slice(0, 200));
      expect(result).toBeDefined();
    });
    
    it("should add another message pair", async () => {
      const result = await sendMcpRequest({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "add_messages_to_session",
          arguments: {
            workspace_id: "pi-harness",
            session_id: TEST_SESSION,
            messages: [
              {
                peer_id: TEST_USER_PEER,
                content: "How is the weather?",
              },
              {
                peer_id: TEST_ASSISTANT_PEER,
                content: "The weather is sunny and warm today!",
              },
            ],
          },
        },
      });
      
      expect(result).toBeDefined();
    });
  });
  
  describe("context retrieval", () => {
    it("should chat with workspace", async () => {
      const result = await sendMcpRequest({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: {
          name: "workspace_chat",
          arguments: {
            workspace_id: "pi-harness",
            query: "What was discussed in the test conversation?",
          },
        },
      }) as { content?: Array<{ type: string; text: string }> };
      
      console.log("  Chat result:", JSON.stringify(result).slice(0, 300));
      expect(result).toBeDefined();
    });
    
    it("should search messages", async () => {
      const result = await sendMcpRequest({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "search",
          arguments: {
            workspace_id: "pi-harness",
            query: "weather",
          },
        },
      }) as { content?: Array<{ type: string; text: string }> };
      
      console.log("  Search result:", JSON.stringify(result).slice(0, 200));
      expect(result).toBeDefined();
    });
  });
});
