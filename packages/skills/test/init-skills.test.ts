/**
 * Skills Initialization E2E Test
 * 
 * Tests the initSkills function to ensure:
 * 1. initSkills() with no args uses default directories
 * 2. initSkills({ locations }) with explicit locations works
 * 3. initSkills({ locations: undefined }) falls back to defaults (the bug case)
 * 
 * Bug: Previously, passing undefined for locations would override defaults
 * with undefined, causing "directories is not iterable" error.
 * 
 * Usage:
 *   bun packages/skills/test/init-skills.test.ts
 */

import { initSkills } from "../src/index.js";

async function runTests() {
  console.log("=== initSkills E2E Test ===\n");
  
  let passed = 0;
  let failed = 0;

  // Test 1: no args
  console.log("[Test 1] initSkills() with no arguments...");
  try {
    const result = initSkills();
    if (!result || !Array.isArray(result.skills) || !Array.isArray(result.errors)) {
      throw new Error("Invalid result structure");
    }
    console.log(`  PASS: Returned ${result.skills.length} skills, ${result.errors.length} errors\n`);
    passed++;
  } catch (error) {
    console.error(`  FAIL: ${error}\n`);
    failed++;
  }

  // Test 2: explicit locations
  console.log("[Test 2] initSkills({ locations: [...] })...");
  try {
    const result = initSkills({ locations: ["/tmp/test"] });
    if (!result) {
      throw new Error("No result returned");
    }
    console.log(`  PASS: Returned ${result.skills.length} skills\n`);
    passed++;
  } catch (error) {
    console.error(`  FAIL: ${error}\n`);
    failed++;
  }

  // Test 3: undefined locations (the bug case)
  console.log("[Test 3] initSkills({ locations: undefined }) - THE BUG CASE...");
  try {
    const result = initSkills({ locations: undefined });
    if (!result || !Array.isArray(result.skills)) {
      throw new Error("Invalid result structure");
    }
    console.log(`  PASS: Returned ${result.skills.length} skills\n`);
    passed++;
  } catch (error) {
    console.error(`  FAIL: ${error}\n`);
    failed++;
  }

  // Test 4: partial config with only maxDepth
  console.log("[Test 4] initSkills({ maxDepth: 5 })...");
  try {
    const result = initSkills({ maxDepth: 5 });
    if (!result || !Array.isArray(result.skills)) {
      throw new Error("Invalid result structure");
    }
    console.log(`  PASS: Returned ${result.skills.length} skills\n`);
    passed++;
  } catch (error) {
    console.error(`  FAIL: ${error}\n`);
    failed++;
  }

  // Test 5: partial config with only includeHidden
  console.log("[Test 5] initSkills({ includeHidden: true })...");
  try {
    const result = initSkills({ includeHidden: true });
    if (!result || !Array.isArray(result.skills)) {
      throw new Error("Invalid result structure");
    }
    console.log(`  PASS: Returned ${result.skills.length} skills\n`);
    passed++;
  } catch (error) {
    console.error(`  FAIL: ${error}\n`);
    failed++;
  }

  // Test 6: empty locations array
  console.log("[Test 6] initSkills({ locations: [] })...");
  try {
    const result = initSkills({ locations: [] });
    if (!result) {
      throw new Error("No result returned");
    }
    console.log(`  PASS: Returned ${result.skills.length} skills\n`);
    passed++;
  } catch (error) {
    console.error(`  FAIL: ${error}\n`);
    failed++;
  }

  // Summary
  console.log("=== Summary ===");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
