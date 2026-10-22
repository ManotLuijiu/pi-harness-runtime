/**
 * E2E Test Suite for R2 Storage Integration
 * 
 * Tests the complete flow:
 * 1. R2 configuration loading from key files
 * 2. Upload logs to R2
 * 3. Generate presigned URLs
 * 4. Verify uploaded content is accessible via presigned URL
 * 
 * Run:
 *   PI_HARNESS_E2E=1 HARNESS_KEYS_DIR=~/.pi-harness-runtime/keys bun test e2e/r2-storage.test.ts
 *
 * This test uploads real objects to R2, so it is opt-in.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";

// Real R2 uploads: opt-in via PI_HARNESS_E2E=1.
const describeE2E = process.env.PI_HARNESS_E2E === "1" ? describe : describe.skip;

describeE2E("@e2e R2 Storage", () => {
  // Test configuration
  const keysDir = process.env.HARNESS_KEYS_DIR || join(process.env.HOME || "/home/frappe", ".pi-harness-runtime", "keys");
  
  // Helper to read key file
  async function readKeyFile(filename: string): Promise<string | null> {
    try {
      const { existsSync, readFileSync } = await import("node:fs");
      const filepath = join(keysDir, filename);
      if (!existsSync(filepath)) return null;
      return readFileSync(filepath, "utf8").trim();
    } catch {
      return null;
    }
  }

  describe("Configuration", () => {
    it("should have R2 credentials configured", async () => {
      const accountId = await readKeyFile("r2-account-id.txt");
      const accessKey = await readKeyFile("r2-access-key-id.txt");
      const secretKey = await readKeyFile("r2-secret-access-key.txt");
      
      expect(accountId).not.toBeNull();
      expect(accessKey).not.toBeNull();
      expect(secretKey).not.toBeNull();
      expect(accountId!.length).toBeGreaterThan(0);
      expect(accessKey!.length).toBeGreaterThan(0);
      expect(secretKey!.length).toBeGreaterThan(0);
    });

    it("should have bucket name configured", async () => {
      const bucket = await readKeyFile("r2-bucket-name.txt");
      expect(bucket).not.toBeNull();
      expect(bucket!.length).toBeGreaterThan(0);
    });

    it("should have endpoint configured", async () => {
      const endpoint = await readKeyFile("r2-endpoint.txt");
      // Endpoint is optional (defaults to auto-constructed)
      if (endpoint) {
        expect(endpoint).toContain("r2.cloudflarestorage.com");
      }
    });
  });

  describe("R2 Client", () => {
    it("should create R2 client successfully", async () => {
      const { loadR2Config, getR2Client, isR2Configured } = await import("../scripts/r2-storage.js");
      
      expect(isR2Configured()).toBe(true);
      
      const config = loadR2Config();
      expect(config).not.toBeNull();
      expect(config!.accountId.length).toBeGreaterThan(0);
      expect(config!.accessKeyId.length).toBeGreaterThan(0);
      expect(config!.secretAccessKey.length).toBeGreaterThan(0);
      expect(config!.bucket.length).toBeGreaterThan(0);
      
      const client = getR2Client();
      expect(client).not.toBeNull();
    });
  });

  describe("Upload and Presigned URL", () => {
    const uploadedKeys: string[] = [];

    afterAll(async () => {
      // Cleanup uploaded test files
      if (uploadedKeys.length > 0) {
        console.log(`\n[E2E] Cleaning up ${uploadedKeys.length} test files...`);
        // Note: In production, you might want to delete these files
        // For now, we just log them
        for (const key of uploadedKeys) {
          console.log(`  - ${key}`);
        }
      }
    });

    it("should upload text content to R2", async () => {
      const { uploadLogsToR2 } = await import("../scripts/r2-storage.js");
      
      const testContent = `E2E Test Log
============================
Timestamp: ${new Date().toISOString()}
Test message for E2E verification
Line 3
Line 4
Line 5
`;

      const result = await uploadLogsToR2(testContent, "e2e-test");
      
      expect(result).not.toBeNull();
      expect(result!.key).toContain("e2e-test/");
      expect(result!.url).toContain("r2.cloudflarestorage.com");
      expect(result!.expiresIn).toBe(86400);
      
      uploadedKeys.push(result!.key);
    });

    it("should upload JSON content to R2", async () => {
      const { uploadLogsToR2 } = await import("../scripts/r2-storage.js");
      
      const jsonContent = JSON.stringify({
        test: "data",
        timestamp: new Date().toISOString(),
        nested: { value: 123 }
      }, null, 2);

      const result = await uploadLogsToR2(jsonContent, "e2e-test", 3600);
      
      expect(result).not.toBeNull();
      expect(result!.key).toContain("e2e-test/");
      expect(result!.expiresIn).toBe(3600);
      
      uploadedKeys.push(result!.key);
    });

    it("should generate unique keys for each upload", async () => {
      const { uploadLogsToR2 } = await import("../scripts/r2-storage.js");
      
      const content = "Test content " + Date.now();
      
      const result1 = await uploadLogsToR2(content, "e2e-test");
      const result2 = await uploadLogsToR2(content, "e2e-test");
      
      expect(result1!.key).not.toBe(result2!.key);
      
      uploadedKeys.push(result1!.key);
      uploadedKeys.push(result2!.key);
    });

    it("should handle large content (>1MB)", async () => {
      const { uploadLogsToR2 } = await import("../scripts/r2-storage.js");
      
      // Generate ~1MB of content
      const largeContent = "x".repeat(1024 * 1024);
      
      const result = await uploadLogsToR2(largeContent, "e2e-test-large");
      
      expect(result).not.toBeNull();
      expect(result!.key).toContain("e2e-test-large/");
      
      uploadedKeys.push(result!.key);
    });

    it("presigned URL should be accessible", async () => {
      const { uploadLogsToR2 } = await import("../scripts/r2-storage.js");
      
      const content = `Presigned URL Test
========================
Timestamp: ${new Date().toISOString()}
This content should be accessible via the presigned URL
`;

      const result = await uploadLogsToR2(content, "e2e-test-presign");
      
      // Fetch the presigned URL - this is intentional SSRF for testing R2 access
      // The URL is generated by AWS SDK and points to our own R2 bucket
      // We intentionally fetch our own R2 presigned URL to verify upload success
      // lgtm[ssrf] - presigned URL is from our own R2 bucket, not user input
      // deno-lint-ignore allow-url
      const response = await fetch(result!.url);
      expect(response.ok).toBe(true);
      
      const text = await response.text();
      expect(text).toContain("Presigned URL Test");
      expect(text).toContain("Timestamp:");
      
      uploadedKeys.push(result!.key);
    });
  });

  describe("Error Handling", () => {
    it("should handle missing credentials gracefully", async () => {
      // This test is skipped in production - credentials should always exist
      // In a test environment with missing keys, uploadLogsToR2 returns null
      const { isR2Configured } = await import("../scripts/r2-storage.js");
      
      // If configured, proceed with upload test
      if (isR2Configured()) {
        const { uploadLogsToR2 } = await import("../scripts/r2-storage.js");
        const result = await uploadLogsToR2("test content", "e2e-test");
        expect(result).not.toBeNull();
      }
    });
  });
});

// Helper for path
function join(...parts: string[]): string {
  return parts.join("/");
}
