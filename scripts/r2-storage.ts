/**
 * R2 Storage - Cloudflare R2 integration for Telegram log storage
 * 
 * Uses @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner
 * Credentials loaded from key files per sensitive data rules.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ============================================================================
// Configuration - Load from key files
// ============================================================================

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string;
  publicUrl?: string;
}

/**
 * Load R2 config from key files
 */
export function loadR2Config(): R2Config | null {
  const keysDir = join(process.env.HOME || "/home/frappe", ".pi-harness-runtime", "keys");

  const accountIdFile = join(keysDir, "r2-account-id.txt");
  const accessKeyFile = join(keysDir, "r2-access-key-id.txt");
  const secretKeyFile = join(keysDir, "r2-secret-access-key.txt");
  const bucketFile = join(keysDir, "r2-bucket-name.txt");
  const endpointFile = join(keysDir, "r2-endpoint.txt");
  const publicUrlFile = join(keysDir, "r2-public-url.txt");

  // Check if R2 is configured
  if (!existsSync(accountIdFile) || !existsSync(accessKeyFile) || !existsSync(secretKeyFile)) {
    return null;
  }

  return {
    accountId: readFileSync(accountIdFile, "utf8").trim(),
    accessKeyId: readFileSync(accessKeyFile, "utf8").trim(),
    secretAccessKey: readFileSync(secretKeyFile, "utf8").trim(),
    bucket: existsSync(bucketFile) ? readFileSync(bucketFile, "utf8").trim() : "telegram-logs",
    endpoint: existsSync(endpointFile) ? readFileSync(endpointFile, "utf8").trim() : undefined,
    publicUrl: existsSync(publicUrlFile) ? readFileSync(publicUrlFile, "utf8").trim() : undefined,
  };
}

// ============================================================================
// R2 Client
// ============================================================================

let r2Client: R2Client | null = null;

export class R2Client {
  private client: S3Client;
  private bucket: string;
  private publicUrl: string | null;

  constructor(config: R2Config) {
    // Build endpoint from accountId or use explicit endpoint
    const endpoint = config.endpoint || `https://${config.accountId}.r2.cloudflarestorage.com`;

    this.client = new S3Client({
      region: "auto",
      endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    this.bucket = config.bucket;
    this.publicUrl = config.publicUrl || null;
  }

  /**
   * Upload content to R2
   */
  async upload(options: {
    key: string;
    body: string;
    contentType?: string;
    expiresIn?: number; // For signed URL
  }): Promise<{ key: string; signedUrl: string; expiresIn: number }> {
    const { key, body, contentType = "text/plain", expiresIn = 86400 } = options;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );

    // Generate signed URL for access
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const signedUrl = await getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }), { expiresIn });

    console.log(`[R2] Uploaded: ${key}`);

    return {
      key,
      signedUrl,
      expiresIn,
    };
  }

  /**
   * Get public URL for a key (if publicUrl is configured)
   */
  getPublicUrl(key: string): string | null {
    if (this.publicUrl) {
      return `${this.publicUrl}/${key}`;
    }
    return null;
  }
}

/**
 * Get or create R2 client singleton
 */
export function getR2Client(): R2Client | null {
  if (r2Client) return r2Client;

  const config = loadR2Config();
  if (!config) return null;

  r2Client = new R2Client(config);
  return r2Client;
}

/**
 * Check if R2 is configured
 */
export function isR2Configured(): boolean {
  return loadR2Config() !== null;
}

// ============================================================================
// High-level API
// ============================================================================

interface UploadResult {
  key: string;
  url: string;
  expiresIn: number;
}

/**
 * Upload logs to R2 and return a signed URL
 * 
 * @param content - Log content to upload
 * @param prefix - Path prefix (default: "logs")
 * @param expiresIn - URL expiration in seconds (default: 86400 = 24h)
 */
export async function uploadLogsToR2(
  content: string,
  prefix: string = "logs",
  expiresIn: number = 86400
): Promise<UploadResult | null> {
  const client = getR2Client();
  if (!client) {
    console.log("[R2] Not configured - skipping upload");
    return null;
  }

  const key = `${prefix}/${Date.now()}-${generateId()}.txt`;

  try {
    const result = await client.upload({
      key,
      body: content,
      contentType: "text/plain",
      expiresIn,
    });

    return {
      key: result.key,
      url: result.signedUrl,
      expiresIn: result.expiresIn,
    };
  } catch (error) {
    console.error("[R2] Upload failed:", error);
    return null;
  }
}

/**
 * Generate a short random ID
 */
function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ============================================================================
// Key Files Required
// ============================================================================

/**
 * Required key files for R2:
 * - ~/.pi-harness-runtime/keys/r2-account-id.txt
 * - ~/.pi-harness-runtime/keys/r2-access-key-id.txt
 * - ~/.pi-harness-runtime/keys/r2-secret-access-key.txt
 * - ~/.pi-harness-runtime/keys/r2-bucket-name.txt (optional, default: "telegram-logs")
 * - ~/.pi-harness-runtime/keys/r2-endpoint.txt (optional)
 * - ~/.pi-harness-runtime/keys/r2-public-url.txt (optional)
 */
