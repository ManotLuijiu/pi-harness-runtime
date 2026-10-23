import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveLogSinkConfig } from "../src/config.js";

const created: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "log-config-"));
	created.push(dir);
	return dir;
}

afterEach(() => {
	while (created.length > 0) {
		rmSync(created.pop() as string, { recursive: true, force: true });
	}
});

describe("resolveLogSinkConfig", () => {
	test("PI_LOG_SINK=off disables logging completely", () => {
		const config = resolveLogSinkConfig({ env: { PI_LOG_SINK: "off" }, keysDir: tempDir() });
		expect(config.enabled).toBe(false);
		expect(config.transports).toHaveLength(0);
		expect(config.spoolDir).toBeUndefined();
	});

	test("auto mode stays local when nothing is configured", () => {
		const config = resolveLogSinkConfig({ env: {}, keysDir: tempDir() });
		expect(config.enabled).toBe(true);
		expect(config.transports).toHaveLength(0);
		expect(config.spoolDir).toBeTruthy();
	});

	test("auto mode picks up R2 credentials from the key files", () => {
		const keysDir = tempDir();
		writeFileSync(join(keysDir, "r2-bucket-name.txt"), "logs-bucket\n");
		writeFileSync(join(keysDir, "r2-access-key-id.txt"), "AKIAEXAMPLE\n");
		writeFileSync(join(keysDir, "r2-secret-access-key.txt"), "secret\n");
		writeFileSync(join(keysDir, "r2-account-id.txt"), "account\n");

		const config = resolveLogSinkConfig({ env: {}, keysDir });
		expect(config.transports).toHaveLength(1);
		expect(config.transports[0].name).toBe("r2");
	});

	test("auto mode picks up an explicit webhook url", () => {
		const config = resolveLogSinkConfig({
			env: { PI_LOG_WEBHOOK_URL: "http://127.0.0.1:8443/api/logs" },
			keysDir: tempDir(),
		});
		expect(config.transports).toHaveLength(1);
		expect(config.transports[0].name).toBe("webhook");
	});

	test("r2+webhook keeps R2 as the first transport", () => {
		const keysDir = tempDir();
		writeFileSync(join(keysDir, "r2-bucket-name.txt"), "logs-bucket\n");
		writeFileSync(join(keysDir, "r2-access-key-id.txt"), "AKIAEXAMPLE\n");
		writeFileSync(join(keysDir, "r2-secret-access-key.txt"), "secret\n");
		writeFileSync(join(keysDir, "r2-endpoint.txt"), "https://example.r2.cloudflarestorage.com\n");

		const config = resolveLogSinkConfig({
			env: { PI_LOG_SINK: "r2+webhook", PI_LOG_WEBHOOK_URL: "http://127.0.0.1:8443/api/logs" },
			keysDir,
		});
		expect(config.transports.map((transport) => transport.name)).toEqual(["r2", "webhook"]);
	});

	test("r2 without credentials is skipped and reported", () => {
		const config = resolveLogSinkConfig({ env: { PI_LOG_SINK: "r2" }, keysDir: tempDir() });
		expect(config.transports).toHaveLength(0);
		expect(config.notes.join(" ")).toContain("credentials are incomplete");
	});

	test("sampling and buffer settings come from the environment", () => {
		const config = resolveLogSinkConfig({
			env: {
				PI_LOG_LEVEL: "warn",
				PI_LOG_SAMPLE_RATE: "0.5",
				PI_LOG_RATE_LIMIT: "5",
				PI_LOG_BUFFER_SIZE: "42",
				PI_LOG_BATCH_SIZE: "7",
				PI_LOG_FLUSH_INTERVAL_MS: "1000",
			},
			keysDir: tempDir(),
		});

		expect(config.sampling.minLevel).toBe("warn");
		expect(config.sampling.sampleRate).toBe(0.5);
		expect(config.sampling.rateLimitPerMinute).toBe(5);
		expect(config.buffer.maxSize).toBe(42);
		expect(config.buffer.maxBatchSize).toBe(7);
		expect(config.flushIntervalMs).toBe(1000);
	});
});
