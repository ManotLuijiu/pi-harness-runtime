/**
 * Prompt Versioning Tests (RFC-0019)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { PromptVersioning } from "../src/index.js";

describe("PromptVersioning", () => {
  let pv: PromptVersioning;

  beforeEach(() => { pv = new PromptVersioning(); });

  it("creates a prompt with initial version", () => {
    const record = pv.createPrompt("login-prompt", "Hello {{name}}");
    expect(record.name).toBe("login-prompt");
    expect(record.versions).toHaveLength(1);
    expect(record.activeVersion).toBe(record.versions[0].version);
  });

  it("addVersion creates a new version", () => {
    const record = pv.createPrompt("greet", "Hi {{name}}");
    const v2 = pv.addVersion(record.id, "Hello {{name}}");
    expect(v2.version).not.toBe(record.versions[0].version);
    expect(record.versions).toHaveLength(2);
    expect(record.activeVersion).toBe(v2.version);
  });

  it("getVersion returns correct version", () => {
    const record = pv.createPrompt("test", "v1");
    const v2 = pv.addVersion(record.id, "v2");
    const found = pv.getVersion(record.id, v2.version);
    expect(found?.prompt).toBe("v2");
  });

  it("getVersion returns active when no version specified", () => {
    const record = pv.createPrompt("test", "v1");
    pv.addVersion(record.id, "v2");
    const found = pv.getVersion(record.id);
    expect(found?.prompt).toBe("v2");
  });

  it("listVersions returns all versions", () => {
    const record = pv.createPrompt("test", "v1");
    pv.addVersion(record.id, "v2");
    pv.addVersion(record.id, "v3");
    const versions = pv.listVersions(record.id);
    expect(versions).toHaveLength(3);
  });

  it("diff shows added and removed lines", () => {
    const record = pv.createPrompt("test", "line1\nline2\nline3");
    pv.addVersion(record.id, "line1\nnewLine\nline3");
    const d = pv.diff(record.id, record.versions[0].version, record.versions[1].version);
    expect(d).not.toBeNull();
    expect(d!.added).toBe(1);
    expect(d!.removed).toBe(1);
  });

  it("rollback reverts to previous version", () => {
    const record = pv.createPrompt("test", "v1");
    const v2 = pv.addVersion(record.id, "v2");
    const result = pv.rollback(record.id, record.versions[0].version);
    expect(result?.rolledBackTo).toBe(record.versions[0].version);
    expect(result?.previousVersion).toBe(v2.version);
  });

  it("rollback returns null for unknown version", () => {
    const record = pv.createPrompt("test", "v1");
    const result = pv.rollback(record.id, "nonexistent");
    expect(result).toBeNull();
  });

  it("delete removes prompt when allowed", () => {
    pv = new PromptVersioning({ allowDelete: true });
    const record = pv.createPrompt("test", "content");
    expect(pv.delete(record.id)).toBe(true);
    expect(pv.getVersion(record.id)).toBeNull();
  });

  it("delete returns false when not allowed", () => {
    const record = pv.createPrompt("test", "content");
    expect(pv.delete(record.id)).toBe(false);
  });

  it("enforces maxVersions", () => {
    pv = new PromptVersioning({ maxVersions: 3 });
    const record = pv.createPrompt("test", "v1");
    for (let i = 2; i <= 10; i++) pv.addVersion(record.id, `v${i}`);
    expect(record.versions).toHaveLength(3);
  });

  it("getStats returns correct stats", () => {
    const record = pv.createPrompt("test", "v1");
    pv.addVersion(record.id, "v2");
    const stats = pv.getStats(record.id);
    expect(stats?.versionCount).toBe(2);
  });

  it("getStats returns null for unknown prompt", () => {
    expect(pv.getStats("nonexistent")).toBeNull();
  });

  it("listPrompts returns all prompts", () => {
    pv.createPrompt("a", "content a");
    pv.createPrompt("b", "content b");
    expect(pv.listPrompts()).toHaveLength(2);
  });

  it("throws for unknown promptId on addVersion", () => {
    expect(() => pv.addVersion("nonexistent", "content")).toThrow();
  });
});
