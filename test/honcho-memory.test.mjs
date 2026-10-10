import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../harness/honcho-memory.ts", import.meta.url), "utf8");
// Evaluate the whole module with isolated I/O and timers, preserving declaration order.
const outputText = stripTypeScriptTypes(source)
  .replace(/import\s+\{([^}]+)\}\s+from\s+"([^"]+)";/g,
    (_, names, id) => `const {${names}} = require(${JSON.stringify(id)});`)
  .replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let)\b)/g, "")
  + "\nObject.assign(exports, { startHonchoHealthCheck, stopHonchoHealthCheck });";

for (const hasKey of [false, true]) {
  test(`Honcho module starts health checks safely ${hasKey ? "with" : "without"} an API key`, async () => {
    const timers = new Map();
    const requests = [];
    const exports = {};
    runInNewContext(outputText, {
      exports,
      require(id) {
        if (id === "./service-diagnostics.js") return {};
        if (id === "node:os") return { homedir: () => "/test-home" };
        if (id === "node:fs") return {
          existsSync: (path) => path.endsWith("honcho-api-key.txt") ? hasKey : true,
          readFileSync: (path) => path.endsWith("honcho-api-key.txt")
            ? "test-key" : JSON.stringify({ mcpServers: { honcho: { bearerToken: "test-key" } } }),
          mkdirSync() { throw new Error("Unexpected filesystem write"); },
          writeFileSync() { throw new Error("Unexpected filesystem write"); },
        };
        return require(id);
      },
      console: { log() {}, warn() {}, debug() {} },
      fetch: async (url, options) => {
        requests.push({ url, options });
        return { status: 200, json: async () => ({ status: "ok" }) };
      },
      setInterval(callback, delay) {
        const handle = {};
        timers.set(handle, { callback, delay });
        return handle;
      },
      clearInterval: (handle) => timers.delete(handle),
    });

    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].delay, 300_000);
    assert.equal(requests.length, hasKey ? 1 : 0);
    if (hasKey) {
      assert.equal(requests[0].url, "https://api.honcho.dev/v1/health");
      assert.equal(requests[0].options.headers.Authorization, "Bearer test-key");
    }
    exports.startHonchoHealthCheck();
    assert.equal(timers.size, 1);
    await [...timers.values()][0].callback();
    assert.equal(requests.length, hasKey ? 2 : 0);
    exports.stopHonchoHealthCheck();
    exports.stopHonchoHealthCheck();
    assert.equal(timers.size, 0);
    exports.startHonchoHealthCheck();
    assert.equal(timers.size, 1);
    exports.stopHonchoHealthCheck();
  });
}
