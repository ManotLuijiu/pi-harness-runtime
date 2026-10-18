/**
 * Test R2 Connection
 * 
 * Run: bun run scripts/test-r2.ts
 */

import { loadR2Config, getR2Client, uploadLogsToR2, isR2Configured } from "./r2-storage.js";

async function main() {
  console.log("=".repeat(60));
  console.log("R2 Connection Test");
  console.log("=".repeat(60));

  // Check if configured
  console.log("\n1. Checking configuration...");
  if (!isR2Configured()) {
    console.log("❌ R2 not configured - missing key files");
    process.exit(1);
  }
  console.log("✓ R2 credentials found");

  const config = loadR2Config();
  console.log(`   Account ID: ${config!.accountId.slice(0, 8)}...`);
  console.log(`   Bucket: ${config!.bucket}`);
  console.log(`   Endpoint: ${config!.endpoint || "(auto)"}`);

  // Test connection
  console.log("\n2. Testing connection...");
  const client = getR2Client();
  if (!client) {
    console.log("❌ Failed to create R2 client");
    process.exit(1);
  }
  console.log("✓ R2 client created");

  // Upload test
  console.log("\n3. Testing upload...");
  const testContent = `R2 Test Log
================
Timestamp: ${new Date().toISOString()}
Test message for R2 upload verification
`;

  const result = await uploadLogsToR2(testContent, "test");
  if (!result) {
    console.log("❌ Upload failed");
    process.exit(1);
  }

  console.log("✓ Upload successful!");
  console.log(`   Key: ${result.key}`);
  console.log(`   Presigned URL: ${result.url.slice(0, 80)}...`);
  console.log(`   Expires in: ${result.expiresIn / 3600} hours`);

  console.log("\n" + "=".repeat(60));
  console.log("✅ R2 is working correctly!");
  console.log("=".repeat(60));
}

main().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
