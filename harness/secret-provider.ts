/**
 * Secret Provider Module
 *
 * Shared async resolution, immutable snapshots, and precedence handling.
 * All services await this provider for credentials.
 */

import {
  InfisicalConfig,
  loadConfig,
  isConfigured,
  activateRevision,
  createRevision,
  getSchemaPath,
  getRevision,
  markRevisionValidated,
  getSiteUrl,
  ensureDirectories,
} from "./infisical-config.js";
import {
  resolveSecrets,
  ResolutionResult,
  getVarlockVersion,
  validateSchema,
} from "./varlock-worker.js";
import {
  generateSchema,
  ServiceSecretMapping,
  ServiceName,
} from "./secret-schema.js";
import { logServiceEvent } from "./service-diagnostics.js";

/**
 * Immutable credential snapshot
 */
export interface CredentialSnapshot {
  revisionId: string;
  createdAt: string;
  secrets: Record<string, string>; // key -> value
  sources: Record<string, "infisical" | "env" | "file">; // key -> source
}

/**
 * Provider status
 */
export type ProviderStatus =
  | "unconfigured"
  | "validating"
  | "resolved"
  | "saved_awaiting_restart"
  | "active"
  | "degraded";

/**
 * Provider state
 */
export interface ProviderState {
  status: ProviderStatus;
  config: InfisicalConfig | null;
  currentSnapshot: CredentialSnapshot | null;
  activeRevision: string | null;
  lastResolvedAt: string | null;
  lastError: string | null;
  errorCode: string | null;
}

/**
 * Secret Provider singleton
 */
export class SecretProvider {
  private static instance: SecretProvider | null = null;

  private state: ProviderState = {
    status: "unconfigured",
    config: null,
    currentSnapshot: null,
    activeRevision: null,
    lastResolvedAt: null,
    lastError: null,
    errorCode: null,
  };

