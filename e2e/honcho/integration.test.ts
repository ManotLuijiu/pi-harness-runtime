/**
 * E2E Integration Test: Honcho Full Memory Workflow
 * 
 * Tests the complete flow used by pi-harness-runtime:
 * 1. CLI: Create workspace (if needed)
 * 2. CLI: Verify workspace exists
 * 3. MCP: Create session and peers
 * 4. MCP: Add messages (conversation)
 * 5. MCP: Retrieve context (memory recall)
 * 
 * Usage:
 *   PI_HARNESS_E2E=1 bun test e2e/honcho/integration.test.ts
 *
 * These tests talk to the real Honcho MCP server, so they are opt-in.
 */

import { describe, it, beforeAll, afterAll, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

// Real Honcho MCP calls: opt-in via PI_HARNESS_E2E=1.
const describeE2E = process.env.PI_HARNESS_E2E === "1" ? describe : describe.skip;

// Configuration
const HONCHO_MCP_URL = "https://mcp.honcho.dev";
const API_KEY_FILE = join(homedir(), ".pi-harness-runtime", "keys", "honcho-api-key.txt");
const TEST_WORKSPACE = `pi-harness-integration-${Date.now()}`;
const TEST_SESSION = `integration-session-${Date.now()}`;
const TEST_USER = `integration-user-${Date.now()}`;
const TEST_ASSISTANT = `integration-assistant`;

interface McpResponse {
  jsonrpc: string;
  id: number | string;
  result?: unknown;
}

function getApiKey(): string {
  const envKey = process.env.HONCHO_API_KEY;
  if (envKey) return envKey;
  
  if (existsSync(API_KEY_FILE)) {
    return readFileSync(API_KEY_FILE, "utf-8").trim();
  }
  
  throw new Error("No Honcho API key");
}

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
            // Continue
          }
        }
      }
    }
  }
  
  throw new Error("No result in response");
}

function execCli(args: string[]): string {
  const fullEnv = { ...process.env, HONCHO_API_KEY: getApiKey() };
  return execSync(`honcho ${args.join(" ")}`, {
    env: fullEnv as NodeJS.ProcessEnv,
    encoding: "utf-8",
  });
}

