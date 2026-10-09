/**
 * Varlock Worker Module
 *
 * Spawns Varlock CLI as an async child process for secret resolution.
 * All secrets stay in private pipes - never touch main process stdout.
 *
 * Security:
 * - Uses shell: false to prevent injection
 * - Captures output in memory only
 * - Enforces deadlines and termination
 * - Never logs secret values
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

/**
 * Varlock worker options
 */
export interface VarlockWorkerOptions {
  /** Path to Varlock schema file (.env.schema) */
  schemaPath: string;

  /** Working directory for Varlock */
  cwd?: string;

  /** Environment variables to pass (bootstrap vars only) */
  env?: Record<string, string>;

  /** Maximum time to wait for resolution (ms) */
  timeoutMs?: number;

  /** Skip cache for this resolution */
  skipCache?: boolean;
}

/**
 * Resolved secret value
 */
export interface ResolvedSecret {
  key: string;
  value: string;
}

/**
 * Resolution result
 */
export interface ResolutionResult {
  success: boolean;
  secrets?: ResolvedSecret[];
  error?: string;
  errorCode?: "timeout" | "exit_error" | "parse_error" | "no_binary" | "cancelled";
}

/**
 * Error categories for safe logging
 */
export type ErrorCategory =
  | "no_binary"
  | "schema_not_found"
  | "timeout"
  | "exit_error"
  | "parse_error"
  | "cancelled"
  | "unknown";


/**
 * Resolution error codes (subset of ErrorCategory that can be returned)
 */
export type ResolutionErrorCode =
  | "no_binary"
  | "timeout"
  | "exit_error"
  | "parse_error"
  | "cancelled";

/**
 * Find Varlock CLI binary
 */
function findVarlockBinary(): string | null {
  // Check common locations
  const possiblePaths = [
    // Global npm
    join(homedir(), ".nvm", "versions", "node", process.version.split(".")[0].slice(1), "lib", "node_modules", "varlock", "bin", "cli.js"),
    // User npm
    join(homedir(), ".npm-global", "bin", "varlock"),
    // Local node_modules
    join(process.cwd(), "node_modules", ".bin", "varlock"),
    // pi-harness-runtime node_modules
    join(__dirname, "..", "node_modules", ".bin", "varlock"),
    // Direct global
    "/usr/local/bin/varlock",
    "/usr/bin/varlock",
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

/**
 * Map error to safe category for logging
 */
function categorizeError(error: unknown): ErrorCategory {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    if (msg.includes("enoent") || msg.includes("not found")) {
      return "no_binary";
    }
    if (msg.includes("timeout")) {
      return "timeout";
    }
    if (msg.includes("enoent") || msg.includes("no such file")) {
      return "schema_not_found";
    }
  }

  return "unknown";
}

/**
 * Parse Varlock JSON output
 */
function parseVarlockOutput(stdout: string, maxSize: number = 1024 * 1024): ResolvedSecret[] | null {
  // Enforce size limit
  if (stdout.length > maxSize) {
    return null;
  }

  try {
    const parsed = JSON.parse(stdout);

    // Varlock JSON format: { "KEY": "value", ... }
    // Only return string-to-string mappings
    const secrets: ResolvedSecret[] = [];

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === "string" && typeof value === "string") {
        secrets.push({ key, value });
      }
    }

    return secrets;
  } catch {
    return null;
  }
}

/**
 * Resolve secrets using Varlock CLI
 *
 * @param options - Worker options
 * @param signal - AbortSignal for cancellation
 * @returns Resolution result
 */
export async function resolveSecrets(
  options: VarlockWorkerOptions,
  signal?: AbortSignal
): Promise<ResolutionResult> {
  const {
    schemaPath,
    cwd = process.cwd(),
    env = {},
    timeoutMs = 60000,
    skipCache = true,
  } = options;

  const varlockPath = findVarlockBinary();

  if (!varlockPath) {
    console.error("[varlock-worker] Varlock binary not found");
    return {
      success: false,
      error: "Varlock binary not found",
      errorCode: "no_binary",
    };
  }

  // Build arguments
  const args = [
    "load",
    "--format", "json",
    "--path", schemaPath,
  ];

  if (skipCache) {
    args.push("--skip-cache");
  }

  // Create promise with deadline
  const result = await Promise.race([
    new Promise<ResolutionResult>((resolve) => {
      const child = spawn(varlockPath, args, {
        cwd,
        env: {
          ...process.env,
          ...env,
        },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        if (code === 0) {
          const secrets = parseVarlockOutput(stdout);
          if (secrets) {
            resolve({
              success: true,
              secrets,
            });
          } else {
            resolve({
              success: false,
              error: "Failed to parse Varlock output",
              errorCode: "parse_error",
            });
          }
        } else {
          // Log stderr without secrets
          console.error("[varlock-worker] Varlock exited with code:", code);
          if (stderr) {
            // Only log first line of stderr, no secrets
            const firstLine = stderr.split("\n")[0];
            console.error("[varlock-worker] Error:", firstLine?.slice(0, 200));
          }
          resolve({
            success: false,
            error: `Varlock exited with code ${code}`,
            errorCode: "exit_error",
          });
        }
      });

      child.on("error", (err) => {
        const category = categorizeError(err);
        console.error(`[varlock-worker] ${category}:`, err instanceof Error ? err.message : String(err));
        // Map to allowed error codes
        const errorCode: ResolutionErrorCode =
          category === "schema_not_found" || category === "unknown"
            ? "exit_error"
            : category as ResolutionErrorCode;
        resolve({
          success: false,
          error: `${category}: ${err instanceof Error ? err.message : String(err)}`,
          errorCode,
        });
      });

      // Handle cancellation
      signal?.addEventListener("abort", () => {
        console.log("[varlock-worker] Cancelled, terminating child");
        child.kill("SIGTERM");
      });
    }),
    // Timeout
    new Promise<ResolutionResult>((resolve) =>
      setTimeout(() => {
        resolve({
          success: false,
          error: "Resolution timed out",
          errorCode: "timeout",
        });
      }, timeoutMs)
    ),
  ]);

  return result;
}

/**
 * Get Varlock version
 */
export async function getVarlockVersion(): Promise<string | null> {
  const varlockPath = findVarlockBinary();

  if (!varlockPath) {
    return null;
  }

  return new Promise((resolve) => {
    const child = spawn(varlockPath, ["--version"], {
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });

    let version = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      version += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(version.trim());
      } else {
        resolve(null);
      }
    });

    child.on("error", () => {
      resolve(null);
    });

    // Timeout
    setTimeout(() => {
      child.kill();
      resolve(null);
    }, 5000);
  });
}

/**
 * Validate schema file syntax using Varlock
 */
export async function validateSchema(schemaPath: string): Promise<{ valid: boolean; error?: string }> {
  const varlockPath = findVarlockBinary();

  if (!varlockPath) {
    return { valid: false, error: "Varlock binary not found" };
  }

  return new Promise((resolve) => {
    const child = spawn(varlockPath, ["validate", "--path", schemaPath], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ valid: true });
      } else {
        // Return first error line only
        const errorLine = stderr.split("\n")[0];
        resolve({
          valid: false,
          error: errorLine?.slice(0, 500) ?? "Validation failed",
        });
      }
    });

    child.on("error", (err) => {
      resolve({
        valid: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    });

    // 10 second validation timeout
    setTimeout(() => {
      child.kill();
      resolve({ valid: false, error: "Validation timed out" });
    }, 10000);
  });
}