  private resolutionPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): SecretProvider {
    if (!SecretProvider.instance) {
      SecretProvider.instance = new SecretProvider();
    }
    return SecretProvider.instance;
  }

  /**
   * Initialize provider from config
   */
  async initialize(): Promise<void> {
    const config = loadConfig();

    if (!config || !config.enabled) {
      this.state.status = "unconfigured";
      return;
    }

    this.state.config = config;
    this.state.activeRevision = config.activeRevision;

    // Load current snapshot if we have an active revision
    if (config.activeRevision) {
      const snapshot = await this.loadSnapshot(config.activeRevision);
      if (snapshot) {
        this.state.currentSnapshot = snapshot;
        this.state.status = "active";
        this.state.lastResolvedAt = config.lastResolvedAt;
      }
    }
  }

  /**
   * Check if provider is ready
   */
  isReady(): boolean {
    return this.state.status === "active" && this.state.currentSnapshot !== null;
  }

  /**
   * Get current status
   */
  getStatus(): ProviderState {
    return { ...this.state };
  }

  /**
   * Get a secret value
   */
  get(key: string): string | undefined {
    if (!this.state.currentSnapshot) {
      return undefined;
    }
    return this.state.currentSnapshot.secrets[key];
  }

  /**
   * Get all secrets for a service
   */
  getServiceSecrets(service: ServiceName): Record<string, string> {
    const result: Record<string, string> = {};

    if (!this.state.currentSnapshot || !this.state.config) {
      return result;
    }

    const mapping = this.state.config.services.find(s => s.service === service);
    if (!mapping) {
      return result;
    }

    for (const [localKey, secretName] of Object.entries(mapping.keys)) {
      const value = this.state.currentSnapshot.secrets[secretName];
      if (value !== undefined) {
        result[localKey] = value;
      }
    }

    return result;
  }

  /**
   * Refresh secrets (resolve new snapshot)
   */
  async refresh(): Promise<{ success: boolean; error?: string }> {
    // Don't allow concurrent refresh
    if (this.resolutionPromise) {
      return { success: false, error: "Refresh already in progress" };
    }

    const config = loadConfig();
    if (!config || !config.enabled) {
      return { success: false, error: "Infisical not configured" };
    }

    this.abortController = new AbortController();
    this.state.status = "validating";

    logServiceEvent({
      ts: new Date().toISOString(),
      level: "info",
      service: "infisical",
      operation: "refresh_started",
      phase: "start",
      projectId: config.projectId,
      environment: config.environment,
    });

    this.resolutionPromise = this.doRefresh(config, this.abortController.signal);

    try {
      await this.resolutionPromise;
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      this.resolutionPromise = null;
      this.abortController = null;
    }
  }

  /**
   * Internal refresh implementation
   */
  private async doRefresh(
    config: InfisicalConfig,
    signal: AbortSignal
  ): Promise<void> {
    try {
      // Generate schema for this revision
      const revisionId = createRevision(config);
      const schemaPath = getSchemaPath(revisionId);

      const schema = generateSchema(config);
      ensureDirectories();

      // Write schema with proper permissions
      const { writeFileSync, chmodSync } = await import("node:fs");
      writeFileSync(schemaPath, schema, { mode: 0o600 });
      chmodSync(schemaPath, 0o600);

      // Validate schema
      const validation = await validateSchema(schemaPath);
      if (!validation.valid) {
        logServiceEvent({
          ts: new Date().toISOString(),
          level: "error",
          service: "infisical",
          operation: "schema_validation_failed",
          phase: "failed",
          error: validation.error,
        });

        this.state.status = "degraded";
        this.state.lastError = validation.error ?? "Schema validation failed";
        this.state.errorCode = "validation";
        return;
      }

      // Resolve secrets
      const bootstrapEnv = this.getBootstrapEnv(config);
      const result = await resolveSecrets(
        {
          schemaPath,
          cwd: process.cwd(),
          env: bootstrapEnv,
          skipCache: true,
        },
        signal
      );

      if (!result.success) {
        logServiceEvent({
          ts: new Date().toISOString(),
          level: "error",
          service: "infisical",
          operation: "secrets_resolve_failed",
          phase: "failed",
          errorCode: result.errorCode,
        });

        this.state.status = "degraded";
        this.state.lastError = result.error ?? null;
        this.state.errorCode = result.errorCode ?? "unknown";
        return;
      }

      // Build snapshot
      const secrets: Record<string, string> = {};
      const sources: Record<string, "infisical" | "env" | "file"> = {};

      for (const secret of result.secrets ?? []) {
        secrets[secret.key] = secret.value;
        sources[secret.key] = "infisical";
      }

      const snapshot: CredentialSnapshot = {
        revisionId,
        createdAt: new Date().toISOString(),
        secrets,
        sources,
      };

      // Save snapshot
      await this.saveSnapshot(revisionId, snapshot);
      markRevisionValidated(revisionId);

      // Activate revision
      activateRevision(revisionId);

      // Update state
      this.state.currentSnapshot = snapshot;
      this.state.activeRevision = revisionId;
      this.state.status = "active";
      this.state.lastResolvedAt = new Date().toISOString();
      this.state.lastError = null;
      this.state.errorCode = null;

      logServiceEvent({
        ts: new Date().toISOString(),
        level: "info",
        service: "infisical",
        operation: "snapshot_activated",
        phase: "completed",
        revisionId,
        secretCount: result.secrets?.length ?? 0,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        this.state.status = "degraded";
        this.state.lastError = "Cancelled";
        this.state.errorCode = "cancelled";
      } else {
        this.state.status = "degraded";
        this.state.lastError = err instanceof Error ? err.message : String(err);
        this.state.errorCode = "unknown";
      }
    }
  }

  /**
   * Get bootstrap environment for Varlock
   */
  private getBootstrapEnv(config: InfisicalConfig): Record<string, string> {
    const env: Record<string, string> = {};

    if (config.bootstrapRef.type === "env") {
      const value = process.env[config.bootstrapRef.name];
      if (value) {
        env[config.bootstrapRef.name] = value;
      }
    } else if (config.bootstrapRef.type === "file") {
      // Read bootstrap from file
      try {
        const { readFileSync } = require("node:fs");
        const content = readFileSync(config.bootstrapRef.path, "utf8").trim();
        // Parse KEY=value lines
        for (const line of content.split("\n")) {
          const match = line.match(/^([^=]+)=(.*)$/);
          if (match) {
            env[match[1]!.trim()] = match[2]!.trim();
          }
        }
      } catch {
        // Bootstrap file not accessible
      }
    }

    return env;
  }

  /**
   * Load snapshot from disk
   */
  private async loadSnapshot(revisionId: string): Promise<CredentialSnapshot | null> {
    const { loadConfig: reloadConfig } = await import("./infisical-config.js");
    const { existsSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const snapshotPath = join(
      (await import("./infisical-config.js")).getRevisionsDir(),
      revisionId,
      "snapshot.json"
    );

    if (!existsSync(snapshotPath)) {
      return null;
    }

    try {
      const content = readFileSync(snapshotPath, "utf8");
      return JSON.parse(content) as CredentialSnapshot;
    } catch {
      return null;
    }
  }

  /**
   * Save snapshot to disk
   */
  private async saveSnapshot(revisionId: string, snapshot: CredentialSnapshot): Promise<void> {
    const { getRevisionsDir } = await import("./infisical-config.js");
    const { writeFileSync, chmodSync } = await import("node:fs");
    const { join } = await import("node:path");

    const snapshotPath = join(getRevisionsDir(), revisionId, "snapshot.json");

    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
    chmodSync(snapshotPath, 0o600);
  }

  /**
   * Cancel ongoing refresh
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}

/**
 * Get the secret provider instance
 */
export function getSecretProvider(): SecretProvider {
  return SecretProvider.getInstance();
}

/**
 * Await provider readiness
 */
export async function awaitProviderReady(timeoutMs: number = 30000): Promise<boolean> {
  const provider = SecretProvider.getInstance();
  const start = Date.now();

  while (!provider.isReady() && provider.getStatus().status !== "unconfigured") {
    if (Date.now() - start > timeoutMs) {
      return false;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return provider.isReady();
}
