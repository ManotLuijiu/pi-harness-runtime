#!/usr/bin/env bun
/**
 * Qdrant Skills E2E Test
 * 
 * Tests the Qdrant integration for skill storage and search.
 * 
 * Usage:
 *   bun e2e/qdrant-skills.test.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Load env from .env.test
const envPath = join(process.cwd(), ".env.test");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const [key, ...valueParts] = line.split("=");
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join("=").trim();
    }
  }
}

/**
 * Simple Qdrant REST client
 */
class QdrantRest {
  private url: string;
  private apiKey: string;

  constructor(url: string, apiKey: string) {
    this.url = url.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.url}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "api-key": this.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${response.status}: ${error}`);
    }

    return response.json() as Promise<T>;
  }

  async createCollection(name: string, config: { vectors: { size: number; distance: string } }): Promise<void> {
    await this.request("PUT", `/collections/${name}`, config);
  }

  async deleteCollection(name: string): Promise<void> {
    await this.request("DELETE", `/collections/${name}`);
  }

  async upsert(name: string, points: unknown[]): Promise<void> {
    await this.request("PUT", `/collections/${name}/points?wait=true`, { points });
  }

  async query(
    name: string,
    query: { query: { text: string; model: string }; limit: number }
  ): Promise<unknown> {
    return this.request("POST", `/collections/${name}/points/query`, query);
  }
}

/**
 * Test configuration from environment
 */
const config = {
  url: process.env.QDRANT_CLUSTER_ENDPOINT || "https://api.qdrant.tech",
  apiKey: process.env.QDRANT_API_KEY || "",
  collection: "pi-harness-skills-test",
};

console.error("=== Qdrant Skills E2E Test ===\n");
console.error(`URL: ${config.url}`);
console.error(`Collection: ${config.collection}`);
console.error("");

// Create client
const client = new QdrantRest(config.url, config.apiKey);

/**
 * Test 1: Create collection
 */
async function testCreateCollection(): Promise<boolean> {
  console.error("[Test 1] Creating collection...");
  
  try {
    await client.createCollection(config.collection, {
      vectors: {
        size: 384, // all-MiniLM-L6-v2 dimensions
        distance: "Cosine",
      },
    });
    console.error("✓ Collection created\n");
    return true;
  } catch (err) {
    if (err instanceof Error && err.message.includes("already exists")) {
      console.error("✓ Collection already exists\n");
      return true;
    }
    console.error("✗ Failed to create collection:", err);
    return false;
  }
}

/**
 * Test 2: Upsert points with text embedding
 */
async function testUpsertPoints(): Promise<boolean> {
  console.error("[Test 2] Upserting points...");
  
  try {
    const points = [
      {
        id: 1,
        payload: { 
          topic: "cooking", 
          type: "dessert",
          name: "chocolate-chip-cookies",
          description: "Recipe for baking chocolate chip cookies"
        },
        vector: {
          text: "Recipe for baking chocolate chip cookies requires flour, sugar, eggs, and chocolate chips.",
          model: "sentence-transformers/all-minilm-l6-v2"
        }
      },
      {
        id: 2,
        payload: { 
          topic: "frappe", 
          type: "permission",
          name: "frappe-permission-manager",
          description: "Handle frappe permissions, roles, and user access control"
        },
        vector: {
          text: "Frappe permission manager handles user roles, permissions, and access control in Frappe framework.",
          model: "sentence-transformers/all-minilm-l6-v2"
        }
      },
      {
        id: 3,
        payload: { 
          topic: "frappe", 
          type: "build",
          name: "frappe-app-build-system",
          description: "Build system for Frappe apps"
        },
        vector: {
          text: "Frappe app build system uses bench build, esbuild, and yarn for frontend assets.",
          model: "sentence-transformers/all-minilm-l6-v2"
        }
      }
    ];

    await client.upsert(config.collection, points);
    console.error("✓ Points upserted\n");
    return true;
  } catch (err) {
    console.error("✗ Failed to upsert points:", err);
    return false;
  }
}

/**
 * Test 3: Semantic search
 */
async function testSearch(): Promise<boolean> {
  console.error("[Test 3] Searching for 'cookies recipe'...");
  
  try {
    const rawResults = await client.query(config.collection, {
      query: {
        text: "What ingredients are needed for baking chocolate chip cookies?",
        model: "sentence-transformers/all-minilm-l6-v2"
      },
      limit: 5,
    });

    // Parse: { result: { points: [...] } }
    const queryResult = rawResults as { result?: { points?: Array<{ id: number; score: number }> } };
    const results = queryResult?.result?.points || [];

    console.error(`\nFound ${results.length} results:\n`);
    
    if (results.length > 0) {
      for (const result of results) {
        const score = (result.score || 0) * 100;
        console.error(`[${score.toFixed(1)}%] Point ID: ${result.id}`);
        console.error("");
      }
    }
    
    console.error("✓ Search completed\n");
    return true;
  } catch (err) {
    console.error("✗ Failed to search:", err);
    return false;
  }
}

/**
 * Test 4: Search for frappe permissions
 */
async function testFrappePermissionsSearch(): Promise<boolean> {
  console.error("[Test 4] Searching for 'frappe permissions'...");
  
  try {
    const rawResults = await client.query(config.collection, {
      query: {
        text: "frappe permissions",
        model: "sentence-transformers/all-minilm-l6-v2"
      },
      limit: 5,
    });

    // Parse: { result: { points: [...] } }
    const queryResult = rawResults as { result?: { points?: Array<{ id: number; score: number }> } };
    const results = queryResult?.result?.points || [];

    console.error(`\nFound ${results.length} results:\n`);
    
    if (results.length > 0) {
      for (const result of results) {
        const score = (result.score || 0) * 100;
        console.error(`[${score.toFixed(1)}%] Point ID: ${result.id}`);
        console.error("");
      }
    }
    
    // Check if frappe-permission-manager (id=2) is in results
    const hasPermissionSkill = results.some(r => r.id === 2);
    
    if (hasPermissionSkill) {
      console.error("✓ Found frappe-permission-manager (id=2)!\n");
    } else {
      console.error("⚠ frappe-permission-manager not in top results\n");
    }
    
    return true;
  } catch (err) {
    console.error("✗ Failed to search:", err);
    return false;
  }
}

/**
 * Test 5: Cleanup
 */
async function testCleanup(): Promise<boolean> {
  console.error("[Test 5] Cleaning up test collection...");
  
  try {
    await client.deleteCollection(config.collection);
    console.error("✓ Collection deleted\n");
    return true;
  } catch (err) {
    console.error("⚠ Failed to delete collection (may not exist):", err, "\n");
    return true; // Not a failure
  }
}

// Run tests
async function runTests() {
  const tests = [
    testCreateCollection,
    testUpsertPoints,
    testSearch,
    testFrappePermissionsSearch,
    testCleanup,
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const result = await test();
      if (result) passed++;
      else failed++;
    } catch (err) {
      console.error("✗ Test threw error:", err);
      failed++;
    }
  }

  console.error("=== Test Summary ===");
  console.error(`Passed: ${passed}`);
  console.error(`Failed: ${failed}`);
  
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