describeE2E("Honcho Integration E2E Tests", () => {
  beforeAll(async () => {
    console.log("\n[Test Setup] Creating test workspace via CLI...");
    
    // Step 1: Create workspace via CLI
    const createResult = JSON.parse(execCli(["workspace", "create", TEST_WORKSPACE, "--json"]));
    console.log("  Workspace created:", createResult.workspace_id);
    
    // Step 2: Verify workspace via CLI
    const listResult = JSON.parse(execCli(["workspace", "list", "--json"]));
    const workspaceIds = listResult.map((w: { id: string }) => w.id);
    console.log("  Workspaces:", workspaceIds);
    expect(workspaceIds).toContain(TEST_WORKSPACE);
    
    // Step 3: Initialize MCP connection
    await sendMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "pi-harness-integration-test", version: "1.0.0" },
      },
    });
    console.log("  MCP initialized");
  });
  
  describe("full memory workflow", () => {
    it("should create session and peers", async () => {
      // Create session
      const sessionResult = await sendMcpRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "create_session",
          arguments: {
            workspace_id: TEST_WORKSPACE,
            session_id: TEST_SESSION,
          },
        },
      });
      console.log("  Session:", JSON.stringify(sessionResult).slice(0, 100));
      
      // Create peers
      await sendMcpRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "create_peer",
          arguments: { workspace_id: TEST_WORKSPACE, peer_id: TEST_USER },
        },
      });
      
      await sendMcpRequest({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "create_peer",
          arguments: { workspace_id: TEST_WORKSPACE, peer_id: TEST_ASSISTANT },
        },
      });
      
      // Add peers to session
      const addPeersResult = await sendMcpRequest({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "add_peers_to_session",
          arguments: {
            workspace_id: TEST_WORKSPACE,
            session_id: TEST_SESSION,
            peers: [
              { peer_id: TEST_USER, observe_me: true, observe_others: true },
              { peer_id: TEST_ASSISTANT, observe_me: false, observe_others: true },
            ],
          },
        },
      });
      console.log("  Peers added:", JSON.stringify(addPeersResult).slice(0, 100));
      
      expect(addPeersResult).toBeDefined();
    });
    
    it("should add conversation messages", async () => {
      const conversation = [
        { user: "I prefer using TypeScript for type safety.", assistant: "TypeScript is great for catching errors early!" },
        { user: "Can you explain async/await?", assistant: "Async/await makes handling promises more readable." },
        { user: "What's your favorite code pattern?", assistant: "I like the repository pattern for data access." },
      ];
      
      for (const exchange of conversation) {
        await sendMcpRequest({
          jsonrpc: "2.0",
          id: 10,
          method: "tools/call",
          params: {
            name: "add_messages_to_session",
            arguments: {
              workspace_id: TEST_WORKSPACE,
              session_id: TEST_SESSION,
              messages: [
                { peer_id: TEST_USER, content: exchange.user },
                { peer_id: TEST_ASSISTANT, content: exchange.assistant },
              ],
            },
          },
        });
      }
      
      console.log("  Added", conversation.length, "conversation exchanges");
    });
    
    it("should retrieve context from memory", async () => {
      // Search for messages
      const searchResult = await sendMcpRequest({
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: {
          name: "search",
          arguments: {
            workspace_id: TEST_WORKSPACE,
            query: "TypeScript",
          },
        },
      });
      
      const searchText = JSON.stringify(searchResult);
      console.log("  Search 'TypeScript':", searchText.slice(0, 200));
      
      // Should find the TypeScript message
      expect(searchText).toContain("TypeScript");
      
      // Get session messages
      const messagesResult = await sendMcpRequest({
        jsonrpc: "2.0",
        id: 21,
        method: "tools/call",
        params: {
          name: "get_session_messages",
          arguments: {
            workspace_id: TEST_WORKSPACE,
            session_id: TEST_SESSION,
          },
        },
      });
      
      const messagesText = JSON.stringify(messagesResult);
      console.log("  Session messages:", messagesText.slice(0, 300));
      expect(messagesText).toContain(TEST_USER);
    });
    
    it("should verify session state", async () => {
      const inspectResult = await sendMcpRequest({
        jsonrpc: "2.0",
        id: 30,
        method: "tools/call",
        params: {
          name: "inspect_session",
          arguments: {
            workspace_id: TEST_WORKSPACE,
            session_id: TEST_SESSION,
          },
        },
      });
      
      console.log("  Session inspect:", JSON.stringify(inspectResult).slice(0, 300));
      expect(inspectResult).toBeDefined();
    });
  });
  
  describe("workspace inspection", () => {
    it("should list sessions in workspace", async () => {
      const result = await sendMcpRequest({
        jsonrpc: "2.0",
        id: 40,
        method: "tools/call",
        params: {
          name: "list_sessions",
          arguments: { workspace_id: TEST_WORKSPACE },
        },
      });
      
      console.log("  Sessions:", JSON.stringify(result).slice(0, 200));
      expect(result).toBeDefined();
    });
    
    it("should list peers in workspace", async () => {
      const result = await sendMcpRequest({
        jsonrpc: "2.0",
        id: 41,
        method: "tools/call",
        params: {
          name: "list_peers",
          arguments: { workspace_id: TEST_WORKSPACE },
        },
      });
      
      console.log("  Peers:", JSON.stringify(result).slice(0, 200));
      expect(result).toBeDefined();
    });
  });
  
  afterAll(() => {
    console.log("\n[Integration Test Complete]");
    console.log("  Workspace:", TEST_WORKSPACE);
    console.log("  Session:", TEST_SESSION);
    console.log("  User:", TEST_USER);
    console.log("  (Data persists in Honcho for inspection in Explore)");
  });
});
