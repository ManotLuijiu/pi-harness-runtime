/**
 * StatusLineManager tests — T16
 *
 * Tests the pi-lens detection, quota formatting, and status file writing
 * when pi-lens is not available.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { StatusLineManager, isPiLensAvailable, formatQuotaLine, } from "./status-line.js";
describe("isPiLensAvailable", () => {
    it("returns false when no PI_LENS env vars are set", () => {
        assert.ok(!isPiLensAvailable());
    });
});
describe("formatQuotaLine", () => {
    it("returns 'quota unknown' when no data", () => {
        assert.ok(formatQuotaLine({}).startsWith("MiniMax: quota unknown"));
    });
    it("shows 5h usage when available", () => {
        const line = formatQuotaLine({ fiveHourPercent: 89 });
        assert.ok(line.includes("5h: 89% left"), line);
        assert.ok(line.includes("MiniMax:"), line);
    });
    it("shows both 5h and weekly when both available", () => {
        const line = formatQuotaLine({ fiveHourPercent: 89, weeklyPercent: 75 });
        assert.ok(line.includes("5h: 89% left"), line);
        assert.ok(line.includes("week: 75% left"), line);
    });
    it("shows 0% left when at 100%", () => {
        const line = formatQuotaLine({ fiveHourPercent: 100 });
        assert.ok(line.includes("0% left"), line);
    });
    it("shows ? for invalid negative percentage", () => {
        // fmtPercent returns ? for negative values
        const line = formatQuotaLine({ fiveHourPercent: -1 });
        assert.ok(line.includes("5h: ?"), line);
    });
    it("shows reset countdown when resetAt is provided", () => {
        const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2h from now
        const line = formatQuotaLine({
            fiveHourPercent: 89,
            fiveHourResetAt: future,
        });
        assert.ok(line.includes("resets in"), line);
    });
});
describe("StatusLineManager", () => {
    const tmpDir = join(process.env.TMPDIR ?? "/tmp", `harness-status-test-${Date.now()}`);
    let manager;
    beforeEach(() => {
        mkdirSync(tmpDir, { recursive: true });
        manager = new StatusLineManager(tmpDir);
    });
    afterEach(() => {
        manager.stop();
        try {
            rmSync(tmpDir, { recursive: true, force: true });
        }
        catch {
            /* ignore */
        }
    });
    it("getLine returns combined loop + quota status", () => {
        manager.updateLoopStatus("[P] planning");
        const line = manager.getLine();
        assert.ok(line.includes("planning"), line);
    });
    it("getLine returns quota-only when no loop status", () => {
        const line = manager.getLine();
        assert.ok(line.includes("MiniMax"), line);
    });
    it("writes .harness-status file when pi-lens is not available", () => {
        manager.updateLoopStatus("[W] coding");
        const statusFile = join(tmpDir, ".harness-status");
        assert.ok(existsSync(statusFile), ".harness-status should exist");
        const content = readFileSync(statusFile, "utf8");
        assert.ok(content.includes("coding"), content);
    });
    it("start() and stop() do not throw", () => {
        assert.doesNotThrow(() => manager.start());
        assert.doesNotThrow(() => manager.stop());
    });
});
//# sourceMappingURL=status-line.test.js.map