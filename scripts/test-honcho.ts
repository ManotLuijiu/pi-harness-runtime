/**
 * Test Honcho MCP connection
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

async function testHoncho() {
  console.log("=== Honcho MCP Test ===\n");

  // 1. Check Honcho API key
  const keyFile = join(homedir(), ".pi-harness-runtime", "keys", "honcho-api-key.txt");
  let apiKey = "";
  
  if (existsSync(keyFile)) {
    apiKey = readFileSync(keyFile, "utf-8").trim();
    console.log("✓ Honcho API key found");
  } else {
    console.log("✗ Honcho API key not found:", keyFile);
    console.log("   Run: echo '{your-key}' >", keyFile);
    return;
  }

  // 2. Check MCP config
  const mcpConfig = join(homedir(), ".config", "mcp", "mcp.json");
  if (existsSync(mcpConfig)) {
    try {
      const config = JSON.parse(readFileSync(mcpConfig, "utf-8"));
      console.log("✓ MCP config found");
      console.log("   Servers:", Object.keys(config.mcpServers || {}).join(", "));
    } catch {
      console.log("✗ MCP config parse error");
    }
  } else {
    console.log("✗ MCP config not found");
  }

  // 3. Test Honcho MCP connection
  console.log("\nTesting Honcho MCP...");
  try {
    const health = await fetch("https://app.honcho.dev/api/health", {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });
    
    if (health.ok) {
      console.log("✓ Honcho MCP connected");
    } else {
      console.log("✗ Honcho MCP health failed:", health.status);
    }
  } catch (err) {
    console.log("✗ Honcho MCP call failed:", err);
  }

  console.log("\n=== Done ===");
}

testHoncho().catch(console.error);
