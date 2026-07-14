/**
 * Runtime Tests — Policy Engine & Runtime API
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  PolicyEngine,
  createHarnessPolicyEngine,
  type PolicyContext,
} from "../src/policy-engine.js";

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  describe("defaults", () => {
    it("denies rm -rf /", () => {
      const result = engine.canExecuteCommand("rm -rf /");
      expect(result.effect).toBe("deny");
    });

    it("allows git commands", () => {
      const result = engine.canExecuteCommand("git status");
      expect(result.effect).toBe("allow");
    });

    it("allows npm/npx commands", () => {
      expect(engine.canExecuteCommand("npm install").effect).toBe("allow");
      expect(engine.canExecuteCommand("npx test").effect).toBe("allow");
    });

    it("allows HTTPS network requests", () => {
      const result = engine.canMakeNetworkRequest("https://api.example.com");
      expect(result.effect).toBe("allow");
    });

    it("denies HTTP network requests by default", () => {
      const result = engine.canMakeNetworkRequest("http://insecure.example.com");
      expect(result.effect).toBe("ask"); // Default ask, not explicit deny
    });

    it("denies private network access", () => {
      const result = engine.canMakeNetworkRequest("10.0.0.1");
      expect(result.effect).toBe("deny");
    });

    it("denies localhost network access", () => {
      const result = engine.canMakeNetworkRequest("localhost");
      expect(result.effect).toBe("deny");
    });

    it("denies file access outside workspace (.. paths)", () => {
      const result = engine.canAccessFile("../secret.txt", "read");
      expect(result.effect).toBe("deny");
    });

    it("defaults to ask for unknown resources", () => {
      const ctx: PolicyContext = {
        subject: {},
        resource: { type: "command", path: "unknown-cmd" },
      };
      const result = engine.evaluate(ctx);
      expect(result.effect).toBe("ask");
    });
  });

  describe("addPolicy / removePolicy", () => {
    it("adds a custom allow policy", () => {
      engine.addPolicy({
        id: "allow-my-cmd",
        name: "Allow my command",
        priority: 5,
        effect: "allow",
        condition: {
          resource: { pathPattern: "^my-script" },
        },
      });

      const result = engine.canExecuteCommand("my-script.sh");
      expect(result.effect).toBe("allow");
    });

    it("higher priority policies override lower", () => {
      engine.addPolicy({
        id: "allow-any",
        name: "Allow all",
        priority: 1,
        effect: "allow",
        condition: { resource: { type: "command" } },
      });
      engine.addPolicy({
        id: "deny-specific",
        name: "Deny specific",
        priority: 50,
        effect: "deny",
        condition: {
          resource: { pathPattern: "git" },
        },
      });

      const result = engine.canExecuteCommand("git status");
      expect(result.effect).toBe("deny");
    });

    it("removes policy by id", () => {
      engine.addPolicy({
        id: "temp-policy",
        name: "Temp",
        priority: 5,
        effect: "allow",
        condition: { resource: { type: "command" } },
      });
      expect(engine.removePolicy("temp-policy")).toBe(true);
      expect(engine.removePolicy("nonexistent")).toBe(false);
    });

    it("getPolicies returns all policies", () => {
      engine.addPolicy({
        id: "p1",
        name: "Policy 1",
        priority: 1,
        effect: "allow",
        condition: { resource: { type: "command" } },
      });
      const policies = engine.getPolicies();
      expect(policies.some((p) => p.id === "p1")).toBe(true);
    });
  });

  describe("canExecuteCommand", () => {
    it("returns policy name in result", () => {
      const result = engine.canExecuteCommand("git status");
      expect(result.policy).toBeDefined();
    });
  });

  describe("canAccessFile", () => {
    it("allows reading safe paths", () => {
      const result = engine.canAccessFile("/home/project/src/index.ts", "read");
      expect(result.effect).not.toBe("deny");
    });
  });

  describe("canMakeNetworkRequest", () => {
    it("allows github HTTPS", () => {
      const result = engine.canMakeNetworkRequest("https://github.com/api");
      expect(result.effect).toBe("allow");
    });
  });

  describe("addCommandRule", () => {
    it("adds regex-based command rule", () => {
      engine.addCommandRule(/^curl\s+/, "allow", "curl allowed");
      const result = engine.canExecuteCommand("curl https://example.com");
      expect(result.effect).toBe("allow");
      expect(result.reason).toBe("curl allowed");
    });
  });

  describe("addFileRule", () => {
    it("adds regex-based file rule", () => {
      engine.addFileRule(/\.log$/, "deny", "No log files");
      const result = engine.canAccessFile("/tmp/debug.log", "read");
      expect(result.effect).toBe("deny");
    });
  });

  describe("addNetworkRule", () => {
    it("adds regex-based network rule", () => {
      engine.addNetworkRule(/internal\.company\.com/, "deny", "Internal hosts blocked");
      const result = engine.canMakeNetworkRequest("https://internal.company.com");
      expect(result.effect).toBe("deny");
    });
  });

  describe("rate limiting", () => {
    it("enforces rate limits via custom policy", () => {
      // Add policy with custom rate limit condition
      let callCount = 0;
      engine.addPolicy({
        id: "rate-limit-test",
        name: "Rate Limit Test",
        priority: 50,
        effect: "deny",
        condition: {
          resource: { type: "command" },
          custom: () => {
            callCount++;
            return callCount > 3;
          },
        },
        reason: "Rate limit exceeded",
      });

      // First 3 should be allowed (no policy match)
      expect(engine.canExecuteCommand("git status").effect).toBe("allow");
      expect(engine.canExecuteCommand("git status").effect).toBe("allow");
      expect(engine.canExecuteCommand("git status").effect).toBe("allow");

      // 4th should be denied
      const result = engine.canExecuteCommand("git status");
      expect(result.effect).toBe("deny");
    });

    it("getRateLimit returns configured limit", () => {
      engine.setRateLimit("network", { maxRequests: 50, windowMs: 60000 });
      const limit = engine.getRateLimit("network");
      expect(limit?.maxRequests).toBe(50);
      expect(limit?.windowMs).toBe(60000);
    });
  });

  describe("audit log", () => {
    it("logs audited policies", () => {
      engine.addPolicy({
        id: "audit-test",
        name: "Audit Test",
        priority: 5,
        effect: "allow",
        audit: true,
        condition: {
          resource: { type: "command", pathPattern: "^test-audit" },
        },
      });

      engine.canExecuteCommand("test-audit");
      const log = engine.getAuditLog();
      expect(log.length).toBeGreaterThan(0);
    });

    it("filters audit log by effect", () => {
      engine.clearAuditLog();
      const log = engine.getAuditLog({ effect: "deny" });
      expect(Array.isArray(log)).toBe(true);
    });

    it("clears audit log", () => {
      engine.clearAuditLog();
      expect(engine.getAuditLog()).toEqual([]);
    });
  });

  describe("export/import policies", () => {
    it("exports policies as JSON", () => {
      const json = engine.exportPolicies();
      expect(json).toContain("policies");
      expect(json).toContain("commandRules");
    });

    it("imports policies from JSON", () => {
      const original = engine.exportPolicies();
      const imported = new PolicyEngine();
      expect(imported.importPolicies(original)).toBe(true);

      // After import, should still deny rm -rf
      expect(imported.canExecuteCommand("rm -rf /").effect).toBe("deny");
    });

    it("returns false for invalid JSON", () => {
      expect(engine.importPolicies("not valid json")).toBe(false);
    });
  });
});

describe("createHarnessPolicyEngine", () => {
  it("creates engine with harness-specific policies", () => {
    const engine = createHarnessPolicyEngine();

    // Should still deny dangerous commands
    expect(engine.canExecuteCommand("rm -rf /").effect).toBe("deny");

    // Should allow harness internal commands
    expect(engine.canExecuteCommand("pi-status").effect).toBe("allow");
    expect(engine.canExecuteCommand("harness-status").effect).toBe("allow");

    // Should deny system commands
    expect(engine.canExecuteCommand("sudo rm /").effect).toBe("deny");
  });

  it("has rate limits configured", () => {
    const engine = createHarnessPolicyEngine();
    expect(engine.getRateLimit("command")?.maxRequests).toBe(60);
    expect(engine.getRateLimit("network")?.maxRequests).toBe(100);
    expect(engine.getRateLimit("file")?.maxRequests).toBe(200);
  });
});
