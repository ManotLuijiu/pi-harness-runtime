import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerAgentPolicy } from "../src/extension.js";
import { PolicyLoader } from "../src/policy-loader.js";
import { resetPolicyStore } from "../src/policy-store.js";

let root: string;
let cwd: string;
let harnessRulesPath: URL;
beforeEach(() => {
  resetPolicyStore();
  root = mkdtempSync(join(tmpdir(), "policy-interlock-"));
  cwd = join(root, "project");
  mkdirSync(join(cwd, "src"), { recursive: true });
  mkdirSync(join(cwd, ".git"));
  writeFileSync(join(root, "harness.md"), "Harness mandatory rules");
  writeFileSync(join(root, "AGENTS.md"), "Ancestor mandatory rules");
  writeFileSync(join(cwd, "AGENTS.md"), "Project mandatory rules");
  writeFileSync(join(cwd, "RULES.md"), "Advisory rules");
  harnessRulesPath = pathToFileURL(join(root, "harness.md"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function runtime(requireReceiptBeforeMutation = true) {
  const hooks = new Map<string, Function[]>();
  let tool: any;
  registerAgentPolicy({
    on(name: string, handler: Function) {
      hooks.set(name, [...(hooks.get(name) ?? []), handler]);
    },
    registerTool(value: unknown) { tool = value; },
  } as any, { harnessRulesPath, requireReceiptBeforeMutation, lspMode: "pi-lens" });
  return {
    call: (params: unknown, ctx: unknown) => tool.execute("test", params, undefined, undefined, ctx),
    gate: (ctx: unknown, path = "src/file.ts") => hooks.get("tool_call")![0](
      { toolName: "edit", input: { path } }, ctx),
  };
}

test("target checks preserve mandatory revision, ancestor rules, and cached manifest", async () => {
  const loader = new PolicyLoader({ harnessRulesPath });
  const manifest = await loader.load(cwd);
  const snapshot = JSON.stringify(manifest);
  for (const path of ["src/file.ts", join(cwd, "src/file.ts"), "packages/a/file.ts"]) {
    const target = await loader.loadForTarget(cwd, path);
    expect(target.revision).toBe(manifest.revision);
    expect(target.sources.some(s => s.path === join(root, "AGENTS.md"))).toBe(true);
    expect(JSON.stringify(manifest)).toBe(snapshot);
  }
  loader.invalidateCache();
  expect((await loader.load(cwd)).revision).toBe(manifest.revision);
});

test("acknowledgment unlocks the next target call using Pi sessionManager identity", async () => {
  const r = runtime();
  const context = (id = "session-a") => ({ cwd, sessionManager: { getSessionId: () => id } });
  expect((await r.gate(context())).block).toBe(true);
  const revision = (await r.call({ action: "manifest" }, context())).details.manifest.revision;
  expect((await r.call({ action: "acknowledge", revision }, context())).isError).not.toBe(true);
  expect((await r.gate(context())).block).not.toBe(true);
  expect((await r.gate(context(), join(cwd, "src/file.ts"))).block).not.toBe(true);
  expect((await r.gate(context("session-b"))).block).toBe(true);
});

test("legacy contexts reuse a stable fallback identity", async () => {
  const r = runtime();
  const revision = (await r.call({ action: "manifest" }, { cwd })).details.manifest.revision;
  await r.call({ action: "acknowledge", revision }, { cwd });
  expect((await r.gate({ cwd })).block).not.toBe(true);
});

test("explicitly disabled receipt enforcement allows tools without an acknowledgment", async () => {
  const r = runtime(false);
  expect((await r.gate({ cwd })).block).not.toBe(true);
});

test("wrong revisions remain rejected when receipt enforcement is enabled", async () => {
  const r = runtime();
  const ctx = { cwd, sessionId: "session-a" };
  const result = await r.call({ action: "acknowledge", revision: "stale" }, ctx);
  expect(result.isError).toBe(true);
  expect((await r.gate(ctx)).block).toBe(true);
});

test("rule changes still require a new receipt after policy cache refresh", async () => {
  const r = runtime();
  const ctx = { cwd, sessionId: "session-a" };
  const revision = (await r.call({ action: "manifest" }, ctx)).details.manifest.revision;
  await r.call({ action: "acknowledge", revision }, ctx);
  writeFileSync(join(cwd, "AGENTS.md"), "Updated mandatory rules");
  // A fresh loader/registration models cache refresh without a five-second wait.
  const refreshed = runtime();
  expect((await refreshed.gate(ctx)).block).toBe(true);
  const current = (await refreshed.call({ action: "manifest" }, ctx)).details.manifest.revision;
  expect(current).not.toBe(revision);
  await refreshed.call({ action: "acknowledge", revision: current }, ctx);
  expect((await refreshed.gate(ctx)).block).not.toBe(true);
});
