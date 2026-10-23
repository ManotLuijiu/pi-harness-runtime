/**
 * Configuration for the centralized log pipeline.
 *
 * Resolution order for credentials:
 *   environment variable -> key file in ~/.pi-harness-runtime/keys
 *
 * Secrets are never hardcoded here. A key file that is missing simply means
 * the corresponding transport is not configured.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createR2Transport } from "./transports/r2.js";
import { createWebhookTransport } from "./transports/webhook.js";
function readKeyFile(keysDir, name) {
    const file = join(keysDir, name);
    if (!existsSync(file))
        return undefined;
    const value = readFileSync(file, "utf8").trim();
    return value.length > 0 ? value : undefined;
}
function readNumber(env, key, fallback) {
    const raw = env[key];
    if (!raw)
        return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}
export function defaultKeysDir() {
    return join(homedir(), ".pi-harness-runtime", "keys");
}
export function defaultSpoolDir() {
    return join(homedir(), ".pi-harness-runtime", "logs", "spool");
}
/**
 * Build the log sink configuration from the environment and the key files.
 */
export function resolveLogSinkConfig(options = {}) {
    const env = options.env ?? process.env;
    const keysDir = options.keysDir ?? defaultKeysDir();
    const mode = (env.PI_LOG_SINK ?? "auto");
    const notes = [];
    if (mode === "off") {
        return {
            enabled: false,
            app: env.PI_LOG_APP ?? "pi-harness",
            transports: [],
            sampling: {},
            buffer: {},
            flushIntervalMs: 0,
            notes: ["logging disabled by PI_LOG_SINK=off"],
        };
    }
    const transports = [];
    const bucket = env.PI_LOG_R2_BUCKET ?? readKeyFile(keysDir, "r2-bucket-name.txt");
    const accessKeyId = env.PI_LOG_R2_ACCESS_KEY_ID ?? readKeyFile(keysDir, "r2-access-key-id.txt");
    const secretAccessKey = env.PI_LOG_R2_SECRET_ACCESS_KEY ?? readKeyFile(keysDir, "r2-secret-access-key.txt");
    const accountId = env.PI_LOG_R2_ACCOUNT_ID ?? readKeyFile(keysDir, "r2-account-id.txt");
    const endpoint = env.PI_LOG_R2_ENDPOINT ??
        readKeyFile(keysDir, "r2-endpoint.txt") ??
        (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
    const r2Ready = Boolean(bucket && accessKeyId && secretAccessKey && endpoint);
    const wantR2 = mode === "r2" || mode === "r2+webhook" || (mode === "auto" && r2Ready);
    if (wantR2) {
        if (r2Ready) {
            transports.push(createR2Transport({
                bucket: bucket,
                endpoint: endpoint,
                accessKeyId: accessKeyId,
                secretAccessKey: secretAccessKey,
                prefix: env.PI_LOG_R2_PREFIX ?? "logs/harness",
            }));
            notes.push(`r2 enabled (bucket ${bucket})`);
        }
        else {
            notes.push("r2 requested but credentials are incomplete - transport skipped");
        }
    }
    const webhookUrl = env.PI_LOG_WEBHOOK_URL;
    const wantWebhook = mode === "webhook" || mode === "r2+webhook" || (mode === "auto" && Boolean(webhookUrl));
    if (wantWebhook) {
        if (webhookUrl) {
            transports.push(createWebhookTransport({
                url: webhookUrl,
                token: env.PI_LOG_WEBHOOK_TOKEN,
            }));
            notes.push(`webhook enabled (${webhookUrl})`);
        }
        else {
            notes.push("webhook requested but PI_LOG_WEBHOOK_URL is not set - transport skipped");
        }
    }
    if (transports.length === 0) {
        notes.push("no transport configured - logs stay local");
    }
    return {
        enabled: true,
        app: env.PI_LOG_APP ?? "pi-harness",
        transports,
        spoolDir: env.PI_LOG_SPOOL_DIR ?? defaultSpoolDir(),
        sampling: {
            minLevel: env.PI_LOG_LEVEL ?? "info",
            sampleRate: readNumber(env, "PI_LOG_SAMPLE_RATE", 0.1),
            rateLimitPerMinute: readNumber(env, "PI_LOG_RATE_LIMIT", 60),
        },
        buffer: {
            maxSize: readNumber(env, "PI_LOG_BUFFER_SIZE", 1000),
            maxBatchSize: readNumber(env, "PI_LOG_BATCH_SIZE", 100),
        },
        flushIntervalMs: readNumber(env, "PI_LOG_FLUSH_INTERVAL_MS", 15_000),
        notes,
    };
}
//# sourceMappingURL=config.js.map