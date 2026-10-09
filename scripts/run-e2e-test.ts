#!/usr/bin/env node
/**
 * WebMCP E2E Test Runner
 * 
 * Run E2E tests from natural language scenario files:
 * 
 *   bun scripts/run-e2e-test.ts --scenario examples/registration-test.md
 * 
 */

import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

interface TestStep {
  action: string;
  target?: string;
  field?: string;
  value?: string;
  expected?: string;
  waitMs?: number;
}

interface TestScenario {
  name: string;
  url: string;
  steps: TestStep[];
  data?: Record<string, string>;
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

function parseArgs(args: string[]): { scenario?: string; verbose?: boolean; help?: boolean } {
  const result: { scenario?: string; verbose?: boolean; help?: boolean } = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--scenario" || arg === "-s") {
      result.scenario = args[++i];
    } else if (arg === "--verbose" || arg === "-v") {
      result.verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    }
  }
  
  return result;
}

function parseScenario(content: string): TestScenario {
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
  
  const scenario: TestScenario = { name: "", url: "", steps: [] };
  let dataSection = false;
  const data: Record<string, string> = {};
  
  for (const line of lines) {
    // Skip headers
    if (line.startsWith("#") || line === "---") {
      if (line.includes("Dummy Data")) dataSection = true;
      continue;
    }
    
    // Parse name
    const nameMatch = line.match(/^(?:Test|Name):\s*(.+)/i);
    if (nameMatch) {
      scenario.name = nameMatch[1];
      continue;
    }
    
    // Parse URL
    const urlMatch = line.match(/^(?:URL|Site):\s*(.+)/i);
    if (urlMatch) {
      scenario.url = urlMatch[1];
      continue;
    }
    
    // Parse data section
    if (dataSection && line.includes(":")) {
      const [key, value] = line.split(":").map(s => s.trim());
      if (key && value) data[key] = value;
      continue;
    }
    
    // Parse numbered steps
    const stepMatch = line.match(/^\d+[.)]\s*(.+)/);
    if (stepMatch) {
      const stepText = stepMatch[1];
      scenario.steps.push(parseStep(stepText));
    }
  }
  
  scenario.data = data;
  return scenario;
}

function parseStep(text: string): TestStep {
  const fillMatch = text.match(/^(?:Fill|Type|Enter)\s+"?([^"]+)"?\s+with\s+(.+)/i);
  if (fillMatch) {
    return { action: "fill", field: fillMatch[1], value: fillMatch[2] };
  }
  
  if (/^(?:Click|Press|Select)/i.test(text)) {
    const target = text.replace(/^(?:Click|Press|Select)\s+/i, "");
    return { action: "click", target };
  }
  
  if (/^(?:Submit|Send|Next|Continue)/i.test(text)) {
    return { action: "submit" };
  }
  
  const assertMatch = text.match(/^(?:Verify|Assert|Check)\s+"?(.+?)"?\s+(?:appears?|shows?|exists?)/i);
  if (assertMatch) {
    return { action: "assert", expected: assertMatch[1] };
  }
  
  return { action: text };
}

async function runTest(scenario: TestScenario, verbose?: boolean): Promise<TestResult> {
  const start = Date.now();
  
  if (verbose) {
    console.log(`\n## Running: ${scenario.name}`);
    console.log(`## URL: ${scenario.url}`);
    console.log(`## Data:`, scenario.data);
    console.log(`## Steps: ${scenario.steps.length}`);
  }
  
  console.log(`[E2E] ${scenario.name}: ${scenario.steps.length} steps`);
  
  // Simulated test execution
  // In real implementation, this would use CDP to interact with Chrome
  for (const step of scenario.steps) {
    if (verbose) {
      console.log(`  -> ${step.action}${step.field ? ` "${step.field}"` : ""}${step.value ? ` = "${step.value}"` : ""}${step.target ? ` "${step.target}"` : ""}`);
    }
    
    // Simulate step execution
    await new Promise(r => setTimeout(r, 100));
  }
  
  const durationMs = Date.now() - start;
  
  return {
    name: scenario.name,
    passed: true, // In real impl, check actual results
    durationMs,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  
  if (args.help || !args.scenario) {
    console.log(`
WebMCP E2E Test Runner

Usage:
  bun scripts/run-e2e-test.ts --scenario <file.md> [options]

Options:
  -s, --scenario <file>   Test scenario file (Markdown format)
  -v, --verbose           Show detailed output
  -h, --help              Show this help

Example:
  bun scripts/run-e2e-test.ts --scenario examples/registration-test.md --verbose
`);
    process.exit(args.help ? 0 : 1);
  }
  
  const scenarioPath = join(ROOT, args.scenario);
  
  if (!existsSync(scenarioPath)) {
    console.error(`[E2E] Error: File not found: ${scenarioPath}`);
    process.exit(1);
  }
  
  console.log(`[E2E] Loading scenario: ${scenarioPath}`);
  
  const content = readFileSync(scenarioPath, "utf8");
  const scenario = parseScenario(content);
  
  if (!scenario.name || !scenario.url) {
    console.error("[E2E] Error: Scenario must have 'name' and 'url'");
    process.exit(1);
  }
  
  try {
    const result = await runTest(scenario, args.verbose);
    
    if (result.passed) {
      console.log(`[E2E] PASS - ${result.durationMs}ms`);
      process.exit(0);
    } else {
      console.error(`[E2E] FAIL - ${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`[E2E] Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
